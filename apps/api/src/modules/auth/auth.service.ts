import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser, JwtPayload } from './auth.types';

@Injectable()
export class AuthService implements OnModuleInit {
  // Computed asynchronously in onModuleInit so bootstrap is non-blocking.
  // Used as a dummy hash for users that don't exist — ensures every login
  // attempt spends the same ~100 ms in bcrypt.compare, preventing timing-
  // based email enumeration.
  private dummyHash!: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit() {
    this.dummyHash = await bcrypt.hash('constant-time-dummy-do-not-use', 10);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always run bcrypt regardless of whether the user exists.
    const hash = user?.passwordHash ?? this.dummyHash;
    const ok = await bcrypt.compare(password, hash);
    if (!user || !user.passwordHash || !ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload: JwtPayload = {
      sub: user.id,
      orgId: user.organizationId,
      role: user.role,
    };
    return {
      accessToken: this.jwt.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
  }

  async getMe(actor: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        organizationId: true,
      },
    });
    if (!user) throw new UnauthorizedException('User no longer exists');
    return user;
  }

  static async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 10);
  }
}
