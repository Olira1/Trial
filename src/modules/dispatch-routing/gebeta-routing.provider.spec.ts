import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { dispatchConfig } from '../../config';
import {
  GebetaRoutingError,
  GebetaRoutingProvider,
} from './gebeta-routing.provider';

const origin = { latitude: 9.0106, longitude: 38.7613 };
const destination = { latitude: 9.03, longitude: 38.77 };

describe('GebetaRoutingProvider', () => {
  let moduleRef: TestingModule;
  let provider: GebetaRoutingProvider;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [dispatchConfig],
        }),
      ],
      providers: [GebetaRoutingProvider],
    }).compile();

    provider = moduleRef.get(GebetaRoutingProvider);
  });

  beforeEach(() => {
    process.env.GEBETA_API_KEY = 'test-api-key';
    fetchSpy = jest.spyOn(global, 'fetch').mockReset();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.GEBETA_API_KEY;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('returns routed estimates from a valid Matrix response', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          origin_to_destination: [{ from: 0, to: 1, distance: 2.4, time: 180 }],
        }),
    });

    const [result] = await provider.estimateBatch([{ origin, destination }]);

    expect(result).toBeDefined();
    if (!result) throw new Error('missing routing result');
    expect(result.status).toBe('routed');
    if (result.status !== 'routed') throw new Error('expected routed result');
    expect(result.distanceMeters).toBe(2400);
    expect(result.durationSeconds).toBe(180);
  });

  it('rejects more than 9 candidate origins', async () => {
    const requests = Array.from({ length: 10 }).map(() => ({
      origin,
      destination,
    }));

    await expect(provider.estimateBatch(requests)).rejects.toThrow(
      GebetaRoutingError,
    );
  });

  it('returns empty array for no requests', async () => {
    const result = await provider.estimateBatch([]);
    expect(result).toEqual([]);
  });

  it('throws when API key is missing', async () => {
    const providerWithoutKey = new GebetaRoutingProvider({
      ...moduleRef.get(dispatchConfig.KEY),
      gebetaApiKey: undefined,
    });

    await expect(
      providerWithoutKey.estimateBatch([{ origin, destination }]),
    ).rejects.toThrow('GEBETA_API_KEY is not configured');
  });

  it('throws provider failure on HTTP error', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(
      provider.estimateBatch([{ origin, destination }]),
    ).rejects.toThrow('Gebeta returned HTTP 500');
  });

  it('throws provider failure on invalid JSON', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('parse error')),
    });

    await expect(
      provider.estimateBatch([{ origin, destination }]),
    ).rejects.toThrow('Gebeta returned invalid JSON');
  });

  it('returns unreachable for missing pair', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ origin_to_destination: [] }),
    });

    const [result] = await provider.estimateBatch([{ origin, destination }]);

    expect(result).toBeDefined();
    if (!result) throw new Error('missing routing result');
    expect(result.status).toBe('unreachable');
  });

  it('throws provider failure on invalid route pair values', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          origin_to_destination: [{ from: 0, to: 1, distance: -1, time: 180 }],
        }),
    });

    await expect(
      provider.estimateBatch([{ origin, destination }]),
    ).rejects.toThrow('Gebeta returned invalid route pair');
  });
});
