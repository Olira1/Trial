import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { dispatchConfig } from '../../config';
import { DRIZZLE, type Database } from '../../database/database.module';
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueService,
  type DispatchWorkerHandle,
  dispatchJobIds,
} from '../dispatch-queue';
import { rideRequest } from '../ride-requests/schema';
import {
  MatchOrchestrator,
  type MatchResult,
} from './match-orchestrator.service';

export const DISPATCH_MATCH_JOB_NAME = 'dispatch.match.request';

export type DispatchMatchJobData = {
  requestId: string;
  attemptId: string;
};

export type DispatchMatchJobResult = {
  status: MatchResult['status'];
  requestId: string;
};

@Injectable()
export class MatchWorkerService implements OnModuleInit {
  private readonly logger = new Logger(MatchWorkerService.name);
  private worker: DispatchWorkerHandle | null = null;

  constructor(
    private readonly orchestrator: MatchOrchestrator,
    private readonly queues: DispatchQueueService,
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    if (this.worker) return;

    this.worker = this.queues.createWorker<
      DispatchMatchJobData,
      DispatchMatchJobResult
    >(DISPATCH_QUEUE_NAMES.match, (job) => this.processJob(job));

    await this.worker.waitUntilReady();
    this.logger.log('Match worker started');
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async enqueueMatchJob(
    requestId: string,
    attemptId: string,
  ): Promise<{ id: string | undefined; name: string }> {
    const job = await this.queues.enqueue<DispatchMatchJobData>({
      queueName: DISPATCH_QUEUE_NAMES.match,
      jobName: DISPATCH_MATCH_JOB_NAME,
      jobId: dispatchJobIds.match({ requestId, attemptId }),
      data: { requestId, attemptId },
    });
    this.logger.log(
      `Match job enqueued requestId=${requestId} attemptId=${attemptId} jobId=${job.id ?? 'unknown'} jobName=${job.name}`,
    );
    return job;
  }

  async rematch(
    requestId: string,
  ): Promise<{ enqueued: boolean; reason?: string }> {
    const [request] = await this.db
      .select({
        state: rideRequest.state,
        matchingDeadlineAt: rideRequest.matchingDeadlineAt,
      })
      .from(rideRequest)
      .where(eq(rideRequest.id, requestId))
      .limit(1);

    if (!request || request.state !== 'searching') {
      return { enqueued: false, reason: 'not_searching' };
    }

    if (request.matchingDeadlineAt <= new Date()) {
      return { enqueued: false, reason: 'deadline_passed' };
    }

    const attemptId = `rematch-${Date.now()}`;
    await this.enqueueMatchJob(requestId, attemptId);

    this.logger.log(
      `Rematch enqueued requestId=${requestId} attemptId=${attemptId}`,
    );
    return { enqueued: true };
  }

  private async processJob(
    job: Job<DispatchMatchJobData, DispatchMatchJobResult, string>,
  ): Promise<DispatchMatchJobResult> {
    const { requestId, attemptId } = job.data;
    const jobAttempt = job.attemptsStarted ?? 0;

    this.logger.log(
      `Processing match job requestId=${requestId} attemptId=${attemptId} jobAttempt=${jobAttempt} jobId=${job.id}`,
    );

    try {
      const result = await this.orchestrator.attemptMatch(requestId);

      this.logger.log(
        `Match job completed requestId=${requestId} attemptId=${attemptId} result=${result.status}`,
      );

      return { status: result.status, requestId };
    } catch (error) {
      this.logger.error(
        `Match job failed requestId=${requestId} attemptId=${attemptId} jobAttempt=${jobAttempt}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
