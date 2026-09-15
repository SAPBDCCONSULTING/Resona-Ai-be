import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import type { ApiHealth } from '@pulsefeedback/shared';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(): Promise<ApiHealth> {
    const mongoReady = this.connection.readyState === 1;
    const redisReady = await this.redis.ping();

    const mongo = mongoReady ? 'up' : 'down';
    const redis = redisReady ? 'up' : 'down';
    const status = mongoReady && redisReady ? 'ok' : 'degraded';

    return {
      status,
      service: 'resona-ai-api',
      mongo,
      redis,
      timestamp: new Date().toISOString(),
    };
  }
}
