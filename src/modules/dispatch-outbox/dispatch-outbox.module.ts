import { Global, Module, forwardRef } from '@nestjs/common';
import { DispatchQueueModule } from '../dispatch-queue';
import { DispatchRealtimeModule } from '../dispatch-realtime/dispatch-realtime.module';
import { DispatchOutboxPublisherService } from './dispatch-outbox-publisher.service';
import { DispatchOutboxRelayService } from './dispatch-outbox-relay.service';
import { DispatchOutboxService } from './dispatch-outbox.service';
import { DispatchOutboxWorkerService } from './dispatch-outbox-worker.service';

@Global()
@Module({
  imports: [DispatchQueueModule, forwardRef(() => DispatchRealtimeModule)],
  providers: [
    DispatchOutboxService,
    DispatchOutboxPublisherService,
    DispatchOutboxRelayService,
    DispatchOutboxWorkerService,
  ],
  exports: [
    DispatchOutboxService,
    DispatchOutboxPublisherService,
    DispatchOutboxRelayService,
    DispatchOutboxWorkerService,
  ],
})
export class DispatchOutboxModule {}
