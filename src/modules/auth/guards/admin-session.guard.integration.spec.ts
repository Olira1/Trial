import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { databaseConfig } from '../../../config';
import {
  DRIZZLE,
  DatabaseModule,
  type Database,
} from '../../../database/database.module';
import { user } from '../../user';
import { authSession } from '../schema/session.schema';
import { AdminSessionGuard } from './admin-session.guard';

const makeContext = (sessionToken: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        cookies: { ubel_admin_session: sessionToken },
      }),
    }),
  }) as unknown as ExecutionContext;

describe('AdminSessionGuard (integration)', () => {
  let moduleRef: TestingModule;
  let db: Database;
  let guard: AdminSessionGuard;
  let adminUserId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [databaseConfig],
        }),
        DatabaseModule,
      ],
      providers: [AdminSessionGuard],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    guard = moduleRef.get(AdminSessionGuard);
  });

  beforeEach(async () => {
    const [created] = await db
      .insert(user)
      .values({
        firstName: 'Inactive',
        lastName: 'AdminGuard',
        roles: ['admin'],
        isActive: false,
      })
      .returning({ id: user.id });

    if (!created) {
      throw new Error('test setup failed to create admin user');
    }
    adminUserId = created.id;
  });

  afterEach(async () => {
    if (adminUserId) {
      await db.delete(user).where(eq(user.id, adminUserId));
    }
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('rejects a valid admin session when the admin account is inactive', async () => {
    const sessionToken = randomUUID();
    await db.insert(authSession).values({
      userId: adminUserId,
      tokenHash: createHash('sha256').update(sessionToken).digest('hex'),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      guard.canActivate(makeContext(sessionToken)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
