import type { Request } from 'express';

export interface AdminSessionPayload {
  sub: string;
  typ: 'admin';
}

export interface AdminAuthenticatedRequest extends Request {
  admin?: AdminSessionPayload;
}

export interface AdminSessionDto {
  email: string;
}
