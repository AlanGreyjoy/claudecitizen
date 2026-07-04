import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { EnvService } from '../shared/env.service';
import { AuthService, type IssuedAuthTokens } from './auth.service';
import { HttpAuthGuard } from './auth.guard';
import type { AuthenticatedRequest } from './auth.types';

function readString(body: unknown, key: string): string {
  if (typeof body !== 'object' || body === null) return '';
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(EnvService) private readonly env: EnvService,
  ) {}

  @Post('register')
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(
      readString(body, 'email'),
      readString(body, 'username'),
      readString(body, 'password'),
    );
    this.writeAuthCookies(res, result.tokens);
    return result.session;
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(readString(body, 'identifier'), readString(body, 'password'));
    this.writeAuthCookies(res, result.tokens);
    return result.session;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.cc_rt);
    this.clearAuthCookies(res);
  }

  @Get('me')
  @UseGuards(HttpAuthGuard)
  async me(@Req() req: AuthenticatedRequest) {
    return this.auth.me(req.user!.sub);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.refresh(req.cookies?.cc_rt);
    this.writeAuthCookies(res, result.tokens);
    return result.session;
  }

  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body() body: unknown) {
    await this.auth.requestPasswordReset(readString(body, 'email'));
    return { ok: true };
  }

  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    await this.auth.resetPassword(readString(body, 'token'), readString(body, 'password'));
    this.clearAuthCookies(res);
  }

  @Get('discord/start')
  async discordStart(@Res() res: Response) {
    res.redirect(await this.auth.startDiscordLogin());
  }

  @Get('discord/callback')
  async discordCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    try {
      const result = await this.auth.finishDiscordLogin(code ?? '', state ?? '');
      this.writeAuthCookies(res, result.tokens);
      res.redirect(`${this.env.clientOrigin}/?auth=discord-success`);
    } catch (error) {
      const reason = encodeURIComponent(error instanceof Error ? error.message : 'discord_failed');
      res.redirect(`${this.env.clientOrigin}/?auth=discord-error&reason=${reason}`);
    }
  }

  private writeAuthCookies(res: Response, tokens: IssuedAuthTokens): void {
    res.cookie('cc_at', tokens.accessToken, this.env.authCookieOptions(this.auth.accessCookieMs));
    res.cookie('cc_rt', tokens.refreshToken, this.env.authCookieOptions(this.auth.refreshCookieMs));
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie('cc_at', this.env.clearCookieOptions());
    res.clearCookie('cc_rt', this.env.clearCookieOptions());
  }
}
