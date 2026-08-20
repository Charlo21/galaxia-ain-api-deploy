-- Free / Community plan tier for Galaxia AIN SMB
-- Apply after add_production_hardening.sql

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(40) NOT NULL DEFAULT 'FREE';

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS financial_eligibility BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.plan_tier IS 'Commercial plan: FREE | SMALL_BUSINESS | BUSINESS | PROFESSIONAL | ENTERPRISE';
COMMENT ON COLUMN organizations.financial_eligibility IS 'Independent of plan — never grant regulated access from payment alone';

-- Align default free quota (server also enforces via entitlements catalog)
UPDATE organizations
SET quota_requests_per_day = 100
WHERE plan_tier = 'FREE' AND (quota_requests_per_day IS NULL OR quota_requests_per_day >= 10000);
