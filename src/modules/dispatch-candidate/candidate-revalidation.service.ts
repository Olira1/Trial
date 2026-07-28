import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { inArray, sql } from 'drizzle-orm';
import { dispatchConfig } from '../../config';
import {
  DRIZZLE,
  type Database,
  type DBTransaction,
} from '../../database/database.module';
import { DriverEligibilityService } from '../driver-presence';
import { driverOperationalProfile } from '../driver-presence/schema';

import { CandidatePolicy } from './candidate-policy';
import type { CoarseDiscoveryCandidate } from './coarse-discovery.service';

export type ValidatedCandidate = {
  driverId: string;
  exactDistanceKm: number;
  location: { latitude: number; longitude: number };
};

@Injectable()
export class CandidateRevalidationService {
  private readonly policy: CandidatePolicy;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
    private readonly eligibility: DriverEligibilityService,
  ) {
    this.policy = new CandidatePolicy({
      searchRadiusKm: config.searchRadiusKm,
      discoveryH3Resolution: config.discoveryH3Resolution,
      maxRings: config.maxRings,
      maxCandidates: config.maxCandidates,
      tiebreaker: 'eta_then_distance',
      fairnessMode: 'none',
    });
  }

  async revalidate(
    requestId: string,
    coarseCandidates: CoarseDiscoveryCandidate[],
    excludedDriverIds?: Set<string>,
  ): Promise<ValidatedCandidate[]> {
    return this.db.transaction(async (tx) => {
      const request = await this.loadRequest(requestId, tx);
      if (!request) {
        throw new NotFoundException('ride request not found');
      }

      if (coarseCandidates.length === 0) {
        return [];
      }

      const driverIds = coarseCandidates.map((c) => c.driverId);
      const profiles = await this.loadOperationalProfiles(driverIds, tx);
      const eligibility =
        await this.eligibility.batchEvaluateInstantRideDriverEligibility(
          driverIds,
          tx,
        );
      const distances = await this.loadExactDistances(
        requestId,
        coarseCandidates,
        tx,
      );

      const validated = coarseCandidates
        .filter((candidate) => {
          if (excludedDriverIds?.has(candidate.driverId)) return false;

          const profile = profiles.get(candidate.driverId);
          if (profile?.operationalState !== 'online') return false;

          const eligibilityResult = eligibility.get(candidate.driverId);
          if (!eligibilityResult?.eligible) return false;

          const exactDistanceKm = distances.get(candidate.driverId);
          if (exactDistanceKm === undefined) return false;
          if (exactDistanceKm > this.config.searchRadiusKm) return false;

          return true;
        })
        .map((candidate) => ({
          driverId: candidate.driverId,
          exactDistanceKm: distances.get(candidate.driverId)!,
          location: candidate.location,
        }));

      return this.policy
        .select(
          validated.map((c) => ({
            driverId: c.driverId,
            etaSeconds: null,
            straightLineKm: c.exactDistanceKm,
          })),
        )
        .map((c) => ({
          driverId: c.driverId,
          exactDistanceKm: c.straightLineKm,
          location: validated.find((v) => v.driverId === c.driverId)!.location,
        }));
    });
  }

  private async loadRequest(requestId: string, tx: DBTransaction) {
    const result = await tx.execute<{ id: string }>(sql`
      SELECT "id" FROM "ride_request" WHERE "id" = ${requestId}
    `);
    return result.rows[0];
  }

  private async loadExactDistances(
    requestId: string,
    candidates: CoarseDiscoveryCandidate[],
    tx: DBTransaction,
  ): Promise<Map<string, number>> {
    if (candidates.length === 0) return new Map();

    const valueRows = candidates.map(
      (c) =>
        sql`(${c.driverId}::uuid, ${c.location.latitude}::float8, ${c.location.longitude}::float8)`,
    );
    const values = valueRows.reduce((a, b) => sql`${a}, ${b}`);

    const result = await tx.execute<{
      driver_id: string;
      distance_km: number;
    }>(sql`
      WITH candidates(driver_id, lat, lon) AS (VALUES ${values})
      SELECT
        c.driver_id::text AS driver_id,
        ST_Distance(
          r.pickup,
          ST_SetSRID(ST_MakePoint(c.lon, c.lat), 4326)::geography
        ) / 1000.0 AS distance_km
      FROM candidates c
      CROSS JOIN "ride_request" r
      WHERE r.id = ${requestId}
    `);

    return new Map(
      result.rows.map((r) => [r.driver_id, Number(r.distance_km)]),
    );
  }

  private async loadOperationalProfiles(
    driverIds: string[],
    tx: DBTransaction,
  ): Promise<
    Map<string, { operationalState: string; presenceGeneration: number }>
  > {
    const uniqueIds = [...new Set(driverIds)];
    if (uniqueIds.length === 0) return new Map();

    const rows = await tx
      .select({
        userId: driverOperationalProfile.userId,
        operationalState: driverOperationalProfile.operationalState,
        presenceGeneration: driverOperationalProfile.presenceGeneration,
      })
      .from(driverOperationalProfile)
      .where(inArray(driverOperationalProfile.userId, uniqueIds));

    return new Map(
      rows.map((r) => [
        r.userId,
        {
          operationalState: r.operationalState,
          presenceGeneration: r.presenceGeneration,
        },
      ]),
    );
  }
}
