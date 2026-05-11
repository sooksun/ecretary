import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { Public } from '../auth/public.decorator';

/**
 * Prometheus scrape endpoint.
 *
 * Marked @Public because scrapers don't carry JWTs. In production the
 * proxy/firewall is expected to restrict this path to internal sources
 * (Caddyfile-side allowlist by source IP, or a separate internal bind).
 * See docs/RUNBOOK_PROD.md for the recommended Caddy snippet.
 */
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    return this.metrics.render();
  }
}
