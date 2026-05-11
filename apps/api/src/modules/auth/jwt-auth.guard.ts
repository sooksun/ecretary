import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthUser, JwtPayload } from './auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  /**
   * Comma-separated list of secrets that USED to be JWT_SECRET. Tokens
   * signed with any of these are accepted as valid (verify-only — new
   * tokens are still signed with JWT_SECRET). Allows rotating the active
   * secret without forcing every user to re-login: deploy with both set,
   * wait JWT_EXPIRES_IN (default 7d) for outstanding tokens to expire,
   * then drop the previous-secrets env var. See docs/RUNBOOK_SECRETS.md.
   */
  private readonly previousSecrets: string[];

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    cfg: ConfigService,
  ) {
    const raw = cfg.get<string>('JWT_PREVIOUS_SECRETS') ?? '';
    this.previousSecrets = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: AuthUser;
    }>();
    const header = req.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw || !raw.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = raw.slice(7).trim();

    const payload = this.verifyWithRotation(token);
    if (!payload) throw new UnauthorizedException('Invalid or expired token');

    req.user = {
      id: payload.sub,
      organizationId: payload.orgId,
      role: payload.role,
    };
    return true;
  }

  /**
   * Try the active secret first; on failure, fall back to each previous
   * secret in turn. Logs when an old secret is accepted so an operator
   * can watch the rotation drain (when the log line stops appearing,
   * you can safely drop JWT_PREVIOUS_SECRETS).
   */
  private verifyWithRotation(token: string): JwtPayload | null {
    try {
      return this.jwt.verify<JwtPayload>(token);
    } catch {
      // fall through to previous secrets
    }
    for (const secret of this.previousSecrets) {
      try {
        const payload = this.jwt.verify<JwtPayload>(token, { secret });
        this.logger.warn(
          `auth: token verified by a PREVIOUS secret (sub=${payload.sub}). ` +
            `Once all such tokens have expired, remove JWT_PREVIOUS_SECRETS.`,
        );
        return payload;
      } catch {
        continue;
      }
    }
    return null;
  }
}
