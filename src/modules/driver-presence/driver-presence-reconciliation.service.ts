import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { eq, inArray } from 'drizzle-orm';
import { dispatchConfig } from '../../config';
import { DRIZZLE, type Database } from '../../database/database.module';
import { REDIS_CLIENT } from '../redis';
import type { Redis } from '../redis';
import { clearDriverPresenceRedisAuthority } from './clear-driver-presence-redis-authority';
import { driverOperationalProfile } from './schema';

const RECONCILIATION_INTERVAL_MS = 60_000;

export interface ReconciliationResult {
  cleanedUserIds: string[];
  disagreementCount: number;
  candidateSupply: number;
  durationMs: number;
}

@Injectable()
export class DriverPresenceReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    DriverPresenceReconciliationService.name,
  );
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(dispatchConfig.KEY)
    private readonly dispatchCfg: ConfigType<typeof dispatchConfig>,
  ) {}

  onModuleInit() {
    this.logger.log({
      msg: 'starting reconciliation scheduler',
      intervalMs: RECONCILIATION_INTERVAL_MS,
    });
    this.timer = setInterval(() => {
      this.reconcile().catch((err: unknown) => {
        this.logger.error({
          msg: 'scheduled reconciliation failed',
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, RECONCILIATION_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async reconcile(): Promise<ReconciliationResult> {
    const start = Date.now();
    const cleanedUserIds: string[] = [];
    const prefix = this.dispatchCfg.queuePrefix;
    const ownerPattern = `${prefix}:driver_presence:owner:*`;

    try {
      let cursor = '0';
      const allOwnerKeys: string[] = [];

      do {
        const [nextCursor, keys]: [string, string[]] = await this.redis.scan(
          cursor,
          'MATCH',
          ownerPattern,
        );
        cursor = nextCursor;
        allOwnerKeys.push(...keys);
      } while (cursor !== '0');

      if (allOwnerKeys.length > 0) {
        const userIds = allOwnerKeys.map((key) => {
          const parts = key.split(':');
          return parts.at(-1)!;
        });

        const profiles = await this.db
          .select({
            userId: driverOperationalProfile.userId,
            operationalState: driverOperationalProfile.operationalState,
          })
          .from(driverOperationalProfile)
          .where(inArray(driverOperationalProfile.userId, userIds))
          .execute();
        const profileMap = new Map(
          profiles.map((p) => [p.userId, p.operationalState]),
        );

        for (const userId of userIds) {
          const state = profileMap.get(userId);
          if (!state || state !== 'online') {
            await clearDriverPresenceRedisAuthority(
              this.redis,
              prefix,
              this.dispatchCfg.h3Resolution,
              userId,
            );
            cleanedUserIds.push(userId);
          }
        }
      }

      const onlineUserIds = (
        await this.db
          .select({ userId: driverOperationalProfile.userId })
          .from(driverOperationalProfile)
          .where(eq(driverOperationalProfile.operationalState, 'online'))
          .execute()
      ).map((r) => r.userId);

      let disagreementCount = 0;
      for (const userId of onlineUserIds) {
        const ownerKey = `${prefix}:driver_presence:owner:${userId}`;
        const exists = await this.redis.exists(ownerKey);
        if (!exists) {
          disagreementCount++;
        }
      }

      const candidateSupply = allOwnerKeys.length;

      this.logger.log({
        msg: 'reconciliation complete',
        cleaned: cleanedUserIds.length,
        disagreements: disagreementCount,
        candidateSupply,
        durationMs: Date.now() - start,
      });

      return {
        cleanedUserIds,
        disagreementCount,
        candidateSupply,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      this.logger.error({ msg: 'reconciliation failed', error });
      return {
        cleanedUserIds: [],
        disagreementCount: 0,
        candidateSupply: 0,
        durationMs: Date.now() - start,
      };
    }
  }
}
