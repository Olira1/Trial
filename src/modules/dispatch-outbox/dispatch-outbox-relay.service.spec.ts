import { Logger } from '@nestjs/common';
import {
  DISPATCH_OUTBOX_RELAY_BATCH_SIZE,
  DISPATCH_OUTBOX_RELAY_INTERVAL_MS,
  DispatchOutboxRelayService,
} from './dispatch-outbox-relay.service';
import type { DispatchOutboxPublisherService } from './dispatch-outbox-publisher.service';

describe('DispatchOutboxRelayService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('drains pending outbox events on startup and on a bounded interval', async () => {
    jest.useFakeTimers();
    const publisher = {
      enqueuePendingPublishJobs: jest.fn().mockResolvedValue([]),
      countUnpublishedEvents: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<
      Pick<
        DispatchOutboxPublisherService,
        'enqueuePendingPublishJobs' | 'countUnpublishedEvents'
      >
    >;
    const relay = new DispatchOutboxRelayService(publisher as never);

    await relay.onApplicationBootstrap();

    expect(publisher.enqueuePendingPublishJobs).toHaveBeenCalledTimes(1);
    expect(publisher.enqueuePendingPublishJobs).toHaveBeenCalledWith({
      limit: DISPATCH_OUTBOX_RELAY_BATCH_SIZE,
    });

    await jest.advanceTimersByTimeAsync(DISPATCH_OUTBOX_RELAY_INTERVAL_MS);

    expect(publisher.enqueuePendingPublishJobs).toHaveBeenCalledTimes(2);
    relay.onApplicationShutdown();
  });

  it('logs the drained batch size and remaining unpublished count', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const publisher = {
      enqueuePendingPublishJobs: jest.fn().mockResolvedValue([
        {
          status: 'enqueued' as const,
          eventId: 'event-1',
          jobId: 'outbox-event-1',
        },
      ]),
      countUnpublishedEvents: jest.fn().mockResolvedValue(3),
    } as unknown as jest.Mocked<
      Pick<
        DispatchOutboxPublisherService,
        'enqueuePendingPublishJobs' | 'countUnpublishedEvents'
      >
    >;
    const relay = new DispatchOutboxRelayService(publisher as never);

    await relay.drainOnce('test');

    expect(logSpy).toHaveBeenCalledWith(
      'Dispatch outbox relay drained source=test published=1 remaining=3',
    );
  });
});
