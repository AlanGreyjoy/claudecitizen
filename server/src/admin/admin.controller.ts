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
import { ITEM_TYPES, WEAPON_SLOT_TYPES } from '../game/game.catalog.service';
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

function readNullableString(body: unknown, key: string): string | null | undefined {
  if (typeof body !== 'object' || body === null || !(key in body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  if (value === null) return null;
  return typeof value === 'string' ? value.trim() : undefined;
}

function requireItemType(value: string): (typeof ITEM_TYPES)[number] {
  const trimmed = value.trim();
  if (!(ITEM_TYPES as readonly string[]).includes(trimmed)) {
    throw new Error('Item type is invalid.');
  }
  return trimmed as (typeof ITEM_TYPES)[number];
}

function requireWeaponSlotType(value: string): (typeof WEAPON_SLOT_TYPES)[number] {
  const trimmed = value.trim();
  if (!(WEAPON_SLOT_TYPES as readonly string[]).includes(trimmed)) {
    throw new Error('Weapon slot type is invalid.');
  }
  return trimmed as (typeof WEAPON_SLOT_TYPES)[number];
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
    starterPropDefinitionIds: readStringArray(body, 'starterPropDefinitionIds'),
    starterItemDefinitionIds: readStringArray(body, 'starterItemDefinitionIds'),
  };
}

function parsePropDefinitionCreate(body: unknown) {
  const maxPerHangarRaw = readFiniteNumber(body, 'maxPerHangar');
  const snapGridRaw = readFiniteNumber(body, 'snapGridM');
  return {
    name: requireText(readString(body, 'name'), 'Name', 80),
    description: requireText(readString(body, 'description'), 'Description', 2_000),
    prefabId: requirePrefabId(readString(body, 'prefabId')),
    costArc: requireInteger(readFiniteNumber(body, 'costArc'), 'Cost', 0, 2_000_000_000),
    category: requireText(readString(body, 'category') || 'decoration', 'Category', 40),
    maxPerHangar:
      maxPerHangarRaw === null ? null : requireInteger(maxPerHangarRaw, 'Max per space', 1, 64),
    allowRotateY: readString(body, 'allowRotateY') !== 'false',
    snapGridM: snapGridRaw === null ? null : requireFloat(snapGridRaw, 'Snap grid', 0.1, 4),
  };
}

function parsePropDefinitionPatch(body: unknown) {
  const next: {
    name?: string;
    description?: string;
    prefabId?: string;
    costArc?: number;
    category?: string;
    maxPerHangar?: number | null;
    allowRotateY?: boolean;
    snapGridM?: number | null;
  } = {};

  const name = readOptionalString(body, 'name');
  if (name !== undefined) next.name = requireText(name, 'Name', 80);

  const description = readOptionalString(body, 'description');
  if (description !== undefined) next.description = requireText(description, 'Description', 2_000);

  const prefabId = readOptionalString(body, 'prefabId');
  if (prefabId !== undefined) next.prefabId = requirePrefabId(prefabId);

  const costArc = readFiniteNumber(body, 'costArc');
  if (costArc !== null) next.costArc = requireInteger(costArc, 'Cost', 0, 2_000_000_000);

  const category = readOptionalString(body, 'category');
  if (category !== undefined) next.category = requireText(category, 'Category', 40);

  if (typeof body === 'object' && body !== null && 'maxPerHangar' in body) {
    const maxPerHangar = readFiniteNumber(body, 'maxPerHangar');
    next.maxPerHangar =
      maxPerHangar === null ? null : requireInteger(maxPerHangar, 'Max per space', 1, 64);
  }

  if (typeof body === 'object' && body !== null && 'allowRotateY' in body) {
    next.allowRotateY = readString(body, 'allowRotateY') !== 'false';
  }

  if (typeof body === 'object' && body !== null && 'snapGridM' in body) {
    const snapGridM = readFiniteNumber(body, 'snapGridM');
    next.snapGridM = snapGridM === null ? null : requireFloat(snapGridM, 'Snap grid', 0.1, 4);
  }

  return next;
}

function parseItemDefinitionCreate(body: unknown) {
  const prefabRaw = readNullableString(body, 'prefabId');
  const iconRaw = readNullableString(body, 'iconUrl');
  return {
    name: requireText(readString(body, 'name'), 'Name', 80),
    description: requireText(readString(body, 'description'), 'Description', 2_000),
    itemType: requireItemType(readString(body, 'itemType') || 'misc'),
    subType: requireText(readString(body, 'subType') || 'generic', 'Sub-type', 40),
    prefabId:
      prefabRaw === undefined || prefabRaw === null || prefabRaw === ''
        ? null
        : requirePrefabId(prefabRaw),
    iconUrl:
      iconRaw === undefined || iconRaw === null || iconRaw === ''
        ? null
        : iconRaw.slice(0, 512),
    stackMax: requireInteger(readFiniteNumber(body, 'stackMax') ?? 99, 'Stack max', 1, 9_999),
    costArc: requireInteger(readFiniteNumber(body, 'costArc') ?? 0, 'Cost', 0, 2_000_000_000),
    rarity: requireText(readString(body, 'rarity') || 'common', 'Rarity', 24),
  };
}

function parseItemDefinitionPatch(body: unknown) {
  const next: {
    name?: string;
    description?: string;
    itemType?: (typeof ITEM_TYPES)[number];
    subType?: string;
    prefabId?: string | null;
    iconUrl?: string | null;
    stackMax?: number;
    costArc?: number;
    rarity?: string;
  } = {};

  const name = readOptionalString(body, 'name');
  if (name !== undefined) next.name = requireText(name, 'Name', 80);

  const description = readOptionalString(body, 'description');
  if (description !== undefined) next.description = requireText(description, 'Description', 2_000);

  const itemType = readOptionalString(body, 'itemType');
  if (itemType !== undefined) next.itemType = requireItemType(itemType);

  const subType = readOptionalString(body, 'subType');
  if (subType !== undefined) next.subType = requireText(subType, 'Sub-type', 40);

  if (typeof body === 'object' && body !== null && 'prefabId' in body) {
    const prefabId = readNullableString(body, 'prefabId');
    next.prefabId =
      prefabId === undefined || prefabId === null || prefabId === ''
        ? null
        : requirePrefabId(prefabId);
  }

  if (typeof body === 'object' && body !== null && 'iconUrl' in body) {
    const iconUrl = readNullableString(body, 'iconUrl');
    next.iconUrl =
      iconUrl === undefined || iconUrl === null || iconUrl === ''
        ? null
        : iconUrl.slice(0, 512);
  }

  const stackMax = readFiniteNumber(body, 'stackMax');
  if (stackMax !== null) next.stackMax = requireInteger(stackMax, 'Stack max', 1, 9_999);

  const costArc = readFiniteNumber(body, 'costArc');
  if (costArc !== null) next.costArc = requireInteger(costArc, 'Cost', 0, 2_000_000_000);

  const rarity = readOptionalString(body, 'rarity');
  if (rarity !== undefined) next.rarity = requireText(rarity, 'Rarity', 24);

  return next;
}

function parseSpecializedItemCreate(body: unknown) {
  const prefabId = requirePrefabId(readString(body, 'prefabId'));
  const iconRaw = readNullableString(body, 'iconUrl');
  return {
    name: requireText(readString(body, 'name'), 'Name', 80),
    description: requireText(readString(body, 'description'), 'Description', 2_000),
    subType: requireText(readString(body, 'subType') || 'generic', 'Sub-type', 40),
    prefabId,
    iconUrl:
      iconRaw === undefined || iconRaw === null || iconRaw === ''
        ? null
        : iconRaw.slice(0, 512),
    costArc: requireInteger(readFiniteNumber(body, 'costArc') ?? 0, 'Cost', 0, 2_000_000_000),
    rarity: requireText(readString(body, 'rarity') || 'common', 'Rarity', 24),
  };
}

function parseSpecializedItemPatch(body: unknown) {
  const next: {
    name?: string;
    description?: string;
    subType?: string;
    prefabId?: string;
    iconUrl?: string | null;
    costArc?: number;
    rarity?: string;
  } = {};
  const name = readOptionalString(body, 'name');
  if (name !== undefined) next.name = requireText(name, 'Name', 80);
  const description = readOptionalString(body, 'description');
  if (description !== undefined) next.description = requireText(description, 'Description', 2_000);
  const subType = readOptionalString(body, 'subType');
  if (subType !== undefined) next.subType = requireText(subType, 'Sub-type', 40);
  const prefabId = readOptionalString(body, 'prefabId');
  if (prefabId !== undefined) next.prefabId = requirePrefabId(prefabId);
  if (typeof body === 'object' && body !== null && 'iconUrl' in body) {
    const iconUrl = readNullableString(body, 'iconUrl');
    next.iconUrl = iconUrl ? iconUrl.slice(0, 512) : null;
  }
  const costArc = readFiniteNumber(body, 'costArc');
  if (costArc !== null) next.costArc = requireInteger(costArc, 'Cost', 0, 2_000_000_000);
  const rarity = readOptionalString(body, 'rarity');
  if (rarity !== undefined) next.rarity = requireText(rarity, 'Rarity', 24);
  return next;
}

function parseWeaponDefinitionCreate(body: unknown) {
  return {
    ...parseSpecializedItemCreate(body),
    weaponSlotType: requireWeaponSlotType(readString(body, 'weaponSlotType')),
  };
}

function parseWeaponDefinitionPatch(body: unknown) {
  const next = parseSpecializedItemPatch(body);
  const weaponSlotType = readOptionalString(body, 'weaponSlotType');
  return {
    ...next,
    ...(weaponSlotType === undefined
      ? {}
      : { weaponSlotType: requireWeaponSlotType(weaponSlotType) }),
  };
}

function parseBackpackDefinitionCreate(body: unknown) {
  return {
    ...parseSpecializedItemCreate(body),
    capacityLiters: requireFloat(
      readFiniteNumber(body, 'capacityLiters'),
      'Capacity',
      0.1,
      100_000,
    ),
    emptyMassKg: requireFloat(
      readFiniteNumber(body, 'emptyMassKg'),
      'Empty mass',
      0.01,
      10_000,
    ),
  };
}

function parseBackpackDefinitionPatch(body: unknown) {
  const next = parseSpecializedItemPatch(body);
  const capacityLiters = readFiniteNumber(body, 'capacityLiters');
  const emptyMassKg = readFiniteNumber(body, 'emptyMassKg');
  return {
    ...next,
    ...(capacityLiters === null
      ? {}
      : { capacityLiters: requireFloat(capacityLiters, 'Capacity', 0.1, 100_000) }),
    ...(emptyMassKg === null
      ? {}
      : { emptyMassKg: requireFloat(emptyMassKg, 'Empty mass', 0.01, 10_000) }),
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

  @Get('props')
  @UseGuards(AdminGuard)
  async listProps() {
    return this.admin.listPropDefinitions();
  }

  @Post('props')
  @UseGuards(AdminGuard)
  async createProp(@Body() body: unknown) {
    try {
      return this.admin.createPropDefinition(parsePropDefinitionCreate(body));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Prop definition is invalid.',
      );
    }
  }

  @Patch('props/:id')
  @UseGuards(AdminGuard)
  async updateProp(@Param('id') id: string, @Body() body: unknown) {
    try {
      return this.admin.updatePropDefinition(id, parsePropDefinitionPatch(body));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Prop definition update is invalid.',
      );
    }
  }

  @Get('items')
  @UseGuards(AdminGuard)
  async listItems() {
    return this.admin.listItemDefinitions();
  }

  @Post('items')
  @UseGuards(AdminGuard)
  async createItem(@Body() body: unknown) {
    try {
      return this.admin.createItemDefinition(parseItemDefinitionCreate(body));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Item definition is invalid.',
      );
    }
  }

  @Patch('items/:id')
  @UseGuards(AdminGuard)
  async updateItem(@Param('id') id: string, @Body() body: unknown) {
    try {
      return this.admin.updateItemDefinition(id, parseItemDefinitionPatch(body));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Item definition update is invalid.',
      );
    }
  }

  @Delete('items/:id')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async deleteItem(@Param('id') id: string) {
    try {
      await this.admin.deleteItemDefinition(id);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Item definition delete failed.',
      );
    }
  }

  @Get('weapons')
  @UseGuards(AdminGuard)
  async listWeapons() {
    return this.admin.listWeaponDefinitions();
  }

  @Post('weapons')
  @UseGuards(AdminGuard)
  async createWeapon(@Body() body: unknown) {
    try {
      return this.admin.createWeaponDefinition(parseWeaponDefinitionCreate(body));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Weapon definition is invalid.',
      );
    }
  }

  @Patch('weapons/:id')
  @UseGuards(AdminGuard)
  async updateWeapon(@Param('id') id: string, @Body() body: unknown) {
    try {
      return this.admin.updateWeaponDefinition(id, parseWeaponDefinitionPatch(body));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Weapon definition update is invalid.',
      );
    }
  }

  @Delete('weapons/:id')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async deleteWeapon(@Param('id') id: string) {
    await this.admin.deleteWeaponDefinition(id);
  }

  @Get('backpacks')
  @UseGuards(AdminGuard)
  async listBackpacks() {
    return this.admin.listBackpackDefinitions();
  }

  @Post('backpacks')
  @UseGuards(AdminGuard)
  async createBackpack(@Body() body: unknown) {
    try {
      return this.admin.createBackpackDefinition(parseBackpackDefinitionCreate(body));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Backpack definition is invalid.',
      );
    }
  }

  @Patch('backpacks/:id')
  @UseGuards(AdminGuard)
  async updateBackpack(@Param('id') id: string, @Body() body: unknown) {
    try {
      return this.admin.updateBackpackDefinition(id, parseBackpackDefinitionPatch(body));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Backpack definition update is invalid.',
      );
    }
  }

  @Delete('backpacks/:id')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async deleteBackpack(@Param('id') id: string) {
    await this.admin.deleteBackpackDefinition(id);
  }
}
