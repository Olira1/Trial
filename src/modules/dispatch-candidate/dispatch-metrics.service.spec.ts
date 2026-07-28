import { Logger } from '@nestjs/common';
import { LoggingDispatchMetrics } from './dispatch-metrics.service';

describe('LoggingDispatchMetrics', () => {
  let metrics: LoggingDispatchMetrics;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    metrics = new LoggingDispatchMetrics();
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs candidate filter counts', () => {
    metrics.recordCandidateCounts('req-1', {
      coarse: 10,
      validated: 5,
      routed: 3,
      unreachable: 1,
      providerFailure: 1,
    });

    expect(logSpy).toHaveBeenCalledWith({
      msg: 'candidate_filter_counts',
      requestId: 'req-1',
      coarse: 10,
      validated: 5,
      routed: 3,
      unreachable: 1,
      providerFailure: 1,
    });
  });

  it('logs request lifecycle events', () => {
    metrics.recordRequestCreated('req-1', 'rider-1');
    metrics.recordRequestAssigned('req-1', 'rider-1', 'driver-1', 1_234.56);
    metrics.recordRequestCancelled('req-1', 'rider');
    metrics.recordRequestExpired('req-1');
    metrics.recordRequestNoDriverFound('req-1');

    expect(logSpy).toHaveBeenCalledWith({
      msg: 'request_lifecycle',
      requestId: 'req-1',
      riderId: 'rider-1',
      outcome: 'created',
    });
    expect(logSpy).toHaveBeenCalledWith({
      msg: 'request_lifecycle',
      requestId: 'req-1',
      riderId: 'rider-1',
      driverId: 'driver-1',
      outcome: 'assigned',
      durationMs: 1235,
    });
    expect(logSpy).toHaveBeenCalledWith({
      msg: 'request_lifecycle',
      requestId: 'req-1',
      actor: 'rider',
      outcome: 'cancelled',
    });
    expect(logSpy).toHaveBeenCalledWith({
      msg: 'request_lifecycle',
      requestId: 'req-1',
      outcome: 'expired',
    });
    expect(logSpy).toHaveBeenCalledWith({
      msg: 'request_lifecycle',
      requestId: 'req-1',
      outcome: 'no_driver_found',
    });
  });

  it('logs offer lifecycle events', () => {
    metrics.recordOfferCreated('req-1', 'offer-1', 'driver-1');
    metrics.recordOfferAccepted('req-1', 'offer-1', 'driver-1', 'rider-1');
    metrics.recordOfferRejected('req-1', 'offer-1', 'driver-1');
    metrics.recordOfferExpired('req-1', 'offer-1', 'driver-1');

    expect(logSpy).toHaveBeenCalledWith({
      msg: 'offer_lifecycle',
      requestId: 'req-1',
      offerId: 'offer-1',
      driverId: 'driver-1',
      outcome: 'created',
    });
    expect(logSpy).toHaveBeenCalledWith({
      msg: 'offer_lifecycle',
      requestId: 'req-1',
      offerId: 'offer-1',
      driverId: 'driver-1',
      riderId: 'rider-1',
      outcome: 'accepted',
    });
  });

  it('logs provider errors without sensitive data', () => {
    metrics.recordProviderError('routing', 'estimate_batch', 'timeout');

    expect(logSpy).toHaveBeenCalledWith({
      msg: 'provider_error',
      provider: 'routing',
      operation: 'estimate_batch',
      errorType: 'timeout',
    });
  });

  it('logs socket event latency', () => {
    metrics.recordSocketEventLatency('dispatch:request:snapshot', 42.4);

    expect(logSpy).toHaveBeenCalledWith({
      msg: 'socket_event_latency_ms',
      event: 'dispatch:request:snapshot',
      durationMs: 42,
    });
  });

  it('logs stuck state alerts', () => {
    metrics.recordStuckRequest('req-1', 'offered', 120_000);
    metrics.recordStuckOffer('offer-1', 'pending', 60_000);
    metrics.recordStuckDriver('driver-1', 'offered', 30_000);

    expect(logSpy).toHaveBeenCalledWith({
      msg: 'stuck_request',
      requestId: 'req-1',
      state: 'offered',
      ageMs: 120_000,
    });
    expect(logSpy).toHaveBeenCalledWith({
      msg: 'stuck_offer',
      offerId: 'offer-1',
      state: 'pending',
      ageMs: 60_000,
    });
    expect(logSpy).toHaveBeenCalledWith({
      msg: 'stuck_driver',
      driverId: 'driver-1',
      state: 'offered',
      ageMs: 30_000,
    });
  });

  it('logs queue health snapshots', () => {
    metrics.recordOutboxUnpublished(5, 30_000);
    metrics.recordQueueDepth('dispatch:match', 12);
    metrics.recordQueueDelayed('dispatch:expire', 3);
    metrics.recordQueueFailed('dispatch:match', 1);
    metrics.recordQueueOldestAge('dispatch:match', 45_000);

    expect(logSpy).toHaveBeenCalledWith({
      msg: 'outbox_unpublished',
      count: 5,
      oldestAgeMs: 30_000,
    });
    expect(logSpy).toHaveBeenCalledWith({
      msg: 'queue_depth',
      queueName: 'dispatch:match',
      count: 12,
    });
  });

  it('logs presence reconciliation', () => {
    metrics.recordOnlineDrivers(100, 'fresh');
    metrics.recordPresenceReconciliation(7);

    expect(logSpy).toHaveBeenCalledWith({
      msg: 'online_drivers',
      count: 100,
      freshness: 'fresh',
    });
    expect(logSpy).toHaveBeenCalledWith({
      msg: 'presence_reconciliation',
      repaired: 7,
    });
  });
});
