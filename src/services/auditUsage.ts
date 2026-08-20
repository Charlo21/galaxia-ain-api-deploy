import { pool } from '../config/database';

export async function appendAuditEvent(event: {
  organizationId?: string;
  actorId?: string;
  requestId?: string;
  eventType: string;
  resourceType?: string;
  resourceId?: string;
  result: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const safeMeta = scrubSecrets(event.metadata || {});
  await pool.query(
    `INSERT INTO audit_events (organization_id, actor_id, request_id, event_type, resource_type, resource_id, result, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      event.organizationId || null,
      event.actorId || null,
      event.requestId || null,
      event.eventType,
      event.resourceType || null,
      event.resourceId || null,
      event.result,
      JSON.stringify(safeMeta),
    ]
  );
}

export function scrubSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/secret|password|token|key|authorization/i.test(k)) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = scrubSecrets(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function appendUsageRecord(record: {
  organizationId: string;
  projectId?: string;
  userId?: string;
  requestId: string;
  providerId?: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  status: string;
  estimatedCostUsd?: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO usage_records
     (organization_id, project_id, user_id, request_id, provider_id, model_id, input_tokens, output_tokens, duration_ms, status, estimated_cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      record.organizationId,
      record.projectId || null,
      record.userId || null,
      record.requestId,
      record.providerId || null,
      record.modelId || null,
      record.inputTokens ?? null,
      record.outputTokens ?? null,
      record.durationMs ?? null,
      record.status,
      record.estimatedCostUsd ?? null,
    ]
  );
}
