import { withTenantTransaction } from '../db/tenantContext';
import { resolvePlan } from '../plans/entitlements';

export type QuotaState = 'QUOTA_OK' | 'QUOTA_WARNING' | 'QUOTA_EXCEEDED';

export async function checkOrganizationQuota(organizationId: string): Promise<{
  state: QuotaState;
  usedToday: number;
  limit: number;
  planTier: string;
  percentUsed: number;
  message?: string;
}> {
  return withTenantTransaction(organizationId, async (client) => {
    const org = await client.query(
      `SELECT quota_requests_per_day, plan_tier FROM organizations WHERE id = $1`,
      [organizationId]
    );
    const plan = resolvePlan(org.rows[0]?.plan_tier);
    const limit = org.rows[0]?.quota_requests_per_day ?? plan.quotaRequestsPerDay;
    const usage = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM usage_records
       WHERE organization_id = $1 AND created_at >= date_trunc('day', NOW())`,
      [organizationId]
    );
    const usedToday = usage.rows[0]?.cnt ?? 0;
    const percentUsed = limit > 0 ? Math.round((usedToday / limit) * 100) : 0;
    let state: QuotaState = 'QUOTA_OK';
    let message: string | undefined;
    if (usedToday >= limit) {
      state = 'QUOTA_EXCEEDED';
      message = 'You have used 100% of your included AI allowance for today.';
    } else if (usedToday >= limit * 0.8) {
      state = 'QUOTA_WARNING';
      message = `You have used ${percentUsed}% of your included AI allowance.`;
    }
    return { state, usedToday, limit, planTier: plan.id, percentUsed, message };
  });
}
