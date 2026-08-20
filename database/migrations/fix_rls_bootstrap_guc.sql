-- Controlled RLS bootstrap for managed DB owners (FORCE RLS).
-- Application sets: SELECT set_config('app.rls_bootstrap', 'on', true) inside a transaction.
-- Tenant requests must NEVER set this GUC.

CREATE OR REPLACE FUNCTION rls_bootstrap() RETURNS boolean AS $$
  SELECT COALESCE(current_setting('app.rls_bootstrap', true), '') = 'on';
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION current_organization_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')::UUID;
$$ LANGUAGE SQL STABLE;

-- Organizations: tenant SELECT + bootstrap ALL
DROP POLICY IF EXISTS org_select ON organizations;
DROP POLICY IF EXISTS org_all ON organizations;
CREATE POLICY org_all ON organizations FOR ALL
  USING (rls_bootstrap() OR id = current_organization_id())
  WITH CHECK (rls_bootstrap() OR id = current_organization_id());

DROP POLICY IF EXISTS org_members_select ON organization_members;
DROP POLICY IF EXISTS org_members_all ON organization_members;
CREATE POLICY org_members_all ON organization_members FOR ALL
  USING (rls_bootstrap() OR organization_id = current_organization_id())
  WITH CHECK (rls_bootstrap() OR organization_id = current_organization_id());

DROP POLICY IF EXISTS projects_all ON projects;
CREATE POLICY projects_all ON projects FOR ALL
  USING (rls_bootstrap() OR organization_id = current_organization_id())
  WITH CHECK (rls_bootstrap() OR organization_id = current_organization_id());

DROP POLICY IF EXISTS api_credentials_all ON api_credentials;
CREATE POLICY api_credentials_all ON api_credentials FOR ALL
  USING (rls_bootstrap() OR organization_id = current_organization_id())
  WITH CHECK (rls_bootstrap() OR organization_id = current_organization_id());

DROP POLICY IF EXISTS provider_credentials_all ON provider_credentials;
CREATE POLICY provider_credentials_all ON provider_credentials FOR ALL
  USING (rls_bootstrap() OR organization_id = current_organization_id())
  WITH CHECK (rls_bootstrap() OR organization_id = current_organization_id());

DROP POLICY IF EXISTS inference_requests_all ON inference_requests;
CREATE POLICY inference_requests_all ON inference_requests FOR ALL
  USING (rls_bootstrap() OR organization_id = current_organization_id())
  WITH CHECK (rls_bootstrap() OR organization_id = current_organization_id());

DROP POLICY IF EXISTS usage_records_all ON usage_records;
CREATE POLICY usage_records_all ON usage_records FOR ALL
  USING (rls_bootstrap() OR organization_id = current_organization_id())
  WITH CHECK (rls_bootstrap() OR organization_id = current_organization_id());

DROP POLICY IF EXISTS audit_events_all ON audit_events;
CREATE POLICY audit_events_all ON audit_events FOR ALL
  USING (rls_bootstrap() OR organization_id = current_organization_id())
  WITH CHECK (rls_bootstrap() OR organization_id = current_organization_id());

DROP POLICY IF EXISTS security_events_all ON security_events;
CREATE POLICY security_events_all ON security_events FOR ALL
  USING (rls_bootstrap() OR organization_id = current_organization_id())
  WITH CHECK (rls_bootstrap() OR organization_id = current_organization_id());

DROP POLICY IF EXISTS quota_state_all ON quota_state;
CREATE POLICY quota_state_all ON quota_state FOR ALL
  USING (rls_bootstrap() OR organization_id = current_organization_id())
  WITH CHECK (rls_bootstrap() OR organization_id = current_organization_id());
