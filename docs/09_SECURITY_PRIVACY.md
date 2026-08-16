# 09 Security, Privacy, and Consent

## Core Principle

Meeting audio may contain personal data, student information, personnel discussions, or confidential school matters. Treat every recording as sensitive.

## Consent UX

Before recording:

- show consent notice
- show purpose of recording
- show who can access output
- require user confirmation

Suggested notice:

```txt
ระบบนี้จะบันทึกเสียงการประชุมเพื่อถอดเสียงและจัดทำสรุปรายงานประชุม กรุณาแจ้งผู้เข้าร่วมประชุมให้ทราบก่อนเริ่มบันทึกเสียง
```

## Access Control

Roles:

- admin: manage organization/settings
- recorder: create meetings and upload audio
- editor: edit summaries/action items
- viewer: view final reports

## Data Security

- HTTPS only
- JWT auth
- signed upload/download URLs where possible
- object storage private by default
- audit logs for export/download/delete — implemented, see below
- encrypt secrets using environment variables

## Audit Trail

Written to the `AuditLog` table by `AuditService` (`apps/api/src/common/audit/`).
Covers the operations that move meeting content out of the system or destroy it:

| action | Written when | resourceType / resourceId | metadata |
|---|---|---|---|
| `meeting.delete` | after `DELETE /meetings/:id` succeeds | `Meeting` / meeting id | title, organizationId, counts of audio chunks and export files removed |
| `export.create` | a DOCX/PDF/TXT file is rendered | `ExportFile` / export id | meetingId, exportType, sizeBytes |
| `export.download` | a signed download URL is issued (`GET /exports/:id`, or `GET /meetings/:id/exports` for the batch) | `ExportFile` or `Meeting` | meetingId, exportType, `via: detail \| list` |

Design rules:

- **Reads are not audited.** Viewing a summary is the normal use of the product; a row per view would bury the events that matter.
- **`meeting.delete` is written after the delete succeeds**, never before — a trail listing deletions that did not happen is worse than one that is merely incomplete. It keeps the title because the row it identifies no longer exists.
- **`AuditService.record()` never throws.** A failed audit write must not turn a successful delete into a 500 for the user; it is logged at error level instead (`audit.write.failed`).
- **metadata carries no content and no credentials** — no transcript text, no signed URLs.
- The trail is currently write-only; there is no read API for it yet. Query it directly:
  `SELECT action, "resourceType", "resourceId", "actorUserId", metadata, "createdAt" FROM "AuditLog" ORDER BY "createdAt" DESC;`

Covered by the API e2e suite (`apps/api/test/app.e2e-spec.ts`), including the negative case that a failed delete writes nothing.

## Retention Policy

Configurable:

- keep local audio until uploaded
- auto-delete local chunks after successful backup and user confirmation
- server audio retention: 30/90/365 days based on policy
- transcript/report retention according to organization rules

## Sensitive Data Warnings

AI output must include review requirement:

```txt
ผลสรุปจาก AI ควรได้รับการตรวจทานจากผู้รับผิดชอบก่อนใช้เป็นเอกสารทางราชการ
```

## Data Deletion

Required features:

- delete meeting audio
- delete transcript
- delete generated report
- export before delete
- admin-only permanent deletion

## Logging

Do not log:

- raw transcript
- audio URLs
- private tokens
- personally sensitive content

Can log:

- job id
- status
- duration
- error code
- processing time
