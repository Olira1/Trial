import { randomUUID } from 'node:crypto';
import { dispatchJobIds } from './dispatch-job-ids';

describe('dispatchJobIds', () => {
  it('creates deterministic BullMQ-safe job ids for every dispatch job type', () => {
    const requestId = randomUUID();
    const offerId = randomUUID();
    const outboxEventId = randomUUID();
    const expiresAt = new Date('2026-06-15T12:34:56.789Z');

    const ids = [
      dispatchJobIds.match({ requestId, attemptId: 'attempt-1' }),
      dispatchJobIds.offerExpiration({ offerId, expiresAt }),
      dispatchJobIds.outboxPublish({ outboxEventId }),
      dispatchJobIds.notification({ outboxEventId, channel: 'fcm' }),
      dispatchJobIds.reconciliation({ name: 'stuck-offers' }),
    ];

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).not.toContain(':');
      expect(id.length).toBeGreaterThan(0);
    }
    expect(dispatchJobIds.match({ requestId, attemptId: 'attempt-1' })).toBe(
      ids[0],
    );
  });
});
