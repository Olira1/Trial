import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import {
  authConfig,
  databaseConfig,
  dispatchConfig,
  notificationsConfig,
  redisConfig,
  storageConfig,
} from '../src/config';
import {
  DatabaseModule,
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../src/database/database.module';
import { REDIS_CLIENT, RedisModule } from '../src/modules/redis';
import { document as documentTable } from '../src/modules/driver/schema/document.schema';
import { driverApplicationAudit } from '../src/modules/driver/schema/driver-application-audit.schema';
import { driverApplication } from '../src/modules/driver/schema/driver-application.schema';
import { driverLicenseApprovalAudit } from '../src/modules/driver/schema/driver-license-approval-audit.schema';
import { driverLicenseApproval } from '../src/modules/driver/schema/driver-license-approval.schema';
import { vehicle } from '../src/modules/driver/schema/vehicle.schema';
import { user } from '../src/modules/user';
import { AuthModule } from '../src/modules/auth/auth.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { authIdentity } from '../src/modules/auth/schema/auth-identity.schema';
import { NotificationsService } from '../src/modules/notifications';
import { StorageService } from '../src/modules/storage';

type AuthTestContextOptions = {
  storage?: Pick<StorageService, 'getUploadUrl' | 'getDownloadUrl' | 'delete'>;
  notifications?: Pick<
    NotificationsService,
    'registerDeviceToken' | 'sendWelcomeNotification'
  >;
};

export async function createAuthTestContext(options?: AuthTestContextOptions) {
  const moduleBuilder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [
          authConfig,
          redisConfig,
          databaseConfig,
          dispatchConfig,
          storageConfig,
          notificationsConfig,
        ],
      }),
      RedisModule,
      DatabaseModule,
      AuthModule,
    ],
  });

  if (options?.storage) {
    moduleBuilder.overrideProvider(StorageService).useValue(options.storage);
  }

  if (options?.notifications) {
    moduleBuilder
      .overrideProvider(NotificationsService)
      .useValue(options.notifications);
  }

  const moduleRef = await moduleBuilder.compile();

  return {
    service: moduleRef.get(AuthService),
    db: moduleRef.get<Database>(DRIZZLE),
    close: async () => {
      await moduleRef
        .get<Redis>(REDIS_CLIENT)
        .quit()
        .catch(() => undefined);
      await moduleRef.get<Pool>(PG_POOL).end();
    },
  };
}

export async function deleteUserForIdentity(db: Database, identifier: string) {
  const [identity] = await db
    .select({ userId: authIdentity.userId })
    .from(authIdentity)
    .where(eq(authIdentity.identifier, identifier))
    .limit(1);

  if (identity) {
    await db
      .delete(driverLicenseApprovalAudit)
      .where(eq(driverLicenseApprovalAudit.userId, identity.userId));
    await db
      .delete(driverLicenseApprovalAudit)
      .where(eq(driverLicenseApprovalAudit.actorId, identity.userId));
    await db
      .delete(driverLicenseApproval)
      .where(eq(driverLicenseApproval.userId, identity.userId));
    await db
      .update(driverLicenseApproval)
      .set({ reviewerId: null })
      .where(eq(driverLicenseApproval.reviewerId, identity.userId));
    await db
      .delete(documentTable)
      .where(eq(documentTable.userId, identity.userId));
    await db
      .delete(driverApplicationAudit)
      .where(eq(driverApplicationAudit.userId, identity.userId));
    await db
      .delete(driverApplication)
      .where(eq(driverApplication.userId, identity.userId));
    await db.delete(vehicle).where(eq(vehicle.userId, identity.userId));
    await db
      .delete(authIdentity)
      .where(eq(authIdentity.userId, identity.userId));
    await db.delete(user).where(eq(user.id, identity.userId));
  }
}
