import { ActiveDispatchAssignmentResponseSchema } from './dispatch-assignments.response';

describe('ActiveDispatchAssignmentResponseSchema', () => {
  it('serializes assignment snapshots with nullable pickup state', () => {
    const parsed = ActiveDispatchAssignmentResponseSchema.parse({
      id: '019eeb33-ffff-7aaa-8c97-5164e250ed54',
      assignmentId: '019eeb33-ffff-7aaa-8c97-5164e250ed54',
      offerId: '019eeb33-9c2a-7984-8c97-5164e250ed54',
      requestId: '019eeb33-6aeb-7c85-8884-9debe93dd854',
      riderId: '019eeb33-4b86-78ad-ac4a-608356923108',
      driverId: '019eeb33-f7ed-76aa-9963-ef36f5338ce8',
      state: 'assigned',
      status: 'assigned',
      assignedAt: new Date('2026-06-21T12:02:00.000Z'),
      createdAt: new Date('2026-06-21T12:01:00.000Z'),
      updatedAt: new Date('2026-06-21T12:02:30.000Z'),
      driver: {
        id: '019eeb33-f7ed-76aa-9963-ef36f5338ce8',
        fullName: 'Aster Bekele',
        phone: '+251911111111',
        rating: 5,
      },
      vehicle: {
        make: 'Toyota',
        model: 'Vitz',
        color: 'Blue',
        plateRegion: 'aa',
        plateCode: '03',
        plateCodeSubtype: 'transport_service',
        plateNumber: '12345',
      },
      trip: {
        id: '019eeb34-4a0c-7ac9-8f73-d81b6854f4b7',
        state: 'started',
        startedAt: new Date('2026-06-21T12:05:00.000Z'),
        completedAt: null,
      },
      pickup: {
        id: '019eeb34-3bf0-7d78-8d06-49a5e36b04f0',
        state: 'arrived',
        arrivedAt: new Date('2026-06-21T12:03:00.000Z'),
        warningDueAt: new Date('2026-06-21T12:04:00.000Z'),
        warningSentAt: null,
        noShowCancellableAt: new Date('2026-06-21T12:04:00.000Z'),
        noShowCancelledAt: null,
      },
    });

    expect(parsed).toMatchObject({
      assignmentId: '019eeb33-ffff-7aaa-8c97-5164e250ed54',
      status: 'assigned',
      createdAt: '2026-06-21T12:01:00.000Z',
      updatedAt: '2026-06-21T12:02:30.000Z',
    });
    expect(parsed.assignedAt).toBe('2026-06-21T12:02:00.000Z');
    expect(parsed.trip?.startedAt).toBe('2026-06-21T12:05:00.000Z');
    expect(parsed.pickup?.arrivedAt).toBe('2026-06-21T12:03:00.000Z');
    expect(parsed.pickup?.warningSentAt).toBeNull();
  });
});
