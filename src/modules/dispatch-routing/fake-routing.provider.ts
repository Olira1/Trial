import {
  ROUTING_PROVIDER,
  type ProviderFailureEstimate,
  type RoutingEstimate,
  type RoutingEstimateRequest,
  type RoutingProvider,
  type RoutingPoint,
  type UnreachableEstimate,
} from './routing-provider';

export type FakeRoutingProviderOptions = {
  averageSpeedMetersPerSecond?: number;
  unreachableRate?: number;
  failureRate?: number;
};

export class FakeRoutingProvider implements RoutingProvider {
  constructor(private readonly options: FakeRoutingProviderOptions = {}) {}

  estimateBatch(
    requests: RoutingEstimateRequest[],
  ): Promise<RoutingEstimate[]> {
    return Promise.resolve(requests.map((request) => this.estimate(request)));
  }

  private estimate(request: RoutingEstimateRequest): RoutingEstimate {
    const { unreachableRate = 0, failureRate = 0 } = this.options;
    const roll = Math.random();

    if (failureRate > 0 && roll < failureRate) {
      return providerFailure('simulated provider failure');
    }

    if (unreachableRate > 0 && roll < failureRate + unreachableRate) {
      return unreachable();
    }

    const distanceMeters = this.haversineMeters(
      request.origin,
      request.destination,
    );
    const averageSpeedMetersPerSecond =
      this.options.averageSpeedMetersPerSecond ?? 8.33; // ~30 km/h
    const durationSeconds = Math.ceil(
      distanceMeters / averageSpeedMetersPerSecond,
    );

    return {
      status: 'routed',
      distanceMeters,
      durationSeconds: Math.max(1, durationSeconds),
    };
  }

  private haversineMeters(a: RoutingPoint, b: RoutingPoint): number {
    const R = 6_371_000;
    const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
    const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
    const lat1 = (a.latitude * Math.PI) / 180;
    const lat2 = (b.latitude * Math.PI) / 180;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
  }
}

export const fakeRoutingProvider = (options?: FakeRoutingProviderOptions) => ({
  provide: ROUTING_PROVIDER,
  useValue: new FakeRoutingProvider(options),
});

export const unreachable = (): UnreachableEstimate => ({
  status: 'unreachable',
});

export const providerFailure = (reason: string): ProviderFailureEstimate => ({
  status: 'provider_failure',
  reason,
});
