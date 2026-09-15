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
      await this.ensureConnected();
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /** Increment key and set TTL on first hit. Used by rate-limit stub. */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    await this.ensureConnected();
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return count;
  }

  private async ensureConnected() {
    if (this.client.status !== 'ready') {
      await this.client.connect();
    }
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}
