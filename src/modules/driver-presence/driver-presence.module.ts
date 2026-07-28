import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { DispatchOutboxModule } from '../dispatch-outbox';
import { DriverEligibilityService } from './driver-eligibility.service';
import { DriverPresenceGateway } from './driver-presence.gateway';
import { DriverPresenceLiveLocationService } from './driver-presence-live-location.service';
import { DriverPresenceController } from './driver-presence.controller';
import { DriverPresenceLeaseService } from './driver-presence-lease.service';
import { DriverPresenceService } from './driver-presence.service';
import { DriverPresencePrivacyInterceptor } from './driver-presence-privacy.interceptor';
import { DriverPresenceReconciliationService } from './driver-presence-reconciliation.service';

@Module({
  imports: [AuthModule, DispatchOutboxModule],
  controllers: [DriverPresenceController],
  providers: [
    DriverEligibilityService,
    DriverPresenceGateway,
    DriverPresenceLiveLocationService,
    DriverPresenceLeaseService,
    DriverPresenceService,
    DriverPresencePrivacyInterceptor,
    DriverPresenceReconciliationService,
  ],
  exports: [
    DriverEligibilityService,
    DriverPresenceLeaseService,
    DriverPresenceService,
  ],
})
export class DriverPresenceModule {}
