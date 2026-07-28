import { Module } from '@nestjs/common';
import { DispatchRoutingModule } from '../dispatch-routing';
import { DriverPresenceModule } from '../driver-presence';
import { CandidateRankingService } from './candidate-ranking.service';
import { CandidateRevalidationService } from './candidate-revalidation.service';
import { CoarseDiscoveryService } from './coarse-discovery.service';

@Module({
  imports: [DriverPresenceModule, DispatchRoutingModule],
  providers: [
    CandidateRankingService,
    CandidateRevalidationService,
    CoarseDiscoveryService,
  ],
  exports: [
    CandidateRankingService,
    CandidateRevalidationService,
    CoarseDiscoveryService,
  ],
})
export class DispatchCandidateModule {}
