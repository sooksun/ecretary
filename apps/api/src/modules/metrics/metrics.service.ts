import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { collectDefaultMetrics, Gauge, Registry } from 'prom-client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Custom registry (NOT the prom-client default global) so this Nest app's
 * metrics are isolated from any other module's. The collector runs on a
 * short cache to absorb hot-scraping without hammering Postgres.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new Registry();

  private readonly meetingsByStatus = new Gauge({
    name: 'msec_meetings_total',
    help: 'Number of meetings grouped by status.',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  private readonly chunksByTranscribeStatus = new Gauge({
    name: 'msec_audio_chunks_total',
    help: 'Number of audio chunks grouped by transcribeStatus.',
    labelNames: ['transcribeStatus'] as const,
    registers: [this.registry],
  });

  private readonly actionItemsByStatus = new Gauge({
    name: 'msec_action_items_total',
    help: 'Number of action items grouped by status.',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  /**
   * Counter-style "this many meetings are mock-content" — useful as a
   * spike alert (if non-zero is unexpected in your deployment, page on it).
   */
  private readonly mockSummaries = new Gauge({
    name: 'msec_mock_summaries_total',
    help: 'Number of meetings whose summary modelName starts with "mock".',
    registers: [this.registry],
  });

  // Cache the DB roll-up. Without this, a scraper polling every second
  // hammers Postgres needlessly — gauge values don't change that fast.
  private cache: { at: number; promise: Promise<void> | null } = {
    at: 0,
    promise: null,
  };
  private readonly cacheTtlMs = 10_000;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // Node process metrics (memory, CPU, GC, event-loop lag).
    collectDefaultMetrics({ register: this.registry, prefix: 'msec_node_' });
  }

  async render(): Promise<string> {
    await this.refreshIfStale();
    return this.registry.metrics();
  }

  private async refreshIfStale(): Promise<void> {
    const age = Date.now() - this.cache.at;
    if (age < this.cacheTtlMs && this.cache.promise === null) return;
    if (this.cache.promise) {
      // Another scrape is already refreshing — piggyback on the in-flight query.
      return this.cache.promise;
    }
    this.cache.promise = this.refresh().finally(() => {
      this.cache.at = Date.now();
      this.cache.promise = null;
    });
    return this.cache.promise;
  }

  private async refresh(): Promise<void> {
    try {
      const [meetings, chunks, actions, mock] = await Promise.all([
        this.prisma.meeting.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.audioChunk.groupBy({
          by: ['transcribeStatus'],
          _count: { _all: true },
        }),
        this.prisma.actionItem.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.meetingSummary.count({
          where: { modelName: { startsWith: 'mock' } },
        }),
      ]);

      // Clear-and-set: a status that drops to zero must reflect that, but
      // gauge .set() without iterating over previously-seen labels would
      // leave them stuck at their last non-zero value.
      this.meetingsByStatus.reset();
      for (const m of meetings) this.meetingsByStatus.set({ status: m.status }, m._count._all);

      this.chunksByTranscribeStatus.reset();
      for (const c of chunks)
        this.chunksByTranscribeStatus.set(
          { transcribeStatus: c.transcribeStatus },
          c._count._all,
        );

      this.actionItemsByStatus.reset();
      for (const a of actions) this.actionItemsByStatus.set({ status: a.status }, a._count._all);

      this.mockSummaries.set(mock);
    } catch (err) {
      this.logger.warn(`metrics refresh failed: ${(err as Error).message}`);
    }
  }
}
