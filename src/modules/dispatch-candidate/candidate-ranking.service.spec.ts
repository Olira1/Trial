import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { dispatchConfig } from '../../config';
import {
  ROUTING_PROVIDER,
  RoutingProviderFailureError,
  type RoutingProvider,
} from '../dispatch-routing';
import { CandidateRankingService } from './candidate-ranking.service';
import { CoarseDiscoveryService } from './coarse-discovery.service';
import { CandidateRevalidationService } from './candidate-revalidation.service';
import {
  DISPATCH_METRICS,
  type DispatchMetrics,
} from './dispatch-metrics.service';

const pickup = { latitude: 9.01, longitude: 38.76 };

const coarseA = {
  driverId: 'a',
  straightLineKm: 1,
  location: { latitude: 9.015, longitude: 38.765 },
};
const coarseB = {
  driverId: 'b',
  straightLineKm: 0.8,
  location: { latitude: 9.012, longitude: 38.762 },
};

const validatedA = {
  driverId: 'a',
  exactDistanceKm: 1,
  location: coarseA.location,
};
const validatedB = {
  driverId: 'b',
  exactDistanceKm: 0.8,
  location: coarseB.location,
};

describe('CandidateRankingService', () => {
  let service: CandidateRankingService;
  let coarseDiscovery: jest.Mocked<CoarseDiscoveryService>;
  let revalidation: jest.Mocked<CandidateRevalidationService>;
  let routingProvider: jest.Mocked<RoutingProvider>;
  let metrics: jest.Mocked<DispatchMetrics>;

  beforeEach(async () => {
    process.env.GEBETA_API_KEY = 'test-key';
    process.env.DISPATCH_ROUTING_MAX_CONCURRENCY = '3';
    process.env.DISPATCH_ROUTING_MAX_CALLS_PER_SECOND = '0';

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
            findCandidates: jest.fn(),
          },
        },
        {
          provide: CandidateRevalidationService,
          useValue: {
            revalidate: jest.fn(),
          },
        },
        {
          provide: ROUTING_PROVIDER,
          useValue: {
            estimateBatch: jest.fn(),
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
          },
        },
      ],
    }).compile();

    service = moduleRef.get(CandidateRankingService);
    coarseDiscovery = moduleRef.get(CoarseDiscoveryService);
    revalidation = moduleRef.get(CandidateRevalidationService);
    routingProvider = moduleRef.get(ROUTING_PROVIDER);
    metrics = moduleRef.get(DISPATCH_METRICS);
  });

  afterEach(() => {
    delete process.env.GEBETA_API_KEY;
    delete process.env.DISPATCH_ROUTING_MAX_CONCURRENCY;
    delete process.env.DISPATCH_ROUTING_MAX_CALLS_PER_SECOND;
  });

  it('ranks candidates by ETA then exact distance', async () => {
    coarseDiscovery.findCandidates.mockResolvedValue([coarseA, coarseB]);
    revalidation.revalidate.mockResolvedValue([validatedA, validatedB]);
    routingProvider.estimateBatch.mockResolvedValue([
      { status: 'routed', durationSeconds: 120, distanceMeters: 1000 },
      { status: 'routed', durationSeconds: 90, distanceMeters: 800 },
    ]);

    const result = await service.rankForRequest('req-1', pickup);

    expect(result).toEqual([
      { driverId: 'b', etaSeconds: 90, distanceMeters: 800 },
      { driverId: 'a', etaSeconds: 120, distanceMeters: 1000 },
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(metrics.recordCandidateCounts).toHaveBeenCalledWith('req-1', {
      coarse: 2,
      validated: 2,
      routed: 2,
      unreachable: 0,
      providerFailure: 0,
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(metrics.recordRoutingOutcome).toHaveBeenCalledWith(
      'req-1',
      'success',
    );
  });

  it('excludes unreachable candidates without failing the batch', async () => {
    coarseDiscovery.findCandidates.mockResolvedValue([coarseA, coarseB]);
    revalidation.revalidate.mockResolvedValue([validatedA, validatedB]);
    routingProvider.estimateBatch.mockResolvedValue([
      { status: 'unreachable' },
      { status: 'routed', durationSeconds: 90, distanceMeters: 800 },
    ]);

    const result = await service.rankForRequest('req-1', pickup);

    expect(result).toEqual([
      { driverId: 'b', etaSeconds: 90, distanceMeters: 800 },
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(metrics.recordRoutingOutcome).toHaveBeenCalledWith(
      'req-1',
      'partial',
    );
  });

  it('propagates a provider_failure estimate as a routing provider failure', async () => {
    coarseDiscovery.findCandidates.mockResolvedValue([coarseA, coarseB]);
    revalidation.revalidate.mockResolvedValue([validatedA, validatedB]);
    routingProvider.estimateBatch.mockResolvedValue([
      { status: 'provider_failure', reason: 'timeout' },
      { status: 'routed', durationSeconds: 90, distanceMeters: 800 },
    ]);

    await expect(service.rankForRequest('req-1', pickup)).rejects.toThrow(
      RoutingProviderFailureError,
    );
  });

  it('propagates a thrown provider error as a routing provider failure', async () => {
    coarseDiscovery.findCandidates.mockResolvedValue([coarseA]);
    revalidation.revalidate.mockResolvedValue([validatedA]);
    routingProvider.estimateBatch.mockRejectedValue(new Error('network'));

    await expect(service.rankForRequest('req-1', pickup)).rejects.toThrow(
      RoutingProviderFailureError,
    );
  });

  it('returns an empty list when coarse discovery finds no candidates', async () => {
    coarseDiscovery.findCandidates.mockResolvedValue([]);

    const result = await service.rankForRequest('req-1', pickup);

    expect(result).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(revalidation.revalidate).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(routingProvider.estimateBatch).not.toHaveBeenCalled();
  });

  it('limits results to maxCandidates', async () => {
    const candidates = Array.from({ length: 12 }).map((_, i) => ({
      driverId: `d${i}`,
      straightLineKm: i,
      location: { latitude: 9.01 + i * 0.001, longitude: 38.76 + i * 0.001 },
    }));
    const validated = candidates.map((c) => ({
      driverId: c.driverId,
      exactDistanceKm: c.straightLineKm,
      location: c.location,
    }));

    coarseDiscovery.findCandidates.mockResolvedValue(candidates);
    revalidation.revalidate.mockResolvedValue(validated);
    routingProvider.estimateBatch.mockResolvedValue(
      candidates.map((_, i) => ({
        status: 'routed',
        durationSeconds: 100 + i,
        distanceMeters: i * 1000,
      })),
    );

    const result = await service.rankForRequest('req-1', pickup);

    expect(result).toHaveLength(9);
    const [firstResult] = result;
    if (!firstResult) throw new Error('expected ranked candidate');
    expect(firstResult.driverId).toBe('d0');
  });
});
