import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { HttpAuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GameService } from './game.service';

@Controller('game')
export class GameController {
  constructor(private readonly game: GameService) {}

  @Get('bootstrap')
  @UseGuards(HttpAuthGuard)
  async bootstrap(@Req() req: AuthenticatedRequest) {
    return this.game.bootstrapForUser(req.user!.sub);
  }
}
