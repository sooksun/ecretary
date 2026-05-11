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
      expect(Array.isArray(res.body)).toBe(true);
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
