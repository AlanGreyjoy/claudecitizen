import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { HttpAuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { GameHangarService } from './game.hangar.service';
import { GameService } from './game.service';

function readString(body: unknown, key: string): string {
  if (typeof body !== 'object' || body === null) return '';
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readFiniteNumber(body: unknown, key: string): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parsePlacementTransform(body: unknown) {
  const right = readFiniteNumber(body, 'right');
  const up = readFiniteNumber(body, 'up');
  const forward = readFiniteNumber(body, 'forward');
  const rotationY = readFiniteNumber(body, 'rotationY') ?? 0;
  if (right === null || up === null || forward === null) {
    throw new BadRequestException('Placement transform requires right, up, and forward.');
  }
  return { right, up, forward, rotationY };
}

@Controller('game')
export class GameController {
  constructor(
    @Inject(GameService) private readonly game: GameService,
    @Inject(GameHangarService) private readonly hangar: GameHangarService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private async requirePlayerId(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { player: { select: { id: true } } },
    });
    if (!user?.player) throw new UnauthorizedException('Account has no player.');
    return user.player.id;
  }

  @Get('bootstrap')
  @UseGuards(HttpAuthGuard)
  async bootstrap(@Req() req: AuthenticatedRequest) {
    return this.game.bootstrapForUser(req.user!.sub);
  }

  @Get('hangar/build')
  @UseGuards(HttpAuthGuard)
  async getHangarBuild(@Req() req: AuthenticatedRequest) {
    const playerId = await this.requirePlayerId(req.user!.sub);
    return this.hangar.getBuildState(playerId);
  }

  @Post('hangar/purchase')
  @UseGuards(HttpAuthGuard)
  async purchaseProp(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const propDefinitionId = readString(body, 'propDefinitionId');
    if (!propDefinitionId) throw new BadRequestException('propDefinitionId is required.');
    const playerId = await this.requirePlayerId(req.user!.sub);
    return this.hangar.purchaseProp(playerId, propDefinitionId);
  }

  @Post('hangar/placements')
  @UseGuards(HttpAuthGuard)
  async createPlacement(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const propDefinitionId = readString(body, 'propDefinitionId');
    if (!propDefinitionId) throw new BadRequestException('propDefinitionId is required.');
    const transform = parsePlacementTransform(body);
    const playerId = await this.requirePlayerId(req.user!.sub);
    return this.hangar.createPlacement(playerId, propDefinitionId, transform);
  }

  @Patch('hangar/placements/:id')
  @UseGuards(HttpAuthGuard)
  async updatePlacement(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const transform = parsePlacementTransform(body);
    const playerId = await this.requirePlayerId(req.user!.sub);
    return this.hangar.updatePlacement(playerId, id, transform);
  }

  @Delete('hangar/placements/:id')
  @UseGuards(HttpAuthGuard)
  async deletePlacement(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const playerId = await this.requirePlayerId(req.user!.sub);
    return this.hangar.deletePlacement(playerId, id);
  }

  @Post('hangar/assigned-bay')
  @UseGuards(HttpAuthGuard)
  async setAssignedBay(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const hangarIndex = readFiniteNumber(body, 'hangarIndex');
    if (hangarIndex === null) throw new BadRequestException('hangarIndex is required.');
    const playerId = await this.requirePlayerId(req.user!.sub);
    await this.hangar.setAssignedHangar(playerId, Math.round(hangarIndex));
    return this.hangar.getBuildState(playerId);
  }
}
