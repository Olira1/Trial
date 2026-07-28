import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { DispatchOfferModule } from '../dispatch-offer';
import { DriverModule } from '../driver';
import { NotificationsModule } from '../notifications';
import { UserModule } from '../user';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    AuthModule,
    DispatchOfferModule,
    DriverModule,
    NotificationsModule,
    UserModule,
  ],
  controllers: [AdminController],
})
export class AdminModule {}
