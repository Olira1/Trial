import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { dispatchConfig, redisConfig, validateEnv } from '../../config';
import {
  createDispatchIntegrationTestHarness,
  type DispatchIntegrationTestHarness,
} from '../../../test/dispatch-integration-harness';
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueModule,
  DispatchQueueService,
  dispatchJobIds,
} from './';

describe('DispatchQueueModule (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let queues: DispatchQueueService;

  const waitFor = async (assertion: () => void): Promise<void> => {
    const deadline = Date.now() + 3_000;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        assertion();
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    throw lastError;
  };

  beforeAll(async () => {
    harness = createDispatchIntegrationTestHarness();
    await harness.verifyDependencies();

    validateEnv({
      ...process.env,
      DISPATCH_QUEUE_PREFIX: harness.namespace,
    });

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [redisConfig, dispatchConfig],
        }),
        DispatchQueueModule,
      ],
    }).compile();

    queues = moduleRef.get(DispatchQueueService);
  });

  afterAll(async () => {
    await queues?.close();
    await moduleRef?.close();
    await harness?.cleanupRedisNamespace();
    await harness?.close();
    // BullMQ/ioredis can finish socket finalization after close resolves.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  it('deduplicates jobs by deterministic job id', async () => {
    const jobId = dispatchJobIds.match({
      requestId: 'request-1',
      attemptId: 'attempt-1',
    });
    const job = {
      queueName: DISPATCH_QUEUE_NAMES.match,
      jobName: 'dispatch.match.request',
      jobId,
      data: {
        requestId: 'request-1',
        attemptId: 'attempt-1',
      },
    };

    const first = await queues.enqueue(job);
    const second = await queues.enqueue(job);

    expect(first.id).toBe(jobId);
    expect(second.id).toBe(jobId);
    await expect(
      queues.getWaitingCount(DISPATCH_QUEUE_NAMES.match),
    ).resolves.toBe(1);
  });

  it('processes later jobs after a worker restart', async () => {
    const processed: string[] = [];
    const firstWorker = queues.createWorker<{ marker: string }>(
      DISPATCH_QUEUE_NAMES.notification,
      (job) => {
        processed.push(`first:${job.data.marker}`);
        return Promise.resolve();
      },
    );
    await firstWorker.waitUntilReady();

    await queues.enqueue({
      queueName: DISPATCH_QUEUE_NAMES.notification,
      jobName: 'dispatch.notification.deliver',
      jobId: 'notification-before-restart',
      data: { marker: 'before-restart' },
    });

    await waitFor(() => expect(processed).toContain('first:before-restart'));
    await firstWorker.close();

    const secondWorker = queues.createWorker<{ marker: string }>(
      DISPATCH_QUEUE_NAMES.notification,
      (job) => {
        processed.push(`second:${job.data.marker}`);
        return Promise.resolve();
      },
    );
    await secondWorker.waitUntilReady();

    await queues.enqueue({
      queueName: DISPATCH_QUEUE_NAMES.notification,
      jobName: 'dispatch.notification.deliver',
      jobId: 'notification-after-restart',
      data: { marker: 'after-restart' },
    });

    await waitFor(() => expect(processed).toContain('second:after-restart'));
    await secondWorker.close();
  });
});
