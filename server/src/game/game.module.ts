import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameCatalogService } from './game.catalog.service';
import { GameController } from './game.controller';
import { GameService } from './game.service';

@Module({
  imports: [AuthModule],
  controllers: [GameController],
  providers: [GameService, GameCatalogService],
  exports: [GameService, GameCatalogService],
})
export class GameModule {}
