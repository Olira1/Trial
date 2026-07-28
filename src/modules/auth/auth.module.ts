import { Module } from '@nestjs/common';
import { NotificationsController } from '../notifications/notifications.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { RewardsModule } from '../rewards';
import { StorageModule } from '../storage';
import { UserModule } from '../user';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AdminSessionGuard } from './guards/admin-session.guard';
import { SessionGuard } from './guards/session.guard';

@Module({
  imports: [UserModule, RewardsModule, StorageModule, NotificationsModule],
  // NotificationsController belongs to the notifications feature, but keeping it
  // here avoids AuthModule <-> NotificationsModule circular imports while
  // AuthService still calls NotificationsService for login welcome pushes.
  // TODO: Move this controller back to NotificationsModule after session auth is
  // split into a shared boundary or login side effects are event-driven.
  controllers: [AuthController, NotificationsController],
  providers: [AuthService, SessionGuard, AdminSessionGuard],
  exports: [AuthService, SessionGuard, AdminSessionGuard, UserModule],
})
export class AuthModule {}
