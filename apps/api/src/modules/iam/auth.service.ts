import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 7;

export interface AuthUser {
  userId: string;
  email: string;
  sid: string;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

interface RefreshPayload {
  sub: string;
  sid: string;
  jti: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private accessSecret(): string {
    return this.secret('JWT_ACCESS_SECRET', 'dev-access-secret');
  }

  private refreshSecret(): string {
    return this.secret('JWT_REFRESH_SECRET', 'dev-refresh-secret');
  }

  private secret(key: string, devFallback: string): string {
    const value = this.config.get<string>(key);
    if (value && value.length > 0) {
      return value;
    }
    this.logger.warn(`${key} not set — using an insecure dev fallback. Set it before production.`);
    return devFallback;
  }

  // Utility for dev seeding/tests.
  hashPassword(plain: string): Promise<string> {
    return hash(plain);
  }

  async login(
    email: string,
    password: string,
    meta?: { userAgent?: string | null; ip?: string | null },
  ): Promise<Tokens & { user: { id: string; email: string } }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const sid = ulid();
    const jti = ulid();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000);
    await this.prisma.session.create({
      data: {
        id: sid,
        userId: user.id,
        currentRefreshJti: jti,
        expiresAt,
        userAgent: meta?.userAgent ?? null,
        ipAddress: meta?.ip ?? null,
      },
    });

    const tokens = await this.issue(user.id, user.email, sid, jti);
    return { ...tokens, user: { id: user.id, email: user.email } };
  }

  async refresh(refreshToken: string): Promise<Tokens> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.refreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.prisma.session.findUnique({ where: { id: payload.sid } });
    if (!session || session.revokedAt !== null || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired');
    }
    if (session.currentRefreshJti !== payload.jti) {
      // Reuse of a rotated token — revoke the whole session defensively.
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const newJti = ulid();
    await this.prisma.session.update({
      where: { id: session.id },
      data: { currentRefreshJti: newJti },
    });
    return this.issue(user.id, user.email, session.id, newJti);
  }

  async logout(sid: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sid, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<{ id: string; email: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }

  async verifyAccess(token: string): Promise<AuthUser> {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; email: string; sid: string }>(token, {
        secret: this.accessSecret(),
      });
      return { userId: p.sub, email: p.email, sid: p.sid };
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private async issue(userId: string, email: string, sid: string, jti: string): Promise<Tokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, sid, type: 'access' },
      { secret: this.accessSecret(), expiresIn: ACCESS_TTL },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, sid, jti, type: 'refresh' },
      { secret: this.refreshSecret(), expiresIn: `${REFRESH_TTL_DAYS}d` },
    );
    return { accessToken, refreshToken };
  }
}
