import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Actions worth an audit row. docs/09_SECURITY_PRIVACY.md commits to audit logs
 * for "export/download/delete" — the three operations that either move meeting
 * content out of the system or destroy it.
 *
 * Reads are deliberately NOT audited: viewing a summary is the normal use of
 * the product, and a row per view would bury the events that matter.
 */
export const AuditAction = {
  /** A new export file was rendered from a meeting. */
  EXPORT_CREATE: 'export.create',
  /** A signed download URL was handed out — the capability to fetch the file. */
  EXPORT_DOWNLOAD: 'export.download',
  /** A meeting and all its audio/transcripts/exports were destroyed. */
  MEETING_DELETE: 'meeting.delete',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditResource = {
  MEETING: 'Meeting',
  EXPORT_FILE: 'ExportFile',
} as const;
export type AuditResource = (typeof AuditResource)[keyof typeof AuditResource];

export interface AuditEntry {
  actorUserId: string | null;
  action: AuditAction;
  resourceType: AuditResource;
  resourceId?: string | null;
  /** Small, non-sensitive context: never transcript text or signed URLs. */
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes one audit row.
   *
   * Never throws: an audit write failing must not turn a successful delete or
   * export into a 500 for the user. It IS logged at error level, because a
   * silently missing audit trail is exactly what an auditor would care about.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: entry.actorUserId,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          metadata: (entry.metadata ?? {}) as object,
        },
      });
    } catch (err) {
      this.logger.error(
        { action: entry.action, resourceId: entry.resourceId, err: (err as Error).message },
        'audit.write.failed',
      );
    }
  }
}
