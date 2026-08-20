-- Production hardening additions: idempotency payload hash, security_events
-- Apply after add_tenant_security.sql

ALTER TABLE inference_requests
  ADD COLUMN IF NOT EXISTS payload_hash VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inference_idempotency_hash
  ON inference_requests (organization_id, idempotency_key, payload_hash)
  WHERE idempotency_key IS NOT NULL AND payload_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  actor_id UUID,
  request_id VARCHAR(64),
  event_type VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
  result VARCHAR(30) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_org ON security_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS security_events_all ON security_events;
CREATE POLICY security_events_all ON security_events FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Organization quota snapshot (optional denormalized state)
CREATE TABLE IF NOT EXISTS quota_state (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  requests_today INTEGER NOT NULL DEFAULT 0,
  tokens_today BIGINT NOT NULL DEFAULT 0,
  last_reset_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('day', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE quota_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE quota_state FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quota_state_all ON quota_state;
CREATE POLICY quota_state_all ON quota_state FOR ALL
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
