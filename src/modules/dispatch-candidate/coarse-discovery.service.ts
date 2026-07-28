import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { latLngToCell, gridDiskDistances, cellToChildren } from 'h3-js';
import { dispatchConfig } from '../../config';
import { DriverPresenceLeaseService } from '../driver-presence';
import type { DriverPresenceIndexedCandidate } from '../driver-presence/driver-presence-lease.service';
import { CandidatePolicy } from './candidate-policy';

export type CoarseDiscoveryCandidate = {
  driverId: string;
  straightLineKm: number;
  location: { latitude: number; longitude: number };
};

const CONCURRENCY = 50;

@Injectable()
export class CoarseDiscoveryService {
  private readonly policy: CandidatePolicy;

  constructor(
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
    private readonly leaseService: DriverPresenceLeaseService,
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

  async findCandidates(
    pickupLatitude: number,
    pickupLongitude: number,
    rejectedDriverIds?: Set<string>,
    now?: Date,
  ): Promise<CoarseDiscoveryCandidate[]> {
    const centerCell = latLngToCell(
      pickupLatitude,
      pickupLongitude,
      this.config.discoveryH3Resolution,
    );

    const rings = this.policy.getRequiredRings();
    const distances = gridDiskDistances(centerCell, rings);
    const ringCells = [...new Set(distances.flat())];

    const storageCells = ringCells.flatMap((cell) =>
      cellToChildren(cell, this.config.h3Resolution),
    );

    const results: DriverPresenceIndexedCandidate[] = [];
    for (let i = 0; i < storageCells.length; i += CONCURRENCY) {
      const batch = storageCells.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((c) => this.leaseService.listActiveCellCandidates(c, now)),
      );
      for (const r of batchResults) {
        results.push(...r);
      }
    }

    const seen = new Set<string>();
    const unique = results.filter((c) => {
      if (seen.has(c.userId)) return false;
      seen.add(c.userId);
      return true;
    });

    const candidates = unique.map((c) => ({
      driverId: c.userId,
      etaSeconds: null as number | null,
      straightLineKm: this.approximateKm(
        pickupLatitude,
        pickupLongitude,
        c.location.latitude,
        c.location.longitude,
      ),
      location: {
        latitude: c.location.latitude,
        longitude: c.location.longitude,
      },
    }));

    return this.policy.select(candidates, rejectedDriverIds);
  }

  private approximateKm(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
