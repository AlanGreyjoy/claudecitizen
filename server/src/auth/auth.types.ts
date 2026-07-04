import type { Request } from 'express';

export interface AccessTokenPayload {
  sub: string;
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  typ: 'refresh';
  jti: string;
  fam: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}

export interface PublicPlayerProfile {
  id: string;
  handle: string;
  displayName: string;
}

export interface AuthSession {
  user: {
    id: string;
    email: string | null;
    username: string;
    displayName: string;
  };
  player: PublicPlayerProfile;
}
