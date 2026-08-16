import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import type { AuthUser } from './auth.types';

/**
 * Restricts a route to callers whose JWT role is in the @Roles(...) list.
 * Endpoints without @Roles are accessible to any authenticated user.
 * Must be registered AFTER JwtAuthGuard so req.user is already populated.
 *
 * Guard order matters: JwtAuthGuard runs first and populates req.user. If a
 * route is @Public() and also has @Roles(), JwtAuthGuard skips JWT validation
 * and req.user stays undefined. We detect that here and throw 401 instead of
 * 403, making the misconfiguration visible rather than silently locking the
 * route for everyone.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!req.user) {
      // req.user is absent when @Public() bypassed JwtAuthGuard.
      // A route with both @Public() and @Roles() is a configuration mistake.
      throw new UnauthorizedException('Authentication required');
    }
    if (!required.includes(req.user.role)) {
      throw new ForbiddenException('Insufficient permissions for this operation');
    }
    return true;
  }
}
