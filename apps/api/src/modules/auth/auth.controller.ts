import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Public } from './public.decorator';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './auth.types';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(LoginSchema))
    body: z.infer<typeof LoginSchema>,
  ) {
    return this.auth.login(body.email, body.password);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return this.auth.getMe(user);
  }
}
