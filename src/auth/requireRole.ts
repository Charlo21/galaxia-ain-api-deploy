import { Response, NextFunction } from 'express';
import { OrgRole } from './types';
import { requireRole as checkRole, AuthorizationError } from './authorize';
import { TenantRequest, authErrorHandler } from './requireAuth';

export function requireRole(...roles: OrgRole[]) {
  return (req: TenantRequest, res: Response, next: NextFunction): void => {
    try {
      if (!req.auth) {
        res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Authentication required' });
        return;
      }
      checkRole(req.auth, ...roles);
      next();
    } catch (err) {
      if (!authErrorHandler(err, res)) {
        res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Authorization error' });
      }
    }
  };
}
