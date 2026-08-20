import { PoolClient } from 'pg';
import { withBootstrapTransaction, withTenantTransaction } from '../db/tenantContext';
import { OrgRole } from '../auth/types';
import { resolvePlan, PlanTier } from '../plans/entitlements';

export async function createOrganization(input: {
  name: string;
  slug: string;
  ownerUserId: string;
  planTier?: PlanTier | string;
}): Promise<{ id: string; slug: string; planTier: string }> {
  const plan = resolvePlan(input.planTier || 'FREE');
  return withBootstrapTransaction(async (client) => {
    const org = await client.query(
      `INSERT INTO organizations (name, slug, plan_tier, quota_requests_per_day, billing_status, usage_mode, financial_eligibility)
       VALUES ($1, $2, $3, $4, 'NOT_CONFIGURED', 'METERING_ONLY', false)
       RETURNING id, slug, plan_tier`,
      [input.name, input.slug, plan.id, plan.quotaRequestsPerDay]
    );
    const orgId = org.rows[0].id;
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [orgId, input.ownerUserId]
    );
    return { id: orgId, slug: org.rows[0].slug, planTier: org.rows[0].plan_tier };
  });
}

export async function getOrganization(organizationId: string) {
  return withTenantTransaction(organizationId, async (client) => {
    const r = await client.query(
      `SELECT id, name, slug, status, billing_status, usage_mode, plan_tier, financial_eligibility, quota_requests_per_day
       FROM organizations WHERE id = $1`,
      [organizationId]
    );
    return r.rows[0] || null;
  });
}

export async function listProjects(organizationId: string) {
  return withTenantTransaction(organizationId, async (client) => {
    const r = await client.query(
      `SELECT id, name, slug, status, created_at FROM projects WHERE organization_id = $1 ORDER BY created_at DESC`,
      [organizationId]
    );
    return r.rows;
  });
}

export async function getProject(organizationId: string, projectId: string) {
  return withTenantTransaction(organizationId, async (client) => {
    const r = await client.query(
      `SELECT id, organization_id, name, slug, status FROM projects WHERE id = $1`,
      [projectId]
    );
    return r.rows[0] || null;
  });
}

export async function createProject(organizationId: string, name: string, slug: string) {
  return withTenantTransaction(organizationId, async (client) => {
    const r = await client.query(
      `INSERT INTO projects (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id, name, slug, status`,
      [organizationId, name, slug]
    );
    return r.rows[0];
  });
}

export async function assertMemberActive(
  client: PoolClient,
  organizationId: string,
  userId: string
): Promise<OrgRole | null> {
  const r = await client.query(
    `SELECT role, status FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
    [organizationId, userId]
  );
  if (!r.rows.length || r.rows[0].status !== 'active') return null;
  return r.rows[0].role as OrgRole;
}
