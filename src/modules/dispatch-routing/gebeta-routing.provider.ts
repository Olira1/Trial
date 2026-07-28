import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { dispatchConfig } from '../../config';
import {
  ROUTING_PROVIDER,
  type RoutingEstimate,
  type RoutingEstimateRequest,
  type RoutingProvider,
} from './routing-provider';

const GEBETA_MATRIX_PATH = '/api/v1/route/matrix';
const MAX_COORDINATES = 10;

export type GebetaMatrixResponse = {
  origin_to_destination?: Array<{
    from: number;
    to: number;
    distance: number;
    time: number;
  }>;
};

export class GebetaRoutingError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GebetaRoutingError';
  }
}

@Injectable()
export class GebetaRoutingProvider implements RoutingProvider {
  constructor(
    @Inject(dispatchConfig.KEY)
    private readonly config: ConfigType<typeof dispatchConfig>,
  ) {}

  async estimateBatch(
    requests: RoutingEstimateRequest[],
  ): Promise<RoutingEstimate[]> {
    if (requests.length === 0) {
      return [];
    }

    if (!this.config.gebetaApiKey) {
      throw new GebetaRoutingError('GEBETA_API_KEY is not configured');
    }

    if (requests.length > MAX_COORDINATES - 1) {
      throw new GebetaRoutingError(
        `Gebeta Matrix supports at most ${MAX_COORDINATES - 1} candidate origins per request, received ${requests.length}`,
      );
    }

    const destination = requests[0]!.destination;
    const coordinates = [
      ...requests.map((r) => `${r.origin.latitude},${r.origin.longitude}`),
      `${destination.latitude},${destination.longitude}`,
    ];

    const url = new URL(
      GEBETA_MATRIX_PATH,
      this.config.gebetaBaseUrl,
    ).toString();

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.gebetaTimeoutMs,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.gebetaApiKey}`,
        },
        body: JSON.stringify({ coordinates }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GebetaRoutingError(
          `Gebeta request timed out after ${this.config.gebetaTimeoutMs}ms`,
        );
      }
      throw new GebetaRoutingError('Gebeta request failed', error);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new GebetaRoutingError(`Gebeta returned HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new GebetaRoutingError('Gebeta returned invalid JSON', error);
    }

    return this.parseMatrixResponse(requests.length, body);
  }

  private parseMatrixResponse(
    originCount: number,
    body: unknown,
  ): RoutingEstimate[] {
    const parsed = body as GebetaMatrixResponse;
    const pairs = parsed?.origin_to_destination;

    if (!Array.isArray(pairs)) {
      throw new GebetaRoutingError(
        'Gebeta response missing origin_to_destination',
      );
    }

    const destinationIndex = originCount;
    const expectedPairs = originCount;
    const results: RoutingEstimate[] = [];

    for (let from = 0; from < originCount; from += 1) {
      const pair = pairs.find(
        (p) => p.from === from && p.to === destinationIndex,
      );

      if (!pair) {
        results.push({ status: 'unreachable' });
        continue;
      }

      if (
        typeof pair.distance !== 'number' ||
        typeof pair.time !== 'number' ||
        !Number.isFinite(pair.distance) ||
        !Number.isFinite(pair.time) ||
        pair.distance < 0 ||
        pair.time < 0
      ) {
        throw new GebetaRoutingError('Gebeta returned invalid route pair');
      }

      results.push({
        status: 'routed',
        distanceMeters: Math.round(pair.distance * 1_000),
        durationSeconds: Math.round(pair.time),
      });
    }

    if (results.length !== expectedPairs) {
      throw new GebetaRoutingError('Gebeta response pair count mismatch');
    }

    return results;
  }
}

export const gebetaRoutingProvider = () => ({
  provide: ROUTING_PROVIDER,
  useClass: GebetaRoutingProvider,
});
