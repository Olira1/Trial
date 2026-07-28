import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { fareConfig } from '../../config';
import { DRIZZLE, type Database } from '../../database/database.module';
import {
  ROUTING_PROVIDER,
  type RoutedEstimate,
  type RoutingEstimate,
  type RoutingPoint,
  type RoutingProvider,
} from '../dispatch-routing';
import {
  fareEstimate,
  type FareEstimate,
  type NewFareEstimate,
} from './schema';

const ETB_MINOR_PER_UNIT = 100;

export type CreateFareEstimateInput = {
  pickup: RoutingPoint;
  destination: RoutingPoint;
  vehicleType: 'standard';
};

@Injectable()
export class FareEstimatesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(ROUTING_PROVIDER)
    private readonly routingProvider: RoutingProvider,
    @Inject(fareConfig.KEY)
    private readonly config: ConfigType<typeof fareConfig>,
  ) {}

  async create(
    riderId: string,
    input: CreateFareEstimateInput,
  ): Promise<FareEstimate> {
    const route = await this.estimateRoute(input.pickup, input.destination);
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + this.config.estimateTtlSeconds * 1_000,
    );
    const values: NewFareEstimate = {
      riderId,
      pickup: input.pickup,
      destination: input.destination,
      vehicleType: input.vehicleType,
      currency: 'ETB',
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      rateMinorPerKm: this.config.standardRateMinorPerKm,
      estimatedFareMinor: this.calculateFareMinor(route.distanceMeters),
      expiresAt,
      createdAt,
    };

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(fareEstimate)
        .values(values)
        .returning();

      if (!created) {
        throw new Error('fare estimate insert returned no row');
      }

      return {
        ...created,
        pickup: input.pickup,
        destination: input.destination,
      };
    });
  }

  private async estimateRoute(
    origin: RoutingPoint,
    destination: RoutingPoint,
  ): Promise<RoutedEstimate> {
    let estimates: RoutingEstimate[];
    try {
      estimates = await this.routingProvider.estimateBatch([
        { origin, destination },
      ]);
    } catch (error) {
      throw new ServiceUnavailableException(
        'fare routing provider unavailable',
        { cause: error },
      );
    }

    const estimate = estimates[0];
    if (!estimate || estimate.status === 'provider_failure') {
      throw new ServiceUnavailableException(
        'fare routing provider unavailable',
      );
    }
    if (estimate.status === 'unreachable') {
      throw new UnprocessableEntityException('route is unreachable');
    }
    if (estimate.distanceMeters <= 0 || estimate.durationSeconds <= 0) {
      throw new UnprocessableEntityException(
        'route must have positive distance and duration',
      );
    }

    return estimate;
  }

  private calculateFareMinor(distanceMeters: number): number {
    const fareEtb =
      (distanceMeters * this.config.standardRateMinorPerKm) /
      (1_000 * ETB_MINOR_PER_UNIT);

    return Math.round(fareEtb) * ETB_MINOR_PER_UNIT;
  }
}
