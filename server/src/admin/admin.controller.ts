import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { EnvService } from '../shared/env.service';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

const PREFAB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function readString(body: unknown, key: string): string {
  if (typeof body !== 'object' || body === null) return '';
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readOptionalString(body: unknown, key: string): string | undefined {
  const value = readString(body, key);
  return value.length > 0 ? value : undefined;
}

function readFiniteNumber(body: unknown, key: string): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requirePrefabId(value: string): string {
  if (!PREFAB_ID_PATTERN.test(value)) {
    throw new Error('Prefab id is invalid.');
  }
  return value;
}

function requireText(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed.slice(0, maxLength);
}

function requireInteger(value: number | null, label: string, min: number, max: number): number {
  if (value === null) throw new Error(`${label} is required.`);
  return Math.min(max, Math.max(min, Math.round(value)));
}

function requireFloat(value: number | null, label: string, min: number, max: number): number {
  if (value === null) throw new Error(`${label} is required.`);
  return Math.min(max, Math.max(min, value));
}

function readStringArray(body: unknown, key: string): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const value = (body as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return [...unique];
}

function parseShipDefinitionCreate(body: unknown) {
  return {
    name: requireText(readString(body, 'name'), 'Name', 80),
    description: requireText(readString(body, 'description'), 'Description', 2_000),
    prefabId: requirePrefabId(readString(body, 'prefabId')),
    costArc: requireInteger(readFiniteNumber(body, 'costArc'), 'Cost', 0, 2_000_000_000),
    maxHp: requireFloat(readFiniteNumber(body, 'maxHp'), 'Max HP', 1, 100_000),
    maxShields: requireFloat(readFiniteNumber(body, 'maxShields'), 'Max shields', 0, 100_000),
    shieldRegenPerSec: requireFloat(
      readFiniteNumber(body, 'shieldRegenPerSec'),
      'Shield regen',
      0,
      10_000,
    ),
    maxSpeedMps: requireFloat(readFiniteNumber(body, 'maxSpeedMps'), 'Max speed', 5, 500),
    throttleAccelMps2: requireFloat(
      readFiniteNumber(body, 'throttleAccelMps2'),
      'Acceleration',
      1,
      10_000,
    ),
  };
}

function parseShipDefinitionPatch(body: unknown) {
  const next: {
    name?: string;
    description?: string;
    prefabId?: string;
    costArc?: number;
    maxHp?: number;
    maxShields?: number;
    shieldRegenPerSec?: number;
    maxSpeedMps?: number;
    throttleAccelMps2?: number;
  } = {};

  const name = readOptionalString(body, 'name');
  if (name !== undefined) next.name = requireText(name, 'Name', 80);

  const description = readOptionalString(body, 'description');
  if (description !== undefined) next.description = requireText(description, 'Description', 2_000);

  const prefabId = readOptionalString(body, 'prefabId');
  if (prefabId !== undefined) next.prefabId = requirePrefabId(prefabId);

  const costArc = readFiniteNumber(body, 'costArc');
  if (costArc !== null) next.costArc = requireInteger(costArc, 'Cost', 0, 2_000_000_000);

  const maxHp = readFiniteNumber(body, 'maxHp');
  if (maxHp !== null) next.maxHp = requireFloat(maxHp, 'Max HP', 1, 100_000);

  const maxShields = readFiniteNumber(body, 'maxShields');
  if (maxShields !== null) {
    next.maxShields = requireFloat(maxShields, 'Max shields', 0, 100_000);
  }

  const shieldRegenPerSec = readFiniteNumber(body, 'shieldRegenPerSec');
  if (shieldRegenPerSec !== null) {
    next.shieldRegenPerSec = requireFloat(shieldRegenPerSec, 'Shield regen', 0, 10_000);
  }

  const maxSpeedMps = readFiniteNumber(body, 'maxSpeedMps');
  if (maxSpeedMps !== null) {
    next.maxSpeedMps = requireFloat(maxSpeedMps, 'Max speed', 5, 500);
  }

  const throttleAccelMps2 = readFiniteNumber(body, 'throttleAccelMps2');
  if (throttleAccelMps2 !== null) {
    next.throttleAccelMps2 = requireFloat(
      throttleAccelMps2,
      'Acceleration',
      1,
      10_000,
    );
  }

  return next;
}

function parseSettingsUpdate(body: unknown) {
  return {
    startingArcBalance: requireInteger(
      readFiniteNumber(body, 'startingArcBalance'),
      'Starting ARC',
      0,
      2_000_000_000,
    ),
    starterShipDefinitionIds: readStringArray(body, 'starterShipDefinitionIds'),
  };
}

@Controller('admin')
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(EnvService) private readonly env: EnvService,
  ) {}

  @Post('session')
  @HttpCode(200)
  async createSession(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const result = await this.admin.login(
      readString(body, 'email'),
      readString(body, 'password'),
    );
    res.cookie(
      'cc_admin',
      result.token,
      this.env.authCookieOptions(this.admin.sessionCookieMs),
    );
    return result.session;
  }

  @Get('session')
  @UseGuards(AdminGuard)
  async getSession() {
    return this.admin.session();
  }

  @Delete('session')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async deleteSession(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('cc_admin', this.env.clearCookieOptions());
  }

  @Get('users')
  @UseGuards(AdminGuard)
  async listUsers() {
    return this.admin.listUsers();
  }

  @Get('users/:id')
  @UseGuards(AdminGuard)
  async getUser(@Param('id') id: string) {
    return this.admin.getUser(id);
  }

  @Get('ships')
  @UseGuards(AdminGuard)
  async listShips() {
    return this.admin.listShipDefinitions();
  }

  @Post('ships')
  @UseGuards(AdminGuard)
  async createShip(@Body() body: unknown) {
    try {
      return this.admin.createShipDefinition(parseShipDefinitionCreate(body));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Ship definition is invalid.',
      );
    }
  }

  @Patch('ships/:id')
  @UseGuards(AdminGuard)
  async updateShip(@Param('id') id: string, @Body() body: unknown) {
    try {
      return this.admin.updateShipDefinition(id, parseShipDefinitionPatch(body));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Ship definition update is invalid.',
      );
    }
  }

  @Get('settings')
  @UseGuards(AdminGuard)
  async getSettings() {
    return this.admin.getSettings();
  }

  @Put('settings')
  @UseGuards(AdminGuard)
  async updateSettings(@Body() body: unknown) {
    try {
      return this.admin.updateSettings(parseSettingsUpdate(body));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Game settings are invalid.',
      );
    }
  }
}
