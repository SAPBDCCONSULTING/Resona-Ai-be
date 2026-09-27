import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RedisService } from './redis.service';

/**
 * Phase 1 stub: best-effort per-IP counter via Redis.
 * Never blocks the request if Redis is down — only stamps rate-limit headers.
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(private readonly redis: RedisService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const windowSec = 60;
    const limit = 120;

    try {
      const count = await this.redis.incrWithTtl(`rl:${ip}`, windowSec);
      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader(
        'X-RateLimit-Remaining',
        String(Math.max(0, limit - count)),
      );
      if (count > limit) {
        res.status(429).json({
          statusCode: 429,
          message: 'Too many requests',
        });
        return;
      }
    } catch {
      // Soft-fail: continue without rate limiting when Redis is unavailable.
    }

    next();
  }
}
