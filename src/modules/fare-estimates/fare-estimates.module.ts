import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { DispatchRoutingModule } from '../dispatch-routing';
import { FareEstimatesController } from './fare-estimates.controller';
import { FareEstimatesService } from './fare-estimates.service';

@Module({
  imports: [AuthModule, DispatchRoutingModule],
  controllers: [FareEstimatesController],
  providers: [FareEstimatesService],
})
export class FareEstimatesModule {}
