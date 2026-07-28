import { MatchOrchestrator } from './match-orchestrator.service';

describe('MatchOrchestrator rollout controls', () => {
  it('skips matching before any request load when the rollout flag is disabled', async () => {
    const db = {
      execute: jest.fn(),
      transaction: jest.fn(),
    };
    const ranking = {
      rankForRequest: jest.fn(),
    };

    const service = new MatchOrchestrator(
      db as never,
      {
        enableNewMatching: false,
        enableShadowRanking: false,
      } as never,
      ranking as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.attemptMatch('request-1')).resolves.toEqual({
      status: 'noop',
    });
    expect(db.execute).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(ranking.rankForRequest).not.toHaveBeenCalled();
  });

  it('runs ranking without reserving or mutating requests when shadow ranking is enabled', async () => {
    const db = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'request-1',
              state: 'searching',
              matching_deadline_at: new Date(Date.now() + 60_000).toISOString(),
              pickup_lat: 9.02,
              pickup_lon: 38.75,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ driver_id: 'driver-1' }],
        }),
      transaction: jest.fn(),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn().mockResolvedValue([{ driverId: 'driver-1' }]),
        })),
      })),
    };
    const ranking = {
      rankForRequest: jest.fn().mockResolvedValue([
        {
          driverId: 'driver-2',
          etaSeconds: 120,
          distanceMeters: 1500,
        },
      ]),
    };
    const reservation = {
      tryReserve: jest.fn(),
    };

    const service = new MatchOrchestrator(
      db as never,
      {
        enableNewMatching: true,
        enableShadowRanking: true,
      } as never,
      ranking as never,
      reservation as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.attemptMatch('request-1')).resolves.toEqual({
      status: 'shadow',
      candidateCount: 1,
    });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(ranking.rankForRequest).toHaveBeenCalledWith(
      'request-1',
      { latitude: 9.02, longitude: 38.75 },
      new Set(['driver-1']),
    );
    expect(reservation.tryReserve).not.toHaveBeenCalled();
  });
});
