/**
 * Free / Community software signup — no bank, card, or KYC required.
 * Creates organization on FREE plan + initial API credential (shown once).
 */
import { Router, Response } from 'express';
import crypto from 'crypto';
import { TenantRequest } from '../auth/requireAuth';
import { createOrganization } from '../services/tenantService';
import { createApiCredential } from '../services/apiCredentials';
import { appendAuditEvent } from '../services/auditUsage';
import { entitlementSnapshot, resolvePlan } from '../plans/entitlements';
import {
  checkDistributedRateLimit,
  rateLimitConfigured,
  requireDistributedRateLimit,
} from '../infra/rateLimitDistributed';
import { checkMemoryRateLimit } from '../infra/memoryRateLimit';

const router = Router();

function freeSignupEnabled(): boolean {
  const explicit = (process.env.FREE_TIER_SIGNUP_ENABLED || '').toLowerCase();
  if (explicit === 'false') return false;
  if (explicit === 'true') return true;
  // Default: enabled in non-production; production requires explicit opt-in
  return process.env.NODE_ENV !== 'production';
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

async function enforceFreeSignupRateLimit(ip: string): Promise<{ ok: true } | { ok: false; status: number; body: object }> {
  if (requireDistributedRateLimit() && !rateLimitConfigured()) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        code: 'RATE_LIMIT_UNAVAILABLE',
        error: 'Distributed rate limiting required for free signup',
      },
    };
  }
  if (rateLimitConfigured()) {
    const rl = await checkDistributedRateLimit(`free-signup:${ip}`, 5, 3600);
    if (rl && !rl.allowed) {
      return {
        ok: false,
        status: 429,
        body: {
          ok: false,
          code: 'RATE_LIMITED',
          error: 'Too many free signup attempts. Try again later.',
          retryAfterSec: rl.retryAfterSec,
        },
      };
    }
    return { ok: true };
  }
  // Local/dev only — never replaces required distributed RL in production
  const mem = checkMemoryRateLimit(`free-signup:${ip}`, 5, 3600);
  if (!mem.allowed) {
    return {
      ok: false,
      status: 429,
      body: {
        ok: false,
        code: 'RATE_LIMITED',
        error: 'Too many free signup attempts. Try again later.',
        retryAfterSec: mem.retryAfterSec,
      },
    };
  }
  return { ok: true };
}

router.post('/free-signup', async (req: TenantRequest, res: Response) => {
  try {
    if (!freeSignupEnabled()) {
      res.status(403).json({
        ok: false,
        code: 'FREE_SIGNUP_DISABLED',
        error: 'Free-tier signup is not enabled on this deployment',
      });
      return;
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const rlGate = await enforceFreeSignupRateLimit(ip);
    if (rlGate.ok === false) {
      const body = rlGate.body as { retryAfterSec?: number };
      if (body.retryAfterSec) {
        res.setHeader('Retry-After', String(body.retryAfterSec));
      }
      res.status(rlGate.status).json(rlGate.body);
      return;
    }

    const { businessName, email } = req.body || {};
    if (!businessName || typeof businessName !== 'string' || businessName.trim().length < 2) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_INPUT',
        error: 'businessName is required (min 2 characters)',
      });
      return;
    }
    if (email && typeof email === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ ok: false, code: 'INVALID_INPUT', error: 'email format invalid' });
      return;
    }

    const ownerUserId = crypto.randomUUID();
    const baseSlug = slugify(businessName) || 'smb';
    const slug = `${baseSlug}-${Date.now().toString(36)}`;
    const plan = resolvePlan('FREE');

    const org = await createOrganization({
      name: businessName.trim().slice(0, 255),
      slug,
      ownerUserId,
      planTier: 'FREE',
    });

    const credential = await createApiCredential({
      organizationId: org.id,
      name: 'Free tier default key',
      scopes: [
        'inference:read',
        'inference:execute',
        'projects:read',
        'projects:write',
        'usage:read',
        'audit:read',
        'providers:read',
      ],
      createdBy: ownerUserId,
    });

    await appendAuditEvent({
      organizationId: org.id,
      actorId: ownerUserId,
      eventType: 'ORG_CREATED',
      resourceType: 'organization',
      resourceId: org.id,
      result: 'SUCCESS',
      metadata: { plan: 'FREE', freeSignup: true, emailProvided: Boolean(email) },
    });

    res.status(201).json({
      ok: true,
      message:
        'Free / Community workspace created. No bank account or card required. Save your API key — it is shown once.',
      organization: {
        id: org.id,
        slug: org.slug,
        plan: plan.id,
        label: plan.label,
        quotaRequestsPerDay: plan.quotaRequestsPerDay,
      },
      ownerUserId,
      apiKey: credential.plaintextKey,
      apiKeyPrefix: credential.prefix,
      entitlements: entitlementSnapshot('FREE'),
      billingStatus: 'NOT_CONFIGURED',
      usageMode: 'METERING_ONLY',
      mainnet: 'MAINNET_BLOCKED',
      financialEligibility: false,
      nextSteps: [
        'Store the API key securely (password manager).',
        'Open /pilot and paste the key to use AI inference within free limits.',
        'Upgrade later when ready — payment never unlocks regulated financial features alone.',
      ],
    });
  } catch (e: any) {
    if (e?.code === '23505') {
      res.status(409).json({ ok: false, code: 'CONFLICT', error: 'Organization slug conflict — retry' });
      return;
    }
    res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Free signup failed' });
  }
});

router.get('/plans', (_req, res) => {
  res.json({
    ok: true,
    plans: entitlementSnapshot('FREE'),
    catalog: ['FREE', 'SMALL_BUSINESS', 'BUSINESS', 'PROFESSIONAL', 'ENTERPRISE'].map((id) =>
      entitlementSnapshot(id)
    ),
    billing: 'NOT_CONFIGURED',
    usageMode: 'METERING_ONLY',
    note: 'Paid checkout is not live until Stripe/Nebula billing is configured. Free software access works without payment.',
  });
});

export default router;
