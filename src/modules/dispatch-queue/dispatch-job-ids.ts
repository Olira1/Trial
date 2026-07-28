export const dispatchJobIds = {
  match: ({
    requestId,
    attemptId,
  }: {
    requestId: string;
    attemptId: string;
  }): string => `match-${requestId}-attempt-${attemptId}`,

  offerExpiration: ({
    offerId,
    expiresAt,
  }: {
    offerId: string;
    expiresAt: Date;
  }): string => `offer-expiration-${offerId}-${expiresAt.getTime()}`,

  outboxPublish: ({ outboxEventId }: { outboxEventId: string }): string =>
    `outbox-${outboxEventId}`,

  notification: ({
    outboxEventId,
    channel,
  }: {
    outboxEventId: string;
    channel: 'fcm' | 'socket';
  }): string => `notification-${channel}-${outboxEventId}`,

  pickupReminder: ({
    pickupId,
    warningDueAt,
  }: {
    pickupId: string;
    warningDueAt: Date;
  }): string => `pickup-reminder-${pickupId}-${warningDueAt.getTime()}`,

  reconciliation: ({ name }: { name: string }): string =>
    `reconciliation-${name}`,
} as const;
