import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DispatchOutboxPublisherService } from './dispatch-outbox-publisher.service';

export const DISPATCH_OUTBOX_RELAY_INTERVAL_MS = 1_000;
export const DISPATCH_OUTBOX_RELAY_BATCH_SIZE = 100;

@Injectable()
export class DispatchOutboxRelayService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DispatchOutboxRelayService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private drainInFlight = false;

  constructor(private readonly publisher: DispatchOutboxPublisherService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.start();
  }

  onApplicationShutdown(): void {
    this.stop();
  }

  async start(): Promise<void> {
    if (this.timer) return;

    this.logger.log(
      `Dispatch outbox relay started intervalMs=${DISPATCH_OUTBOX_RELAY_INTERVAL_MS} batchSize=${DISPATCH_OUTBOX_RELAY_BATCH_SIZE}`,
    );
    await this.drainOnce('startup');
    this.timer = setInterval(() => {
      void this.drainOnce('interval');
    }, DISPATCH_OUTBOX_RELAY_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async drainOnce(source: string) {
    if (this.drainInFlight) {
      this.logger.debug(
        `Dispatch outbox relay skipped source=${source} reason=in_flight`,
      );
      return [];
    }

    this.drainInFlight = true;
    try {
      const results = await this.publisher.enqueuePendingPublishJobs({
        limit: DISPATCH_OUTBOX_RELAY_BATCH_SIZE,
      });
      const remaining = await this.publisher.countUnpublishedEvents();
      const message = `Dispatch outbox relay drained source=${source} published=${results.length} remaining=${remaining}`;

      if (results.length > 0 || remaining > 0) {
        this.logger.log(message);
      } else {
        this.logger.debug(message);
      }

      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Dispatch outbox relay failed source=${source} error=${message}`,
      );
      return [];
    } finally {
      this.drainInFlight = false;
    }
  }
}
