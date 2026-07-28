import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  databaseConfig,
  dispatchConfig,
  redisConfig,
  validateEnv,
} from '../../config';
import {
  createDispatchIntegrationTestHarness,
  type DispatchIntegrationTestHarness,
} from '../../../test/dispatch-integration-harness';
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueModule,
  DispatchQueueService,
  dispatchJobIds,
} from '../dispatch-queue';
import { NotificationsService } from '../notifications';
import {
  DISPATCH_NOTIFICATION_JOB_NAME,
  DispatchNotificationWorkerService,
  type DispatchNotificationJobData,
} from './dispatch-notification-worker.service';

const waitFor = async (
  assertion: () => void,
  timeoutMs = 5_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
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

describe('DispatchNotificationWorkerService (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let queues: DispatchQueueService;
  let workerService: DispatchNotificationWorkerService;
  let notifications: jest.Mocked<NotificationsService>;

  beforeAll(async () => {
    harness = createDispatchIntegrationTestHarness();
    await harness.verifyDependencies();

    validateEnv({
      ...process.env,
      DISPATCH_QUEUE_PREFIX: harness.namespace,
      DISPATCH_QUEUE_BACKOFF_DELAY_MS: '100',
    });

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [databaseConfig, redisConfig, dispatchConfig],
        }),
        DispatchQueueModule,
      ],
      providers: [
        DispatchNotificationWorkerService,
        {
          provide: NotificationsService,
          useValue: {
            sendUserNotification: jest.fn().mockResolvedValue({
              storedCount: 1,
              sentCount: 1,
              skippedCount: 0,
              failedCount: 0,
            }),
          },
        },
      ],
    }).compile();

    queues = moduleRef.get(DispatchQueueService);
    workerService = moduleRef.get(DispatchNotificationWorkerService);
    notifications = moduleRef.get(NotificationsService);

    await workerService.start();
  });

  afterEach(async () => {
    jest.resetAllMocks();
    await queues
      .drain(DISPATCH_QUEUE_NAMES.notification)
      .catch(() => undefined);
  });

  afterAll(async () => {
    await workerService?.close();
    await queues?.close();
    await moduleRef?.close();
    await harness?.cleanupRedisNamespace();
    await harness?.close();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  const enqueueNotification = async (
    data: DispatchNotificationJobData,
    attempts?: number,
  ) => {
    return queues.enqueue<DispatchNotificationJobData>({
      queueName: DISPATCH_QUEUE_NAMES.notification,
      jobName: DISPATCH_NOTIFICATION_JOB_NAME,
      jobId: dispatchJobIds.notification({
        outboxEventId: data.outboxEventId,
        channel: 'fcm',
      }),
      data,
      attempts,
    });
  };

  it('sends a notification for a dispatch_offer.created event', async () => {
    const outboxEventId = randomUUID();
    const driverId = randomUUID();

    await enqueueNotification({
      outboxEventId,
      eventType: 'dispatch_offer.created.v1',
      driverId,
      payload: { offerId: randomUUID(), etaSeconds: 120 },
    });

    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(notifications.sendUserNotification).toHaveBeenCalledWith(
        driverId,
        expect.objectContaining({
          title: 'New ride offer',
        }),
      );
    });
  });

  it('skips events with no notification mapping', async () => {
    const outboxEventId = randomUUID();

    await enqueueNotification({
      outboxEventId,
      eventType: 'dispatch_offer.accepted.v1',
      driverId: randomUUID(),
      payload: {},
    });

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(notifications.sendUserNotification).not.toHaveBeenCalled();
  });

  it('handles missing driverId gracefully', async () => {
    const outboxEventId = randomUUID();

    await enqueueNotification({
      outboxEventId,
      eventType: 'dispatch_offer.created.v1',
      payload: { offerId: randomUUID() },
    });

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(notifications.sendUserNotification).not.toHaveBeenCalled();
  });

  it('handles user-not-found as a non-retryable skip', async () => {
    const outboxEventId = randomUUID();
    const driverId = randomUUID();
    notifications.sendUserNotification.mockRejectedValue(
      new NotFoundException('user not found'),
    );

    await enqueueNotification({
      outboxEventId,
      eventType: 'dispatch_offer.created.v1',
      driverId,
      payload: { offerId: randomUUID() },
    });

    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(notifications.sendUserNotification).toHaveBeenCalledWith(
        driverId,
        expect.any(Object),
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(notifications.sendUserNotification).toHaveBeenCalledTimes(1);
  });

  it('makes duplicate notification jobs harmless via deterministic IDs', async () => {
    const outboxEventId = randomUUID();
    const driverId = randomUUID();
    const data: DispatchNotificationJobData = {
      outboxEventId,
      eventType: 'dispatch_offer.created.v1',
      driverId,
      payload: { offerId: randomUUID() },
    };

    await enqueueNotification(data);
    await enqueueNotification(data);

    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(notifications.sendUserNotification).toHaveBeenCalledWith(
        driverId,
        expect.any(Object),
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(notifications.sendUserNotification).toHaveBeenCalledTimes(1);
  });

  it('retries transient notification failures until delivery succeeds', async () => {
    const outboxEventId = randomUUID();
    const driverId = randomUUID();
    notifications.sendUserNotification
      .mockRejectedValueOnce(new Error('fcm unavailable'))
      .mockRejectedValueOnce(new Error('fcm unavailable'))
      .mockResolvedValueOnce({
        message: 'notification sent',
        storedCount: 1,
        sentCount: 1,
        skippedCount: 0,
        failedCount: 0,
      });

    await enqueueNotification(
      {
        outboxEventId,
        eventType: 'dispatch_offer.created.v1',
        driverId,
        payload: { offerId: randomUUID() },
      },
      3,
    );

    await waitFor(
      () =>
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(notifications.sendUserNotification).toHaveBeenCalledTimes(3),
      10_000,
    );
  });
});
