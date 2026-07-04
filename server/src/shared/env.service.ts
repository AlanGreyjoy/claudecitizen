import { Injectable } from '@nestjs/common';
import type { CookieOptions } from 'express';

type SameSite = 'lax' | 'strict' | 'none';

function readEnv(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function readNumber(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = readEnv(name);
  if (!raw) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function readSameSite(): SameSite {
  const raw = readEnv('COOKIE_SAME_SITE', 'lax').toLowerCase();
  if (raw === 'strict' || raw === 'none') return raw;
  return 'lax';
}

@Injectable()
export class EnvService {
  readonly nodeEnv = readEnv('NODE_ENV', 'development');
  readonly port = readNumber('PORT', 3000);
  readonly clientOrigin = readEnv('CLIENT_ORIGIN', 'http://localhost:4173');
  readonly apiPublicUrl = readEnv('API_PUBLIC_URL', `http://localhost:${this.port}`);
  readonly databaseUrl = readEnv(
    'DATABASE_URL',
    'postgresql://claude:citizen@localhost:5432/claude_citizen?schema=public',
  );
  readonly redisUrl = readEnv('REDIS_URL', 'redis://localhost:6379');
  readonly jwtAccessSecret = readEnv('JWT_ACCESS_SECRET', 'dev-access-secret-change-me');
  readonly jwtRefreshSecret = readEnv('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me');
  readonly cookieDomain = readEnv('COOKIE_DOMAIN');
  readonly cookieSameSite = readSameSite();
  readonly cookieSecure = readBoolean('COOKIE_SECURE', this.nodeEnv === 'production');
  readonly discordClientId = readEnv('DISCORD_CLIENT_ID');
  readonly discordClientSecret = readEnv('DISCORD_CLIENT_SECRET');
  readonly discordRedirectUri = readEnv(
    'DISCORD_REDIRECT_URI',
    `${this.apiPublicUrl}/auth/discord/callback`,
  );
  readonly smtpHost = readEnv('SMTP_HOST');
  readonly smtpPort = readNumber('SMTP_PORT', 587);
  readonly smtpUser = readEnv('SMTP_USER');
  readonly smtpPass = readEnv('SMTP_PASS');
  readonly smtpFrom = readEnv('SMTP_FROM', 'ClaudeCitizen <noreply@localhost>');

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  authCookieOptions(maxAgeMs: number): CookieOptions {
    return {
      domain: this.cookieDomain || undefined,
      httpOnly: true,
      maxAge: maxAgeMs,
      path: '/',
      sameSite: this.cookieSameSite,
      secure: this.cookieSecure,
    };
  }

  clearCookieOptions(): CookieOptions {
    return {
      domain: this.cookieDomain || undefined,
      httpOnly: true,
      path: '/',
      sameSite: this.cookieSameSite,
      secure: this.cookieSecure,
    };
  }
}
