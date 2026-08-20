/**
 * RLS integration tests — require RUN_TENANT_INTEGRATION=true and DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { pool } from '../../src/config/database';
import { withBootstrapTransaction, withTenantTransaction } from '../../src/db/tenantContext';
import crypto from 'crypto';

const runIntegration =
  process.env.RUN_TENANT_INTEGRATION === 'true' && Boolean(process.env.DATABASE_URL || process.env.DB_HOST);

const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('PostgreSQL RLS adversarial integration', () => {
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  let projectB: string;

  beforeAll(async () => {
    await withBootstrapTransaction(async (client) => {
      await client.query(`INSERT INTO organizations (id, name, slug) VALUES ($1,'Org A','org-a-${orgA.slice(0,8)}')`, [orgA]);
      await client.query(`INSERT INTO organizations (id, name, slug) VALUES ($1,'Org B','org-b-${orgB.slice(0,8)}')`, [orgB]);
      await client.query(
        `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'ADMIN'),($3,$4,'ADMIN')`,
        [orgA, userA, orgB, userB]
      );
      const p = await client.query(
        `INSERT INTO projects (organization_id, name, slug) VALUES ($1,'P B','pb') RETURNING id`,
        [orgB]
      );
      projectB = p.rows[0].id;
    });
  });

  afterAll(async () => {
    await withBootstrapTransaction(async (client) => {
      await client.query('DELETE FROM projects WHERE organization_id IN ($1,$2)', [orgA, orgB]);
      await client.query('DELETE FROM organization_members WHERE organization_id IN ($1,$2)', [orgA, orgB]);
      await client.query('DELETE FROM organizations WHERE id IN ($1,$2)', [orgA, orgB]);
    });
    await pool.end();
  });

  it('Tenant A cannot read Tenant B project', async () => {
    const rows = await withTenantTransaction(orgA, async (client) => {
      const r = await client.query(`SELECT id FROM projects WHERE id = $1`, [projectB]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  it('Tenant A cannot update Tenant B project', async () => {
    const r = await withTenantTransaction(orgA, async (client) => {
      return client.query(`UPDATE projects SET name = 'hacked' WHERE id = $1 RETURNING id`, [projectB]);
    });
    expect(r.rowCount).toBe(0);
  });

  it('Tenant A cannot delete Tenant B project', async () => {
    const r = await withTenantTransaction(orgA, async (client) => {
      return client.query(`DELETE FROM projects WHERE id = $1`, [projectB]);
    });
    expect(r.rowCount).toBe(0);
  });

  it('missing tenant context denies via empty RLS', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_organization_id', '', true)`);
      const r = await client.query(`SELECT id FROM projects WHERE id = $1`, [projectB]);
      expect(r.rows.length).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('Tenant B can read own project', async () => {
    const rows = await withTenantTransaction(orgB, async (client) => {
      const r = await client.query(`SELECT id FROM projects WHERE id = $1`, [projectB]);
      return r.rows;
    });
    expect(rows.length).toBe(1);
  });

  it('transaction rollback clears tenant visibility', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_organization_id', $1, true)`, [orgB]);
      const inside = await client.query(`SELECT id FROM projects WHERE id = $1`, [projectB]);
      expect(inside.rows.length).toBe(1);
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_organization_id', '', true)`);
      const outside = await client.query(`SELECT id FROM projects WHERE id = $1`, [projectB]);
      expect(outside.rows.length).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

if (!runIntegration) {
  describe('RLS integration (skipped)', () => {
    it('reports BLOCKED without DATABASE_URL', () => {
      expect(runIntegration).toBe(false);
    });
  });
}
