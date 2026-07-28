import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { StorageModule } from '../storage';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
