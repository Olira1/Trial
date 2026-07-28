import { DISPATCH_QUEUE_NAMES } from './dispatch-queue.names';

describe('DISPATCH_QUEUE_NAMES', () => {
  it('defines the approved dispatch queue names', () => {
    expect(DISPATCH_QUEUE_NAMES).toEqual({
      outbox: 'dispatch.outbox',
      match: 'dispatch.match',
      offerExpiration: 'dispatch.offer-expiration',
      notification: 'dispatch.notification',
      pickupReminder: 'dispatch.pickup-reminder',
      reconciliation: 'dispatch.reconciliation',
    });
  });
});
