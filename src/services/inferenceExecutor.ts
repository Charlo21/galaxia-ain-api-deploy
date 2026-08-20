import { getProviderAdapter } from '../providers/adapter';
import { updateInferenceJob } from './inferenceJobs';
import { appendAuditEvent, appendUsageRecord } from './auditUsage';
import { INPUT_LIMITS } from '../security/inputSecurity';

export async function executeInferenceJob(input: {
  organizationId: string;
  projectId?: string;
  userId?: string;
  requestId: string;
  providerId: string;
  modelId: string;
  prompt: string;
}): Promise<void> {
  const provider = getProviderAdapter(input.providerId);
  await updateInferenceJob(input.organizationId, input.requestId, { status: 'RUNNING' });

  try {
    const result = await provider.generate({
      modelId: input.modelId,
      prompt: input.prompt,
      maxOutputTokens: INPUT_LIMITS.maxOutputTokensDefault,
      timeoutMs: INPUT_LIMITS.inferenceTimeoutMs,
    });

    await updateInferenceJob(input.organizationId, input.requestId, {
      status: 'SUCCEEDED',
      outputBytes: Buffer.byteLength(result.output, 'utf8'),
      durationMs: result.durationMs,
    });

    await appendUsageRecord({
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: input.userId,
      requestId: input.requestId,
      providerId: result.providerId,
      modelId: result.modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      status: 'SUCCEEDED',
      estimatedCostUsd: provider.estimateCost?.({ modelId: input.modelId, prompt: input.prompt }),
    });

    await appendAuditEvent({
      organizationId: input.organizationId,
      actorId: input.userId,
      requestId: input.requestId,
      eventType: 'INFERENCE_COMPLETED',
      resourceType: 'inference',
      resourceId: input.requestId,
      result: 'SUCCESS',
    });
  } catch (e: any) {
    await updateInferenceJob(input.organizationId, input.requestId, {
      status: 'FAILED',
      errorCode: e.code || 'INFERENCE_FAILED',
    });
    await appendAuditEvent({
      organizationId: input.organizationId,
      actorId: input.userId,
      requestId: input.requestId,
      eventType: 'INFERENCE_FAILED',
      resourceType: 'inference',
      resourceId: input.requestId,
      result: 'FAILED',
      metadata: { code: e.code },
    });
  }
}
