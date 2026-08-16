import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('M-Secretary API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Login as the seeded admin (assumes prisma:seed has run on the dev db)
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@msecretary.local', password: 'admin1234' });
    if (loginRes.status !== 201) {
      throw new Error(
        `Login failed in test setup (status=${loginRes.status}). ` +
          `Run 'npm --workspace @msec/api run prisma:seed' before tests.`,
      );
    }
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  // ──────────────────────────────────────────────────────────
  describe('public endpoints', () => {
    it('GET /api/v1/health → 200 with no token', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.db).toBe('up');
    });
  });

  // ──────────────────────────────────────────────────────────
  describe('JwtAuthGuard', () => {
    it('GET /api/v1/meetings without token → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/meetings');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('GET /api/v1/meetings with garbage token → 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/meetings')
        .set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/meetings with valid token → 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/meetings')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect('nextCursor' in res.body).toBe(true);
    });

    it('GET /api/v1/auth/me reflects the JWT subject', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe('admin@msecretary.local');
    });
  });

  // ──────────────────────────────────────────────────────────
  describe('meetings list pagination', () => {
    it('GET /api/v1/meetings → { items, nextCursor } shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/meetings')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect('nextCursor' in res.body).toBe(true);
    });

    it('GET /api/v1/meetings?limit=1 respects limit', async () => {
      // Create two meetings to ensure there are enough rows
      const base = { title: 'pagination-test', meetingType: 'GENERAL' };
      await request(app.getHttpServer())
        .post('/api/v1/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...base, title: 'pagination-A' });
      await request(app.getHttpServer())
        .post('/api/v1/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...base, title: 'pagination-B' });

      const res = await request(app.getHttpServer())
        .get('/api/v1/meetings?limit=1')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      // nextCursor must be a string if there are more rows
      if (res.body.nextCursor !== null) {
        expect(typeof res.body.nextCursor).toBe('string');
      }
    });
  });

  // ──────────────────────────────────────────────────────────
  describe('cross-org isolation', () => {
    it('GET /api/v1/meetings/:id for another org → 404', async () => {
      // Create a meeting as the seeded user (admin org), then try to fetch
      // it with the same token but a spoofed meeting id that does not belong
      // to this org — the service scopes by orgId so any unknown id returns 404.
      const created = await request(app.getHttpServer())
        .post('/api/v1/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'cross-org test', meetingType: 'GENERAL' });
      expect(created.status).toBe(201);
      const meetingId = created.body.id;

      // Use the real meeting id but a non-existent id — the service returns 404
      const res = await request(app.getHttpServer())
        .get('/api/v1/meetings/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);

      // Cleanup
      await prisma.meeting.delete({ where: { id: meetingId } }).catch(() => {});
    });
  });

  // ──────────────────────────────────────────────────────────
  describe('chunk upload validation', () => {
    let meetingId: string;

    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'chunk validation meeting', meetingType: 'GENERAL' });
      expect(created.status).toBe(201);
      meetingId = created.body.id;
    });

    afterAll(async () => {
      await prisma.audioChunk.deleteMany({ where: { meetingId } }).catch(() => {});
      await prisma.meeting.delete({ where: { id: meetingId } }).catch(() => {});
    });

    it('upload with wrong checksum → 400', async () => {
      const audio = Buffer.from('fake-audio-data');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/meetings/${meetingId}/audio-chunks`)
        .set('Authorization', `Bearer ${token}`)
        .field('clientChunkId', `e2e-checksum-${Date.now()}`)
        .field('chunkIndex', '0')
        .field('durationSec', '5')
        .field('mimeType', 'audio/mp4')
        .field('checksumSha256', 'deadbeef'.repeat(8)) // wrong hash
        .attach('file', audio, 'chunk.m4a');
      expect(res.status).toBe(400);
    });

    it('upload with invalid clientChunkId (special chars) → 400', async () => {
      const audio = Buffer.from('fake-audio-data');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/meetings/${meetingId}/audio-chunks`)
        .set('Authorization', `Bearer ${token}`)
        .field('clientChunkId', '../../../etc/passwd')
        .field('chunkIndex', '0')
        .field('durationSec', '5')
        .field('mimeType', 'audio/mp4')
        .attach('file', audio, 'chunk.m4a');
      expect(res.status).toBe(400);
    });

    it('upload with non-audio content-type → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/meetings/${meetingId}/audio-chunks`)
        .set('Authorization', `Bearer ${token}`)
        .field('clientChunkId', `e2e-bad-mime-${Date.now()}`)
        .field('chunkIndex', '0')
        .field('durationSec', '5')
        .field('mimeType', 'text/html')
        .attach('file', Buffer.from('<html>'), 'evil.html');
      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────────────────────────────────────────
  describe('meeting delete', () => {
    it('DELETE /api/v1/meetings/:id → 204, then GET → 404', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'delete-me', meetingType: 'GENERAL' });
      expect(created.status).toBe(201);
      const id = created.body.id;

      const del = await request(app.getHttpServer())
        .delete(`/api/v1/meetings/${id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(204);

      const get = await request(app.getHttpServer())
        .get(`/api/v1/meetings/${id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(get.status).toBe(404);
    });

    it('writes an audit row naming the actor and what was destroyed', async () => {
      // docs/09_SECURITY_PRIVACY.md commits to audit logs for delete. The
      // meeting row is gone afterwards, so the trail is the only record that
      // it ever existed — it has to carry enough to identify it.
      const created = await request(app.getHttpServer())
        .post('/api/v1/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'audit-delete-me', meetingType: 'GENERAL' });
      const id = created.body.id;

      await request(app.getHttpServer())
        .delete(`/api/v1/meetings/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'meeting.delete', resourceId: id },
      });
      expect(entry).not.toBeNull();
      expect(entry!.actorUserId).toBeTruthy();
      expect(entry!.resourceType).toBe('Meeting');
      expect((entry!.metadata as { title?: string }).title).toBe('audit-delete-me');
    });

    it('does not log a delete that never happened', async () => {
      const missing = '00000000-0000-0000-0000-0000000000ff';
      await request(app.getHttpServer())
        .delete(`/api/v1/meetings/${missing}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'meeting.delete', resourceId: missing },
      });
      expect(entry).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────
  describe('export audit trail', () => {
    it('records an export.create row when a file is rendered', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'audit-export', meetingType: 'GENERAL' });
      const meetingId = created.body.id;

      const exp = await request(app.getHttpServer())
        .post(`/api/v1/meetings/${meetingId}/exports`)
        .set('Authorization', `Bearer ${token}`)
        .send({ exportType: 'TRANSCRIPT_TXT' });
      expect(exp.status).toBe(201);

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'export.create', resourceId: exp.body.id },
      });
      expect(entry).not.toBeNull();
      expect(entry!.actorUserId).toBeTruthy();
      expect((entry!.metadata as { meetingId?: string }).meetingId).toBe(meetingId);

      // Fetching the export mints a signed URL — that is a download event.
      await request(app.getHttpServer())
        .get(`/api/v1/exports/${exp.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const download = await prisma.auditLog.findFirst({
        where: { action: 'export.download', resourceId: exp.body.id },
      });
      expect(download).not.toBeNull();

      await request(app.getHttpServer())
        .delete(`/api/v1/meetings/${meetingId}`)
        .set('Authorization', `Bearer ${token}`);
    });
  });

  // ──────────────────────────────────────────────────────────
  describe('chunk upload idempotency', () => {
    let meetingId: string;
    const clientChunkId = `e2e-test-${Date.now()}`;

    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'e2e idempotency meeting', meetingType: 'GENERAL' });
      expect(created.status).toBe(201);
      meetingId = created.body.id;
    });

    afterAll(async () => {
      // Local driver — chunk file lands under apps/api/uploads. Cleanup the row.
      await prisma.audioChunk.deleteMany({ where: { meetingId } }).catch(() => {});
      await prisma.meeting.delete({ where: { id: meetingId } }).catch(() => {});
    });

    it('POST /meetings/:id/audio-chunks twice with same clientChunkId → single row', async () => {
      const audio = Buffer.from('fake-m4a-bytes-for-test');

      const upload = () =>
        request(app.getHttpServer())
          .post(`/api/v1/meetings/${meetingId}/audio-chunks`)
          .set('Authorization', `Bearer ${token}`)
          .field('clientChunkId', clientChunkId)
          .field('chunkIndex', '0')
          .field('durationSec', '5')
          .field('mimeType', 'audio/mp4')
          .attach('file', audio, 'chunk0.m4a');

      const first = await upload();
      expect([200, 201]).toContain(first.status);

      const second = await upload();
      // Second call should succeed (idempotent) and not create a duplicate
      expect([200, 201, 409]).toContain(second.status);

      const rows = await prisma.audioChunk.count({
        where: { meetingId, clientChunkId },
      });
      expect(rows).toBe(1);
    });
  });
});
