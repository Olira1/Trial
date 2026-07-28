import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { StorageModule } from '../storage';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [DriverController],
  providers: [DriverService],
  exports: [DriverService],
})
export class DriverModule {}
