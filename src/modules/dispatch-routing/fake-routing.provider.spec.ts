import { FakeRoutingProvider } from './fake-routing.provider';

describe('FakeRoutingProvider', () => {
  const origin = { latitude: 9.0106, longitude: 38.7613 };
  const destination = { latitude: 9.03, longitude: 38.77 };

  it('returns routed estimates with deterministic distance and duration', async () => {
    const provider = new FakeRoutingProvider({
      averageSpeedMetersPerSecond: 10,
    });

    const [result] = await provider.estimateBatch([{ origin, destination }]);

    expect(result).toBeDefined();
    if (!result) throw new Error('missing routing result');
    expect(result.status).toBe('routed');
    if (result.status !== 'routed') throw new Error('expected routed result');
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.durationSeconds).toBeGreaterThan(0);
  });

  it('preserves request order in the response', async () => {
    const provider = new FakeRoutingProvider();
    const requests = [
      { origin, destination: { latitude: 9.011, longitude: 38.762 } },
      { origin, destination: { latitude: 9.012, longitude: 38.763 } },
      { origin, destination: { latitude: 9.013, longitude: 38.764 } },
    ];

    const results = await provider.estimateBatch(requests);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'routed')).toBe(true);
  });

  it('can simulate unreachable outcomes', async () => {
    const provider = new FakeRoutingProvider({ unreachableRate: 1 });

    const [result] = await provider.estimateBatch([{ origin, destination }]);

    expect(result).toBeDefined();
    if (!result) throw new Error('missing routing result');
    expect(result.status).toBe('unreachable');
  });

  it('can simulate provider failures', async () => {
    const provider = new FakeRoutingProvider({ failureRate: 1 });

    const [result] = await provider.estimateBatch([{ origin, destination }]);

    expect(result).toBeDefined();
    if (!result) throw new Error('missing routing result');
    expect(result.status).toBe('provider_failure');
    if (result.status !== 'provider_failure') {
      throw new Error('expected provider_failure result');
    }
    expect(result.reason).toBe('simulated provider failure');
  });

  it('returns provider_failure before unreachable when both rates are configured', async () => {
    const provider = new FakeRoutingProvider({
      failureRate: 1,
      unreachableRate: 1,
    });

    const [result] = await provider.estimateBatch([{ origin, destination }]);

    expect(result).toBeDefined();
    if (!result) throw new Error('missing routing result');
    expect(result.status).toBe('provider_failure');
  });

  it('does not mutate input requests', async () => {
    const provider = new FakeRoutingProvider();
    const request = { origin, destination };

    await provider.estimateBatch([request]);

    expect(request).toEqual({ origin, destination });
  });
});
