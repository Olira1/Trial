import type { Request } from 'express';
import type { User } from '../user';

export type AuthenticatedRequest = Request & {
  user: User;
  sessionId: string;
  deviceId: string | null;
};
