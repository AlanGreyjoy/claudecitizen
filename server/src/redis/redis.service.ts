import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { EnvService } from '../shared/env.service';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(
    @Inject(EnvService) env: EnvService,
    @InjectPinoLogger(RedisService.name) private readonly logger: PinoLogger,
  ) {
    this.client = new Redis(env.redisUrl, {
      enableOfflineQueue: true,
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    this.client.on('error', (error) => {
      this.logger.warn({ err: error }, 'Redis client error');
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
    this.logger.debug('Redis client disconnected');
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async rateLimit(key: string, maxHits: number, windowSeconds: number): Promise<boolean> {
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, windowSeconds);
    return count <= maxHits;
  }
}
