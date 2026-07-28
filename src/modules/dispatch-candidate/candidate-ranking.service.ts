import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { dispatchConfig } from '../../config';
import {
  ROUTING_PROVIDER,
  RoutingProviderFailureError,
  type RoutingEstimate,
  type RoutingPoint,
  type RoutingProvider,
} from '../dispatch-routing';
import { CandidatePolicy } from './candidate-policy';
import { CoarseDiscoveryService } from './coarse-discovery.service';
import { ConcurrencySemaphore } from './concurrency-semaphore';
import {
  DISPATCH_METRICS,
  type DispatchMetrics,
} from './dispatch-metrics.service';
import { CandidateRevalidationService } from './candidate-revalidation.service';
import { TokenBucket } from './token-bucket';

export type RankedCandidate = {
  driverId: string;
  etaSeconds: number;
  distanceMeters: number;
};

type CandidateForRanking = {
  driverId: string;
  etaSeconds: number;
  straightLineKm: number;
  distanceMeters: number;
};

@Injectable()
export class CandidateRankingService {
  private readonly policy: CandidatePolicy;
  private readonly routingSemaphore: ConcurrencySemaphore;
  private readonly routingRateLimit: TokenBucket;

  constructor(
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
    private readonly coarseDiscovery: CoarseDiscoveryService,
    private readonly revalidation: CandidateRevalidationService,
    @Inject(ROUTING_PROVIDER)
    private readonly routingProvider: RoutingProvider,
    @Inject(DISPATCH_METRICS)
    private readonly metrics: DispatchMetrics,
  ) {
    this.policy = new CandidatePolicy({
      searchRadiusKm: config.searchRadiusKm,
      discoveryH3Resolution: config.discoveryH3Resolution,
      maxRings: config.maxRings,
      maxCandidates: config.maxCandidates,
      tiebreaker: 'eta_then_distance',
      fairnessMode: 'none',
    });
    this.routingSemaphore = new ConcurrencySemaphore(
      config.routingMaxConcurrency,
    );
    this.routingRateLimit = new TokenBucket(
      config.routingMaxCallsPerSecond,
      config.routingMaxCallsPerSecond,
    );
  }

  async rankForRequest(
    requestId: string,
    pickup: RoutingPoint,
    excludedDriverIds?: Set<string>,
  ): Promise<RankedCandidate[]> {
    const discoveryStart = performance.now();
    const coarseCandidates = await this.coarseDiscovery.findCandidates(
      pickup.latitude,
      pickup.longitude,
      excludedDriverIds,
    );

    if (coarseCandidates.length === 0) {
      this.emitCounts(requestId, {
        coarse: 0,
        validated: 0,
        routed: 0,
        unreachable: 0,
        providerFailure: 0,
      });
      this.metrics.recordDiscoveryLatency(
        requestId,
        performance.now() - discoveryStart,
      );
      return [];
    }

    const validated = await this.revalidation.revalidate(
      requestId,
      coarseCandidates,
      excludedDriverIds,
    );

    this.metrics.recordDiscoveryLatency(
      requestId,
      performance.now() - discoveryStart,
    );

    if (validated.length === 0) {
      this.emitCounts(requestId, {
        coarse: coarseCandidates.length,
        validated: 0,
        routed: 0,
        unreachable: 0,
        providerFailure: 0,
      });
      return [];
    }

    const requests = validated.map((candidate) => ({
      origin: candidate.location,
      destination: pickup,
    }));

    if (!this.routingRateLimit.consume()) {
      this.metrics.recordRoutingOutcome(requestId, 'failure');
      throw new RoutingProviderFailureError(
        'routing provider rate limit exceeded',
      );
    }

    const routingStart = performance.now();
    let estimates: RoutingEstimate[];
    const release = await this.routingSemaphore.acquire();
    try {
      estimates = await this.routingProvider.estimateBatch(requests);
    } catch (error) {
      this.metrics.recordRoutingLatency(
        requestId,
        performance.now() - routingStart,
      );
      this.metrics.recordRoutingOutcome(requestId, 'failure');
      throw new RoutingProviderFailureError(
        'routing provider estimate failed',
        error,
      );
    } finally {
      release();
    }
    this.metrics.recordRoutingLatency(
      requestId,
      performance.now() - routingStart,
    );

    const routed: CandidateForRanking[] = [];
    let unreachableCount = 0;
    let providerFailureCount = 0;

    for (let i = 0; i < estimates.length; i += 1) {
      const estimate = estimates[i]!;
      const candidate = validated[i]!;

      if (estimate.status === 'routed') {
        routed.push({
          driverId: candidate.driverId,
          etaSeconds: estimate.durationSeconds,
          straightLineKm: candidate.exactDistanceKm,
          distanceMeters: estimate.distanceMeters,
        });
        continue;
      }

      if (estimate.status === 'unreachable') {
        unreachableCount += 1;
        continue;
      }

      if (estimate.status === 'provider_failure') {
        providerFailureCount += 1;
        this.metrics.recordRoutingOutcome(requestId, 'failure');
        throw new RoutingProviderFailureError(
          `routing provider failed: ${estimate.reason}`,
        );
      }
    }

    this.emitCounts(requestId, {
      coarse: coarseCandidates.length,
      validated: validated.length,
      routed: routed.length,
      unreachable: unreachableCount,
      providerFailure: providerFailureCount,
    });

    const hasUnreachable = unreachableCount > 0;
    this.metrics.recordRoutingOutcome(
      requestId,
      hasUnreachable ? 'partial' : 'success',
    );

    const ranked = this.policy.rank(routed);
    return ranked.slice(0, this.config.maxCandidates).map((candidate) => ({
      driverId: candidate.driverId,
      etaSeconds: candidate.etaSeconds,
      distanceMeters: candidate.distanceMeters,
    }));
  }

  private emitCounts(
    requestId: string,
    counts: {
      coarse: number;
      validated: number;
      routed: number;
      unreachable: number;
      providerFailure: number;
    },
  ): void {
    this.metrics.recordCandidateCounts(requestId, counts);
  }
}
