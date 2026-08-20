-- Force RLS for table owners (Render role owns tables; without FORCE, owners bypass policies).
-- Safe / idempotent.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations',
    'organization_members',
    'projects',
    'api_credentials',
    'provider_credentials',
    'inference_requests',
    'usage_records',
    'audit_events',
    'security_events',
    'quota_state'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;
