import { ListDispatchAssignmentsHistoryDto } from './dispatch-assignments.history.dto';

describe('ListDispatchAssignmentsHistoryDto', () => {
  it('defaults bounded pagination', () => {
    expect(ListDispatchAssignmentsHistoryDto.schema.parse({})).toEqual({
      limit: 20,
      offset: 0,
    });
  });

  it('coerces query values and enforces bounds', () => {
    expect(
      ListDispatchAssignmentsHistoryDto.schema.parse({
        limit: '50',
        offset: '10',
      }),
    ).toEqual({
      limit: 50,
      offset: 10,
    });
  });
});
