import type { NotificationsService } from '../notifications';
import type { DispatchJobOperationsService } from '../dispatch-offer';
import type { UserService } from '../user';
import type { DriverService } from '../driver/driver.service';
import { AdminController } from './admin.controller';

describe('AdminController', () => {
  it('lists notification history through the notifications service', async () => {
    const result = {
      items: [],
      total: 0,
      limit: 25,
      offset: 50,
    };
    const listNotificationsForAdmin = jest.fn().mockResolvedValue(result);
    const controller = new AdminController(
      { listNotificationsForAdmin } as unknown as NotificationsService,
      {} as UserService,
      {} as DriverService,
      {} as DispatchJobOperationsService,
    );

    await expect(
      controller.listNotifications({ limit: 25, offset: 50 }),
    ).resolves.toBe(result);

    expect(listNotificationsForAdmin).toHaveBeenCalledWith({
      limit: 25,
      offset: 50,
    });
  });

  it('soft deletes a user through the user service', async () => {
    const result = { message: 'user deleted' };
    const deleteUser = jest.fn().mockResolvedValue(result);
    const controller = new AdminController(
      {} as NotificationsService,
      { deleteUser } as unknown as UserService,
      {} as DriverService,
      {} as DispatchJobOperationsService,
    );

    await expect(controller.deleteUser('user-id')).resolves.toBe(result);

    expect(deleteUser).toHaveBeenCalledWith('user-id');
  });

  it('approves a driver document through the driver service', async () => {
    const result = { reviewStatus: 'approved' as const };
    const approveDocument = jest.fn().mockResolvedValue(result);
    const controller = new AdminController(
      {} as NotificationsService,
      {} as UserService,
      { approveDocument } as unknown as DriverService,
      {} as DispatchJobOperationsService,
    );

    await expect(
      controller.approveDocument({ id: 'admin-1' } as never, 'document-1', {
        reason: 'meets qualification requirements',
        expiresAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
    ).resolves.toBe(result);

    expect(approveDocument).toHaveBeenCalledWith('admin-1', 'document-1', {
      reason: 'meets qualification requirements',
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    });
  });

  it('rejects a driver document through the driver service', async () => {
    const result = { reviewStatus: 'rejected' as const };
    const rejectDocument = jest.fn().mockResolvedValue(result);
    const controller = new AdminController(
      {} as NotificationsService,
      {} as UserService,
      { rejectDocument } as unknown as DriverService,
      {} as DispatchJobOperationsService,
    );

    await expect(
      controller.rejectDocument({ id: 'admin-1' } as never, 'document-1', {
        reason: 'image is not readable',
      }),
    ).resolves.toBe(result);

    expect(rejectDocument).toHaveBeenCalledWith('admin-1', 'document-1', {
      reason: 'image is not readable',
    });
  });

  it('revokes a driver document through the driver service', async () => {
    const result = { reviewStatus: 'revoked' as const };
    const revokeDocument = jest.fn().mockResolvedValue(result);
    const controller = new AdminController(
      {} as NotificationsService,
      {} as UserService,
      { revokeDocument } as unknown as DriverService,
      {} as DispatchJobOperationsService,
    );

    await expect(
      controller.revokeDocument({ id: 'admin-1' } as never, 'document-1', {
        reason: 'document was withdrawn',
      }),
    ).resolves.toBe(result);

    expect(revokeDocument).toHaveBeenCalledWith('admin-1', 'document-1', {
      reason: 'document was withdrawn',
    });
  });

  it('approves a driver vehicle through the driver service', async () => {
    const result = { reviewStatus: 'approved' as const };
    const approveVehicleDocuments = jest.fn().mockResolvedValue(result);
    const controller = new AdminController(
      {} as NotificationsService,
      {} as UserService,
      { approveVehicleDocuments } as unknown as DriverService,
      {} as DispatchJobOperationsService,
    );

    await expect(
      controller.approveVehicle({ id: 'admin-1' } as never, 'driver-1', {
        reason: 'vehicle meets qualification requirements',
        tinNumber: 'TIN-001',
        qualifications: ['standard', 'comfort'],
      }),
    ).resolves.toBe(result);

    expect(approveVehicleDocuments).toHaveBeenCalledWith(
      'admin-1',
      'driver-1',
      {
        reason: 'vehicle meets qualification requirements',
        tinNumber: 'TIN-001',
        qualifications: ['standard', 'comfort'],
      },
    );
  });

  it('approves a driver license through the driver service', async () => {
    const result = { reviewStatus: 'approved' as const };
    const approveLicense = jest.fn().mockResolvedValue(result);
    const controller = new AdminController(
      {} as NotificationsService,
      {} as UserService,
      { approveLicense } as unknown as DriverService,
      {} as DispatchJobOperationsService,
    );

    await expect(
      controller.approveLicense({ id: 'admin-1' } as never, 'driver-1', {
        reason: 'license verified',
        licenseNumber: 'ETH-123456',
        issuedBy: 'oromia',
        licenseType: 'T1',
        expiresAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
    ).resolves.toBe(result);

    expect(approveLicense).toHaveBeenCalledWith('admin-1', 'driver-1', {
      reason: 'license verified',
      licenseNumber: 'ETH-123456',
      issuedBy: 'oromia',
      licenseType: 'T1',
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    });
  });

  it('rejects a driver vehicle through the driver service', async () => {
    const result = { isApproved: false };
    const rejectVehicle = jest.fn().mockResolvedValue(result);
    const controller = new AdminController(
      {} as NotificationsService,
      {} as UserService,
      { rejectVehicle } as unknown as DriverService,
      {} as DispatchJobOperationsService,
    );

    await expect(
      controller.rejectVehicle({ id: 'admin-1' } as never, 'vehicle-1', {
        reason: 'registration mismatch',
      }),
    ).resolves.toBe(result);

    expect(rejectVehicle).toHaveBeenCalledWith('admin-1', 'vehicle-1', {
      reason: 'registration mismatch',
    });
  });

  it('revokes a driver vehicle through the driver service', async () => {
    const result = { isApproved: false };
    const revokeVehicle = jest.fn().mockResolvedValue(result);
    const controller = new AdminController(
      {} as NotificationsService,
      {} as UserService,
      { revokeVehicle } as unknown as DriverService,
      {} as DispatchJobOperationsService,
    );

    await expect(
      controller.revokeVehicle({ id: 'admin-1' } as never, 'vehicle-1', {
        reason: 'vehicle qualification revoked',
      }),
    ).resolves.toBe(result);

    expect(revokeVehicle).toHaveBeenCalledWith('admin-1', 'vehicle-1', {
      reason: 'vehicle qualification revoked',
    });
  });

  it('lists dispatch queue statuses through the dispatch operations service', async () => {
    const result = [
      {
        queueName: 'dispatch.match',
        counts: {
          waiting: 1,
          delayed: 0,
          active: 0,
          completed: 0,
          failed: 0,
          paused: 0,
        },
      },
    ];
    const getAllQueueStatuses = jest.fn().mockResolvedValue(result);
    const controller = new AdminController(
      {} as NotificationsService,
      {} as UserService,
      {} as DriverService,
      { getAllQueueStatuses } as unknown as DispatchJobOperationsService,
    );

    await expect(controller.listDispatchQueueStatuses()).resolves.toBe(result);
    expect(getAllQueueStatuses).toHaveBeenCalledTimes(1);
  });

  it('triggers dispatch reconciliation through the dispatch operations service', async () => {
    const result = {
      success: true,
      jobId: 'job-1',
      queueName: 'dispatch.reconciliation',
      message: 'dispatch reconciliation enqueued',
    };
    const enqueueReconciliation = jest.fn().mockResolvedValue(result);
    const controller = new AdminController(
      {} as NotificationsService,
      {} as UserService,
      {} as DriverService,
      { enqueueReconciliation } as unknown as DispatchJobOperationsService,
    );

    await expect(
      controller.triggerDispatchReconciliation({ id: 'admin-1' } as never, {
        reason: 'repair stuck offered state',
      }),
    ).resolves.toBe(result);

    expect(enqueueReconciliation).toHaveBeenCalledWith(
      'admin-1',
      'repair stuck offered state',
    );
  });
});
