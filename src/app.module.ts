import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import {
  hours,
  seconds,
  ThrottlerGuard,
  ThrottlerModule,
} from '@nestjs/throttler';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import {
  appConfig,
  authConfig,
  databaseConfig,
  dispatchConfig,
  fareConfig,
  notificationsConfig,
  redisConfig,
  storageConfig,
  validateEnv,
} from './config';
import { DatabaseModule } from './database/database.module';
import { AdBannersModule } from './modules/ad-banners';
import { AdminModule } from './modules/admin';
import { AuthModule } from './modules/auth';
import { DriverModule } from './modules/driver';
import { DriverPresenceModule } from './modules/driver-presence';
import { DispatchOutboxModule } from './modules/dispatch-outbox';
import { DispatchQueueModule } from './modules/dispatch-queue';
import { DispatchRealtimeModule } from './modules/dispatch-realtime';
import { FareEstimatesModule } from './modules/fare-estimates';
import { HealthModule } from './modules/health';
import { RedisModule } from './modules/redis';
import { NotificationsModule } from './modules/notifications';
import { RewardsModule } from './modules/rewards';
import { DispatchMetricsModule } from './modules/dispatch-candidate/dispatch-metrics.module';
import { RideRequestsModule } from './modules/ride-requests';
import { StorageModule } from './modules/storage';
import { SupportModule } from './modules/support';
import { UserModule } from './modules/user';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        authConfig,
        storageConfig,
        notificationsConfig,
        fareConfig,
        dispatchConfig,
      ],
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: seconds(1), limit: 10 },
      { name: 'medium', ttl: seconds(60), limit: 60 },
      { name: 'long', ttl: hours(1), limit: 1_000 },
    ]),
    DatabaseModule,
    RedisModule,
    DispatchMetricsModule,
    DispatchQueueModule,
    DispatchOutboxModule,
    DispatchRealtimeModule,
    StorageModule,
    AdBannersModule,
    NotificationsModule,
    UserModule,
    AdminModule,
    AuthModule,
    DriverModule,
    DriverPresenceModule,
    SupportModule,
    RewardsModule,
    RideRequestsModule,
    FareEstimatesModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
  ],
})
export class AppModule {}
