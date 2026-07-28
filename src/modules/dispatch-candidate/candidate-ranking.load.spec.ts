import { performance } from 'node:perf_hooks';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { dispatchConfig } from '../../config';
import { ROUTING_PROVIDER } from '../dispatch-routing';
import { CandidateRankingService } from './candidate-ranking.service';
import { CoarseDiscoveryService } from './coarse-discovery.service';
import { CandidateRevalidationService } from './candidate-revalidation.service';
import {
  DISPATCH_METRICS,
  type DispatchMetrics,
} from './dispatch-metrics.service';

describe('CandidateRankingService load simulation', () => {
  let service: CandidateRankingService;
  let maxInFlightSeen = 0;

  const pickup = { latitude: 9.01, longitude: 38.76 };
  const coarseCandidate = {
    driverId: 'driver-1',
    straightLineKm: 1,
    location: { latitude: 9.015, longitude: 38.765 },
  };
  const validatedCandidate = {
    driverId: 'driver-1',
    exactDistanceKm: 1,
    location: coarseCandidate.location,
  };

  beforeEach(async () => {
    process.env.GEBETA_API_KEY = 'test-key';
    process.env.DISPATCH_ROUTING_MAX_CONCURRENCY = '3';
    process.env.DISPATCH_ROUTING_MAX_CALLS_PER_SECOND = '0';

    let inFlight = 0;
    maxInFlightSeen = 0;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [dispatchConfig],
        }),
      ],
      providers: [
        CandidateRankingService,
        {
          provide: CoarseDiscoveryService,
          useValue: {
            findCandidates: jest.fn().mockResolvedValue([coarseCandidate]),
          },
        },
        {
          provide: CandidateRevalidationService,
          useValue: {
            revalidate: jest.fn().mockResolvedValue([validatedCandidate]),
          },
        },
        {
          provide: ROUTING_PROVIDER,
          useValue: {
            estimateBatch: jest.fn().mockImplementation(async () => {
              inFlight += 1;
              maxInFlightSeen = Math.max(maxInFlightSeen, inFlight);
              await new Promise((resolve) => setTimeout(resolve, 40));
              inFlight -= 1;
              return [
                {
                  status: 'routed' as const,
                  durationSeconds: 90,
                  distanceMeters: 1_000,
                },
              ];
            }),
          },
        },
        {
          provide: DISPATCH_METRICS,
          useValue: {
            recordCandidateCounts: jest.fn(),
            recordDiscoveryLatency: jest.fn(),
            recordRoutingLatency: jest.fn(),
            recordRoutingOutcome: jest.fn(),
            recordRequestCreated: jest.fn(),
            recordRequestAssigned: jest.fn(),
            recordRequestCancelled: jest.fn(),
            recordRequestExpired: jest.fn(),
            recordRequestNoDriverFound: jest.fn(),
            recordTimeToFirstOffer: jest.fn(),
            recordOfferCreated: jest.fn(),
            recordOfferAccepted: jest.fn(),
            recordOfferRejected: jest.fn(),
            recordOfferExpired: jest.fn(),
            recordOffersPerAssignment: jest.fn(),
            recordOutboxUnpublished: jest.fn(),
            recordQueueDepth: jest.fn(),
            recordQueueDelayed: jest.fn(),
            recordQueueFailed: jest.fn(),
            recordQueueOldestAge: jest.fn(),
            recordDuplicateCommand: jest.fn(),
            recordStuckRequest: jest.fn(),
            recordStuckOffer: jest.fn(),
            recordStuckDriver: jest.fn(),
            recordProviderError: jest.fn(),
            recordQueueError: jest.fn(),
            recordOnlineDrivers: jest.fn(),
            recordPresenceReconciliation: jest.fn(),
            recordSocketEventLatency: jest.fn(),
          } satisfies jest.Mocked<DispatchMetrics>,
        },
      ],
    }).compile();
    service = moduleRef.get(CandidateRankingService);
  });

  afterEach(() => {
    delete process.env.GEBETA_API_KEY;
    delete process.env.DISPATCH_ROUTING_MAX_CONCURRENCY;
    delete process.env.DISPATCH_ROUTING_MAX_CALLS_PER_SECOND;
  });

  it('keeps routing concurrency bounded under concurrent ranking pressure', async () => {
    const startedAt = performance.now();

    await Promise.all(
      Array.from({ length: 9 }).map((_, index) =>
        service.rankForRequest(`request-${index}`, pickup),
      ),
    );

    const durationMs = performance.now() - startedAt;

    expect(maxInFlightSeen).toBeLessThanOrEqual(3);
    expect(durationMs).toBeGreaterThanOrEqual(120);
    expect(durationMs).toBeLessThan(400);
  });
});
