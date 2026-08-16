import { Controller, ForbiddenException, Get, Header, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { MetricsService } from './metrics.service';
import { Public } from '../auth/public.decorator';

/**
 * Prometheus scrape endpoint.
 *
 * Marked @Public because scrapers don't carry JWTs.
 *
 * Access control (fail-closed):
 * - If METRICS_TOKEN is set (recommended in production), the request must
 *   supply it as a Bearer token: `Authorization: Bearer <METRICS_TOKEN>`.
 * - If METRICS_TOKEN is unset and NODE_ENV=production, the endpoint is
 *   blocked entirely — do not rely on a proxy allowlist alone.
 * - In development (NODE_ENV≠production, no token) access is open so
 *   local Prometheus/Grafana setups work without extra config.
 *
 * See docs/RUNBOOK_SECRETS.md for token rotation steps.
 */
@Public()
@Controller('metrics')
export class MetricsController {
  private readonly token: string | undefined;
  private readonly isProd: boolean;

  constructor(
    private readonly metrics: MetricsService,
    cfg: ConfigService,
  ) {
    this.token = cfg.get<string>('METRICS_TOKEN');
    this.isProd = cfg.get<string>('NODE_ENV') === 'production';
  }

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(@Req() req: Request): Promise<string> {
    if (this.token) {
      const header = req.headers['authorization'] ?? '';
      const supplied = Array.isArray(header) ? header[0] : header;
      const bearer = supplied.toLowerCase().startsWith('bearer ')
        ? supplied.slice(7).trim()
        : '';
      if (bearer !== this.token) {
        throw new ForbiddenException('Invalid or missing METRICS_TOKEN');
      }
    } else if (this.isProd) {
      // Fail closed: in production METRICS_TOKEN must be explicitly set.
      throw new ForbiddenException(
        'Metrics endpoint is disabled: set METRICS_TOKEN in your environment to enable it.',
      );
    }
    return this.metrics.render();
  }
}
