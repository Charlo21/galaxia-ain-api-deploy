import crypto from 'crypto';
import { pool } from '../config/database';
import { Scope } from '../auth/types';

export async function createApiCredential(input: {
  organizationId: string;
  projectId?: string;
  name: string;
  scopes: Scope[];
  createdBy: string;
  expiresAt?: Date;
}): Promise<{ id: string; plaintextKey: string; prefix: string }> {
  const prefix = `gain_${crypto.randomBytes(4).toString('hex')}`;
  const secret = crypto.randomBytes(32).toString('hex');
  const plaintextKey = `${prefix}_${secret}`;
  const keyHash = crypto.createHash('sha256').update(plaintextKey).digest('hex');

  const result = await pool.query(
    `INSERT INTO api_credentials (organization_id, project_id, key_prefix, key_hash, name, scopes, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      input.organizationId,
      input.projectId || null,
      prefix,
      keyHash,
      input.name,
      input.scopes,
      input.createdBy,
      input.expiresAt || null,
    ]
  );

  return { id: result.rows[0].id, plaintextKey, prefix };
}

export async function revokeApiCredential(organizationId: string, credentialId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE api_credentials SET revoked_at = NOW(), is_active = false
     WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
    [credentialId, organizationId]
  );
  return (result.rowCount || 0) > 0;
}
