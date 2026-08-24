// Augment Express Request with per-request correlation id and authenticated user.
import 'express';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      user?: { userId: string; email: string; sid: string };
    }
  }
}

export {};
