import { Module } from '@nestjs/common';
import { StorageModule } from '../storage';
import { UserService } from './user.service';

@Module({
  imports: [StorageModule],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
