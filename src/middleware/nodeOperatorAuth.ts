/**
 * Optional API key gate for node operator endpoints in production-like mode.
 */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function requireNodeOperatorSecret(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const required = (process.env.REQUIRE_NODE_OPERATOR_SECRET || 'false').toLowerCase() === 'true';
  if (!required) {
    next();
    return;
  }

  const expected = process.env.NODE_OPERATOR_SECRET || '';
  if (!expected) {
    res.status(503).json({
      ok: false,
      code: 'PROVIDER_NOT_CONFIGURED',
      error: 'NODE_OPERATOR_SECRET required but not configured',
      mode: 'testnet-preview',
    });
    return;
  }

  const provided =
    (req.headers['x-node-operator-secret'] as string) ||
    (req.headers['authorization']?.replace(/^Bearer\s+/i, '') ?? '');

  if (!provided) {
    res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Node operator secret required' });
    return;
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'Invalid node operator secret' });
    return;
  }

  next();
}
