export const DISPATCH_QUEUE_NAMES = {
  outbox: 'dispatch.outbox',
  match: 'dispatch.match',
  offerExpiration: 'dispatch.offer-expiration',
  notification: 'dispatch.notification',
  pickupReminder: 'dispatch.pickup-reminder',
  reconciliation: 'dispatch.reconciliation',
} as const;

export type DispatchQueueName =
  (typeof DISPATCH_QUEUE_NAMES)[keyof typeof DISPATCH_QUEUE_NAMES];
