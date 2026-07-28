import type { Redis } from '../redis';
import { driverPresenceRedisKeys } from './driver-presence-redis-keys';
import type {
  DriverPresenceLeaseSnapshot,
  DriverPresenceOwnerLease,
} from './driver-presence-lease.service';

export async function clearDriverPresenceRedisAuthority(
  redis: Redis,
  queuePrefix: string,
  h3Resolution: number,
  userId: string,
) {
  const ownerKey = driverPresenceRedisKeys.owner(queuePrefix, userId);
  const ownerRaw = await redis.get(ownerKey);
  if (!ownerRaw) {
    await redis.del(ownerKey);
    return;
  }

  const owner = JSON.parse(ownerRaw) as DriverPresenceOwnerLease;
  const leaseKey = driverPresenceRedisKeys.lease(
    queuePrefix,
    owner.presenceSessionId,
  );
  const leaseRaw = await redis.get(leaseKey);
  const lease = leaseRaw
    ? (JSON.parse(leaseRaw) as DriverPresenceLeaseSnapshot)
    : null;

  const tx = redis.multi().del(ownerKey);
  if (lease) {
    tx.del(leaseKey);
    tx.zrem(
      `${queuePrefix}:driver_presence:h3:${h3Resolution}:${lease.h3Cell}`,
      userId,
    );
  }
  await tx.exec();
}
