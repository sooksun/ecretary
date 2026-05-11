import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
  });

  const config = app.get(ConfigService);
  const port = Number(config.get<string>('API_PORT') ?? 3000);
  const prefix = config.get<string>('API_GLOBAL_PREFIX') ?? 'api/v1';

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
  app.enableCors({ origin: origins, credentials: true });

  await app.listen(port);
  Logger.log(`🟢 API ready on http://localhost:${port}/${prefix}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
