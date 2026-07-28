export type RoutingPoint = {
  latitude: number;
  longitude: number;
};

export type RoutingEstimateRequest = {
  origin: RoutingPoint;
  destination: RoutingPoint;
};

export type RoutedEstimate = {
  status: 'routed';
  durationSeconds: number;
  distanceMeters: number;
};

export type UnreachableEstimate = {
  status: 'unreachable';
};

export type ProviderFailureEstimate = {
  status: 'provider_failure';
  reason: string;
};

export type RoutingEstimate =
  | RoutedEstimate
  | UnreachableEstimate
  | ProviderFailureEstimate;

export interface RoutingProvider {
  estimateBatch(requests: RoutingEstimateRequest[]): Promise<RoutingEstimate[]>;
}

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');

export class RoutingProviderFailureError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RoutingProviderFailureError';
  }
}
