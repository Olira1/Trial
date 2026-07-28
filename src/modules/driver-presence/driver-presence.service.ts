import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { dispatchConfig } from '../../config';
import {
  DRIZZLE,
  type Database,
  type DBTransaction,
} from '../../database/database.module';
import { DispatchOutboxService } from '../dispatch-outbox';
import { driverOperationalProfile } from './schema';
import { DriverEligibilityService } from './driver-eligibility.service';
import { DriverPresenceLeaseService } from './driver-presence-lease.service';
import type { DriverOperationalState } from './driver-operational-state';
import type { DriverLocationCommand } from './dto/driver-presence.dto';

export type GoOnlineInput = {
  userId: string;
  sessionId: string;
  initialLocation: DriverLocationCommand;
  takeoverConfirmed: boolean;
};

export type GoOfflineInput = {
  userId: string;
  sessionId: string;
};

export type ResumePresenceInput = {
  userId: string;
  sessionId: string;
  presenceSessionId: string;
  currentLocation: DriverLocationCommand;
};

export type DriverPresenceCommandResponse = {
  operationalState: 'online' | 'offline';
  presenceSessionId: string | null;
  leaseId: string | null;
  leaseSequence: 0 | null;
  resumeRequired: boolean;
};

export type DriverPresenceUnavailableReason =
  | 'offline'
  | 'not_eligible'
  | 'not_owner'
  | 'stale_presence'
  | 'redis_unavailable'
  | 'offered'
  | 'assigned'
  | 'suspended';

export type DriverPresenceSnapshotResponse = {
  operationalState: DriverOperationalState;
  isCurrentSessionOwner: boolean;
  presenceSessionId: string | null;
  dispatchAvailable: boolean;
  unavailableReasons: DriverPresenceUnavailableReason[];
};

@Injectable()
export class DriverPresenceService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly eligibility: DriverEligibilityService,
    private readonly outbox: DispatchOutboxService,
    private readonly leases: DriverPresenceLeaseService,
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
  ) {}

  async goOnline(input: GoOnlineInput): Promise<DriverPresenceCommandResponse> {
    this.assertCommandLocation(input.initialLocation);

    const committed = await this.db.transaction(async (tx) => {
      const eligibility =
        await this.eligibility.evaluateInstantRideDriverEligibility(
          input.userId,
          tx,
        );
      if (!eligibility.eligible) {
        throw new ForbiddenException('driver is not eligible for Instant Ride');
      }

      const existing = await this.getLockedProfile(input.userId, tx);
      if (existing?.operationalState === 'offered') {
        throw new ConflictException('driver has an active dispatch offer');
      }
      if (existing?.operationalState === 'assigned') {
        throw new ConflictException('driver has an active dispatch assignment');
      }
      if (existing?.operationalState === 'suspended') {
        throw new ConflictException('driver is suspended');
      }
      if (
        existing?.operationalState === 'online' &&
        existing.ownerSessionId !== input.sessionId &&
        !input.takeoverConfirmed
      ) {
        throw new ConflictException(
          'driver is already online in another session; confirm takeover',
        );
      }

      const generation =
        existing?.operationalState === 'online' &&
        existing.ownerSessionId === input.sessionId
          ? existing.presenceGeneration
          : (existing?.presenceGeneration ?? 0) + 1;
      const presenceSessionId =
        existing?.operationalState === 'online' &&
        existing.ownerSessionId === input.sessionId &&
        existing.presenceSessionId
          ? existing.presenceSessionId
          : randomUUID();
      const now = new Date();

      if (existing) {
        await tx
          .update(driverOperationalProfile)
          .set({
            operationalState: 'online',
            ownerSessionId: input.sessionId,
            presenceSessionId,
            presenceGeneration: generation,
            updatedAt: now,
          })
          .where(eq(driverOperationalProfile.userId, input.userId));
      } else {
        await tx.insert(driverOperationalProfile).values({
          userId: input.userId,
          operationalState: 'online',
          ownerSessionId: input.sessionId,
          presenceSessionId,
          presenceGeneration: generation,
        });
      }

      await this.appendPresenceEvent(tx, {
        userId: input.userId,
        presenceSessionId,
        presenceGeneration: generation,
        eventType:
          existing?.operationalState === 'online' &&
          existing.ownerSessionId !== input.sessionId
            ? 'driver_presence.takeover.v1'
            : 'driver_presence.online.v1',
      });

      return {
        userId: input.userId,
        presenceSessionId,
        presenceGeneration: generation,
      };
    });

    try {
      const lease = await this.leases.createInitialLease({
        userId: committed.userId,
        ownerSessionId: input.sessionId,
        presenceSessionId: committed.presenceSessionId,
        presenceGeneration: committed.presenceGeneration,
        location: input.initialLocation,
      });

      return {
        operationalState: 'online',
        presenceSessionId: committed.presenceSessionId,
        leaseId: lease.leaseId,
        leaseSequence: lease.leaseSequence,
        resumeRequired: false,
      };
    } catch {
      return {
        operationalState: 'online',
        presenceSessionId: committed.presenceSessionId,
        leaseId: null,
        leaseSequence: null,
        resumeRequired: true,
      };
    }
  }

  async goOffline(
    input: GoOfflineInput,
  ): Promise<DriverPresenceCommandResponse> {
    await this.db.transaction(async (tx) => {
      const existing = await this.getLockedProfile(input.userId, tx);

      if (!existing || existing.operationalState === 'offline') {
        return;
      }
      if (existing.operationalState === 'offered') {
        throw new ConflictException('driver has an active dispatch offer');
      }
      if (existing.operationalState === 'assigned') {
        throw new ConflictException('driver has an active dispatch assignment');
      }
      if (existing.operationalState === 'suspended') {
        throw new ConflictException('driver is suspended');
      }
      if (existing.ownerSessionId !== input.sessionId) {
        throw new ConflictException(
          'driver presence is owned by another session',
        );
      }

      const presenceGeneration = existing.presenceGeneration + 1;
      await tx
        .update(driverOperationalProfile)
        .set({
          operationalState: 'offline',
          ownerSessionId: null,
          presenceSessionId: null,
          presenceGeneration,
          updatedAt: new Date(),
        })
        .where(eq(driverOperationalProfile.userId, input.userId));

      await this.appendPresenceEvent(tx, {
        userId: input.userId,
        presenceSessionId: null,
        presenceGeneration,
        eventType: 'driver_presence.offline.v1',
      });
    });

    await this.leases.clearOwnerAuthority(input.userId).catch(() => undefined);

    return {
      operationalState: 'offline',
      presenceSessionId: null,
      leaseId: null,
      leaseSequence: null,
      resumeRequired: false,
    };
  }

  async resume(
    input: ResumePresenceInput,
  ): Promise<DriverPresenceCommandResponse> {
    this.assertCommandLocation(input.currentLocation);

    const committed = await this.db.transaction(async (tx) => {
      const eligibility =
        await this.eligibility.evaluateInstantRideDriverEligibility(
          input.userId,
          tx,
        );
      if (!eligibility.eligible) {
        throw new ForbiddenException('driver is not eligible for Instant Ride');
      }

      const existing = await this.getLockedProfile(input.userId, tx);
      if (!existing || existing.operationalState !== 'online') {
        throw new ConflictException('driver is not online');
      }
      if (existing.ownerSessionId !== input.sessionId) {
        throw new ConflictException(
          'driver presence is owned by another session',
        );
      }
      if (existing.presenceSessionId !== input.presenceSessionId) {
        throw new ConflictException('presence session does not match owner');
      }

      return {
        userId: input.userId,
        presenceSessionId: existing.presenceSessionId,
        presenceGeneration: existing.presenceGeneration,
      };
    });

    try {
      const lease = await this.leases.createInitialLease({
        userId: committed.userId,
        ownerSessionId: input.sessionId,
        presenceSessionId: committed.presenceSessionId,
        presenceGeneration: committed.presenceGeneration,
        location: input.currentLocation,
      });

      return {
        operationalState: 'online',
        presenceSessionId: committed.presenceSessionId,
        leaseId: lease.leaseId,
        leaseSequence: lease.leaseSequence,
        resumeRequired: false,
      };
    } catch {
      throw new ServiceUnavailableException(
        'driver presence lease could not be created',
      );
    }
  }

  async getSnapshot(input: {
    userId: string;
    sessionId: string;
  }): Promise<DriverPresenceSnapshotResponse> {
    const snapshot = await this.db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(driverOperationalProfile)
        .where(eq(driverOperationalProfile.userId, input.userId))
        .limit(1);
      const eligibility =
        await this.eligibility.evaluateInstantRideDriverEligibility(
          input.userId,
          tx,
        );

      return { profile: profile ?? null, eligibility };
    });

    const operationalState =
      snapshot.profile?.operationalState ?? ('offline' as const);
    const isCurrentSessionOwner =
      snapshot.profile?.operationalState === 'online' &&
      snapshot.profile.ownerSessionId === input.sessionId &&
      Boolean(snapshot.profile.presenceSessionId);
    const presenceSessionId = isCurrentSessionOwner
      ? (snapshot.profile?.presenceSessionId ?? null)
      : null;
    const unavailableReasons: DriverPresenceUnavailableReason[] = [];

    if (!snapshot.eligibility.eligible) {
      unavailableReasons.push('not_eligible');
    }

    if (operationalState === 'offline') {
      unavailableReasons.push('offline');
    } else if (operationalState === 'offered') {
      unavailableReasons.push('offered');
    } else if (operationalState === 'assigned') {
      unavailableReasons.push('assigned');
    } else if (operationalState === 'suspended') {
      unavailableReasons.push('suspended');
    } else if (!isCurrentSessionOwner) {
      unavailableReasons.push('not_owner');
    }

    if (operationalState === 'online' && isCurrentSessionOwner) {
      try {
        const hasActiveLease =
          presenceSessionId !== null
            ? await this.leases.hasActiveLease(presenceSessionId)
            : false;
        if (!hasActiveLease) {
          unavailableReasons.push('stale_presence');
        }
      } catch {
        unavailableReasons.push('redis_unavailable');
      }
    }

    return {
      operationalState,
      isCurrentSessionOwner,
      presenceSessionId,
      dispatchAvailable: unavailableReasons.length === 0,
      unavailableReasons,
    };
  }

  private async getLockedProfile(userId: string, tx: DBTransaction) {
    const [profile] = await tx
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, userId))
      .limit(1)
      .for('update');

    return profile ?? null;
  }

  private assertCommandLocation(location: DriverLocationCommand) {
    if (location.accuracyMeters > this.config.maxLocationAccuracyMeters) {
      throw new BadRequestException(
        'location accuracy is outside dispatch limits',
      );
    }

    const capturedAtMs = location.capturedAt.getTime();
    const nowMs = Date.now();
    if (capturedAtMs < nowMs - this.config.capturedAtMaxAgeSeconds * 1_000) {
      throw new BadRequestException('location capture time is too old');
    }
    if (
      capturedAtMs >
      nowMs + this.config.capturedAtMaxFutureSkewSeconds * 1_000
    ) {
      throw new BadRequestException(
        'location capture time is too far in the future',
      );
    }
  }

  private appendPresenceEvent(
    tx: DBTransaction,
    input: {
      userId: string;
      presenceSessionId: string | null;
      presenceGeneration: number;
      eventType:
        | 'driver_presence.online.v1'
        | 'driver_presence.offline.v1'
        | 'driver_presence.takeover.v1';
    },
  ) {
    return this.outbox.append(tx, {
      eventKey: `driver_presence:${input.userId}:${input.presenceGeneration}:${input.eventType}`,
      eventType: input.eventType,
      aggregateType: 'driver_presence',
      aggregateId: input.userId,
      correlationId: randomUUID(),
      actorUserId: input.userId,
      payload: {
        userId: input.userId,
        operationalState:
          input.eventType === 'driver_presence.offline.v1'
            ? 'offline'
            : 'online',
        presenceSessionId: input.presenceSessionId,
        presenceGeneration: input.presenceGeneration,
      },
    });
  }
}
