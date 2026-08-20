import crypto from 'crypto';
import { withTenantTransaction } from '../db/tenantContext';

export type InferenceJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export class IdempotencyConflictError extends Error {
  code = 'IDEMPOTENCY_CONFLICT';
  constructor() {
    super('Idempotency key reused with different payload');
  }
}

function payloadHash(modelId: string, inputBytes?: number, projectId?: string): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ modelId, inputBytes, projectId }))
    .digest('hex');
}

export async function createInferenceJob(input: {
  organizationId: string;
  projectId?: string;
  userId?: string;
  providerId: string;
  modelId: string;
  idempotencyKey?: string;
  inputBytes?: number;
}): Promise<{ requestId: string; status: InferenceJobStatus; existing?: boolean }> {
  const hash = payloadHash(input.modelId, input.inputBytes, input.projectId);
  return withTenantTransaction(input.organizationId, async (client) => {
    if (input.idempotencyKey) {
      const existing = await client.query(
        `SELECT request_id, status, payload_hash FROM inference_requests
         WHERE organization_id = $1 AND idempotency_key = $2`,
        [input.organizationId, input.idempotencyKey]
      );
      if (existing.rows.length) {
        const row = existing.rows[0];
        if (row.payload_hash && row.payload_hash !== hash) {
          throw new IdempotencyConflictError();
        }
        return {
          requestId: row.request_id,
          status: row.status,
          existing: true,
        };
      }
    }
    const requestId = crypto.randomUUID();
    await client.query(
      `INSERT INTO inference_requests
       (organization_id, project_id, user_id, request_id, idempotency_key, payload_hash, provider_id, model_id, status, input_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'QUEUED',$9)`,
      [
        input.organizationId,
        input.projectId || null,
        input.userId || null,
        requestId,
        input.idempotencyKey || null,
        input.idempotencyKey ? hash : null,
        input.providerId,
        input.modelId,
        input.inputBytes ?? null,
      ]
    );
    return { requestId, status: 'QUEUED' };
  });
}

export async function updateInferenceJob(
  organizationId: string,
  requestId: string,
  patch: {
    status: InferenceJobStatus;
    outputBytes?: number;
    durationMs?: number;
    errorCode?: string;
  }
): Promise<void> {
  await withTenantTransaction(organizationId, async (client) => {
    await client.query(
      `UPDATE inference_requests SET status = $3, output_bytes = COALESCE($4, output_bytes),
       duration_ms = COALESCE($5, duration_ms), error_code = COALESCE($6, error_code),
       updated_at = NOW(), completed_at = CASE WHEN $3 IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT') THEN NOW() ELSE completed_at END
       WHERE organization_id = $1 AND request_id = $2`,
      [
        organizationId,
        requestId,
        patch.status,
        patch.outputBytes ?? null,
        patch.durationMs ?? null,
        patch.errorCode ?? null,
      ]
    );
  });
}

export async function getInferenceJob(organizationId: string, requestId: string) {
  return withTenantTransaction(organizationId, async (client) => {
    const r = await client.query(
      `SELECT request_id, status, provider_id, model_id, duration_ms, error_code, created_at, completed_at
       FROM inference_requests WHERE organization_id = $1 AND request_id = $2`,
      [organizationId, requestId]
    );
    return r.rows[0] || null;
  });
}

export async function cancelInferenceJob(organizationId: string, requestId: string): Promise<boolean> {
  return withTenantTransaction(organizationId, async (client) => {
    const r = await client.query(
      `UPDATE inference_requests SET status = 'CANCELLED', updated_at = NOW(), completed_at = NOW()
       WHERE organization_id = $1 AND request_id = $2 AND status IN ('QUEUED','RUNNING')
       RETURNING request_id`,
      [organizationId, requestId]
    );
    return (r.rowCount || 0) > 0;
  });
}
