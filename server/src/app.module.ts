import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { GameModule } from './game/game.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { EnvService } from './shared/env.service';
import { createLoggerParams } from './shared/logger.config';
import { SharedModule } from './shared/shared.module';
import { WorldModule } from './world/world.module';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [SharedModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => createLoggerParams(env),
    }),
    SharedModule,
    PrismaModule,
    RedisModule,
    AdminModule,
    AuthModule,
    GameModule,
    WorldModule,
  ],
})
export class AppModule {}
