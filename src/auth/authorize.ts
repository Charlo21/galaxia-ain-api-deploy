import { AuthContext, OrgRole, ROLE_PERMISSIONS, Scope } from './types';

export class AuthorizationError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

/** Deny-by-default scope check. */
export function authorize(ctx: AuthContext, scope: Scope): void {
  const fromRole = ROLE_PERMISSIONS[ctx.role] || [];
  const fromScopes = ctx.scopes || [];
  if (!fromRole.includes(scope) && !fromScopes.includes(scope)) {
    throw new AuthorizationError('FORBIDDEN', `Missing scope: ${scope}`);
  }
}

export function requireRole(ctx: AuthContext, ...roles: OrgRole[]): void {
  if (!roles.includes(ctx.role)) {
    throw new AuthorizationError('FORBIDDEN', `Role ${ctx.role} not permitted`);
  }
}

/** Reject client-supplied org/project if it doesn't match authenticated context. */
export function assertOrgMatch(ctx: AuthContext, organizationId: string): void {
  if (organizationId !== ctx.organizationId) {
    throw new AuthorizationError('TENANT_ACCESS_DENIED', 'Cross-tenant access denied');
  }
}

export function assertProjectInOrg(
  ctx: AuthContext,
  projectOrganizationId: string
): void {
  if (projectOrganizationId !== ctx.organizationId) {
    throw new AuthorizationError('TENANT_ACCESS_DENIED', 'Project not in organization');
  }
}

/** Never trust client role header/body — only ctx.role from server auth. */
export function rejectClientRoleOverride(body: Record<string, unknown>): void {
  if (body.role !== undefined || body.organizationId !== undefined || body.orgId !== undefined) {
    throw new AuthorizationError('INVALID_INPUT', 'Client cannot set role or organizationId');
  }
}
