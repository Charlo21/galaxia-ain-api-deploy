import { Router, Response } from 'express';
import crypto from 'crypto';
import { requireAuth, requireOrgMember, TenantRequest, authErrorHandler } from '../auth/requireAuth';
import { requireRole } from '../auth/requireRole';
import { authorize, assertOrgMatch, assertProjectInOrg, rejectClientRoleOverride } from '../auth/authorize';
import {
  createOrganization,
  getOrganization,
  listProjects,
  getProject,
  createProject,
} from '../services/tenantService';
import { createApiCredential, revokeApiCredential } from '../services/apiCredentials';
import { appendAuditEvent, appendUsageRecord } from '../services/auditUsage';
import { checkOrganizationQuota } from '../services/quotaService';
import { createInferenceJob, getInferenceJob, IdempotencyConflictError } from '../services/inferenceJobs';
import { resolveModel } from '../security/providerRegistry';
import { validatePromptInput } from '../security/inputSecurity';
import { validateNoMainnetInjection } from '../security/mainnetGuard';
import { getProviderAdapter } from '../providers/adapter';
import { executeInferenceJob } from '../services/inferenceExecutor';
import { tenantLimits } from '../middleware/tenantRateLimit';
import {
  checkDistributedRateLimit,
  rateLimitConfigured,
  requireDistributedRateLimit,
} from '../infra/rateLimitDistributed';
import { withTenantTransaction } from '../db/tenantContext';
import { Scope } from '../auth/types';
import { entitlementSnapshot, canUse } from '../plans/entitlements';
import freeSignupRouter from './freeSignup';

const router = Router();

/** Free signup + public plan catalog (no auth) — bank/card not required */
router.use(freeSignupRouter);

function bootstrapAllowed(req: TenantRequest): boolean {
  const key = req.headers['x-internal-bootstrap-key'];
  return (
    key === process.env.INTERNAL_BOOTSTRAP_KEY &&
    Boolean(process.env.INTERNAL_BOOTSTRAP_KEY) &&
    process.env.NODE_ENV !== 'production'
  );
}

router.post('/organizations', async (req: TenantRequest, res: Response) => {
  try {
    if (!bootstrapAllowed(req) && process.env.ALLOW_DEV_AUTH !== 'true') {
      res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'Organization bootstrap not enabled' });
      return;
    }
    rejectClientRoleOverride(req.body || {});
    const { name, slug, ownerUserId } = req.body || {};
    if (!name || !slug || !ownerUserId) {
      res.status(400).json({ ok: false, code: 'INVALID_INPUT', error: 'name, slug, ownerUserId required' });
      return;
    }
    const org = await createOrganization({ name, slug, ownerUserId });
    await appendAuditEvent({
      organizationId: org.id,
      actorId: ownerUserId,
      eventType: 'ORG_CREATED',
      resourceType: 'organization',
      resourceId: org.id,
      result: 'SUCCESS',
    });
    res.status(201).json({ ok: true, organization: org });
  } catch (e) {
    if (!authErrorHandler(e, res)) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Failed to create organization' });
    }
  }
});

router.use(requireAuth, requireOrgMember);

router.get('/status', tenantLimits.read, async (req: TenantRequest, res: Response) => {
  try {
    const org = await getOrganization(req.auth!.organizationId);
    const quota = await checkOrganizationQuota(req.auth!.organizationId);
    const providerStatus = getProviderAdapter('openai').status();
    const planTier = org?.plan_tier || 'FREE';
    res.json({
      ok: true,
      pilot: true,
      organization: org,
      quota,
      entitlements: entitlementSnapshot(planTier),
      canUse: {
        workspace: canUse(planTier, 'ain.workspace'),
        inference: canUse(planTier, 'ain.inference'),
        inviteMembers: canUse(planTier, 'ain.invite_members'),
        bankBasic: canUse(planTier, 'bank.basic', {
          financialEligibility: org?.financial_eligibility === true,
        }),
      },
      billingStatus: 'NOT_CONFIGURED',
      usageMode: 'METERING_ONLY',
      openAi: providerStatus,
      mainnet: 'MAINNET_BLOCKED',
      freeTier: planTier === 'FREE',
      noBankRequired: true,
    });
  } catch (e) {
    if (!authErrorHandler(e, res)) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Status unavailable' });
    }
  }
});

router.get('/organization', tenantLimits.read, async (req: TenantRequest, res: Response) => {
  try {
    authorize(req.auth!, 'projects:read');
    const org = await getOrganization(req.auth!.organizationId);
    if (!org) {
      res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Organization not found' });
      return;
    }
    if (org.status === 'disabled') {
      res.status(403).json({ ok: false, code: 'ORG_DISABLED', error: 'Organization disabled' });
      return;
    }
    res.json({ ok: true, organization: org });
  } catch (e) {
    if (!authErrorHandler(e, res)) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch organization' });
    }
  }
});

router.get('/projects', async (req: TenantRequest, res: Response) => {
  try {
    authorize(req.auth!, 'projects:read');
    const spoofOrg = req.headers['x-org-id'] as string;
    if (spoofOrg && spoofOrg !== req.auth!.organizationId) {
      res.status(403).json({ ok: false, code: 'TENANT_ACCESS_DENIED', error: 'Header org spoof rejected' });
      return;
    }
    const projects = await listProjects(req.auth!.organizationId);
    res.json({ ok: true, projects });
  } catch (e) {
    if (!authErrorHandler(e, res)) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Failed to list projects' });
    }
  }
});

router.get('/projects/:projectId', async (req: TenantRequest, res: Response) => {
  try {
    authorize(req.auth!, 'projects:read');
    const project = await getProject(req.auth!.organizationId, req.params.projectId);
    if (!project) {
      res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Project not found' });
      return;
    }
    assertProjectInOrg(req.auth!, project.organization_id);
    res.json({ ok: true, project });
  } catch (e) {
    if (!authErrorHandler(e, res)) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch project' });
    }
  }
});

router.post('/projects', requireRole('OWNER', 'ADMIN', 'DEVELOPER'), async (req: TenantRequest, res: Response) => {
  try {
    authorize(req.auth!, 'projects:write');
    rejectClientRoleOverride(req.body || {});
    const { name, slug } = req.body || {};
    if (!name || !slug) {
      res.status(400).json({ ok: false, code: 'INVALID_INPUT', error: 'name and slug required' });
      return;
    }
    const project = await createProject(req.auth!.organizationId, name, slug);
    await appendAuditEvent({
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      requestId: req.auth!.requestId,
      eventType: 'ADMIN_ACTION',
      resourceType: 'project',
      resourceId: project.id,
      result: 'SUCCESS',
      metadata: { action: 'project_created' },
    });
    res.status(201).json({ ok: true, project });
  } catch (e) {
    if (!authErrorHandler(e, res)) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Failed to create project' });
    }
  }
});

router.post('/credentials', requireRole('OWNER', 'ADMIN'), async (req: TenantRequest, res: Response) => {
  try {
    if (requireDistributedRateLimit() && !rateLimitConfigured()) {
      res.status(503).json({ ok: false, code: 'RATE_LIMIT_UNAVAILABLE', error: 'Distributed rate limit required' });
      return;
    }
    const rl = await checkDistributedRateLimit(`cred:${req.auth!.organizationId}`, 10, 3600);
    if (rl && !rl.allowed) {
      res.status(429).json({ ok: false, code: 'RATE_LIMITED', error: 'Too many credential operations' });
      return;
    }
    rejectClientRoleOverride(req.body || {});
    const { name, projectId, scopes } = req.body || {};
    if (!name) {
      res.status(400).json({ ok: false, code: 'INVALID_INPUT', error: 'name required' });
      return;
    }
    const cred = await createApiCredential({
      organizationId: req.auth!.organizationId,
      projectId,
      name,
      scopes: (scopes as Scope[]) || ['inference:execute'],
      createdBy: req.auth!.userId,
    });
    await appendAuditEvent({
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      requestId: req.auth!.requestId,
      eventType: 'API_KEY_CREATED',
      resourceType: 'api_credential',
      resourceId: cred.id,
      result: 'SUCCESS',
    });
    res.status(201).json({
      ok: true,
      credential: { id: cred.id, prefix: cred.prefix, plaintextKey: cred.plaintextKey },
      warning: 'Plaintext key shown once — store securely',
    });
  } catch (e) {
    if (!authErrorHandler(e, res)) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Failed to create credential' });
    }
  }
});

router.delete('/credentials/:credentialId', requireRole('OWNER', 'ADMIN'), async (req: TenantRequest, res: Response) => {
  try {
    const revoked = await revokeApiCredential(req.auth!.organizationId, req.params.credentialId);
    if (!revoked) {
      res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Credential not found' });
      return;
    }
    await appendAuditEvent({
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      requestId: req.auth!.requestId,
      eventType: 'API_KEY_REVOKED',
      resourceType: 'api_credential',
      resourceId: req.params.credentialId,
      result: 'SUCCESS',
    });
    res.json({ ok: true, revoked: true });
  } catch (e) {
    if (!authErrorHandler(e, res)) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Failed to revoke credential' });
    }
  }
});

router.get('/usage', async (req: TenantRequest, res: Response) => {
  try {
    authorize(req.auth!, 'usage:read');
    const records = await withTenantTransaction(req.auth!.organizationId, async (client) => {
      const r = await client.query(
        `SELECT request_id, provider_id, model_id, input_tokens, output_tokens, status, estimated_cost_usd, created_at
         FROM usage_records WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [req.auth!.organizationId]
      );
      return r.rows;
    });
    const quota = await checkOrganizationQuota(req.auth!.organizationId);
    res.json({
      ok: true,
      billingStatus: 'NOT_CONFIGURED',
      usageMode: 'METERING_ONLY',
      quota,
      records,
    });
  } catch (e) {
    if (!authErrorHandler(e, res)) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch usage' });
    }
  }
});

router.get('/audit', async (req: TenantRequest, res: Response) => {
  try {
    authorize(req.auth!, 'audit:read');
    const events = await withTenantTransaction(req.auth!.organizationId, async (client) => {
      const r = await client.query(
        `SELECT event_type, resource_type, resource_id, result, created_at
         FROM audit_events WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [req.auth!.organizationId]
      );
      return r.rows;
    });
    res.json({ ok: true, events });
  } catch (e) {
    if (!authErrorHandler(e, res)) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch audit events' });
    }
  }
});

router.post('/inference', tenantLimits.inference, async (req: TenantRequest, res: Response) => {
  const started = Date.now();
  try {
    authorize(req.auth!, 'inference:execute');
    rejectClientRoleOverride(req.body || {});

    const mainnetCheck = validateNoMainnetInjection(req.body || {});
    if ('code' in mainnetCheck) {
      res.status(403).json({ ok: false, code: mainnetCheck.code, error: mainnetCheck.reason });
      return;
    }

    const spoofOrg = (req.body?.organizationId || req.headers['x-org-id']) as string | undefined;
    if (spoofOrg) assertOrgMatch(req.auth!, spoofOrg);

    const { model, input, projectId, idempotencyKey } = req.body || {};
    if (!model || input === undefined) {
      res.status(400).json({ ok: false, code: 'INVALID_INPUT', error: 'model and input required' });
      return;
    }

    const promptCheck = validatePromptInput(typeof input === 'string' ? input : JSON.stringify(input));
    if (promptCheck.ok === false) {
      res.status(400).json({ ok: false, code: promptCheck.code, error: promptCheck.message });
      return;
    }

    if (projectId) {
      const project = await getProject(req.auth!.organizationId, projectId);
      if (!project) {
        res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Project not found' });
        return;
      }
      assertProjectInOrg(req.auth!, project.organization_id);
    }

    const quota = await checkOrganizationQuota(req.auth!.organizationId);
    if (quota.state === 'QUOTA_EXCEEDED') {
      await appendAuditEvent({
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        eventType: 'QUOTA_EXCEEDED',
        result: 'BLOCKED',
      });
      res.status(429).json({ ok: false, code: 'QUOTA_EXCEEDED', error: 'Organization quota exceeded', quota });
      return;
    }

    const modelCheck = resolveModel(model);
    if (modelCheck.ok === false) {
      res.status(modelCheck.code === 'MODEL_NOT_ALLOWED' ? 403 : 503).json({
        ok: false,
        code: modelCheck.code,
        error: modelCheck.message,
      });
      return;
    }

    const provider = getProviderAdapter(modelCheck.model.provider);
    if (provider.status() === 'NOT_CONFIGURED') {
      res.status(503).json({
        ok: false,
        code: 'PROVIDER_NOT_CONFIGURED',
        error: `Provider ${modelCheck.model.provider} is not configured`,
      });
      return;
    }

    const job = await createInferenceJob({
      organizationId: req.auth!.organizationId,
      projectId,
      userId: req.auth!.userId,
      providerId: modelCheck.model.provider,
      modelId: modelCheck.model.id,
      idempotencyKey,
      inputBytes: Buffer.byteLength(String(input), 'utf8'),
    });

    if (job.existing) {
      res.status(200).json({ ok: true, requestId: job.requestId, status: job.status, idempotent: true });
      return;
    }

    await appendAuditEvent({
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      requestId: job.requestId,
      eventType: 'INFERENCE_STARTED',
      resourceType: 'inference',
      resourceId: job.requestId,
      result: 'ACCEPTED',
    });

    res.status(202).json({
      ok: true,
      requestId: job.requestId,
      status: 'QUEUED',
      accepted: true,
      completed: false,
      billingStatus: 'NOT_CONFIGURED',
      usageMode: 'METERING_ONLY',
    });

    const promptText = typeof input === 'string' ? input : JSON.stringify(input);
    setImmediate(() => {
      executeInferenceJob({
        organizationId: req.auth!.organizationId,
        projectId,
        userId: req.auth!.userId,
        requestId: job.requestId,
        providerId: modelCheck.model.provider,
        modelId: modelCheck.model.id,
        prompt: promptText,
      }).catch(() => {
        /* logged in executor */
      });
    });

    await appendUsageRecord({
      organizationId: req.auth!.organizationId,
      projectId,
      userId: req.auth!.userId,
      requestId: job.requestId,
      providerId: modelCheck.model.provider,
      modelId: modelCheck.model.id,
      durationMs: Date.now() - started,
      status: 'QUEUED',
    });
  } catch (e) {
    if (e instanceof IdempotencyConflictError) {
      res.status(409).json({ ok: false, code: 'IDEMPOTENCY_CONFLICT', error: e.message });
      return;
    }
    if (!authErrorHandler(e, res)) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Inference request failed' });
    }
  }
});

router.get('/inference/:requestId', async (req: TenantRequest, res: Response) => {
  try {
    authorize(req.auth!, 'inference:read');
    const job = await getInferenceJob(req.auth!.organizationId, req.params.requestId);
    if (!job) {
      res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Inference job not found' });
      return;
    }
    res.json({ ok: true, job });
  } catch (e) {
    if (!authErrorHandler(e, res)) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch inference job' });
    }
  }
});

export default router;
