import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { DatabaseHealthIndicator } from './database.health';
import { RedisHealthIndicator } from './redis.health';

@ApiTags('health')
@SkipThrottle()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.database.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
