import { Global, Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { DispatchEventsGateway } from './dispatch-events.gateway';
import { DispatchEventPublisher } from './dispatch-event-publisher.service';
import { DispatchSnapshotService } from './dispatch-snapshot.service';

@Global()
@Module({
  imports: [AuthModule, UserModule],
  providers: [
    DispatchEventsGateway,
    DispatchSnapshotService,
    DispatchEventPublisher,
  ],
  exports: [DispatchEventPublisher, forwardRef(() => DispatchEventsGateway)],
})
export class DispatchRealtimeModule {}
