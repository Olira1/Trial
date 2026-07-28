import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Queue, Worker, type JobsOptions, type Processor } from 'bullmq';
import { Redis } from 'ioredis';
import { dispatchConfig, redisConfig } from '../../config';
import type { DispatchQueueName } from './dispatch-queue.names';

export type DispatchQueueJobCounts = {
  waiting: number;
  delayed: number;
  active: number;
  completed: number;
  failed: number;
  paused: number;
};

export type DispatchEnqueueJobInput<Data = unknown> = {
  queueName: DispatchQueueName;
  jobName: string;
  jobId: string;
  data: Data;
  delayMs?: number;
  attempts?: number;
};

export type DispatchWorkerHandle = {
  waitUntilReady: () => Promise<void>;
  close: () => Promise<void>;
};

const JOB_COUNT_STATUSES = [
  'waiting',
  'delayed',
  'active',
  'completed',
  'failed',
  'paused',
] as const;

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const closeWorker = async (
  worker: Worker,
  connection: Redis | undefined,
  force: boolean,
): Promise<void> => {
  await worker.close(force);
  await worker.disconnect().catch(() => undefined);
  await connection?.quit().catch(() => connection.disconnect());
};

@Injectable()
export class DispatchQueueService
  implements OnModuleDestroy, OnApplicationShutdown
{
  private readonly redisOptions: {
    host: string;
    port: number;
    password?: string;
  };
  private readonly queues = new Map<DispatchQueueName, Queue>();
  private readonly queueConnections = new Map<Queue, Redis>();
  private readonly workers = new Set<Worker>();
  private readonly workerConnections = new Map<Worker, Redis>();
  private isClosed = false;

  constructor(
    @Inject(redisConfig.KEY)
    redis: ConfigType<typeof redisConfig>,
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
  ) {
    this.redisOptions = {
      host: redis.host,
      port: redis.port,
      password: redis.password,
    };
  }

  async enqueue<Data = unknown>(
    options: DispatchEnqueueJobInput<Data>,
  ): Promise<{ id: string | undefined; name: string }> {
    const job = await this.getQueue(options.queueName).add(
      options.jobName,
      options.data,
      {
        jobId: options.jobId,
        delay: options.delayMs,
        attempts: options.attempts ?? this.config.queueDefaultAttempts,
        backoff: {
          type: 'exponential',
          delay: this.config.queueBackoffDelayMs,
        },
      } satisfies JobsOptions,
    );

    return { id: job.id, name: job.name };
  }

  async getWaitingCount(queueName: DispatchQueueName): Promise<number> {
    const counts = await this.getJobCounts(queueName);
    return counts.waiting;
  }

  createWorker<Data = unknown, Result = unknown>(
    queueName: DispatchQueueName,
    processor: Processor<Data, Result, string>,
  ): DispatchWorkerHandle {
    const connection = this.createRedisConnection();
    const worker = new Worker<Data, Result, string>(queueName, processor, {
      connection,
      prefix: this.config.queuePrefix,
    });
    this.workers.add(worker);
    this.workerConnections.set(worker, connection);

    return {
      waitUntilReady: async () => {
        await worker.waitUntilReady();
      },
      close: async () => {
        this.workers.delete(worker);
        this.workerConnections.delete(worker);
        await closeWorker(worker, connection, true);
      },
    };
  }

  async getJobCounts(
    queueName: DispatchQueueName,
  ): Promise<DispatchQueueJobCounts> {
    const counts = await this.getQueue(queueName).getJobCounts(
      ...JOB_COUNT_STATUSES,
    );

    return {
      waiting: counts.waiting ?? 0,
      delayed: counts.delayed ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      paused: counts.paused ?? 0,
    };
  }

  async drain(queueName: DispatchQueueName): Promise<void> {
    await this.getQueue(queueName).drain(true);
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;

    const workers = [...this.workers];
    const queues = [...this.queues.values()];
    const workerConnections = new Map(this.workerConnections);
    const queueConnections = new Map(this.queueConnections);
    this.workers.clear();
    this.queues.clear();
    this.queueConnections.clear();
    this.workerConnections.clear();

    try {
      await withTimeout(
        Promise.all(
          workers.map((worker) =>
            closeWorker(worker, workerConnections.get(worker), false),
          ),
        ).then(() => undefined),
        this.config.queueWorkerShutdownTimeoutMs,
        'Timed out closing dispatch queue workers',
      );
    } catch (error) {
      await Promise.allSettled(
        workers.map((worker) =>
          closeWorker(worker, workerConnections.get(worker), true),
        ),
      );
      throw error;
    } finally {
      await Promise.all(
        queues.map(async (queue) => {
          await queue.close();
          await queue.disconnect().catch(() => undefined);
          const connection = queueConnections.get(queue);
          await connection?.quit().catch(() => connection.disconnect());
        }),
      );
    }
  }

  private getQueue(queueName: DispatchQueueName): Queue {
    const existing = this.queues.get(queueName);
    if (existing) {
      return existing;
    }

    const connection = this.createRedisConnection();
    const queue = new Queue(queueName, {
      connection,
      prefix: this.config.queuePrefix,
    });
    this.queues.set(queueName, queue);
    this.queueConnections.set(queue, connection);
    return queue;
  }

  private createRedisConnection(): Redis {
    return new Redis({
      ...this.redisOptions,
      maxRetriesPerRequest: null,
    });
  }
}
