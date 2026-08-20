/**
 * Testnet Preview activity + simulated job routes.
 * Public read/write with forced simulated labels — no production billing claims.
 */
import express, { Request, Response } from 'express';
import {
  appendActivity,
  listActivity,
  listJobs,
  storeMeta,
  upsertJob,
} from '../services/activityStore';

const router = express.Router();

const windowMs = 60_000;
const buckets = new Map<string, number[]>();

function clientIp(req: Request): string {
  const xf = (req.headers['x-forwarded-for'] as string) || '';
  return xf.split(',')[0]?.trim() || req.ip || 'anonymous';
}

function limit(req: Request, res: Response, max: number): boolean {
  const key = clientIp(req);
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    res.status(429).json({
      ok: false,
      error: 'rate_limited',
      mode: 'testnet-preview',
      message: 'Too many activity requests',
    });
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

/** GET /v1/activity — list server-persisted simulated events */
router.get('/', (req: Request, res: Response) => {
  if (!limit(req, res, 60)) return;
  const limitN = Math.min(parseInt(String(req.query.limit || '100'), 10) || 100, 200);
  const data = listActivity(limitN);
  res.json({
    ok: true,
    ...data,
    liveGpuFleet: false,
    inferenceBilling: false,
  });
});

/** POST /v1/activity — append simulated event (always forced simulated) */
router.post('/', (req: Request, res: Response) => {
  if (!limit(req, res, 30)) return;
  const body = req.body || {};
  if (!body.title || !body.kind) {
    res.status(400).json({
      ok: false,
      error: 'title and kind required',
      mode: 'testnet-preview',
    });
    return;
  }
  const event = appendActivity({
    id: body.id,
    kind: body.kind,
    title: body.title,
    detail: body.detail || '',
    source: 'simulated',
    at: body.at,
    refs: body.refs,
    clientId: body.clientId,
  });
  res.status(201).json({
    ok: true,
    event,
    mode: 'testnet-preview',
    simulated: true,
    persistence: 'server-file',
    disclaimer:
      'Event stored as Testnet Preview / simulated. Not a live GPU or billed inference record.',
  });
});

/** GET /v1/activity/jobs — list simulated jobs */
router.get('/jobs', (req: Request, res: Response) => {
  if (!limit(req, res, 60)) return;
  const limitN = Math.min(parseInt(String(req.query.limit || '100'), 10) || 100, 200);
  const data = listJobs(limitN);
  res.json({
    ok: true,
    ...data,
    liveGpuFleet: false,
    inferenceBilling: false,
  });
});

/** POST /v1/activity/jobs — upsert simulated job */
router.post('/jobs', (req: Request, res: Response) => {
  if (!limit(req, res, 30)) return;
  const body = req.body || {};
  if (!body.name) {
    res.status(400).json({ ok: false, error: 'name required', mode: 'testnet-preview' });
    return;
  }
  const job = upsertJob({
    id: body.id,
    name: body.name,
    status: body.status || 'simulated',
    description: body.description,
    industryId: body.industryId,
    templateId: body.templateId,
    estimatedGpuHours: body.estimatedGpuHours,
    costLabel: body.costLabel || 'Testnet Estimate — not billed',
    progressPct: body.progressPct,
    createdAt: body.createdAt,
    matchedNodes: body.matchedNodes,
  });
  appendActivity({
    kind: 'job',
    title: `Job recorded: ${job.name}`,
    detail: `Server-persisted simulated job (${job.status}). Not live GPU execution.`,
    refs: { jobId: job.id, workloadId: job.id },
    clientId: body.clientId,
  });
  res.status(201).json({
    ok: true,
    job,
    mode: 'testnet-preview',
    simulated: true,
    persistence: 'server-file',
  });
});

/** GET /v1/activity/meta */
router.get('/meta', (req: Request, res: Response) => {
  if (!limit(req, res, 60)) return;
  res.json({ ok: true, ...storeMeta() });
});

export default router;
