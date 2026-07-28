import { randomUUID } from 'node:crypto';
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
import {
  DISPATCH_PICKUP_REMINDER_JOB_NAME,
  DispatchAssignmentPickupService,
  type DispatchPickupReminderJobData,
} from './dispatch-assignment-pickup.service';
import { DispatchPickupReminderWorkerService } from './dispatch-pickup-reminder-worker.service';

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

describe('DispatchPickupReminderWorkerService (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let queues: DispatchQueueService;
  let workerService: DispatchPickupReminderWorkerService;
  let pickup: jest.Mocked<DispatchAssignmentPickupService>;

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
        DispatchPickupReminderWorkerService,
        {
          provide: DispatchAssignmentPickupService,
          useValue: {
            sendTripStartWarning: jest.fn().mockResolvedValue({
              id: randomUUID(),
              state: 'warning_sent',
            }),
          },
        },
      ],
    }).compile();

    queues = moduleRef.get(DispatchQueueService);
    workerService = moduleRef.get(DispatchPickupReminderWorkerService);
    pickup = moduleRef.get(DispatchAssignmentPickupService);

    await workerService.start();
  });

  afterEach(async () => {
    jest.resetAllMocks();
    await queues
      .drain(DISPATCH_QUEUE_NAMES.pickupReminder)
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

  it('sends a trip-start warning for pickup reminder jobs', async () => {
    const pickupId = randomUUID();
    const warningDueAt = new Date();

    await queues.enqueue<DispatchPickupReminderJobData>({
      queueName: DISPATCH_QUEUE_NAMES.pickupReminder,
      jobName: DISPATCH_PICKUP_REMINDER_JOB_NAME,
      jobId: dispatchJobIds.pickupReminder({ pickupId, warningDueAt }),
      data: {
        pickupId,
        warningDueAt: warningDueAt.toISOString(),
      },
    });

    await waitFor(() =>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(pickup.sendTripStartWarning).toHaveBeenCalledWith(pickupId),
    );
  });
});
