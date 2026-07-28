import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  DRIZZLE,
  type Database,
  type DBExecutor,
  type DBTransaction,
} from '../../database/database.module';
import {
  DAILY_EARLY_JOINER_MILES,
  EARLY_JOINER_END_DATE,
  EARLY_JOINER_REWARD_SOURCE,
} from './rewards.constants';
import { userRewardLedger } from './schema';

@Injectable()
export class RewardsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RewardsService.name);
  private dailyTimer?: NodeJS.Timeout;

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private executor(tx?: DBExecutor): DBExecutor {
    return tx ?? this.db;
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;

    await this.grantEarlyJoinerRewardsThrough();
    this.scheduleNextDailyRun();
  }

  onModuleDestroy() {
    if (this.dailyTimer) clearTimeout(this.dailyTimer);
  }

  async getMilesForUser(userId: string, tx?: DBExecutor): Promise<number> {
    const db = this.executor(tx);
    const [row] = await db
      .select({
        miles: sql<string>`coalesce(sum(${userRewardLedger.miles}), 0)::text`,
      })
      .from(userRewardLedger)
      .where(eq(userRewardLedger.userId, userId));

    return Number(row?.miles ?? 0);
  }

  async grantEarlyJoinerRewardsThrough(
    asOf = new Date(),
    tx?: DBTransaction,
  ): Promise<void> {
    const asOfDate = this.toUtcDateString(asOf);

    const result = tx
      ? await this.grantEarlyJoinerRewardsInTransaction(tx, asOfDate)
      : await this.db.transaction(
          (transaction) =>
            this.grantEarlyJoinerRewardsInTransaction(transaction, asOfDate),
          { accessMode: 'read write', isolationLevel: 'read committed' },
        );

    if (!result.acquiredLock) {
      this.logger.log(
        `skipped early joiner rewards through ${asOfDate}; another transaction is running`,
      );
      return;
    }

    this.logger.log(
      `granted ${result.insertedCount} early joiner rewards through ${asOfDate}`,
    );
  }

  private async grantEarlyJoinerRewardsInTransaction(
    tx: DBTransaction,
    asOfDate: string,
  ) {
    const lockResult = await tx.execute<{ locked: boolean }>(sql`
      select pg_try_advisory_xact_lock(hashtext('ubel_early_joiner_daily_rewards')) as locked
    `);

    if (!lockResult.rows[0]?.locked) {
      return { acquiredLock: false, insertedCount: 0 };
    }

    const insertResult = await tx.execute<{ insertedCount: number }>(sql`
      with inserted_rewards as (
        insert into user_reward_ledger (user_id, reward_date, miles, source)
        select
          eligible_users.id,
          reward_days.reward_date,
          ${DAILY_EARLY_JOINER_MILES},
          ${EARLY_JOINER_REWARD_SOURCE}
        from (
          select
            "user".id,
            ("user".created_at at time zone 'UTC')::date as signup_date
          from "user"
          where "user".is_active = true
            and "user".deleted_at is null
            and "user".roles && array['rider', 'driver']::user_role[]
        ) eligible_users
        cross join lateral generate_series(
          eligible_users.signup_date,
          least(${asOfDate}::date, ${EARLY_JOINER_END_DATE}::date),
          interval '1 day'
        ) as reward_days(reward_date)
        on conflict (user_id, reward_date, source) do nothing
        returning 1
      )
      select count(*)::int as "insertedCount" from inserted_rewards
    `);

    return {
      acquiredLock: true,
      insertedCount: Number(insertResult.rows[0]?.insertedCount ?? 0),
    };
  }

  private scheduleNextDailyRun() {
    const delayMs = this.msUntilNextUtcDay();
    this.dailyTimer = setTimeout(() => {
      void this.runScheduledGrant();
    }, delayMs);
    this.dailyTimer.unref();
  }

  private async runScheduledGrant() {
    try {
      await this.grantEarlyJoinerRewardsThrough();
    } catch (error) {
      this.logger.error('failed to grant early joiner rewards', error);
    } finally {
      this.scheduleNextDailyRun();
    }
  }

  private msUntilNextUtcDay() {
    const now = new Date();
    const nextUtcDay = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    );
    return Math.max(nextUtcDay - now.getTime(), 1_000);
  }

  private toUtcDateString(date: Date) {
    return date.toISOString().slice(0, 10);
  }
}
