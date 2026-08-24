import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';

// Functional middleware: reuse an incoming correlation id or generate one, expose it
// on the request and echo it back in the response header for tracing.
export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[CORRELATION_HEADER];
  const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  req.correlationId = id;
  res.setHeader('X-Correlation-ID', id);
  next();
}
