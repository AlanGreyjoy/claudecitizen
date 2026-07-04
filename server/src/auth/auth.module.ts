import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { HttpAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, HttpAuthGuard, MailService],
  exports: [AuthService, HttpAuthGuard],
})
export class AuthModule {}
