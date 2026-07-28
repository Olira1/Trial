import {
  CandidatePolicy,
  type CandidateInfo,
  type CandidatePolicyConfig,
} from './candidate-policy';

const defaultConfig: CandidatePolicyConfig = {
  searchRadiusKm: 3,
  discoveryH3Resolution: 9,
  maxRings: 9,
  maxCandidates: 9,
  tiebreaker: 'eta_then_distance',
  fairnessMode: 'none',
};

describe('CandidatePolicy', () => {
  describe('config', () => {
    it('exposes a frozen snapshot of the config', () => {
      const policy = new CandidatePolicy(defaultConfig);
      expect(policy.configSnapshot).toEqual(defaultConfig);
    });
  });

  describe('getRequiredRings', () => {
    it('returns at least 1 ring for any positive radius', () => {
      const policy = new CandidatePolicy({
        ...defaultConfig,
        searchRadiusKm: 0.1,
      });
      expect(policy.getRequiredRings()).toBeGreaterThanOrEqual(1);
    });

    it('returns the minimum rings needed to cover search radius at the configured resolution', () => {
      const policy = new CandidatePolicy(defaultConfig);
      const rings = policy.getRequiredRings();
      expect(rings).toBeGreaterThanOrEqual(1);
      expect(rings).toBeLessThanOrEqual(defaultConfig.maxRings);
    });

    it('caps rings at maxRings even if radius would need more', () => {
      const policy = new CandidatePolicy({
        ...defaultConfig,
        searchRadiusKm: 100,
      });
      expect(policy.getRequiredRings()).toBe(defaultConfig.maxRings);
    });
  });

  describe('validateCoverage', () => {
    it('passes when rings cover the search radius', () => {
      const policy = new CandidatePolicy(defaultConfig);
      expect(() => policy.validateCoverage()).not.toThrow();
    });

    it('throws when rings cannot cover the search radius', () => {
      const policy = new CandidatePolicy({
        ...defaultConfig,
        searchRadiusKm: 100,
        discoveryH3Resolution: 15,
        maxRings: 3,
      });
      expect(() => policy.validateCoverage()).toThrow();
    });
  });

  describe('excludeRejected', () => {
    it('removes candidates whose driverId is in the rejected set', () => {
      const policy = new CandidatePolicy(defaultConfig);
      const candidates: CandidateInfo[] = [
        { driverId: 'd1', etaSeconds: 60, straightLineKm: 1 },
        { driverId: 'd2', etaSeconds: 90, straightLineKm: 2 },
        { driverId: 'd3', etaSeconds: 30, straightLineKm: 0.5 },
      ];
      const result = policy.excludeRejected(candidates, new Set(['d2']));
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.driverId)).toEqual(['d1', 'd3']);
    });

    it('returns all candidates when rejected set is empty', () => {
      const policy = new CandidatePolicy(defaultConfig);
      const candidates: CandidateInfo[] = [
        { driverId: 'd1', etaSeconds: 60, straightLineKm: 1 },
      ];
      const result = policy.excludeRejected(candidates, new Set());
      expect(result).toHaveLength(1);
    });
  });

  describe('rank', () => {
    it('sorts by ETA ascending, then straight-line distance', () => {
      const policy = new CandidatePolicy(defaultConfig);
      const candidates: CandidateInfo[] = [
        { driverId: 'd1', etaSeconds: 90, straightLineKm: 3 },
        { driverId: 'd2', etaSeconds: 60, straightLineKm: 2 },
        { driverId: 'd3', etaSeconds: 60, straightLineKm: 1 },
      ];
      const result = policy.rank(candidates);
      expect(result.map((c) => c.driverId)).toEqual(['d3', 'd2', 'd1']);
    });

    it('places candidates without ETA at the end', () => {
      const policy = new CandidatePolicy(defaultConfig);
      const candidates: CandidateInfo[] = [
        { driverId: 'd1', etaSeconds: null, straightLineKm: 0.5 },
        { driverId: 'd2', etaSeconds: 60, straightLineKm: 2 },
      ];
      const result = policy.rank(candidates);
      expect(result.map((c) => c.driverId)).toEqual(['d2', 'd1']);
    });

    it('does not mutate the input array', () => {
      const policy = new CandidatePolicy(defaultConfig);
      const candidates: CandidateInfo[] = [
        { driverId: 'd1', etaSeconds: 90, straightLineKm: 3 },
        { driverId: 'd2', etaSeconds: 60, straightLineKm: 2 },
      ];
      const original = [...candidates];
      policy.rank(candidates);
      expect(candidates).toEqual(original);
    });
  });

  describe('select', () => {
    it('applies exclusion, ranking, and limit', () => {
      const policy = new CandidatePolicy({
        ...defaultConfig,
        maxCandidates: 2,
      });
      const candidates: CandidateInfo[] = [
        { driverId: 'd1', etaSeconds: 90, straightLineKm: 3 },
        { driverId: 'd2', etaSeconds: 30, straightLineKm: 1 },
        { driverId: 'd3', etaSeconds: 60, straightLineKm: 2 },
      ];
      const result = policy.select(candidates, new Set(['d2']));
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.driverId)).toEqual(['d3', 'd1']);
    });

    it('returns at most maxCandidates', () => {
      const policy = new CandidatePolicy({
        ...defaultConfig,
        maxCandidates: 1,
      });
      const candidates: CandidateInfo[] = [
        { driverId: 'd1', etaSeconds: 30, straightLineKm: 1 },
        { driverId: 'd2', etaSeconds: 60, straightLineKm: 2 },
      ];
      const result = policy.select(candidates);
      expect(result).toHaveLength(1);
    });

    it('works without rejection set', () => {
      const policy = new CandidatePolicy(defaultConfig);
      const candidates: CandidateInfo[] = [
        { driverId: 'd1', etaSeconds: 30, straightLineKm: 1 },
      ];
      const result = policy.select(candidates);
      expect(result).toHaveLength(1);
      const [firstResult] = result;
      if (!firstResult) throw new Error('expected selected candidate');
      expect(firstResult.driverId).toBe('d1');
    });
  });
});
