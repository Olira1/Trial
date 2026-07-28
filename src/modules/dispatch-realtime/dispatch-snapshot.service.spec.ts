import { DispatchSnapshotService } from './dispatch-snapshot.service';

describe('DispatchSnapshotService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs a debug summary for the generated snapshot state', async () => {
    const db = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'request-1',
              rider_id: 'user-1',
              state: 'offered',
              pickup_lat: 9.0192,
              pickup_lon: 38.7525,
              dest_lat: 9.0301,
              dest_lon: 38.7612,
              matching_deadline_at: '2026-06-26T12:01:30.000Z',
              created_at: '2026-06-26T12:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'offer-1',
              request_id: 'request-1',
              driver_id: 'driver-1',
              state: 'pending',
              eta_seconds: 240,
              distance_meters: 1800,
              expires_at: '2026-06-26T12:00:15.000Z',
              offered_at: '2026-06-26T12:00:00.000Z',
              responded_at: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const service = new DispatchSnapshotService(db as never);
    const debugSpy = jest
      .spyOn(
        (service as unknown as { logger: { debug: (message: string) => void } })
          .logger,
        'debug',
      )
      .mockImplementation(() => undefined);

    const snapshot = await service.generateSnapshot('user-1');

    expect(snapshot.activeRequest?.requestId).toBe('request-1');
    expect(snapshot.activeOffer?.offerId).toBe('offer-1');
    expect(snapshot.activeAssignment).toBeNull();
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Generated dispatch snapshot userId=user-1 requestId=request-1 requestState=offered offerId=offer-1 offerState=pending assignmentId=none',
      ),
    );
  });

  it('includes trip control state in durable assignment snapshots', async () => {
    const db = {
      execute: jest.fn().mockResolvedValueOnce({
        rows: [
          {
            id: 'assignment-1',
            offer_id: 'offer-1',
            request_id: 'request-1',
            rider_id: 'rider-1',
            driver_id: 'driver-1',
            assigned_at: new Date('2026-06-27T12:00:00.000Z'),
            driver_full_name: 'Trip Driver',
            driver_phone: '+251922222222',
            driver_rating: 5,
            vehicle_make: 'Toyota',
            vehicle_model: 'Vitz',
            vehicle_color: 'Blue',
            vehicle_plate_region: 'aa',
            vehicle_plate_code: '03',
            vehicle_plate_code_subtype: 'transport_service',
            vehicle_plate_number: '12345',
            pickup_id: null,
            pickup_state: null,
            pickup_arrived_at: null,
            pickup_warning_due_at: null,
            pickup_warning_sent_at: null,
            pickup_no_show_cancellable_at: null,
            pickup_no_show_cancelled_at: null,
            trip_id: 'trip-1',
            trip_state: 'started',
            trip_started_at: new Date('2026-06-27T12:02:00.000Z'),
            trip_completed_at: null,
          },
        ],
      }),
    };
    const service = new DispatchSnapshotService(db as never);

    const snapshot = await service.findAssignmentByOffer('offer-1');

    expect(snapshot?.trip).toEqual({
      id: 'trip-1',
      state: 'started',
      startedAt: '2026-06-27T12:02:00.000Z',
      completedAt: null,
    });
  });
});
