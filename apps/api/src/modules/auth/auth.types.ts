import type { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  orgId: string;
  role: UserRole;
}

export interface AuthUser {
  id: string;
  organizationId: string;
  role: UserRole;
}
