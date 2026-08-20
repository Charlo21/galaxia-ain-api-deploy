/**
 * File-backed Testnet Preview activity + job store.
 * Survives api-server restarts. Not a production ledger.
 * All records are forced simulated — never claim live GPU billing.
 */
import fs from 'fs';
import path from 'path';

export type ActivityKind = 'workload' | 'node' | 'demo' | 'system' | 'job';

export interface ServerActivityEvent {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  source: 'simulated' | 'testnet-demo';
  simulated: true;
  mode: 'testnet-preview';
  at: string;
  refs?: { workloadId?: string; nodeId?: string; jobId?: string };
  clientId?: string;
}

export interface ServerJobRecord {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'simulated';
  source: 'simulated' | 'testnet-demo';
  simulated: true;
  mode: 'testnet-preview';
  description?: string;
  industryId?: string;
  templateId?: string;
  estimatedGpuHours?: number;
  costLabel: string;
  progressPct: number;
  createdAt: string;
  updatedAt: string;
  matchedNodes?: string[];
}

type StoreShape = {
  version: 1;
  mode: 'testnet-preview';
  disclaimer: string;
  activity: ServerActivityEvent[];
  jobs: ServerJobRecord[];
};

const DISCLAIMER =
  'Testnet Preview store — simulated activity only. Not production GPU metering, billing, or verified compute.';

const DATA_DIR = process.env.ACTIVITY_DATA_DIR || path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'testnet-activity.json');
const MAX_ACTIVITY = 500;
const MAX_JOBS = 200;

function emptyStore(): StoreShape {
  return {
    version: 1,
    mode: 'testnet-preview',
    disclaimer: DISCLAIMER,
    activity: [],
    jobs: [],
  };
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): StoreShape {
  try {
    ensureDir();
    if (!fs.existsSync(DATA_FILE)) return emptyStore();
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as StoreShape;
    if (!parsed || parsed.version !== 1) return emptyStore();
    return {
      ...emptyStore(),
      ...parsed,
      mode: 'testnet-preview',
      disclaimer: DISCLAIMER,
      activity: Array.isArray(parsed.activity) ? parsed.activity : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: StoreShape) {
  ensureDir();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function listActivity(limit = 100): {
  events: ServerActivityEvent[];
  mode: string;
  disclaimer: string;
  persistence: 'server-file';
} {
  const store = readStore();
  return {
    events: store.activity.slice(0, Math.min(limit, MAX_ACTIVITY)),
    mode: store.mode,
    disclaimer: store.disclaimer,
    persistence: 'server-file',
  };
}

export function appendActivity(
  input: Omit<ServerActivityEvent, 'id' | 'at' | 'simulated' | 'mode' | 'source'> & {
    at?: string;
    source?: 'simulated' | 'testnet-demo';
    id?: string;
  }
): ServerActivityEvent {
  const store = readStore();
  const event: ServerActivityEvent = {
    id: input.id || newId('evt'),
    kind: input.kind,
    title: String(input.title || 'Untitled').slice(0, 200),
    detail: String(input.detail || '').slice(0, 1000),
    source: input.source || 'simulated',
    simulated: true,
    mode: 'testnet-preview',
    at: input.at || new Date().toISOString(),
    refs: input.refs,
    clientId: input.clientId,
  };
  store.activity = [event, ...store.activity.filter((e) => e.id !== event.id)].slice(0, MAX_ACTIVITY);
  writeStore(store);
  return event;
}

export function listJobs(limit = 100): {
  jobs: ServerJobRecord[];
  mode: string;
  disclaimer: string;
  persistence: 'server-file';
} {
  const store = readStore();
  return {
    jobs: store.jobs.slice(0, Math.min(limit, MAX_JOBS)),
    mode: store.mode,
    disclaimer: store.disclaimer,
    persistence: 'server-file',
  };
}

export function upsertJob(
  input: Partial<ServerJobRecord> & { id?: string; name: string }
): ServerJobRecord {
  const store = readStore();
  const now = new Date().toISOString();
  const id = input.id || newId('job');
  const existing = store.jobs.find((j) => j.id === id);
  const job: ServerJobRecord = {
    id,
    name: String(input.name).slice(0, 200),
    status: input.status || existing?.status || 'simulated',
    source: 'simulated',
    simulated: true,
    mode: 'testnet-preview',
    description: input.description ?? existing?.description,
    industryId: input.industryId ?? existing?.industryId,
    templateId: input.templateId ?? existing?.templateId,
    estimatedGpuHours: input.estimatedGpuHours ?? existing?.estimatedGpuHours,
    costLabel: input.costLabel || existing?.costLabel || 'Testnet Estimate — not billed',
    progressPct: typeof input.progressPct === 'number' ? input.progressPct : existing?.progressPct ?? 0,
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
    matchedNodes: input.matchedNodes ?? existing?.matchedNodes,
  };
  store.jobs = [job, ...store.jobs.filter((j) => j.id !== id)].slice(0, MAX_JOBS);
  writeStore(store);
  return job;
}

export function storeMeta() {
  const store = readStore();
  return {
    mode: store.mode,
    disclaimer: store.disclaimer,
    activityCount: store.activity.length,
    jobCount: store.jobs.length,
    persistence: 'server-file' as const,
    path: DATA_FILE,
    liveGpuFleet: false,
    inferenceBilling: false,
  };
}
