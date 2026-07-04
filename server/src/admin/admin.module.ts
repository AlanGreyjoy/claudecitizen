import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GameModule } from '../game/game.module';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Module({
  imports: [JwtModule.register({}), GameModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
  exports: [AdminService, AdminGuard],
})
export class AdminModule {}
