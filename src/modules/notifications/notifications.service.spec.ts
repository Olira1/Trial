import { NotFoundException } from '@nestjs/common';
import { generateKeyPairSync } from 'crypto';
import type { NotificationsConfig } from '../../config/notifications.config';
import type { Database } from '../../database/database.module';
import type { UserService } from '../user';
import { NotificationsService } from './notifications.service';

const NOTIFICATION_ID = '11111111-1111-1111-1111-111111111111';
type FetchSpy = jest.SpiedFunction<typeof fetch>;

const createTransaction = <Tx extends object>(tx: Tx) =>
  jest.fn((callback: (tx: Tx) => unknown) => Promise.resolve(callback(tx)));

const createStoreNotificationMocks = (storedCount = 1) => {
  const notificationReturning = jest
    .fn()
    .mockResolvedValue([{ id: NOTIFICATION_ID }]);
  const notificationValues = jest
    .fn()
    .mockReturnValue({ returning: notificationReturning });
  const inboxReturning = jest.fn().mockResolvedValue(
    Array.from({ length: storedCount }, (_, index) => ({
      id: `inbox-${index}`,
    })),
  );
  const onConflictDoNothing = jest
    .fn()
    .mockReturnValue({ returning: inboxReturning });
  const inboxValues = jest.fn().mockReturnValue({ onConflictDoNothing });
  const insert = jest
    .fn()
    .mockReturnValueOnce({ values: notificationValues })
    .mockReturnValueOnce({ values: inboxValues });

  return {
    insert,
    calls: {
      insert,
      notificationValues,
      notificationReturning,
      inboxValues,
      onConflictDoNothing,
      inboxReturning,
    },
  };
};

const createSelectTokenDb = (rows: Array<{ token: string }>) => {
  const limit = jest.fn().mockResolvedValue(rows);
  const orderBy = jest.fn().mockReturnValue({ limit });
  const where = jest.fn().mockReturnValue({ orderBy });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });

  return {
    db: { select } as unknown as Database,
    calls: { select, from, where, orderBy, limit },
  };
};

const createSelectTokensDb = (rows: Array<{ token: string }>) => {
  const store = createStoreNotificationMocks();
  const orderBy = jest.fn().mockResolvedValue(rows);
  const where = jest.fn().mockReturnValue({ orderBy });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  const tx = { insert: store.insert, select };
  const transaction = createTransaction(tx);

  return {
    db: { ...tx, transaction } as unknown as Database,
    calls: { select, from, where, orderBy, transaction, store: store.calls },
  };
};

const createSelectDistinctTokensDb = (
  rows: Array<{ token: string }>,
  targetUsers: Array<{ id: string }> = [{ id: 'user-id' }],
) => {
  const store = createStoreNotificationMocks(targetUsers.length);
  const targetWhere = jest.fn().mockResolvedValue(targetUsers);
  const targetFrom = jest.fn().mockReturnValue({ where: targetWhere });
  const select = jest.fn().mockReturnValue({ from: targetFrom });
  const where = jest.fn().mockResolvedValue(rows);
  const innerJoin = jest.fn().mockReturnValue({ where });
  const from = jest.fn().mockReturnValue({ innerJoin });
  const selectDistinct = jest.fn().mockReturnValue({ from });
  const tx = { insert: store.insert, select, selectDistinct };
  const transaction = createTransaction(tx);

  return {
    db: { ...tx, transaction } as unknown as Database,
    calls: {
      select,
      targetFrom,
      targetWhere,
      selectDistinct,
      from,
      innerJoin,
      where,
      transaction,
      store: store.calls,
    },
  };
};

const readFetchJsonBody = (fetchSpy: FetchSpy, callIndex: number) => {
  const call = fetchSpy.mock.calls[callIndex];
  if (!call) throw new Error(`expected fetch call at index ${callIndex}`);

  const [, requestInit] = call;
  const requestBody = requestInit?.body;
  if (typeof requestBody !== 'string') {
    throw new Error('expected FCM request body to be a JSON string');
  }

  const parsed: unknown = JSON.parse(requestBody);
  return parsed;
};

const createNotificationRow = (seenAt: Date | null = null) => ({
  id: NOTIFICATION_ID,
  title: 'Ubel update',
  body: 'You have a new update.',
  category: 'all_users' as const,
  source: 'admin' as const,
  seenAt,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
});

const createLockedNotificationRow = (seenAt: Date | null = null) => ({
  userNotificationId: 'inbox-id',
  ...createNotificationRow(seenAt),
});

const createListNotificationsDb = () => {
  const row = createNotificationRow();
  const offset = jest.fn().mockResolvedValue([row]);
  const limit = jest.fn().mockReturnValue({ offset });
  const orderBy = jest.fn().mockReturnValue({ limit });
  const listWhere = jest.fn().mockReturnValue({ orderBy });
  const innerJoin = jest.fn().mockReturnValue({ where: listWhere });
  const listFrom = jest.fn().mockReturnValue({ innerJoin });

  const countWhere = jest.fn().mockResolvedValue([{ total: 1 }]);
  const countFrom = jest.fn().mockReturnValue({ where: countWhere });
  const unreadWhere = jest.fn().mockResolvedValue([{ unreadCount: 1 }]);
  const unreadFrom = jest.fn().mockReturnValue({ where: unreadWhere });

  const select = jest
    .fn()
    .mockReturnValueOnce({ from: listFrom })
    .mockReturnValueOnce({ from: countFrom })
    .mockReturnValueOnce({ from: unreadFrom });
  const tx = { select };
  const transaction = createTransaction(tx);

  return {
    db: { ...tx, transaction } as unknown as Database,
    calls: {
      offset,
      limit,
      orderBy,
      listWhere,
      countWhere,
      unreadWhere,
      transaction,
    },
    row,
  };
};

const createListAdminNotificationsDb = () => {
  const row = {
    id: NOTIFICATION_ID,
    title: 'Ubel update',
    body: 'You have a new update.',
    category: 'all_users' as const,
    source: 'admin' as const,
    createdByUserId: 'admin-id',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
  };
  const offset = jest.fn().mockResolvedValue([row]);
  const limit = jest.fn().mockReturnValue({ offset });
  const orderBy = jest.fn().mockReturnValue({ limit });
  const listFrom = jest.fn().mockReturnValue({ orderBy });

  const countFrom = jest.fn().mockResolvedValue([{ total: 1 }]);
  const select = jest
    .fn()
    .mockReturnValueOnce({ from: listFrom })
    .mockReturnValueOnce({ from: countFrom });
  const tx = { select };
  const transaction = createTransaction(tx);

  return {
    db: { transaction } as unknown as Database,
    calls: { limit, offset, orderBy, transaction },
    row,
  };
};

const createGetNotificationDb = (
  rows: Array<ReturnType<typeof createLockedNotificationRow>> = [
    createLockedNotificationRow(),
  ],
) => {
  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set });
  const limit = jest.fn().mockResolvedValue(rows);
  const forUpdate = jest.fn().mockReturnValue({ limit });
  const selectWhere = jest.fn().mockReturnValue({ for: forUpdate });
  const innerJoin = jest.fn().mockReturnValue({ where: selectWhere });
  const from = jest.fn().mockReturnValue({ innerJoin });
  const select = jest.fn().mockReturnValue({ from });
  const tx = { update, select };
  const transaction = createTransaction(tx);

  return {
    db: { ...tx, transaction } as unknown as Database,
    calls: { update, set, updateWhere, selectWhere, forUpdate, transaction },
  };
};

const createDeleteNotificationDb = (rows: Array<{ id: string }>) => {
  const returning = jest.fn().mockResolvedValue(rows);
  const where = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });

  return {
    db: { update } as unknown as Database,
    calls: { update, set, where, returning },
  };
};

const createUsers = (
  row: Awaited<ReturnType<UserService['findById']>> = {
    id: 'user-id',
  } as unknown as Awaited<ReturnType<UserService['findById']>>,
) =>
  ({
    findById: jest.fn().mockResolvedValue(row),
  }) as jest.Mocked<Pick<UserService, 'findById'>>;

const createService = (
  db: Database,
  config: NotificationsConfig = {},
  users = createUsers(),
) => new NotificationsService(db, config, users as unknown as UserService);

const createFirebaseConfig = (): NotificationsConfig => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const exportedPrivateKey = privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  });

  return {
    firebase: {
      projectId: 'ubel-test',
      clientEmail: 'firebase-adminsdk@test.iam.gserviceaccount.com',
      privateKey: String(exportedPrivateKey),
    },
  };
};

describe('NotificationsService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('skips welcome delivery when Firebase is not configured', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const service = createService({} as Database);

    await expect(
      service.sendWelcomeNotification('token'),
    ).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws when sending a test notification without an active token', async () => {
    const { db } = createSelectTokenDb([]);
    const service = createService(db);

    await expect(
      service.sendTestNotification('user-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('skips test notification delivery when Firebase is not configured', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const { db } = createSelectTokenDb([{ token: 'registered-token' }]);
    const service = createService(db);

    await expect(service.sendTestNotification('user-id')).resolves.toEqual({
      message:
        'test notification skipped; Firebase credentials are not configured',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lists visible user notifications with unread count', async () => {
    const { db, calls, row } = createListNotificationsDb();
    const service = createService(db);

    await expect(
      service.listNotifications('user-id', { limit: 25, offset: 50 }),
    ).resolves.toEqual({
      items: [row],
      total: 1,
      limit: 25,
      offset: 50,
      unreadCount: 1,
    });

    expect(calls.limit).toHaveBeenCalledWith(25);
    expect(calls.offset).toHaveBeenCalledWith(50);
    expect(calls.listWhere).toHaveBeenCalled();
    expect(calls.countWhere).toHaveBeenCalled();
    expect(calls.unreadWhere).toHaveBeenCalled();
    expect(calls.transaction).toHaveBeenCalled();
  });

  it('lists all notifications for admins newest first', async () => {
    const { db, calls, row } = createListAdminNotificationsDb();
    const service = createService(db);

    await expect(
      service.listNotificationsForAdmin({ limit: 25, offset: 50 }),
    ).resolves.toEqual({
      items: [row],
      total: 1,
      limit: 25,
      offset: 50,
    });

    expect(calls.limit).toHaveBeenCalledWith(25);
    expect(calls.offset).toHaveBeenCalledWith(50);
    expect(calls.orderBy).toHaveBeenCalled();
    expect(calls.transaction).toHaveBeenCalled();
  });

  it('marks a notification seen when the user opens it', async () => {
    const { db, calls } = createGetNotificationDb([
      createLockedNotificationRow(null),
    ]);
    const service = createService(db);

    await expect(
      service.getNotification('user-id', NOTIFICATION_ID),
    ).resolves.toEqual({
      ...createNotificationRow(null),
      seenAt: expect.any(Date) as Date,
    });

    expect(calls.update).toHaveBeenCalled();
    expect(calls.set).toHaveBeenCalledWith({
      seenAt: expect.any(Date) as Date,
      updatedAt: expect.any(Date) as Date,
    });
    expect(calls.forUpdate).toHaveBeenCalledWith('update');
    expect(calls.selectWhere).toHaveBeenCalled();
    expect(calls.transaction).toHaveBeenCalled();
  });

  it('does not overwrite an existing seen timestamp when opened again', async () => {
    const seenAt = new Date('2026-06-02T00:00:00.000Z');
    const { db, calls } = createGetNotificationDb([
      createLockedNotificationRow(seenAt),
    ]);
    const service = createService(db);

    await expect(
      service.getNotification('user-id', NOTIFICATION_ID),
    ).resolves.toEqual(createNotificationRow(seenAt));

    expect(calls.update).not.toHaveBeenCalled();
    expect(calls.forUpdate).toHaveBeenCalledWith('update');
  });

  it('throws when opening a notification outside the user inbox', async () => {
    const { db, calls } = createGetNotificationDb([]);
    const service = createService(db);

    await expect(
      service.getNotification('user-id', NOTIFICATION_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(calls.transaction).toHaveBeenCalled();
  });

  it('soft deletes a notification from the user inbox', async () => {
    const { db, calls } = createDeleteNotificationDb([{ id: 'inbox-id' }]);
    const service = createService(db);

    await expect(
      service.deleteNotification('user-id', NOTIFICATION_ID),
    ).resolves.toEqual({ message: 'notification deleted' });

    expect(calls.set).toHaveBeenCalledWith({
      deletedAt: expect.any(Date) as Date,
      updatedAt: expect.any(Date) as Date,
    });
    expect(calls.returning).toHaveBeenCalledWith(expect.any(Object));
  });

  it('throws when deleting a notification outside the user inbox', async () => {
    const { db } = createDeleteNotificationDb([]);
    const service = createService(db);

    await expect(
      service.deleteNotification('user-id', NOTIFICATION_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when sending an admin notification to a missing user', async () => {
    const users = {
      findById: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<Pick<UserService, 'findById'>>;
    const { db, calls } = createSelectTokensDb([]);
    const service = createService(db, {}, users);

    await expect(
      service.sendUserNotification('missing-user', {
        title: 'Ubel update',
        body: 'You have a new update.',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(users.findById).toHaveBeenCalledWith(
      'missing-user',
      expect.anything(),
    );
    expect(calls.transaction).toHaveBeenCalled();
  });

  it('stores an admin notification even without active push tokens', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const { db } = createSelectTokensDb([]);
    const service = createService(db);

    await expect(
      service.sendUserNotification('user-id', {
        title: 'Ubel update',
        body: 'You have a new update.',
      }),
    ).resolves.toEqual({
      message: 'notification delivery completed',
      storedCount: 1,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips admin notification delivery when Firebase is not configured', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const { db } = createSelectTokensDb([
      { token: 'first-token' },
      { token: 'second-token' },
    ]);
    const service = createService(db);

    await expect(
      service.sendUserNotification('user-id', {
        title: 'Ubel update',
        body: 'You have a new update.',
      }),
    ).resolves.toEqual({
      message: 'notification delivery completed',
      storedCount: 1,
      sentCount: 0,
      skippedCount: 2,
      failedCount: 0,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends admin notification copy to an active user token', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'access-token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'message-id' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const { db } = createSelectTokensDb([{ token: 'registered-token' }]);
    const service = createService(db, createFirebaseConfig());

    await expect(
      service.sendUserNotification('user-id', {
        title: 'Ubel update',
        body: 'You have a new update.',
      }),
    ).resolves.toEqual({
      message: 'notification delivery completed',
      storedCount: 1,
      sentCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });

    const fcmBody = readFetchJsonBody(fetchSpy, 1);
    expect(fcmBody).toEqual({
      message: {
        token: 'registered-token',
        notification: {
          title: 'Ubel update',
          body: 'You have a new update.',
        },
        data: {
          type: 'admin_notification',
          notificationId: NOTIFICATION_ID,
        },
      },
    });
  });

  it('counts invalid admin notification tokens as failed and marks them inactive', async () => {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const selected = createSelectTokensDb([{ token: 'invalid-token' }]);
    const service = createService(
      { ...selected.db, update } as unknown as Database,
      createFirebaseConfig(),
    );

    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'access-token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { status: 'UNREGISTERED' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(
      service.sendUserNotification('user-id', {
        title: 'Ubel update',
        body: 'You have a new update.',
      }),
    ).resolves.toEqual({
      message: 'notification delivery completed',
      storedCount: 1,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 1,
    });

    expect(update).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
    expect(where).toHaveBeenCalled();
  });

  it('returns zero counts when a category has no matching users', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const { db, calls } = createSelectDistinctTokensDb([], []);
    const service = createService(db);

    await expect(
      service.sendCategoryNotification({
        category: 'all_users',
        title: 'Ubel update',
        body: 'You have a new update.',
      }),
    ).resolves.toEqual({
      message: 'notification delivery completed',
      storedCount: 0,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
    });

    expect(calls.selectDistinct).toHaveBeenCalledWith(expect.any(Object));
    expect(calls.innerJoin).toHaveBeenCalled();
    expect(calls.where).toHaveBeenCalled();
    expect(calls.store.insert).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('queries every supported notification category', async () => {
    for (const category of [
      'all_users',
      'drivers',
      'riders',
      'verified_users_only',
    ] as const) {
      const { db, calls } = createSelectDistinctTokensDb([]);
      const service = createService(db);

      await expect(
        service.sendCategoryNotification({
          category,
          title: 'Ubel update',
          body: 'You have a new update.',
        }),
      ).resolves.toMatchObject({
        message: 'notification delivery completed',
        storedCount: 1,
        sentCount: 0,
        skippedCount: 0,
        failedCount: 0,
      });

      expect(calls.where).toHaveBeenCalled();
    }
  });

  it('skips category notification delivery when Firebase is not configured', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const { db } = createSelectDistinctTokensDb([
      { token: 'first-token' },
      { token: 'second-token' },
    ]);
    const service = createService(db);

    await expect(
      service.sendCategoryNotification({
        category: 'drivers',
        title: 'Ubel update',
        body: 'You have a new update.',
      }),
    ).resolves.toEqual({
      message: 'notification delivery completed',
      storedCount: 1,
      sentCount: 0,
      skippedCount: 2,
      failedCount: 0,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends category notification data to an active token', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'access-token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'message-id' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const { db } = createSelectDistinctTokensDb([
      { token: 'registered-token' },
    ]);
    const service = createService(db, createFirebaseConfig());

    await expect(
      service.sendCategoryNotification({
        category: 'verified_users_only',
        title: 'Ubel update',
        body: 'You have a new update.',
      }),
    ).resolves.toEqual({
      message: 'notification delivery completed',
      storedCount: 1,
      sentCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });

    const fcmBody = readFetchJsonBody(fetchSpy, 1);
    expect(fcmBody).toEqual({
      message: {
        token: 'registered-token',
        notification: {
          title: 'Ubel update',
          body: 'You have a new update.',
        },
        data: {
          type: 'admin_notification',
          category: 'verified_users_only',
          notificationId: NOTIFICATION_ID,
        },
      },
    });
  });

  it('counts invalid category notification tokens as failed and marks them inactive', async () => {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const selected = createSelectDistinctTokensDb([{ token: 'invalid-token' }]);
    const service = createService(
      { ...selected.db, update } as unknown as Database,
      createFirebaseConfig(),
    );

    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'access-token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { status: 'UNREGISTERED' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(
      service.sendCategoryNotification({
        category: 'riders',
        title: 'Ubel update',
        body: 'You have a new update.',
      }),
    ).resolves.toEqual({
      message: 'notification delivery completed',
      storedCount: 1,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 1,
    });

    expect(update).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
    expect(where).toHaveBeenCalled();
  });

  it('marks an invalid FCM token inactive', async () => {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const service = createService(
      { update } as unknown as Database,
      createFirebaseConfig(),
    );

    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'access-token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { status: 'UNREGISTERED' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(
      service.sendWelcomeNotification('invalid-token'),
    ).resolves.toBeUndefined();

    expect(update).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
    expect(where).toHaveBeenCalled();
  });
});
