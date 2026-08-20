import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../config/database';
import { AuthContext, OrgRole } from './types';
import { AuthorizationError } from './authorize';
import { authFromBearerJwt } from './jwtValidator';
import { rejectUntrustedClientHeaders } from '../security/apiRegistry';

export interface TenantRequest extends Request {
  auth?: AuthContext;
  id?: string;
}

/** Reject client-supplied identity headers on tenant routes. */
export function rejectSpoofHeaders(req: TenantRequest, res: Response, next: NextFunction): void {
  const msg = rejectUntrustedClientHeaders(req.headers as Record<string, unknown>);
  if (msg && req.path.startsWith('/v1/tenant')) {
    res.status(403).json({ ok: false, code: 'IDENTITY_SPOOF_REJECTED', error: msg });
    return;
  }
  next();
}

async function authFromApiCredential(rawKey: string): Promise<AuthContext | null> {
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const result = await pool.query(
    `SELECT c.*, o.status as org_status
     FROM api_credentials c
     JOIN organizations o ON o.id = c.organization_id
     WHERE c.key_hash = $1 AND c.is_active = true AND c.revoked_at IS NULL`,
    [keyHash]
  );
  if (!result.rows.length) {
    return null;
  }
  const row = result.rows[0];
  if (row.org_status !== 'active') return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  await pool.query('UPDATE api_credentials SET last_used_at = NOW() WHERE id = $1', [row.id]);
  return {
    userId: row.created_by || row.id,
    organizationId: row.organization_id,
    role: 'API_SERVICE_ACCOUNT',
    projectId: row.project_id || undefined,
    credentialId: row.id,
    scopes: row.scopes || [],
    requestId: crypto.randomUUID(),
  };
}

/** Dev-only header auth for integration tests — disabled in production. */
function authFromDevHeaders(req: Request): AuthContext | null {
  if (process.env.NODE_ENV === 'production') return null;
  if (process.env.ALLOW_DEV_AUTH !== 'true') return null;
  const org = req.headers['x-dev-org-id'] as string;
  const user = req.headers['x-dev-user-id'] as string;
  const role = (req.headers['x-dev-role'] as OrgRole) || 'ADMIN';
  if (!org || !user) return null;
  return {
    userId: user,
    organizationId: org,
    role,
    scopes: [],
    requestId: crypto.randomUUID(),
  };
}

export async function requireAuth(
  req: TenantRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'] as string;
    let ctx: AuthContext | null = null;

    // Bearer JWT — never fall back to API key on failure
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      ctx = await authFromBearerJwt(token);
      if (!ctx) {
        res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Invalid or expired Bearer token' });
        return;
      }
      req.auth = ctx;
      next();
      return;
    }

    if (apiKey) {
      ctx = await authFromApiCredential(apiKey);
    }

    if (!ctx) {
      ctx = authFromDevHeaders(req);
    }

    if (!ctx) {
      res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Authentication required' });
      return;
    }

    req.auth = ctx;
    next();
  } catch (e) {
    res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Authentication error' });
  }
}

export function requireOrgMember(req: TenantRequest, res: Response, next: NextFunction): void {
  if (!req.auth?.organizationId) {
    res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Organization context required' });
    return;
  }
  next();
}

export function authErrorHandler(err: unknown, res: Response): boolean {
  if (err instanceof AuthorizationError) {
    const status = err.code === 'TENANT_ACCESS_DENIED' ? 403 : 403;
    res.status(status).json({ ok: false, code: err.code, error: err.message });
    return true;
  }
  return false;
}
