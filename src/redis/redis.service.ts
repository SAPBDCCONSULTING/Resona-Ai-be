import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
    this.client = new Redis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    this.client.connect().catch((err: Error) => {
      this.logger.warn(`Redis connect deferred: ${err.message}`);
    });
  }

  async ping(): Promise<boolean> {
    try {
      if (this.client.status !== 'ready') {
        await this.client.connect();
      }
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}
