import { getHexagonEdgeLengthAvg } from 'h3-js';

export type CandidatePolicyConfig = {
  searchRadiusKm: number;
  discoveryH3Resolution: number;
  maxRings: number;
  maxCandidates: number;
  tiebreaker: 'eta_then_distance';
  fairnessMode: 'none';
};

export type CandidateInfo = {
  driverId: string;
  etaSeconds: number | null;
  straightLineKm: number;
};

export class CandidatePolicy {
  constructor(private readonly config: CandidatePolicyConfig) {}

  get configSnapshot(): CandidatePolicyConfig {
    return { ...this.config };
  }

  getRequiredRings(): number {
    const edgeKm = getHexagonEdgeLengthAvg(
      this.config.discoveryH3Resolution,
      'km',
    );
    const coveragePerRing = edgeKm * 2;
    if (coveragePerRing <= 0) return 0;
    const rings = Math.ceil(this.config.searchRadiusKm / coveragePerRing);
    return Math.max(1, Math.min(rings, this.config.maxRings));
  }

  validateCoverage(): void {
    const edgeKm = getHexagonEdgeLengthAvg(
      this.config.discoveryH3Resolution,
      'km',
    );
    const maxCoverageKm = this.config.maxRings * edgeKm * 2;
    if (this.config.searchRadiusKm > maxCoverageKm) {
      throw new Error(
        `maxRings=${this.config.maxRings} at resolution ${this.config.discoveryH3Resolution} covers at most ~${maxCoverageKm.toFixed(1)}km, but searchRadiusKm=${this.config.searchRadiusKm}`,
      );
    }
  }

  excludeRejected<T extends CandidateInfo>(
    candidates: T[],
    rejectedDriverIds: Set<string>,
  ): T[] {
    return candidates.filter((c) => !rejectedDriverIds.has(c.driverId));
  }

  rank<T extends CandidateInfo>(candidates: T[]): T[] {
    return [...candidates].sort((a, b) => {
      const etaA = a.etaSeconds ?? Infinity;
      const etaB = b.etaSeconds ?? Infinity;
      if (etaA !== etaB) return etaA - etaB;
      return a.straightLineKm - b.straightLineKm;
    });
  }

  select<T extends CandidateInfo>(
    candidates: T[],
    rejectedDriverIds?: Set<string>,
  ): T[] {
    const eligible = rejectedDriverIds
      ? this.excludeRejected(candidates, rejectedDriverIds)
      : candidates;
    const ranked = this.rank(eligible);
    return ranked.slice(0, this.config.maxCandidates);
  }
}
