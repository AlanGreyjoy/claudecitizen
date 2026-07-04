import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from './admin.service';
import type { AdminAuthenticatedRequest } from './admin.types';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminAuthenticatedRequest & Request>();
    const token = request.cookies?.cc_admin;
    if (typeof token !== 'string') {
      throw new UnauthorizedException('Missing admin session cookie');
    }
    request.admin = await this.admin.verifySessionToken(token);
    return true;
  }
}
