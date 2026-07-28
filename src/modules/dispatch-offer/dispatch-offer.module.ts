import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { DispatchCandidateModule } from '../dispatch-candidate';
import { DispatchOutboxModule } from '../dispatch-outbox';
import { DriverPresenceModule } from '../driver-presence';
import { NotificationsModule } from '../notifications';
import { DispatchAssignmentPickupService } from './dispatch-assignment-pickup.service';
import { DispatchAssignmentTripService } from './dispatch-assignment-trip.service';
import { DispatchAssignmentCancellationService } from './dispatch-assignment-cancellation.service';
import { DispatchAssignmentsController } from './dispatch-assignments.controller';
import { DispatchJobOperationsService } from './dispatch-job-operations.service';
import { DispatchNotificationWorkerService } from './dispatch-notification-worker.service';
import { DispatchOffersController } from './dispatch-offers.controller';
import { DispatchOffersService } from './dispatch-offers.service';
import { DispatchPickupReminderWorkerService } from './dispatch-pickup-reminder-worker.service';
import { MatchOrchestrator } from './match-orchestrator.service';
import { MatchWorkerService } from './match-worker.service';
import { OfferAcceptanceService } from './offer-acceptance.service';
import { OfferCancellationService } from './offer-cancellation.service';
import { OfferExpirationService } from './offer-expiration.service';
import { OfferExpirationWorkerService } from './offer-expiration-worker.service';
import { OfferRejectionService } from './offer-rejection.service';
import { OfferReservationService } from './offer-reservation.service';
import { ReconciliationWorkerService } from './reconciliation-worker.service';

@Module({
  imports: [
    AuthModule,
    DispatchCandidateModule,
    DispatchOutboxModule,
    DriverPresenceModule,
    NotificationsModule,
  ],
  controllers: [DispatchOffersController, DispatchAssignmentsController],
  providers: [
    DispatchOffersService,
    DispatchAssignmentPickupService,
    DispatchAssignmentTripService,
    DispatchAssignmentCancellationService,
    MatchOrchestrator,
    MatchWorkerService,
    OfferReservationService,
    OfferAcceptanceService,
    OfferCancellationService,
    OfferRejectionService,
    OfferExpirationService,
    OfferExpirationWorkerService,
    DispatchNotificationWorkerService,
    DispatchPickupReminderWorkerService,
    ReconciliationWorkerService,
    DispatchJobOperationsService,
  ],
  exports: [
    DispatchOffersService,
    DispatchAssignmentPickupService,
    DispatchAssignmentTripService,
    DispatchAssignmentCancellationService,
    MatchOrchestrator,
    MatchWorkerService,
    OfferReservationService,
    OfferAcceptanceService,
    OfferCancellationService,
    OfferRejectionService,
    OfferExpirationService,
    OfferExpirationWorkerService,
    DispatchNotificationWorkerService,
    DispatchPickupReminderWorkerService,
    ReconciliationWorkerService,
    DispatchJobOperationsService,
  ],
})
export class DispatchOfferModule {}
