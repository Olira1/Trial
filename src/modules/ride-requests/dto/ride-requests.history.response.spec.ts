import { RideRequestsHistoryResponseSchema } from './ride-requests.history.response';

describe('RideRequestsHistoryResponseSchema', () => {
  it('accepts bounded history list payloads', () => {
    expect(
      RideRequestsHistoryResponseSchema.parse({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      }),
    ).toEqual({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });
});
