/**
 * Galaxia AIN commercial plan model — server-authoritative entitlements.
 * Payment alone never grants regulated/financial capabilities.
 */
export type PlanTier = 'FREE' | 'SMALL_BUSINESS' | 'BUSINESS' | 'PROFESSIONAL' | 'ENTERPRISE';

export type Capability =
  | 'ain.workspace'
  | 'ain.projects'
  | 'ain.inference'
  | 'ain.api_credentials'
  | 'ain.usage_read'
  | 'ain.audit_read'
  | 'ain.invite_members'
  | 'bank.basic'
  | 'stablecoin.transfer'
  | 'mainnet.settlement';

export type PlanDefinition = {
  id: PlanTier;
  label: string;
  priceMonthlyUsd: number | null;
  quotaRequestsPerDay: number;
  capabilities: Capability[];
  financialEligibilityRequired: Capability[];
};

/** Free / Community — real usable software, no bank/card required. */
export const PLAN_CATALOG: Record<PlanTier, PlanDefinition> = {
  FREE: {
    id: 'FREE',
    label: 'Free / Community',
    priceMonthlyUsd: 0,
    quotaRequestsPerDay: 100,
    capabilities: [
      'ain.workspace',
      'ain.projects',
      'ain.inference',
      'ain.api_credentials',
      'ain.usage_read',
      'ain.audit_read',
    ],
    financialEligibilityRequired: ['bank.basic', 'stablecoin.transfer', 'mainnet.settlement'],
  },
  SMALL_BUSINESS: {
    id: 'SMALL_BUSINESS',
    label: 'Small Business',
    priceMonthlyUsd: 49,
    quotaRequestsPerDay: 5000,
    capabilities: [
      'ain.workspace',
      'ain.projects',
      'ain.inference',
      'ain.api_credentials',
      'ain.usage_read',
      'ain.audit_read',
      'ain.invite_members',
      'bank.basic',
      'stablecoin.transfer',
      'mainnet.settlement',
    ],
    financialEligibilityRequired: ['bank.basic', 'stablecoin.transfer', 'mainnet.settlement'],
  },
  BUSINESS: {
    id: 'BUSINESS',
    label: 'Business',
    priceMonthlyUsd: 99,
    quotaRequestsPerDay: 25000,
    capabilities: [
      'ain.workspace',
      'ain.projects',
      'ain.inference',
      'ain.api_credentials',
      'ain.usage_read',
      'ain.audit_read',
      'ain.invite_members',
      'bank.basic',
      'stablecoin.transfer',
      'mainnet.settlement',
    ],
    financialEligibilityRequired: ['bank.basic', 'stablecoin.transfer', 'mainnet.settlement'],
  },
  PROFESSIONAL: {
    id: 'PROFESSIONAL',
    label: 'Professional',
    priceMonthlyUsd: 249,
    quotaRequestsPerDay: 100000,
    capabilities: [
      'ain.workspace',
      'ain.projects',
      'ain.inference',
      'ain.api_credentials',
      'ain.usage_read',
      'ain.audit_read',
      'ain.invite_members',
      'bank.basic',
      'stablecoin.transfer',
      'mainnet.settlement',
    ],
    financialEligibilityRequired: ['bank.basic', 'stablecoin.transfer', 'mainnet.settlement'],
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    label: 'Enterprise',
    priceMonthlyUsd: null,
    quotaRequestsPerDay: 500000,
    capabilities: [
      'ain.workspace',
      'ain.projects',
      'ain.inference',
      'ain.api_credentials',
      'ain.usage_read',
      'ain.audit_read',
      'ain.invite_members',
      'bank.basic',
      'stablecoin.transfer',
      'mainnet.settlement',
    ],
    financialEligibilityRequired: ['bank.basic', 'stablecoin.transfer', 'mainnet.settlement'],
  },
};

export function resolvePlan(tier?: string | null): PlanDefinition {
  const key = (tier || 'FREE').toUpperCase() as PlanTier;
  return PLAN_CATALOG[key] || PLAN_CATALOG.FREE;
}

/**
 * Server-side capability check.
 * financialEligibility must be independently true for regulated capabilities.
 */
export function canUse(
  planTier: string | null | undefined,
  capability: Capability,
  opts?: { financialEligibility?: boolean }
): boolean {
  const plan = resolvePlan(planTier);
  if (!plan.capabilities.includes(capability)) return false;
  if (plan.financialEligibilityRequired.includes(capability)) {
    return opts?.financialEligibility === true;
  }
  return true;
}

export function entitlementSnapshot(planTier: string | null | undefined) {
  const plan = resolvePlan(planTier);
  return {
    plan: plan.id,
    label: plan.label,
    priceMonthlyUsd: plan.priceMonthlyUsd,
    quotaRequestsPerDay: plan.quotaRequestsPerDay,
    capabilities: plan.capabilities,
    billingStatus: 'NOT_CONFIGURED' as const,
    usageMode: 'METERING_ONLY' as const,
    financialEligibility: false,
    regulatedCapabilities: plan.financialEligibilityRequired,
    notes: [
      'Free software access does not require a bank account or card.',
      'Regulated financial capabilities remain independently gated.',
      'MAINNET_BLOCKED — blockchain settlement not enabled for AIN SMB pilot.',
    ],
  };
}
