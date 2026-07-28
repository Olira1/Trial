import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { StorageModule } from '../storage';
import { AdBannersController } from './ad-banners.controller';
import { AdBannersService } from './ad-banners.service';
import { AdminAdBannersController } from './admin-ad-banners.controller';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [AdBannersController, AdminAdBannersController],
  providers: [AdBannersService],
  exports: [AdBannersService],
})
export class AdBannersModule {}
