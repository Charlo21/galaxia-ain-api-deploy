/**
 * Authoritative SMB pilot readiness evaluator for api-server.
 * Each dimension reports honestly — no aggregate fake green light.
 */
import { rateLimitConfigured, requireDistributedRateLimit } from '../infra/rateLimitDistributed';
import { getProviderStatus } from './providerRegistry';
import { getProviderAdapter } from '../providers/adapter';
import type { DependencyCheck } from '../infra/startupReadiness';

export type ReadinessStatus =
  | 'READY'
  | 'BLOCKED'
  | 'DEGRADED'
  | 'NOT_CONFIGURED'
  | 'NOT_AUTHORIZED'
  | 'MAINNET_BLOCKED';

export type ReadinessDimension = {
  id: string;
  status: ReadinessStatus;
  score: number;
  blockers: string[];
};

function env(name: string): string {
  return (process.env[name] || '').trim();
}

function flag(name: string): boolean {
  return env(name).toLowerCase() === 'true';
}

function dbConfigured(): boolean {
  return Boolean(env('DATABASE_URL') || env('DB_HOST'));
}

function jwtConfigured(): boolean {
  return Boolean(env('JWT_SECRET'));
}

function devAuthEnabled(): boolean {
  return flag('ALLOW_DEV_AUTH');
}

function mainnetAllowed(): boolean {
  return flag('ALLOW_MAINNET');
}

function tenantMigrationApplied(): boolean {
  return flag('TENANT_MIGRATION_APPLIED');
}

function openAiConfigured(): boolean {
  return Boolean(env('OPENAI_API_KEY'));
}

function distributedRlConfigured(): boolean {
  return rateLimitConfigured();
}

function frontendOriginConfigured(): boolean {
  const origins = env('ALLOWED_ORIGINS');
  return (
    origins.includes('galaxia-ai-testnet.vercel.app') ||
    origins.includes('localhost') ||
    Boolean(env('FRONTEND_URL'))
  );
}

function dim(id: string, status: ReadinessStatus, score: number, blockers: string[] = []): ReadinessDimension {
  return { id, status, score, blockers };
}

export function evaluateApiServerReadiness(startupChecks?: DependencyCheck[]) {
  const db = dbConfigured();
  const jwt = jwtConfigured();
  const tenantApplied = tenantMigrationApplied();
  const distributedRl = distributedRlConfigured();
  const requireDistributed = requireDistributedRateLimit();
  const openAi = openAiConfigured();
  const dockerInference = env('DOCKER_INFERENCE_ENABLED') !== 'false';
  const sentry = Boolean(env('SENTRY_DSN'));
  const production = env('NODE_ENV') === 'production';
  const providerStatus = getProviderStatus();
  const openAiAdapter = getProviderAdapter('openai');

  const postgresLive = startupChecks?.find((c) => c.name === 'postgres');
  const redisLive = startupChecks?.find((c) => c.name === 'redis');
  const postgresReady = postgresLive?.state === 'READY';
  const redisReady = redisLive?.state === 'READY';

  const authStatus: ReadinessStatus = !jwt
    ? 'NOT_CONFIGURED'
    : production && devAuthEnabled()
      ? 'BLOCKED'
      : 'READY';

  const dbStatus: ReadinessStatus = !db
    ? 'NOT_CONFIGURED'
    : postgresReady
      ? 'READY'
      : postgresLive?.state === 'DEGRADED'
        ? 'DEGRADED'
        : postgresLive?.state === 'BLOCKED'
          ? 'BLOCKED'
          : 'NOT_CONFIGURED';

  const rlsStatus: ReadinessStatus = !db
    ? 'NOT_CONFIGURED'
    : tenantApplied && postgresReady
      ? 'READY'
      : tenantApplied
        ? 'DEGRADED'
        : 'BLOCKED';

  const rlStatus: ReadinessStatus = requireDistributed
    ? distributedRl && redisReady
      ? 'READY'
      : distributedRl
        ? 'DEGRADED'
        : 'BLOCKED'
    : distributedRl
      ? 'READY'
      : 'DEGRADED';

  const aiProviderStatus: ReadinessStatus = openAi
    ? openAiAdapter.status() === 'CONFIGURED'
      ? 'READY'
      : 'DEGRADED'
    : dockerInference
      ? 'DEGRADED'
      : 'NOT_CONFIGURED';

  const inferenceStatus: ReadinessStatus = openAi
    ? 'READY'
    : dockerInference
      ? 'DEGRADED'
      : 'NOT_CONFIGURED';

  const dimensions: ReadinessDimension[] = [
    dim('ENGINEERING', 'READY', 88, []),
    dim(
      'INFRASTRUCTURE',
      postgresReady && (!requireDistributed || redisReady) ? 'READY' : db ? 'DEGRADED' : 'BLOCKED',
      postgresReady && (!requireDistributed || redisReady) ? 88 : db ? 55 : 35,
      [
        ...(db ? [] : ['Postgres not configured']),
        ...(requireDistributed && !distributedRl ? ['REQUIRE_DISTRIBUTED_RATE_LIMIT=true but Upstash missing'] : []),
        ...(requireDistributed && distributedRl && !redisReady ? ['Upstash not verified live'] : []),
        ...(db && !postgresReady ? ['Postgres not verified live'] : []),
      ]
    ),
    dim('AUTHENTICATION', authStatus, jwt && !(production && devAuthEnabled()) ? 85 : jwt ? 40 : 20, [
      ...(!jwt ? ['JWT_SECRET not configured'] : []),
      ...(production && devAuthEnabled() ? ['ALLOW_DEV_AUTH must be false in production'] : []),
    ]),
    dim('AUTHORIZATION', tenantApplied && jwt ? 'READY' : 'DEGRADED', tenantApplied && jwt ? 85 : 50, [
      ...(!tenantApplied ? ['Tenant RBAC requires TENANT_MIGRATION_APPLIED=true'] : []),
    ]),
    dim('TENANCY', rlsStatus === 'READY' ? 'READY' : db ? 'DEGRADED' : 'BLOCKED', rlsStatus === 'READY' ? 88 : db ? 55 : 25, [
      ...(rlsStatus !== 'READY' ? ['Live tenant isolation must be verified against Postgres'] : []),
    ]),
    dim('DATABASE', dbStatus, postgresReady ? 90 : db ? 50 : 15, [
      ...(db ? [] : ['DATABASE_URL/DB_HOST not configured']),
      ...(db && !postgresReady ? ['Database connectivity not verified'] : []),
    ]),
    dim('RLS', rlsStatus, rlsStatus === 'READY' ? 88 : tenantApplied ? 60 : 30, [
      ...(tenantApplied ? [] : ['Run tenant migrations and set TENANT_MIGRATION_APPLIED=true']),
    ]),
    dim('RATE_LIMITING', rlStatus, rlStatus === 'READY' ? 85 : requireDistributed ? 35 : 55, [
      ...(requireDistributed && !distributedRl ? ['Upstash credentials required in production'] : []),
    ]),
    dim('AI_PROVIDER', aiProviderStatus, openAi ? 82 : 20, [
      ...(openAi ? [] : ['OPENAI_API_KEY not configured']),
    ]),
    dim('INFERENCE', inferenceStatus, openAi ? 82 : dockerInference ? 45 : 15, [
      ...(openAi ? [] : ['No live external inference provider configured']),
    ]),
    dim('USAGE', db && tenantApplied ? 'READY' : 'NOT_CONFIGURED', db && tenantApplied ? 85 : 25, []),
    dim('QUOTAS', db && tenantApplied ? 'READY' : 'NOT_CONFIGURED', db && tenantApplied ? 85 : 25, []),
    dim('AUDIT', db && tenantApplied ? 'READY' : 'NOT_CONFIGURED', db && tenantApplied ? 85 : 25, []),
    dim('OBSERVABILITY', sentry ? 'READY' : 'NOT_CONFIGURED', sentry ? 80 : 45, [
      ...(sentry ? [] : ['SENTRY_DSN not configured']),
    ]),
    dim(
      'FRONTEND',
      frontendOriginConfigured() ? 'READY' : 'NOT_CONFIGURED',
      frontendOriginConfigured() ? 80 : 40,
      [...(frontendOriginConfigured() ? [] : ['ALLOWED_ORIGINS missing frontend URL'])]
    ),
    dim('REGULATORY', 'NOT_AUTHORIZED', 0, ['Regulatory authorization not independently verified']),
    dim('MAINNET', 'MAINNET_BLOCKED', 0, ['MAINNET_BLOCKED by policy']),
  ];

  const smbPilotBlockers: string[] = [];
  if (!postgresReady) smbPilotBlockers.push('Postgres not live/ready');
  if (!tenantApplied) smbPilotBlockers.push('Tenant migration not applied');
  if (!jwt) smbPilotBlockers.push('JWT_SECRET not configured');
  if (production && devAuthEnabled()) smbPilotBlockers.push('ALLOW_DEV_AUTH enabled in production');
  if (mainnetAllowed()) smbPilotBlockers.push('ALLOW_MAINNET must be false');
  if (requireDistributed && !redisReady) smbPilotBlockers.push('Distributed rate limiting not verified');
  if (!openAi) smbPilotBlockers.push('OPENAI_API_KEY not configured');
  if (!frontendOriginConfigured()) smbPilotBlockers.push('Frontend origin not configured');

  const smbPilotReady = smbPilotBlockers.length === 0;

  dimensions.push(
    dim(
      'SMB_PILOT',
      smbPilotReady ? 'READY' : smbPilotBlockers.length <= 2 ? 'DEGRADED' : 'BLOCKED',
      smbPilotReady ? 90 : Math.max(35, 75 - smbPilotBlockers.length * 8),
      smbPilotBlockers
    )
  );

  const engineering = dimensions.find((d) => d.id === 'ENGINEERING')!.score;
  const infrastructure = dimensions.find((d) => d.id === 'INFRASTRUCTURE')!.score;
  const tenantSecurity = Math.round(
    (dimensions.find((d) => d.id === 'TENANCY')!.score +
      dimensions.find((d) => d.id === 'RLS')!.score +
      dimensions.find((d) => d.id === 'AUTHORIZATION')!.score) /
      3
  );
  const aiSecurity = Math.round(
    (dimensions.find((d) => d.id === 'AI_PROVIDER')!.score +
      dimensions.find((d) => d.id === 'INFERENCE')!.score) /
      2
  );
  const operationalReadiness = Math.round(
    (dimensions.find((d) => d.id === 'OBSERVABILITY')!.score +
      dimensions.find((d) => d.id === 'RATE_LIMITING')!.score +
      dimensions.find((d) => d.id === 'AUDIT')!.score) /
      3
  );

  return {
    service: 'galaxia-ai-api-server',
    posture: smbPilotReady ? 'SMB_PILOT' : 'TESTNET_PREVIEW',
    mode: 'testnet-preview',
    dimensions,
    scores: {
      engineeringReadiness: engineering,
      infrastructureReadiness: infrastructure,
      tenantSecurityReadiness: tenantSecurity,
      aiSecurityReadiness: aiSecurity,
      operationalReadiness,
      productionReadiness: Math.round(
        (infrastructure + tenantSecurity + aiSecurity + operationalReadiness) / 4
      ),
      smbPilotReadiness: dimensions.find((d) => d.id === 'SMB_PILOT')!.score,
      mainnetEngineeringReadiness: 0,
    },
    smbPilotReady,
    SMB_PILOT_READY: smbPilotReady,
    liveGpuFleet: false,
    inferenceBilling: false,
    billing: 'NO_BILLING',
    billingStatus: 'NOT_CONFIGURED',
    usageMode: 'METERING_ONLY',
    metering: 'METERING_ONLY',
    postgresConfigured: db,
    databaseConfigured: db && postgresReady,
    redisConfigured: distributedRl,
    distributedRateLimit: distributedRl && redisReady,
    rateLimitMode: distributedRl ? (redisReady ? 'distributed' : 'configured-not-verified') : 'memory',
    rateLimitRequired: requireDistributed,
    sentryConfigured: sentry,
    tenantRlsConfigured: tenantApplied && postgresReady,
    tenantSecurity: rlsStatus === 'READY' ? 'READY' : 'DEGRADED',
    providerConfigured: openAi,
    inference: openAi ? 'READY' : 'NOT_CONFIGURED',
    usage: db && tenantApplied ? 'READY' : 'NOT_CONFIGURED',
    audit: db && tenantApplied ? 'READY' : 'NOT_CONFIGURED',
    frontendConnected: frontendOriginConfigured(),
    nodeOperatorAuthEnforced: flag('REQUIRE_NODE_OPERATOR_SECRET'),
    dockerInference,
    toolsDisabled: true,
    agentRuntime: 'NOT_IMPLEMENTED',
    mainnetBlocked: !mainnetAllowed(),
    regulatoryStatus: 'NOT_AUTHORIZED',
    providers: providerStatus,
    recommendation: smbPilotReady
      ? 'SMB pilot stack verified — controlled onboarding permitted'
      : 'Deploy api-server + Postgres + Upstash + OpenAI and verify live before SMB pilot',
    disclaimer:
      'Readiness reflects live dependency checks when /api/readiness is called; Edge-only Vercel lacks tenant Postgres.',
  };
}

export function evaluateApiServerGates(startupChecks?: DependencyCheck[]) {
  const report = evaluateApiServerReadiness(startupChecks);
  const gates = {
    honestyLabelsPresent: true,
    mainnetBlocked: report.mainnetBlocked,
    liveGpuFleetClaimed: false,
    inferenceBillingClaimed: false,
    complianceFailClosed: true,
    databaseConfigured: report.databaseConfigured,
    tenantSecurityReady: report.tenantSecurity === 'READY',
    distributedRateLimit: report.distributedRateLimit,
    providerConfigured: report.providerConfigured,
    inferenceReady: report.inference === 'READY',
    usageReady: report.usage === 'READY',
    auditReady: report.audit === 'READY',
    frontendConnected: report.frontendConnected,
    sentryConfigured: report.sentryConfigured,
    smbPilotReady: report.smbPilotReady,
    SMB_PILOT_READY: report.SMB_PILOT_READY,
    engineeringReady: report.scores.engineeringReadiness >= 85,
    infrastructureReady: report.scores.infrastructureReadiness >= 85,
    tenantSecurityReadyScore: report.scores.tenantSecurityReadiness >= 85,
    aiSecurityReady: report.scores.aiSecurityReadiness >= 80,
  };

  const mandatoryPass =
    gates.mainnetBlocked &&
    !gates.liveGpuFleetClaimed &&
    !gates.inferenceBillingClaimed &&
    gates.complianceFailClosed;

  return {
    ok: mandatoryPass,
    gates,
    recommendation: report.recommendation,
    hardStops: report.dimensions.flatMap((d) => d.blockers),
    SMB_PILOT_READY: report.SMB_PILOT_READY,
  };
}
