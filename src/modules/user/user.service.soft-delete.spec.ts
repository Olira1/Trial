import { NotFoundException } from '@nestjs/common';
import type { Database } from '../../database/database.module';
import type { StorageService } from '../storage';
import { UserService } from './user.service';

const createUpdate = (result?: object[]) => {
  const returning = result ? jest.fn().mockResolvedValue(result) : undefined;
  const where = jest
    .fn()
    .mockReturnValue(returning ? { returning } : Promise.resolve());
  const set = jest.fn().mockReturnValue({ where });

  return { query: { set }, calls: { set, where, returning } };
};

describe('UserService soft delete', () => {
  const storage = {} as StorageService;

  it('soft deletes a user and disables their access in a transaction', async () => {
    const userUpdate = createUpdate([{ id: 'user-id' }]);
    const sessionUpdate = createUpdate();
    const deviceTokenUpdate = createUpdate();
    const deletedIdentity = {
      id: 'identity-id',
      userId: 'user-id',
      type: 'phone',
      identifier: '+251911000006',
      verifiedAt: new Date(),
      lastUsedAt: null,
    };
    const presenceSelectLimit = jest.fn().mockResolvedValue([]);
    const presenceSelectFor = jest
      .fn()
      .mockReturnValue({ limit: presenceSelectLimit });
    const presenceSelectWhere = jest
      .fn()
      .mockReturnValue({ for: presenceSelectFor });
    const presenceSelectFrom = jest
      .fn()
      .mockReturnValue({ where: presenceSelectWhere });
    const identitySelectWhere = jest.fn().mockResolvedValue([deletedIdentity]);
    const identitySelectFrom = jest
      .fn()
      .mockReturnValue({ where: identitySelectWhere });
    const select = jest
      .fn()
      .mockReturnValueOnce({ from: presenceSelectFrom })
      .mockReturnValueOnce({ from: identitySelectFrom });
    const historyInsertValues = jest.fn().mockResolvedValue(undefined);
    const insert = jest.fn().mockReturnValue({ values: historyInsertValues });
    const identityDeleteWhere = jest.fn().mockResolvedValue(undefined);
    const identityDelete = { where: identityDeleteWhere };
    const update = jest
      .fn()
      .mockReturnValueOnce(userUpdate.query)
      .mockReturnValueOnce(sessionUpdate.query)
      .mockReturnValueOnce(deviceTokenUpdate.query);
    const deleteFn = jest.fn().mockReturnValue(identityDelete);
    const tx = { update, select, insert, delete: deleteFn };
    const transaction = jest.fn(
      async (callback: (transaction: typeof tx) => Promise<void>) =>
        callback(tx),
    );
    const service = new UserService(
      { transaction } as unknown as Database,
      storage,
    );

    await expect(service.deleteUser('user-id')).resolves.toEqual({
      message: 'user deleted',
    });

    expect(transaction).toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(3);
    expect(userUpdate.calls.set).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: false,
        deletedAt: expect.any(Date) as Date,
        updatedAt: expect.any(Date) as Date,
      }),
    );
    expect(sessionUpdate.calls.set).toHaveBeenCalledWith(
      expect.objectContaining({
        revokedAt: expect.any(Date) as Date,
        updatedAt: expect.any(Date) as Date,
      }),
    );
    expect(deviceTokenUpdate.calls.set).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: false,
        updatedAt: expect.any(Date) as Date,
      }),
    );
    expect(select).toHaveBeenCalledTimes(2);
    expect(presenceSelectLimit).toHaveBeenCalledWith(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(historyInsertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'user-id',
        identityId: 'identity-id',
        type: 'phone',
        identifierHash: expect.any(String) as string,
        identifierMasked: expect.any(String) as string,
        deletedAt: expect.any(Date) as Date,
      }),
    ]);
    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(identityDeleteWhere).toHaveBeenCalled();
  });

  it('does not touch related access records when the user does not exist', async () => {
    const userUpdate = createUpdate([]);
    const update = jest.fn().mockReturnValue(userUpdate.query);
    const tx = { update };
    const transaction = jest.fn(
      async (callback: (transaction: typeof tx) => Promise<void>) =>
        callback(tx),
    );
    const service = new UserService(
      { transaction } as unknown as Database,
      storage,
    );

    await expect(service.deleteUser('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(update).toHaveBeenCalledTimes(1);
  });
});
