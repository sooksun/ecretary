import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const DEV_FALLBACK_SECRET = 'change-me-dev-secret';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const secret = cfg.get<string>('JWT_SECRET');
        const isProd = cfg.get<string>('NODE_ENV') === 'production';

        if (!secret) {
          if (isProd) {
            throw new Error(
              'JWT_SECRET environment variable is required in production. ' +
                'Set a long, random secret (e.g. openssl rand -hex 64).',
            );
          }
          Logger.warn(
            'JWT_SECRET is not set — using insecure dev fallback. Set JWT_SECRET before going to production.',
            'AuthModule',
          );
        }

        return {
          secret: secret ?? DEV_FALLBACK_SECRET,
          signOptions: {
            expiresIn: cfg.get<string>('JWT_EXPIRES_IN') ?? '7d',
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
