import { ListRideRequestsHistoryDto } from './ride-requests.history.dto';

describe('ListRideRequestsHistoryDto', () => {
  it('defaults bounded pagination', () => {
    expect(ListRideRequestsHistoryDto.schema.parse({})).toEqual({
      limit: 20,
      offset: 0,
    });
  });

  it('coerces query values and enforces bounds', () => {
    expect(
      ListRideRequestsHistoryDto.schema.parse({
        limit: '50',
        offset: '10',
      }),
    ).toEqual({
      limit: 50,
      offset: 10,
    });
  });
});
