/**
 * Centralized auth types — server-derived identity only.
 */
export type OrgRole =
  | 'OWNER'
  | 'ADMIN'
  | 'AI_OPERATOR'
  | 'DEVELOPER'
  | 'BILLING'
  | 'AUDITOR'
  | 'VIEWER'
  | 'API_SERVICE_ACCOUNT';

export type AuthContext = {
  userId: string;
  organizationId: string;
  role: OrgRole;
  projectId?: string;
  credentialId?: string;
  scopes: string[];
  requestId: string;
};

export type Scope =
  | 'inference:read'
  | 'inference:execute'
  | 'projects:read'
  | 'projects:write'
  | 'usage:read'
  | 'audit:read'
  | 'providers:read';

export const ROLE_PERMISSIONS: Record<OrgRole, Scope[]> = {
  OWNER: [
    'inference:read',
    'inference:execute',
    'projects:read',
    'projects:write',
    'usage:read',
    'audit:read',
    'providers:read',
  ],
  ADMIN: [
    'inference:read',
    'inference:execute',
    'projects:read',
    'projects:write',
    'usage:read',
    'audit:read',
    'providers:read',
  ],
  AI_OPERATOR: ['inference:read', 'inference:execute', 'projects:read', 'usage:read'],
  DEVELOPER: ['inference:read', 'inference:execute', 'projects:read', 'projects:write'],
  BILLING: ['usage:read'],
  AUDITOR: ['audit:read', 'usage:read'],
  VIEWER: ['inference:read', 'projects:read', 'usage:read'],
  API_SERVICE_ACCOUNT: ['inference:execute', 'inference:read'],
};
