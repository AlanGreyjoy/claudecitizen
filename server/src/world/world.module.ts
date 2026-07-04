import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameModule } from '../game/game.module';
import { WorldGateway } from './world.gateway';
import { WorldService } from './world.service';

@Module({
  imports: [AuthModule, GameModule],
  providers: [WorldGateway, WorldService],
})
export class WorldModule {}
