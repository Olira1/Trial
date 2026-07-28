import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DBTransaction } from '../../database/database.module';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { driverOperationalProfile } from './schema';

export type ForceOfflineDriverPresenceInput = {
  userId: string;
  actorUserId?: string;
  onlyOwnerSessionId?: string;
  now?: Date;
};

export async function forceOfflineDriverPresence(
  tx: DBTransaction,
  input: ForceOfflineDriverPresenceInput,
): Promise<{ forced: boolean; presenceGeneration?: number }> {
  const conditions = [
    eq(driverOperationalProfile.userId, input.userId),
    eq(driverOperationalProfile.operationalState, 'online'),
  ];
  if (input.onlyOwnerSessionId) {
    conditions.push(
      eq(driverOperationalProfile.ownerSessionId, input.onlyOwnerSessionId),
    );
  }

  const [profile] = await tx
    .select()
    .from(driverOperationalProfile)
    .where(and(...conditions))
    .for('update')
    .limit(1);

  if (!profile) {
    return { forced: false };
  }

  const now = input.now ?? new Date();
  const presenceGeneration = profile.presenceGeneration + 1;
  await tx
    .update(driverOperationalProfile)
    .set({
      operationalState: 'offline',
      ownerSessionId: null,
      presenceSessionId: null,
      presenceGeneration,
      updatedAt: now,
    })
    .where(eq(driverOperationalProfile.id, profile.id));

  await tx
    .insert(dispatchOutboxEvent)
    .values({
      eventKey: `driver_presence:${input.userId}:${presenceGeneration}:driver_presence.offline.v1`,
      eventType: 'driver_presence.offline.v1',
      aggregateType: 'driver_presence',
      aggregateId: input.userId,
      correlationId: randomUUID(),
      actorUserId: input.actorUserId ?? input.userId,
      payload: {
        userId: input.userId,
        operationalState: 'offline',
        presenceSessionId: null,
        presenceGeneration,
      },
    })
    .onConflictDoNothing({
      target: dispatchOutboxEvent.eventKey,
    });

  return { forced: true, presenceGeneration };
}
