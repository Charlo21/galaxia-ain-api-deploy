import { Response, NextFunction } from 'express';
import { TenantRequest } from '../auth/requireAuth';
import {
  checkDistributedRateLimit,
  rateLimitConfigured,
  requireDistributedRateLimit,
} from '../infra/rateLimitDistributed';

type LimitSpec = { key: string; limit: number; windowSec: number };

function limitKey(req: TenantRequest, suffix: string): string {
  const org = req.auth?.organizationId || 'anon';
  const ip = req.ip || 'unknown';
  return `${suffix}:${org}:${ip}`;
}

export function tenantRateLimit(spec: LimitSpec) {
  return async (req: TenantRequest, res: Response, next: NextFunction): Promise<void> => {
    if (requireDistributedRateLimit() && !rateLimitConfigured()) {
      res.status(503).json({
        ok: false,
        code: 'RATE_LIMIT_UNAVAILABLE',
        error: 'Distributed rate limiting required but not configured',
      });
      return;
    }

    const rl = await checkDistributedRateLimit(limitKey(req, spec.key), spec.limit, spec.windowSec);
    if (rl && !rl.allowed) {
      if (rl.retryAfterSec) res.setHeader('Retry-After', String(rl.retryAfterSec));
      res.status(429).json({
        ok: false,
        code: 'RATE_LIMITED',
        error: 'Too many requests',
        mode: rl.mode,
      });
      return;
    }
    next();
  };
}

export const tenantLimits = {
  read: tenantRateLimit({ key: 'tenant-read', limit: 120, windowSec: 60 }),
  write: tenantRateLimit({ key: 'tenant-write', limit: 30, windowSec: 60 }),
  inference: tenantRateLimit({ key: 'tenant-inference', limit: 20, windowSec: 60 }),
  credentials: tenantRateLimit({ key: 'tenant-creds', limit: 10, windowSec: 3600 }),
};
