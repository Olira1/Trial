import { Injectable, Logger } from '@nestjs/common';

export const DISPATCH_METRICS = Symbol('DISPATCH_METRICS');

export type CandidateFilterCounts = {
  coarse: number;
  validated: number;
  routed: number;
  unreachable: number;
  providerFailure: number;
};

export type RoutingOutcome = 'success' | 'partial' | 'failure';

export type RequestOutcome =
  | 'created'
  | 'assigned'
  | 'cancelled'
  | 'expired'
  | 'no_driver_found';

export type OfferOutcome = 'created' | 'accepted' | 'rejected' | 'expired';

export interface DispatchMetrics {
  // Candidate discovery / routing
  recordCandidateCounts(requestId: string, counts: CandidateFilterCounts): void;
  recordDiscoveryLatency(requestId: string, durationMs: number): void;
  recordRoutingLatency(requestId: string, durationMs: number): void;
  recordRoutingOutcome(requestId: string, outcome: RoutingOutcome): void;

  // Request lifecycle
  recordRequestCreated(requestId: string, riderId: string): void;
  recordRequestAssigned(
    requestId: string,
    riderId: string,
    driverId: string,
    durationMs: number,
  ): void;
  recordRequestCancelled(requestId: string, actor: 'rider' | 'system'): void;
  recordRequestExpired(requestId: string): void;
  recordRequestNoDriverFound(requestId: string): void;
  recordTimeToFirstOffer(requestId: string, durationMs: number): void;

  // Offer lifecycle
  recordOfferCreated(
    requestId: string,
    offerId: string,
    driverId: string,
  ): void;
  recordOfferAccepted(
    requestId: string,
    offerId: string,
    driverId: string,
    riderId: string,
  ): void;
  recordOfferRejected(
    requestId: string,
    offerId: string,
    driverId: string,
  ): void;
  recordOfferExpired(
    requestId: string,
    offerId: string,
    driverId: string,
  ): void;
  recordOffersPerAssignment(requestId: string, count: number): void;

  // Outbox / queue health
  recordOutboxUnpublished(count: number, oldestAgeMs: number): void;
  recordQueueDepth(queueName: string, count: number): void;
  recordQueueDelayed(queueName: string, count: number): void;
  recordQueueFailed(queueName: string, count: number): void;
  recordQueueOldestAge(queueName: string, ageMs: number): void;
  recordDuplicateCommand(command: string, requestId: string): void;

  // Stuck state
  recordStuckRequest(requestId: string, state: string, ageMs: number): void;
  recordStuckOffer(offerId: string, state: string, ageMs: number): void;
  recordStuckDriver(driverId: string, state: string, ageMs: number): void;

  // Provider / queue errors
  recordProviderError(
    provider: string,
    operation: string,
    errorType: string,
  ): void;
  recordQueueError(
    queueName: string,
    operation: string,
    errorType: string,
  ): void;

  // Presence
  recordOnlineDrivers(
    count: number,
    freshness: 'fresh' | 'stale' | 'missing',
  ): void;
  recordPresenceReconciliation(repaired: number): void;

  // Socket delivery
  recordSocketEventLatency(event: string, durationMs: number): void;
}

@Injectable()
export class LoggingDispatchMetrics implements DispatchMetrics {
  private readonly logger = new Logger(LoggingDispatchMetrics.name);

  // Candidate discovery / routing
  recordCandidateCounts(
    requestId: string,
    counts: CandidateFilterCounts,
  ): void {
    this.logger.log({
      msg: 'candidate_filter_counts',
      requestId,
      ...counts,
    });
  }

  recordDiscoveryLatency(requestId: string, durationMs: number): void {
    this.logger.log({
      msg: 'discovery_latency_ms',
      requestId,
      durationMs: Math.round(durationMs),
    });
  }

  recordRoutingLatency(requestId: string, durationMs: number): void {
    this.logger.log({
      msg: 'routing_latency_ms',
      requestId,
      durationMs: Math.round(durationMs),
    });
  }

  recordRoutingOutcome(requestId: string, outcome: RoutingOutcome): void {
    this.logger.log({ msg: 'routing_outcome', requestId, outcome });
  }

  // Request lifecycle
  recordRequestCreated(requestId: string, riderId: string): void {
    this.logger.log({
      msg: 'request_lifecycle',
      requestId,
      riderId,
      outcome: 'created' satisfies RequestOutcome,
    });
  }

  recordRequestAssigned(
    requestId: string,
    riderId: string,
    driverId: string,
    durationMs: number,
  ): void {
    this.logger.log({
      msg: 'request_lifecycle',
      requestId,
      riderId,
      driverId,
      outcome: 'assigned' satisfies RequestOutcome,
      durationMs: Math.round(durationMs),
    });
  }

  recordRequestCancelled(requestId: string, actor: 'rider' | 'system'): void {
    this.logger.log({
      msg: 'request_lifecycle',
      requestId,
      actor,
      outcome: 'cancelled' satisfies RequestOutcome,
    });
  }

  recordRequestExpired(requestId: string): void {
    this.logger.log({
      msg: 'request_lifecycle',
      requestId,
      outcome: 'expired' satisfies RequestOutcome,
    });
  }

  recordRequestNoDriverFound(requestId: string): void {
    this.logger.log({
      msg: 'request_lifecycle',
      requestId,
      outcome: 'no_driver_found' satisfies RequestOutcome,
    });
  }

  recordTimeToFirstOffer(requestId: string, durationMs: number): void {
    this.logger.log({
      msg: 'time_to_first_offer_ms',
      requestId,
      durationMs: Math.round(durationMs),
    });
  }

  // Offer lifecycle
  recordOfferCreated(
    requestId: string,
    offerId: string,
    driverId: string,
  ): void {
    this.logger.log({
      msg: 'offer_lifecycle',
      requestId,
      offerId,
      driverId,
      outcome: 'created' satisfies OfferOutcome,
    });
  }

  recordOfferAccepted(
    requestId: string,
    offerId: string,
    driverId: string,
    riderId: string,
  ): void {
    this.logger.log({
      msg: 'offer_lifecycle',
      requestId,
      offerId,
      driverId,
      riderId,
      outcome: 'accepted' satisfies OfferOutcome,
    });
  }

  recordOfferRejected(
    requestId: string,
    offerId: string,
    driverId: string,
  ): void {
    this.logger.log({
      msg: 'offer_lifecycle',
      requestId,
      offerId,
      driverId,
      outcome: 'rejected' satisfies OfferOutcome,
    });
  }

  recordOfferExpired(
    requestId: string,
    offerId: string,
    driverId: string,
  ): void {
    this.logger.log({
      msg: 'offer_lifecycle',
      requestId,
      offerId,
      driverId,
      outcome: 'expired' satisfies OfferOutcome,
    });
  }

  recordOffersPerAssignment(requestId: string, count: number): void {
    this.logger.log({
      msg: 'offers_per_assignment',
      requestId,
      count,
    });
  }

  // Outbox / queue health
  recordOutboxUnpublished(count: number, oldestAgeMs: number): void {
    this.logger.log({
      msg: 'outbox_unpublished',
      count,
      oldestAgeMs: Math.round(oldestAgeMs),
    });
  }

  recordQueueDepth(queueName: string, count: number): void {
    this.logger.log({
      msg: 'queue_depth',
      queueName,
      count,
    });
  }

  recordQueueDelayed(queueName: string, count: number): void {
    this.logger.log({
      msg: 'queue_delayed',
      queueName,
      count,
    });
  }

  recordQueueFailed(queueName: string, count: number): void {
    this.logger.log({
      msg: 'queue_failed',
      queueName,
      count,
    });
  }

  recordQueueOldestAge(queueName: string, ageMs: number): void {
    this.logger.log({
      msg: 'queue_oldest_age_ms',
      queueName,
      ageMs: Math.round(ageMs),
    });
  }

  recordDuplicateCommand(command: string, requestId: string): void {
    this.logger.log({
      msg: 'duplicate_command',
      command,
      requestId,
    });
  }

  // Stuck state
  recordStuckRequest(requestId: string, state: string, ageMs: number): void {
    this.logger.log({
      msg: 'stuck_request',
      requestId,
      state,
      ageMs: Math.round(ageMs),
    });
  }

  recordStuckOffer(offerId: string, state: string, ageMs: number): void {
    this.logger.log({
      msg: 'stuck_offer',
      offerId,
      state,
      ageMs: Math.round(ageMs),
    });
  }

  recordStuckDriver(driverId: string, state: string, ageMs: number): void {
    this.logger.log({
      msg: 'stuck_driver',
      driverId,
      state,
      ageMs: Math.round(ageMs),
    });
  }

  // Provider / queue errors
  recordProviderError(
    provider: string,
    operation: string,
    errorType: string,
  ): void {
    this.logger.log({
      msg: 'provider_error',
      provider,
      operation,
      errorType,
    });
  }

  recordQueueError(
    queueName: string,
    operation: string,
    errorType: string,
  ): void {
    this.logger.log({
      msg: 'queue_error',
      queueName,
      operation,
      errorType,
    });
  }

  // Presence
  recordOnlineDrivers(
    count: number,
    freshness: 'fresh' | 'stale' | 'missing',
  ): void {
    this.logger.log({
      msg: 'online_drivers',
      count,
      freshness,
    });
  }

  recordPresenceReconciliation(repaired: number): void {
    this.logger.log({
      msg: 'presence_reconciliation',
      repaired,
    });
  }

  // Socket delivery
  recordSocketEventLatency(event: string, durationMs: number): void {
    this.logger.log({
      msg: 'socket_event_latency_ms',
      event,
      durationMs: Math.round(durationMs),
    });
  }
}

class NoOpDispatchMetrics implements DispatchMetrics {
  recordCandidateCounts(): void {}
  recordDiscoveryLatency(): void {}
  recordRoutingLatency(): void {}
  recordRoutingOutcome(): void {}
  recordRequestCreated(): void {}
  recordRequestAssigned(): void {}
  recordRequestCancelled(): void {}
  recordRequestExpired(): void {}
  recordRequestNoDriverFound(): void {}
  recordTimeToFirstOffer(): void {}
  recordOfferCreated(): void {}
  recordOfferAccepted(): void {}
  recordOfferRejected(): void {}
  recordOfferExpired(): void {}
  recordOffersPerAssignment(): void {}
  recordOutboxUnpublished(): void {}
  recordQueueDepth(): void {}
  recordQueueDelayed(): void {}
  recordQueueFailed(): void {}
  recordQueueOldestAge(): void {}
  recordDuplicateCommand(): void {}
  recordStuckRequest(): void {}
  recordStuckOffer(): void {}
  recordStuckDriver(): void {}
  recordProviderError(): void {}
  recordQueueError(): void {}
  recordOnlineDrivers(): void {}
  recordPresenceReconciliation(): void {}
  recordSocketEventLatency(): void {}
}

export const NOOP_DISPATCH_METRICS = new NoOpDispatchMetrics();

export function injectDispatchMetrics(): {
  provide: typeof DISPATCH_METRICS;
  useClass: typeof LoggingDispatchMetrics;
} {
  return {
    provide: DISPATCH_METRICS,
    useClass: LoggingDispatchMetrics,
  };
}
