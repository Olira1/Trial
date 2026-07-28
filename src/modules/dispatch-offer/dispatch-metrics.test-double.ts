import type { DispatchMetrics } from '../dispatch-candidate';

export type DispatchMetricsMock = jest.Mocked<DispatchMetrics>;

export function createDispatchMetricsMock(): DispatchMetricsMock {
  return {
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
  };
}
