import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { DispatchOfferModule } from '../dispatch-offer';
import { DispatchOutboxModule } from '../dispatch-outbox';
import { RideRequestsController } from './ride-requests.controller';
import { RideRequestsService } from './ride-requests.service';

@Module({
  imports: [AuthModule, DispatchOutboxModule, DispatchOfferModule],
  controllers: [RideRequestsController],
  providers: [RideRequestsService],
})
export class RideRequestsModule {}
