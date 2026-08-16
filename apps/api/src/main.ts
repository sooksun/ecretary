import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

const DEFAULT_JWT_SECRET = 'change-me-dev-secret';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
  });

  const config = app.get(ConfigService);
  const port = Number(config.get<string>('API_PORT') ?? 3000);
  const prefix = config.get<string>('API_GLOBAL_PREFIX') ?? 'api/v1';
  const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
  const jwtSecret = config.get<string>('JWT_SECRET') ?? '';

  // Refuse to start in production with a missing or placeholder secret.
  // Checks both the empty-string case (JWT_SECRET var present but blank) and
  // the default-value case (shipped placeholder never swapped out).
  if (nodeEnv === 'production' && (!jwtSecret || jwtSecret === DEFAULT_JWT_SECRET)) {
    throw new Error(
      'JWT_SECRET must be set to a strong random value in production. ' +
        'Generate one with: openssl rand -hex 32',
    );
  }

  // Cap JSON + form body at 1 MB. File uploads use multipart so they are not
  // affected by this limit — only JSON API endpoints.
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ limit: '1mb', extended: true }));

  app.use(compression());
  app.use(helmet());
  app.setGlobalPrefix(prefix);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  const rawOrigins = config.get<string>('CORS_ORIGINS') ?? '';
  const origins = rawOrigins
    ? rawOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://localhost:8081']; // Expo Metro web — override via CORS_ORIGINS in production
  // credentials:true is NOT set — JWT is in Authorization headers, not cookies,
  // so the browser does not need to send credentials cross-origin.
  app.enableCors({ origin: origins });

  await app.listen(port, '0.0.0.0');
  Logger.log(`🟢 API ready on http://localhost:${port}/${prefix}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
