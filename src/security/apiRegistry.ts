/**
 * Central API endpoint registry for authorization matrix and validation.
 */
export type EndpointDef = {
  method: string;
  path: string;
  auth: 'none' | 'api_key' | 'tenant' | 'node_secret' | 'admin';
  tenant: boolean;
  roles?: string[];
  rateLimit: 'none' | 'standard' | 'strict' | 'distributed_required';
  audit?: string;
  idempotent?: boolean;
};

export const API_ENDPOINTS: EndpointDef[] = [
  { method: 'GET', path: '/health', auth: 'none', tenant: false, rateLimit: 'none' },
  { method: 'GET', path: '/live', auth: 'none', tenant: false, rateLimit: 'none' },
  { method: 'GET', path: '/ready', auth: 'none', tenant: false, rateLimit: 'none' },
  { method: 'GET', path: '/metrics', auth: 'none', tenant: false, rateLimit: 'standard' },
  { method: 'GET', path: '/api/readiness', auth: 'none', tenant: false, rateLimit: 'none' },
  { method: 'GET', path: '/api/gates', auth: 'none', tenant: false, rateLimit: 'none' },
  { method: 'GET', path: '/api/status', auth: 'none', tenant: false, rateLimit: 'none' },
  { method: 'POST', path: '/v1/tenant/free-signup', auth: 'none', tenant: false, rateLimit: 'strict', audit: 'ORG_CREATED' },
  { method: 'GET', path: '/v1/tenant/plans', auth: 'none', tenant: false, rateLimit: 'standard' },
  { method: 'GET', path: '/v1/providers/status', auth: 'none', tenant: false, rateLimit: 'none' },
  { method: 'POST', path: '/v1/nodes/register', auth: 'node_secret', tenant: false, rateLimit: 'strict' },
  { method: 'POST', path: '/v1/inference', auth: 'api_key', tenant: false, rateLimit: 'standard', audit: 'INFERENCE_STARTED' },
  { method: 'POST', path: '/v1/tenant/organizations', auth: 'none', tenant: false, rateLimit: 'strict', audit: 'ORG_CREATED' },
  { method: 'GET', path: '/v1/tenant/organization', auth: 'tenant', tenant: true, rateLimit: 'standard' },
  { method: 'GET', path: '/v1/tenant/projects', auth: 'tenant', tenant: true, rateLimit: 'standard' },
  { method: 'GET', path: '/v1/tenant/projects/:id', auth: 'tenant', tenant: true, rateLimit: 'standard' },
  { method: 'POST', path: '/v1/tenant/projects', auth: 'tenant', tenant: true, roles: ['OWNER', 'ADMIN', 'DEVELOPER'], rateLimit: 'standard', audit: 'ADMIN_ACTION' },
  { method: 'POST', path: '/v1/tenant/credentials', auth: 'tenant', tenant: true, roles: ['OWNER', 'ADMIN'], rateLimit: 'distributed_required', audit: 'API_KEY_CREATED' },
  { method: 'DELETE', path: '/v1/tenant/credentials/:id', auth: 'tenant', tenant: true, roles: ['OWNER', 'ADMIN'], rateLimit: 'strict', audit: 'API_KEY_REVOKED' },
  { method: 'GET', path: '/v1/tenant/usage', auth: 'tenant', tenant: true, rateLimit: 'standard' },
  { method: 'GET', path: '/v1/tenant/audit', auth: 'tenant', tenant: true, roles: ['AUDITOR', 'ADMIN', 'OWNER'], rateLimit: 'standard' },
  { method: 'POST', path: '/v1/tenant/inference', auth: 'tenant', tenant: true, rateLimit: 'distributed_required', audit: 'INFERENCE_STARTED', idempotent: true },
  { method: 'GET', path: '/v1/tenant/inference/:id', auth: 'tenant', tenant: true, rateLimit: 'standard' },
];

export function rejectUntrustedClientHeaders(headers: Record<string, unknown>): string | null {
  const blocked = ['x-organization-id', 'x-org-id', 'x-user-id', 'x-role', 'x-workspace-id'];
  for (const h of blocked) {
    if (headers[h] !== undefined) return `Client header ${h} is not authoritative`;
  }
  return null;
}
