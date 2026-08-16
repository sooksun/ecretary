import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis } from 'ioredis';

@Injectable()
export class ApiCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApiCacheService.name);
  private client: Redis | null = null;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST') ?? 'localhost';
    const port = Number(this.configService.get<string>('REDIS_PORT') ?? 6379);

    try {
      this.client = new IORedis(port, host, {
        lazyConnect: true,
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log(`Connected to Redis cache server (${host}:${port})`);
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        this.logger.warn(`Redis cache warning: ${err.message}`);
      });

      void this.client.connect().catch((err) => {
        this.logger.warn(`Redis cache failed to connect initially: ${err.message}`);
      });
    } catch (err) {
      this.logger.warn(`Redis cache initialization skipped: ${(err as Error).message}`);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client || !this.isConnected) return null;
    try {
      const data = await this.client.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (err) {
      this.logger.warn(`Cache get failed for key "${key}": ${(err as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    if (!this.client || !this.isConnected) return;
    try {
      const serialized = JSON.stringify(value);
      await this.client.setex(key, ttlSeconds, serialized);
    } catch (err) {
      this.logger.warn(`Cache set failed for key "${key}": ${(err as Error).message}`);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client || !this.isConnected) return;
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(`Cache del failed for key "${key}": ${(err as Error).message}`);
    }
  }

  async delPattern(pattern: string): Promise<void> {
    if (!this.client || !this.isConnected) return;
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (err) {
      this.logger.warn(`Cache delPattern failed for "${pattern}": ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch(() => {});
    }
  }
}
