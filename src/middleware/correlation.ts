/**
 * Correlation ID + deployment provenance middleware (Galaxia ID parity).
 */
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function getCommitSha(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'unknown';
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming =
    (req.headers['x-correlation-id'] as string) ||
    (req.headers['x-request-id'] as string) ||
    uuidv4();

  (req as any).id = incoming;
  (req as any).correlationId = incoming;

  res.setHeader('X-Correlation-Id', incoming);
  res.setHeader('X-Request-Id', incoming);
  res.setHeader('X-Galaxia-Commit', getCommitSha());
  res.setHeader('X-Galaxia-Service', 'galaxia-ai-api-server');

  next();
}
