import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { GameModule } from './game/game.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { SharedModule } from './shared/shared.module';
import { WorldModule } from './world/world.module';

@Module({
  imports: [SharedModule, PrismaModule, RedisModule, AuthModule, GameModule, WorldModule],
})
export class AppModule {}
