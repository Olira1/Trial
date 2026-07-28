import type { User } from '../user';
import type { DispatchAssignmentCancellationService } from './dispatch-assignment-cancellation.service';
import { DispatchAssignmentsController } from './dispatch-assignments.controller';
import type { DispatchOffersService } from './dispatch-offers.service';
import type { DispatchAssignmentPickupService } from './dispatch-assignment-pickup.service';
import type { DispatchAssignmentTripService } from './dispatch-assignment-trip.service';

describe('DispatchAssignmentsController', () => {
  const driver = { id: '01976f6f-a9f8-7ad2-bf4b-e95429910c1e' } as User;
  const assignmentId = '019eee40-779a-744d-956d-6e857dbd6973';

  it('gets the authenticated driver active assignment', async () => {
    const assignment = {
      id: assignmentId,
      driverId: driver.id,
      state: 'assigned',
    };
    const offers = {
      findActiveAssignmentForDriver: jest.fn().mockResolvedValue(assignment),
    };
    const controller = new DispatchAssignmentsController(
      {} as DispatchAssignmentPickupService,
      {} as DispatchAssignmentCancellationService,
      offers as unknown as DispatchOffersService,
      {} as DispatchAssignmentTripService,
    );

    await expect(controller.findActive(driver)).resolves.toBe(assignment);
    expect(offers.findActiveAssignmentForDriver).toHaveBeenCalledWith(
      driver.id,
    );
  });

  it('marks pickup arrival for the authenticated driver assignment', async () => {
    const pickup = {
      arriveAtPickup: jest.fn().mockResolvedValue({
        id: '019eee40-779b-78dc-a928-4c6feb71434f',
        assignmentId,
        driverId: driver.id,
        state: 'arrived',
      }),
    };
    const controller = new DispatchAssignmentsController(
      pickup as unknown as DispatchAssignmentPickupService,
      {} as DispatchAssignmentCancellationService,
      {} as DispatchOffersService,
      {} as DispatchAssignmentTripService,
    );

    await expect(
      controller.arriveAtPickup(driver, assignmentId),
    ).resolves.toMatchObject({
      assignmentId,
      driverId: driver.id,
      state: 'arrived',
    });
    expect(pickup.arriveAtPickup).toHaveBeenCalledWith(driver.id, assignmentId);
  });

  it('cancels rider no-show for the authenticated driver assignment', async () => {
    const pickup = {
      cancelRiderNoShow: jest.fn().mockResolvedValue({
        id: '019eee40-779b-78dc-a928-4c6feb71434f',
        assignmentId,
        driverId: driver.id,
        state: 'rider_no_show_cancelled',
      }),
    };
    const controller = new DispatchAssignmentsController(
      pickup as unknown as DispatchAssignmentPickupService,
      {} as DispatchAssignmentCancellationService,
      {} as DispatchOffersService,
      {} as DispatchAssignmentTripService,
    );

    await expect(
      controller.cancelRiderNoShow(driver, assignmentId),
    ).resolves.toMatchObject({
      assignmentId,
      driverId: driver.id,
      state: 'rider_no_show_cancelled',
    });
    expect(pickup.cancelRiderNoShow).toHaveBeenCalledWith(
      driver.id,
      assignmentId,
    );
  });

  it('starts a trip for the authenticated driver assignment', async () => {
    const trip = {
      startTrip: jest.fn().mockResolvedValue({
        id: '019eee40-779d-7001-a4df-fadfb8dc8017',
        assignmentId,
        driverId: driver.id,
        state: 'started',
      }),
    };
    const controller = new DispatchAssignmentsController(
      {} as DispatchAssignmentPickupService,
      {} as DispatchAssignmentCancellationService,
      {} as DispatchOffersService,
      trip as unknown as DispatchAssignmentTripService,
    );

    await expect(
      controller.startTrip(driver, assignmentId),
    ).resolves.toMatchObject({
      assignmentId,
      driverId: driver.id,
      state: 'started',
    });
    expect(trip.startTrip).toHaveBeenCalledWith(driver.id, assignmentId);
  });

  it('completes a trip for the authenticated driver assignment', async () => {
    const trip = {
      completeTrip: jest.fn().mockResolvedValue({
        id: '019eee40-779d-7001-a4df-fadfb8dc8017',
        assignmentId,
        driverId: driver.id,
        state: 'completed',
      }),
    };
    const controller = new DispatchAssignmentsController(
      {} as DispatchAssignmentPickupService,
      {} as DispatchAssignmentCancellationService,
      {} as DispatchOffersService,
      trip as unknown as DispatchAssignmentTripService,
    );

    await expect(
      controller.completeTrip(driver, assignmentId),
    ).resolves.toMatchObject({
      assignmentId,
      driverId: driver.id,
      state: 'completed',
    });
    expect(trip.completeTrip).toHaveBeenCalledWith(driver.id, assignmentId);
  });

  it('cancels an assigned ride for the authenticated driver with structured details', async () => {
    const cancellation = {
      cancelAssignedRide: jest.fn().mockResolvedValue({
        id: '019eee40-779c-7e8a-b2ea-5f24d3ed3362',
        assignmentId,
        actorUserId: driver.id,
        actorRole: 'driver',
        reasonCode: 'driver_requested',
      }),
    };
    const dto = {
      reasonCode: 'driver_requested' as const,
      notes: 'Vehicle issue',
    };
    const controller = new DispatchAssignmentsController(
      {} as DispatchAssignmentPickupService,
      cancellation as unknown as DispatchAssignmentCancellationService,
      {} as DispatchOffersService,
      {} as DispatchAssignmentTripService,
    );

    await expect(
      controller.cancelAssignedRide(driver, assignmentId, dto),
    ).resolves.toMatchObject({
      assignmentId,
      actorUserId: driver.id,
      actorRole: 'driver',
      reasonCode: 'driver_requested',
    });
    expect(cancellation.cancelAssignedRide).toHaveBeenCalledWith(
      driver.id,
      assignmentId,
      dto,
    );
  });

  it('lists bounded history for the authenticated driver', async () => {
    const history = {
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    };
    const offers = {
      findHistoryForDriver: jest.fn().mockResolvedValue(history),
    };
    const controller = new DispatchAssignmentsController(
      {} as DispatchAssignmentPickupService,
      {} as DispatchAssignmentCancellationService,
      offers as unknown as DispatchOffersService,
      {} as DispatchAssignmentTripService,
    );

    await expect(controller.findHistory(driver, {} as never)).resolves.toBe(
      history,
    );
    expect(offers.findHistoryForDriver).toHaveBeenCalledWith(driver.id, {});
  });
});
