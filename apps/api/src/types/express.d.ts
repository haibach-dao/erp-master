// Augment Express Request with the per-request correlation id.
import 'express';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

export {};
