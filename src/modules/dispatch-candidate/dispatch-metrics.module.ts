import { Global, Module } from '@nestjs/common';
import {
  DISPATCH_METRICS,
  LoggingDispatchMetrics,
} from './dispatch-metrics.service';

@Global()
@Module({
  providers: [
    {
      provide: DISPATCH_METRICS,
      useClass: LoggingDispatchMetrics,
    },
  ],
  exports: [DISPATCH_METRICS],
})
export class DispatchMetricsModule {}
