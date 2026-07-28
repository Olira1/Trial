import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import type { ConfigType } from '@nestjs/config';
import { dispatchConfig } from '../../config';
import { REDIS_CLIENT, type Redis } from '../redis';
import { clearDriverPresenceRedisAuthority } from './clear-driver-presence-redis-authority';
import { driverPresenceRedisKeys } from './driver-presence-redis-keys';
import type {
  DriverLocationCommand,
  DriverLocationUpdateEvent,
} from './dto/driver-presence.dto';

export type CreateDriverPresenceLeaseInput = {
  userId: string;
  ownerSessionId: string;
  presenceSessionId: string;
  presenceGeneration: number;
  location: DriverLocationCommand;
};

export type DriverPresenceLeaseResult = {
  leaseId: string;
  leaseSequence: 0;
};

export type DriverPresenceOwnerLease = {
  userId: string;
  ownerSessionId: string;
  presenceSessionId: string;
  presenceGeneration: number;
  leaseId: string;
};

export type DriverPresenceLeaseSnapshot = DriverPresenceOwnerLease & {
  leaseSequence: number;
  h3Cell: string;
  freshUntil: string;
  expiresAt: string;
  serverReceivedAt?: string;
  location: {
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    capturedAt: string;
    headingDegrees?: number;
    speedMetersPerSecond?: number;
  };
};

export type DriverPresenceLocationUpdateAck = {
  status:
    | 'accepted'
    | 'ignored_duplicate'
    | 'ignored_stale_sequence'
    | 'ignored_rate_limited'
    | 'rejected_invalid'
    | 'rejected_unauthorized'
    | 'rejected_not_owner'
    | 'rejected_expired_lease'
    | 'rejected_stale_capture'
    | 'unavailable_redis';
};

export type DriverPresenceIndexedCandidate = DriverPresenceLeaseSnapshot;

@Injectable()
export class DriverPresenceLeaseService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
  ) {}

  async createInitialLease(
    input: CreateDriverPresenceLeaseInput,
  ): Promise<DriverPresenceLeaseResult> {
    const leaseId = randomUUID();
    const leaseSequence = 0 as const;
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.locationCleanupTtlSeconds * 1_000,
    );
    const h3Cell = latLngToCell(
      input.location.latitude,
      input.location.longitude,
      this.config.h3Resolution,
    );
    const lease = {
      userId: input.userId,
      ownerSessionId: input.ownerSessionId,
      presenceSessionId: input.presenceSessionId,
      presenceGeneration: input.presenceGeneration,
      leaseId,
      leaseSequence,
      h3Cell,
      freshUntil: new Date(
        now.getTime() + this.config.locationFreshnessSeconds * 1_000,
      ).toISOString(),
      expiresAt: expiresAt.toISOString(),
      location: {
        latitude: input.location.latitude,
        longitude: input.location.longitude,
        accuracyMeters: input.location.accuracyMeters,
        capturedAt: input.location.capturedAt.toISOString(),
      },
    } satisfies DriverPresenceLeaseSnapshot;

    await this.redis
      .multi()
      .set(
        this.leaseKey(input.presenceSessionId),
        JSON.stringify(lease),
        'EX',
        this.config.locationCleanupTtlSeconds,
      )
      .set(
        this.ownerKey(input.userId),
        JSON.stringify({
          userId: input.userId,
          ownerSessionId: input.ownerSessionId,
          presenceSessionId: input.presenceSessionId,
          presenceGeneration: input.presenceGeneration,
          leaseId,
        } satisfies DriverPresenceOwnerLease),
        'EX',
        this.config.locationCleanupTtlSeconds,
      )
      .zadd(this.cellKey(h3Cell), expiresAt.getTime(), input.userId)
      .expire(this.cellKey(h3Cell), this.config.locationCleanupTtlSeconds)
      .exec();

    return { leaseId, leaseSequence };
  }

  async hasActiveLease(presenceSessionId: string): Promise<boolean> {
    return (await this.redis.exists(this.leaseKey(presenceSessionId))) === 1;
  }

  async clearOwnerAuthority(userId: string): Promise<void> {
    await clearDriverPresenceRedisAuthority(
      this.redis,
      this.config.queuePrefix,
      this.config.h3Resolution,
      userId,
    );
  }

  async findCurrentLeaseByUserId(
    userId: string,
    now: Date = new Date(),
  ): Promise<DriverPresenceLeaseSnapshot | null> {
    const ownerRaw = await this.redis.get(this.ownerKey(userId));
    if (!ownerRaw) {
      return null;
    }

    const owner = JSON.parse(ownerRaw) as DriverPresenceOwnerLease;
    const leaseRaw = await this.redis.get(
      this.leaseKey(owner.presenceSessionId),
    );
    if (!leaseRaw) {
      return null;
    }

    const lease = JSON.parse(leaseRaw) as DriverPresenceLeaseSnapshot;
    const nowMs = now.getTime();
    if (
      lease.presenceSessionId !== owner.presenceSessionId ||
      lease.presenceGeneration !== owner.presenceGeneration ||
      lease.leaseId !== owner.leaseId ||
      new Date(lease.freshUntil).getTime() <= nowMs ||
      new Date(lease.expiresAt).getTime() <= nowMs
    ) {
      return null;
    }

    return lease;
  }

  async acknowledgeLocationUpdate(input: {
    userId: string;
    sessionId: string;
    payload: DriverLocationUpdateEvent;
  }): Promise<DriverPresenceLocationUpdateAck> {
    const now = new Date();
    const capturedAtMs = input.payload.capturedAt.getTime();
    const nowMs = now.getTime();

    if (
      capturedAtMs < nowMs - this.config.capturedAtMaxAgeSeconds * 1_000 ||
      capturedAtMs > nowMs + this.config.capturedAtMaxFutureSkewSeconds * 1_000
    ) {
      return { status: 'rejected_stale_capture' };
    }

    const ownerKey = this.ownerKey(input.userId);
    const leaseKey = this.leaseKey(input.payload.presenceSessionId);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.redis.watch(ownerKey, leaseKey);
      try {
        const [ownerRaw, leaseRaw] = await this.redis.mget(ownerKey, leaseKey);
        if (!ownerRaw || !leaseRaw) {
          return { status: 'rejected_expired_lease' };
        }

        const owner = JSON.parse(ownerRaw) as DriverPresenceOwnerLease;
        const lease = JSON.parse(leaseRaw) as DriverPresenceLeaseSnapshot;

        if (
          owner.ownerSessionId !== input.sessionId ||
          owner.presenceSessionId !== input.payload.presenceSessionId ||
          lease.ownerSessionId !== input.sessionId ||
          lease.presenceSessionId !== input.payload.presenceSessionId
        ) {
          return { status: 'rejected_not_owner' };
        }

        if (
          owner.leaseId !== input.payload.leaseId ||
          lease.leaseId !== input.payload.leaseId
        ) {
          return { status: 'rejected_expired_lease' };
        }

        if (input.payload.sequence === lease.leaseSequence) {
          return { status: 'ignored_duplicate' };
        }
        if (input.payload.sequence < lease.leaseSequence) {
          return { status: 'ignored_stale_sequence' };
        }

        if (lease.serverReceivedAt) {
          const elapsedMs = nowMs - new Date(lease.serverReceivedAt).getTime();
          if (
            elapsedMs <
            this.config.locationMinUpdateIntervalSeconds * 1_000
          ) {
            return { status: 'ignored_rate_limited' };
          }
        }

        const nextLease = {
          ...lease,
          leaseSequence: input.payload.sequence,
          h3Cell: latLngToCell(
            input.payload.latitude,
            input.payload.longitude,
            this.config.h3Resolution,
          ),
          freshUntil: new Date(
            now.getTime() + this.config.locationFreshnessSeconds * 1_000,
          ).toISOString(),
          expiresAt: new Date(
            now.getTime() + this.config.locationCleanupTtlSeconds * 1_000,
          ).toISOString(),
          serverReceivedAt: now.toISOString(),
          location: {
            latitude: input.payload.latitude,
            longitude: input.payload.longitude,
            accuracyMeters: input.payload.accuracyMeters,
            capturedAt: input.payload.capturedAt.toISOString(),
            ...(input.payload.headingDegrees !== undefined
              ? { headingDegrees: input.payload.headingDegrees }
              : {}),
            ...(input.payload.speedMetersPerSecond !== undefined
              ? { speedMetersPerSecond: input.payload.speedMetersPerSecond }
              : {}),
          },
        } satisfies DriverPresenceLeaseSnapshot;

        const tx = this.redis
          .multi()
          .set(
            leaseKey,
            JSON.stringify(nextLease),
            'EX',
            this.config.locationCleanupTtlSeconds,
          )
          .set(
            ownerKey,
            JSON.stringify(owner),
            'EX',
            this.config.locationCleanupTtlSeconds,
          )
          .zadd(
            this.cellKey(nextLease.h3Cell),
            new Date(nextLease.expiresAt).getTime(),
            input.userId,
          )
          .expire(
            this.cellKey(nextLease.h3Cell),
            this.config.locationCleanupTtlSeconds,
          );
        if (lease.h3Cell !== nextLease.h3Cell) {
          tx.zrem(this.cellKey(lease.h3Cell), input.userId);
        }
        const result = await tx.exec();

        if (result) {
          return { status: 'accepted' };
        }
      } finally {
        await this.redis.unwatch();
      }
    }

    return { status: 'unavailable_redis' };
  }

  async listActiveCellCandidates(
    h3Cell: string,
    now: Date = new Date(),
  ): Promise<DriverPresenceIndexedCandidate[]> {
    const cellKey = this.cellKey(h3Cell);
    const nowMs = now.getTime();
    await this.redis.zremrangebyscore(cellKey, 0, nowMs - 1);

    const userIds = await this.redis.zrangebyscore(cellKey, nowMs, '+inf');
    if (userIds.length === 0) {
      return [];
    }

    const ownerKeys = userIds.map((userId) => this.ownerKey(userId));
    const ownerRows = await this.redis.mget(ownerKeys);
    const currentOwners = ownerRows
      .map((row) =>
        row ? (JSON.parse(row) as DriverPresenceOwnerLease) : null,
      )
      .filter((row): row is DriverPresenceOwnerLease => row !== null);
    if (currentOwners.length === 0) {
      return [];
    }

    const leaseRows = await this.redis.mget(
      currentOwners.map((owner) => this.leaseKey(owner.presenceSessionId)),
    );

    return leaseRows
      .map((row, index) => {
        const owner = currentOwners[index];
        if (!row || !owner) {
          return null;
        }
        const lease = JSON.parse(row) as DriverPresenceLeaseSnapshot;
        if (
          lease.h3Cell !== h3Cell ||
          lease.presenceSessionId !== owner.presenceSessionId ||
          lease.presenceGeneration !== owner.presenceGeneration ||
          lease.leaseId !== owner.leaseId ||
          new Date(lease.freshUntil).getTime() <= nowMs ||
          new Date(lease.expiresAt).getTime() <= nowMs
        ) {
          return null;
        }
        return lease;
      })
      .filter((lease): lease is DriverPresenceLeaseSnapshot => lease !== null);
  }

  private leaseKey(presenceSessionId: string) {
    return driverPresenceRedisKeys.lease(
      this.config.queuePrefix,
      presenceSessionId,
    );
  }

  private ownerKey(userId: string) {
    return driverPresenceRedisKeys.owner(this.config.queuePrefix, userId);
  }

  private cellKey(h3Cell: string) {
    return `${this.config.queuePrefix}:driver_presence:h3:${this.config.h3Resolution}:${h3Cell}`;
  }
}
