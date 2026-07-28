import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { and, count, eq, sql } from 'drizzle-orm';
import { dispatchConfig } from '../../config';
import {
  DRIZZLE,
  type Database,
  type DBTransaction,
} from '../../database/database.module';
import {
  DISPATCH_METRICS,
  NOOP_DISPATCH_METRICS,
  type DispatchMetrics,
} from '../dispatch-candidate';
import { DispatchOutboxService } from '../dispatch-outbox';
import { RoutingProviderFailureError } from '../dispatch-routing';
import {
  CandidateRankingService,
  type RankedCandidate,
} from '../dispatch-candidate';
import { rideRequest } from '../ride-requests/schema';
import { dispatchAttempt } from './schema/dispatch-attempt.schema';
import {
  dispatchOffer,
  type DispatchOffer,
} from './schema/dispatch-offer.schema';
import { OfferReservationService } from './offer-reservation.service';
import { OfferExpirationWorkerService } from './offer-expiration-worker.service';

export type MatchResult =
  | { status: 'offered'; offer: DispatchOffer }
  | { status: 'shadow'; candidateCount: number }
  | { status: 'no_driver_found' }
  | { status: 'system_failed' }
  | { status: 'expired' }
  | { status: 'noop' };

type RequestSnapshot = {
  id: string;
  state: string;
  matchingDeadlineAt: Date;
  pickup: { latitude: number; longitude: number };
};

type AttemptClaimResult =
  | { status: 'claimed'; attemptId: string }
  | { status: 'expired' }
  | { status: 'noop' };

@Injectable()
export class MatchOrchestrator {
  private readonly logger = new Logger(MatchOrchestrator.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
    private readonly ranking: CandidateRankingService,
    private readonly reservation: OfferReservationService,
    private readonly outbox: DispatchOutboxService,
    private readonly expirationWorker: OfferExpirationWorkerService,
    @Optional()
    @Inject(DISPATCH_METRICS)
    private readonly metrics: DispatchMetrics = NOOP_DISPATCH_METRICS,
  ) {}

  async attemptMatch(requestId: string): Promise<MatchResult> {
    this.logger.log(`Match attempt started requestId=${requestId}`);

    if (!this.config.enableNewMatching) {
      this.logger.warn(
        `Match attempt skipped by rollout control requestId=${requestId}`,
      );
      return { status: 'noop' };
    }

    const request = await this.loadRequest(requestId);
    if (!request) {
      this.logger.warn(
        `Match attempt skipped missing request requestId=${requestId}`,
      );
      return { status: 'noop' };
    }

    if (request.state !== 'searching') {
      this.logger.log(
        `Match attempt skipped requestId=${requestId} state=${request.state}`,
      );
      return { status: 'noop' };
    }

    if (request.matchingDeadlineAt <= new Date()) {
      this.logger.warn(
        `Match attempt expired before ranking requestId=${requestId} matchingDeadlineAt=${request.matchingDeadlineAt.toISOString()}`,
      );
      await this.markRequest(requestId, 'expired', 'ride_request.expired.v1');
      this.metrics.recordRequestExpired(requestId);
      return { status: 'expired' };
    }

    let candidates: RankedCandidate[];
    try {
      const excludedDriverIds =
        await this.loadPreviouslyOfferedDriverIds(requestId);
      this.logger.log(
        `Ranking match candidates requestId=${requestId} previouslyOfferedDrivers=${excludedDriverIds.size}`,
      );
      candidates = await this.ranking.rankForRequest(
        requestId,
        request.pickup,
        excludedDriverIds.size > 0 ? excludedDriverIds : undefined,
      );
      this.logger.log(
        `Match candidates ranked requestId=${requestId} candidateCount=${candidates.length}`,
      );
    } catch (error) {
      if (error instanceof RoutingProviderFailureError) {
        this.metrics.recordProviderError(
          'routing',
          'estimate_batch',
          error.cause instanceof Error
            ? error.cause.name
            : 'routing_provider_failure',
        );
        if (this.config.enableShadowRanking) {
          this.logger.warn(
            `Shadow ranking failed requestId=${requestId}: ${error.message}`,
          );
          return { status: 'shadow', candidateCount: 0 };
        }
        await this.markRequest(
          requestId,
          'system_failed',
          'ride_request.system_failed.v1',
        );
        return { status: 'system_failed' };
      }
      throw error;
    }

    if (this.config.enableShadowRanking) {
      this.logShadowResult(requestId, candidates);
      return { status: 'shadow', candidateCount: candidates.length };
    }

    if (candidates.length === 0) {
      this.logger.warn(`No match candidates found requestId=${requestId}`);
      await this.markRequest(
        requestId,
        'no_driver_found',
        'ride_request.no_driver_found.v1',
      );
      this.metrics.recordRequestNoDriverFound(requestId);
      return { status: 'no_driver_found' };
    }

    const attempt = await this.claimAttempt(requestId);
    if (attempt.status === 'expired') {
      this.logger.warn(`Match attempt claim expired requestId=${requestId}`);
      return { status: 'expired' };
    }

    if (attempt.status === 'noop') {
      this.logger.log(`Match attempt claim skipped requestId=${requestId}`);
      return { status: 'noop' };
    }

    this.logger.log(
      `Match attempt claimed requestId=${requestId} attemptId=${attempt.attemptId} candidateCount=${candidates.length}`,
    );

    for (const candidate of candidates) {
      const result = await this.reservation.tryReserve(
        requestId,
        attempt.attemptId,
        candidate,
      );

      if (result.status === 'reserved') {
        this.logger.log(
          `Dispatch offer reserved requestId=${requestId} attemptId=${attempt.attemptId} offerId=${result.offer.id} driverId=${result.offer.driverId}`,
        );
        await this.completeAttempt(attempt.attemptId);
        await this.scheduleOfferExpiration(result.offer).catch((error) => {
          this.logger.warn(
            `Failed to schedule offer expiration offerId=${result.offer.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
        return { status: 'offered', offer: result.offer };
      }

      if (result.status === 'expired') {
        this.logger.warn(
          `Match reservation expired requestId=${requestId} attemptId=${attempt.attemptId} driverId=${candidate.driverId}`,
        );
        await this.markRequest(requestId, 'expired', 'ride_request.expired.v1');
        return { status: 'expired' };
      }

      this.logger.log(
        `Match candidate lost reservation race requestId=${requestId} attemptId=${attempt.attemptId} driverId=${candidate.driverId}`,
      );
    }

    this.logger.warn(
      `All match candidates lost reservation race requestId=${requestId} attemptId=${attempt.attemptId} candidateCount=${candidates.length}`,
    );
    await this.exhaustAttempt(requestId, attempt.attemptId);
    this.metrics.recordRequestNoDriverFound(requestId);
    return { status: 'no_driver_found' };
  }

  private async loadRequest(
    requestId: string,
  ): Promise<RequestSnapshot | null> {
    const result = await this.db.execute<{
      id: string;
      state: string;
      matching_deadline_at: string;
      pickup_lat: number;
      pickup_lon: number;
    }>(sql`
      SELECT
        "id",
        "state",
        "matching_deadline_at",
        ST_Y("pickup"::geometry)::float8 AS pickup_lat,
        ST_X("pickup"::geometry)::float8 AS pickup_lon
      FROM "ride_request"
      WHERE "id" = ${requestId}
    `);

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      state: row.state,
      matchingDeadlineAt: new Date(row.matching_deadline_at),
      pickup: { latitude: row.pickup_lat, longitude: row.pickup_lon },
    };
  }

  private async claimAttempt(requestId: string): Promise<AttemptClaimResult> {
    return this.db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(rideRequest)
        .where(eq(rideRequest.id, requestId))
        .limit(1)
        .for('update');

      if (!request || request.state !== 'searching') {
        return { status: 'noop' };
      }

      if (request.matchingDeadlineAt <= new Date()) {
        await this.markRequestInTransaction(
          tx,
          requestId,
          'expired',
          'ride_request.expired.v1',
        );
        this.metrics.recordRequestExpired(requestId);
        return { status: 'expired' };
      }

      const [existingAttempt] = await tx
        .select({ id: dispatchAttempt.id })
        .from(dispatchAttempt)
        .where(
          and(
            eq(dispatchAttempt.requestId, requestId),
            eq(dispatchAttempt.state, 'in_progress'),
          ),
        )
        .limit(1);

      if (existingAttempt) {
        return { status: 'noop' };
      }

      const attemptCount = await tx
        .select({ value: count() })
        .from(dispatchAttempt)
        .where(eq(dispatchAttempt.requestId, requestId))
        .then((rows) => rows[0]?.value ?? 0);

      const attemptNumber = attemptCount + 1;

      const [attempt] = await tx
        .insert(dispatchAttempt)
        .values({ requestId, attemptNumber })
        .returning();

      if (!attempt) {
        throw new Error('dispatch attempt insert returned no row');
      }

      return { status: 'claimed', attemptId: attempt.id };
    });
  }

  private async completeAttempt(attemptId: string): Promise<void> {
    await this.db
      .update(dispatchAttempt)
      .set({
        state: 'completed',
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dispatchAttempt.id, attemptId));
  }

  private async exhaustAttempt(
    requestId: string,
    attemptId: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.markRequestInTransaction(
        tx,
        requestId,
        'no_driver_found',
        'ride_request.no_driver_found.v1',
      );
      await tx
        .update(dispatchAttempt)
        .set({
          state: 'exhausted',
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(dispatchAttempt.id, attemptId));
    });
  }

  private async markRequest(
    requestId: string,
    state: 'expired' | 'no_driver_found' | 'system_failed',
    eventType:
      | 'ride_request.expired.v1'
      | 'ride_request.no_driver_found.v1'
      | 'ride_request.system_failed.v1',
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.markRequestInTransaction(tx, requestId, state, eventType);
    });
  }

  private async markRequestInTransaction(
    tx: DBTransaction,
    requestId: string,
    state: 'expired' | 'no_driver_found' | 'system_failed',
    eventType:
      | 'ride_request.expired.v1'
      | 'ride_request.no_driver_found.v1'
      | 'ride_request.system_failed.v1',
  ): Promise<void> {
    const [updated] = await tx
      .update(rideRequest)
      .set({ state, updatedAt: new Date() })
      .where(
        and(eq(rideRequest.id, requestId), eq(rideRequest.state, 'searching')),
      )
      .returning();

    if (!updated) {
      return;
    }

    await this.outbox.append(tx, {
      eventKey: `ride_request:${requestId}:${state}`,
      eventType,
      aggregateType: 'ride_request',
      aggregateId: requestId,
      correlationId: randomUUID(),
      payload: { requestId, state },
    });
  }

  private async scheduleOfferExpiration(offer: DispatchOffer): Promise<void> {
    await this.expirationWorker.scheduleExpiration(offer.id, offer.expiresAt);
  }

  private async loadPreviouslyOfferedDriverIds(
    requestId: string,
  ): Promise<Set<string>> {
    const rows = await this.db
      .select({ driverId: dispatchOffer.driverId })
      .from(dispatchOffer)
      .where(eq(dispatchOffer.requestId, requestId));

    return new Set(rows.map((row) => row.driverId));
  }

  private logShadowResult(
    requestId: string,
    candidates: RankedCandidate[],
  ): void {
    const topCandidate = candidates[0];
    this.logger.log({
      msg: 'shadow_ranking_result',
      requestId,
      candidateCount: candidates.length,
      topDriverId: topCandidate?.driverId,
      topEtaSeconds: topCandidate?.etaSeconds,
      topDistanceMeters: topCandidate?.distanceMeters,
    });
  }
}
