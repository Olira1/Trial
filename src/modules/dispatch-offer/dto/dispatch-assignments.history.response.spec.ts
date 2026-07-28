import { DispatchAssignmentsHistoryResponseSchema } from './dispatch-assignments.history.response';

describe('DispatchAssignmentsHistoryResponseSchema', () => {
  it('accepts bounded history list payloads', () => {
    expect(
      DispatchAssignmentsHistoryResponseSchema.parse({
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
