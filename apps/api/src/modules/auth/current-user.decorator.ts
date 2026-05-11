import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { AuthUser } from './auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!req.user) {
      throw new InternalServerErrorException(
        '@CurrentUser() used on a route without JwtAuthGuard — add the guard or mark the route @Public()',
      );
    }
    return req.user;
  },
);
