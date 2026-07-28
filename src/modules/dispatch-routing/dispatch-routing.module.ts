import { Module } from '@nestjs/common';
import { FakeRoutingProvider } from './fake-routing.provider';
import { GebetaRoutingProvider } from './gebeta-routing.provider';
import { ROUTING_PROVIDER } from './routing-provider';

@Module({
  providers: [
    {
      provide: ROUTING_PROVIDER,
      useClass: FakeRoutingProvider,
    },
    GebetaRoutingProvider,
  ],
  exports: [ROUTING_PROVIDER, GebetaRoutingProvider],
})
export class DispatchRoutingModule {}
