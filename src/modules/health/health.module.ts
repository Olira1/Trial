import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { RedisModule } from '../redis';
import { DatabaseHealthIndicator } from './database.health';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';

@Module({
  imports: [TerminusModule, RedisModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
