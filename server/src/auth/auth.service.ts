import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EnvService } from '../shared/env.service';
import { MailService } from './mail.service';
import type { AccessTokenPayload, AuthSession, RefreshTokenPayload } from './auth.types';

const ACCESS_COOKIE_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TOKEN_MS = 30 * 60 * 1000;
const STARTER_SHIP_PREFAB_ID = 'phobos-starhopper';
const STARTER_SHIP_NAME = 'Star Hopper';

export interface IssuedAuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface DiscordTokenResponse {
  access_token?: string;
  token_type?: string;
}

interface DiscordUserResponse {
  id: string;
  username: string;
  global_name?: string | null;
  email?: string | null;
  verified?: boolean;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 24);
}

function requirePassword(password: string): void {
  if (password.length < 8) {
    throw new BadRequestException('Password must be at least 8 characters.');
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  readonly accessCookieMs = ACCESS_COOKIE_MS;
  readonly refreshCookieMs = REFRESH_COOKIE_MS;

  async register(email: string, username: string, password: string): Promise<{
    session: AuthSession;
    tokens: IssuedAuthTokens;
  }> {
    const cleanEmail = normalizeEmail(email);
    const cleanUsername = normalizeUsername(username);
    if (!cleanEmail.includes('@')) throw new BadRequestException('Email is invalid.');
    if (cleanUsername.length < 3) throw new BadRequestException('Username is too short.');
    requirePassword(password);

    const passwordHash = await bcrypt.hash(password, 12);
    let user: User;
    try {
      user = await this.createUserWithPlayer({
        email: cleanEmail,
        username: cleanUsername,
        displayName: username.trim(),
        passwordHash,
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ConflictException('Email or username is already taken.');
      throw error;
    }
    return { session: await this.sessionForUser(user.id), tokens: await this.issueTokens(user.id) };
  }

  async login(identifier: string, password: string): Promise<{
    session: AuthSession;
    tokens: IssuedAuthTokens;
  }> {
    const clean = identifier.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: clean }, { username: normalizeUsername(clean) }],
      },
    });
    if (!user?.passwordHash) throw new UnauthorizedException('Invalid credentials.');
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials.');
    return { session: await this.sessionForUser(user.id), tokens: await this.issueTokens(user.id) };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async refresh(refreshToken: string | undefined): Promise<{
    session: AuthSession;
    tokens: IssuedAuthTokens;
  }> {
    if (!refreshToken) throw new UnauthorizedException('Missing refresh cookie.');
    const payload = await this.verifyRefreshToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (
      !record ||
      record.id !== payload.jti ||
      record.userId !== payload.sub ||
      record.revokedAt ||
      record.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Refresh token is invalid.');
    }

    const tokens = await this.issueTokens(record.userId, record.familyId);
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date(), replacedByTokenId: await this.refreshTokenId(tokens.refreshToken) },
    });
    return { session: await this.sessionForUser(record.userId), tokens };
  }

  async me(userId: string): Promise<AuthSession> {
    return this.sessionForUser(userId);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.env.jwtAccessSecret,
      });
      if (payload.typ !== 'access' || !payload.sub) throw new Error('wrong token type');
      return payload;
    } catch {
      throw new UnauthorizedException('Access token is invalid.');
    }
  }

  async startDiscordLogin(): Promise<string> {
    if (!this.env.discordClientId) {
      throw new BadRequestException('Discord OAuth is not configured.');
    }
    const state = randomBytes(24).toString('base64url');
    await this.redis.set(`oauth:discord:${state}`, '1', 10 * 60);
    const params = new URLSearchParams({
      client_id: this.env.discordClientId,
      redirect_uri: this.env.discordRedirectUri,
      response_type: 'code',
      scope: 'identify email',
      state,
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  }

  async finishDiscordLogin(code: string, state: string): Promise<{
    session: AuthSession;
    tokens: IssuedAuthTokens;
  }> {
    if (!code || !state) throw new BadRequestException('Discord callback is missing state or code.');
    const stateKey = `oauth:discord:${state}`;
    const validState = await this.redis.get(stateKey);
    await this.redis.del(stateKey);
    if (!validState) throw new UnauthorizedException('Discord state expired.');
    if (!this.env.discordClientId || !this.env.discordClientSecret) {
      throw new BadRequestException('Discord OAuth is not configured.');
    }

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.discordClientId,
        client_secret: this.env.discordClientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.env.discordRedirectUri,
      }),
    });
    if (!tokenResponse.ok) throw new UnauthorizedException('Discord token exchange failed.');
    const tokenJson = (await tokenResponse.json()) as DiscordTokenResponse;
    if (!tokenJson.access_token) throw new UnauthorizedException('Discord token missing.');

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!userResponse.ok) throw new UnauthorizedException('Discord profile lookup failed.');
    const discordUser = (await userResponse.json()) as DiscordUserResponse;

    const existingDiscord = await this.prisma.user.findUnique({
      where: { discordId: discordUser.id },
    });
    if (existingDiscord) {
      return {
        session: await this.sessionForUser(existingDiscord.id),
        tokens: await this.issueTokens(existingDiscord.id),
      };
    }

    const email = discordUser.email && discordUser.verified ? normalizeEmail(discordUser.email) : null;
    if (email) {
      const emailOwner = await this.prisma.user.findUnique({ where: { email } });
      if (emailOwner) {
        throw new ConflictException('An account with that email already exists. Log in first.');
      }
    }

    const displayName = discordUser.global_name || discordUser.username;
    const username = await this.uniqueUsername(normalizeUsername(displayName || discordUser.username));
    const user = await this.createUserWithPlayer({
      email,
      username,
      displayName,
      discordId: discordUser.id,
    });
    return { session: await this.sessionForUser(user.id), tokens: await this.issueTokens(user.id) };
  }

  async requestPasswordReset(email: string): Promise<void> {
    const cleanEmail = normalizeEmail(email);
    const user = await this.prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) return;

    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_MS),
      },
    });
    const resetUrl = `${this.env.clientOrigin}/?auth=reset&token=${encodeURIComponent(token)}`;
    await this.mail.sendPasswordReset(cleanEmail, resetUrl);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    requirePassword(password);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException('Reset token is invalid or expired.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.env.jwtRefreshSecret,
      });
      if (payload.typ !== 'refresh' || !payload.sub || !payload.jti || !payload.fam) {
        throw new Error('wrong token type');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Refresh token is invalid.');
    }
  }

  private async issueTokens(userId: string, familyId: string = randomUUID()): Promise<IssuedAuthTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, typ: 'access' } satisfies AccessTokenPayload,
      { expiresIn: '15m', secret: this.env.jwtAccessSecret },
    );
    const refreshId = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, typ: 'refresh', jti: refreshId, fam: familyId } satisfies RefreshTokenPayload,
      { expiresIn: '30d', secret: this.env.jwtRefreshSecret },
    );
    await this.prisma.refreshToken.create({
      data: {
        id: refreshId,
        userId,
        tokenHash: sha256(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + REFRESH_COOKIE_MS),
      },
    });
    return { accessToken, refreshToken };
  }

  private async refreshTokenId(refreshToken: string): Promise<string> {
    const payload = await this.verifyRefreshToken(refreshToken);
    return payload.jti;
  }

  private async createUserWithPlayer(data: {
    email: string | null;
    username: string;
    displayName: string;
    passwordHash?: string;
    discordId?: string;
  }): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          username: data.username,
          displayName: data.displayName,
          passwordHash: data.passwordHash,
          discordId: data.discordId,
        },
      });
      const player = await tx.player.create({
        data: {
          userId: user.id,
          handle: data.username,
          displayName: data.displayName,
          currentInstanceId: `apartment:${user.id}`,
          currentRoomId: 'hab-room',
        },
      });
      await tx.ship.create({
        data: {
          playerId: player.id,
          prefabId: STARTER_SHIP_PREFAB_ID,
          displayName: STARTER_SHIP_NAME,
          currentInstanceId: `hangar:${player.id}`,
        },
      });
      await tx.player.update({
        where: { id: player.id },
        data: { currentInstanceId: `apartment:${player.id}` },
      });
      return user;
    });
  }

  private async sessionForUser(userId: string): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { player: true },
    });
    if (!user?.player) throw new UnauthorizedException('Account has no player.');
    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
      },
      player: {
        id: user.player.id,
        handle: user.player.handle,
        displayName: user.player.displayName,
      },
    };
  }

  private async uniqueUsername(base: string): Promise<string> {
    const seed = base.length >= 3 ? base : `pilot-${base || 'discord'}`;
    for (let i = 0; i < 50; i += 1) {
      const candidate = i === 0 ? seed : `${seed}-${i + 1}`;
      const exists = await this.prisma.user.findUnique({ where: { username: candidate } });
      if (!exists) return candidate;
    }
    return `pilot-${randomBytes(5).toString('hex')}`;
  }
}
