import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from 'dotenv';
import { createLogger, format, transports } from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { authenticateApiKey, rateLimit, AuthenticatedRequest, generateApiKey } from './middleware/auth';
import { authenticateGalaxiaId, optionalGalaxiaAuth } from './middleware/galaxiaAuth';
import { verifyQuantumSignature } from './middleware/quantumSecurity';
import { processPrivateTask } from './services/privacy/zkProofs';
import { recordOnChain } from './services/blockchain/verification';
import { getCompetitiveMetrics, getTokenEconomicsMetrics } from './services/tokenEconomics';
import { getPaymentEfficiency } from './services/economics/directPayment';
import { registerNode, updateNodeHealth, getNodeByDeviceId } from './services/nodeRegistry';
import { createTask, assignTask, getTask, completeTask, handleTaskFailure } from './services/taskDistribution';
import { verifyTaskResults } from './services/resultVerification';
import { processPayment, getUserBalance, distributeNodePayments } from './services/payment';
import { runInference, validateInput } from './services/aiInference';
import { taskQueue } from './services/taskQueue';
import { pool } from './config/database';
import { handleErrors, asyncHandler, notFoundHandler } from './middleware/errorHandler';
import { getHealthData, getMetrics, trackRequest } from './middleware/monitoring';
import swaggerRouter from './routes/swagger';
import complianceRouter from './routes/compliance';
import { complianceMiddleware } from './middleware/compliance';
import { setCSRFToken, csrfProtection } from './middleware/csrf';
import cookieParser from 'cookie-parser';
import './config/galaxia'; // Initialize Galaxia ecosystem

// Load environment variables
config();

// Initialize logger
export const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    }),
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' })
  ]
});

// Initialize Express app
export const app = express();
const PORT = process.env.PORT || 3000;

// Security Middleware
import { configureCORS, limitRequestSize, securityHeaders } from './middleware/security';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow external resources
}));
app.use(configureCORS());
app.use(securityHeaders);
app.use(express.json({ limit: '10mb' })); // Reduced from 50mb for security
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(limitRequestSize('10mb'));
app.use(cookieParser()); // For CSRF token cookies
app.use(setCSRFToken); // Set CSRF token for all requests
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Correlation ID + deployment provenance (Galaxia ID parity)
import { correlationMiddleware, getCommitSha } from './middleware/correlation';
app.use(correlationMiddleware);

import { evaluateStartupReadiness, validateEnvironment } from './infra/startupReadiness';
import { initSentry, sentryActive } from './infra/sentry';

// Validate environment on boot
const envCheck = validateEnvironment();
if (!envCheck.ok) {
  logger.error('Environment validation failed', { errors: envCheck.errors });
  if (process.env.NODE_ENV === 'production') process.exit(1);
}
initSentry();

// Request tracking
app.use(trackRequest);

// Health check + provenance
app.get('/health', asyncHandler(async (req: Request, res: Response) => {
  const health = await getHealthData();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json({
    ...health,
    commit: getCommitSha(),
    service: 'galaxia-ai-api-server',
    mode: 'testnet-preview',
    compute: 'simulated',
    liveGpuFleet: false,
    inferenceBilling: false,
    disclaimer:
      'Testnet Preview api-server — do not treat as production GPU infrastructure or live inference billing.',
    timestamp: new Date().toISOString(),
  });
}));

app.get('/live', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    status: 'alive',
    commit: getCommitSha(),
    service: 'galaxia-ai-api-server',
    mode: 'testnet-preview',
    timestamp: new Date().toISOString(),
  });
});

app.get('/ready', asyncHandler(async (_req: Request, res: Response) => {
  const startup = await evaluateStartupReadiness();
  const statusCode = startup.ready ? 200 : startup.state === 'DEGRADED' ? 200 : 503;
  res.status(statusCode).json({
    ok: startup.ready,
    status: startup.ready ? 'ready' : startup.state === 'DEGRADED' ? 'degraded' : 'not_ready',
    state: startup.state,
    commit: getCommitSha(),
    mode: 'testnet-preview',
    checks: startup.checks,
    blockers: startup.blockers,
    sentryConfigured: sentryActive(),
    service: 'galaxia-ai-api-server',
    timestamp: new Date().toISOString(),
  });
}));

// Metrics endpoint
app.get('/metrics', asyncHandler(async (req: Request, res: Response) => {
  const metrics = await getMetrics();
  res.json({ ...metrics, commit: getCommitSha() });
}));

// Swagger documentation
app.use('/', swaggerRouter);

// Compliance middleware (applies to all routes)
app.use(complianceMiddleware);

// Compliance routes
app.use('/v1/compliance', complianceRouter);

// Integration routes (new applications)
import integrationRouter from './routes/integrations';
app.use('/v1/integrations', integrationRouter);

// Audit routes
import auditRouter from './routes/audit';
app.use('/api/v1/audit', auditRouter);

// Issuance routes
import issuanceRouter from './routes/issuance';
app.use('/api/v1/issuance', issuanceRouter);

// Post-quantum health/status
import postQuantumRouter from './routes/postQuantum';
app.use('/api/post-quantum', postQuantumRouter);

// Testnet Preview activity + simulated jobs (file-backed; always labeled simulated)
import activityRouter from './routes/activity';
app.use('/v1/activity', activityRouter);

import { getProviderStatus, resolveModel } from './security/providerRegistry';
import { evaluateApiServerReadiness, evaluateApiServerGates } from './security/readiness';

app.get('/v1/providers/status', (_req, res) => {
  res.json({ ok: true, ...getProviderStatus() });
});

app.get('/api/readiness', asyncHandler(async (_req, res) => {
  const startup = await evaluateStartupReadiness();
  res.json({ ok: true, ...evaluateApiServerReadiness(startup.checks) });
}));

app.get('/api/gates', asyncHandler(async (_req, res) => {
  const startup = await evaluateStartupReadiness();
  const gates = evaluateApiServerGates(startup.checks);
  res.status(gates.gates.smbPilotReady ? 200 : 503).json({
    ...gates,
    commit: getCommitSha(),
    service: 'galaxia-ai-api-server',
    timestamp: new Date().toISOString(),
  });
}));

app.get('/api/status', asyncHandler(async (_req, res) => {
  const startup = await evaluateStartupReadiness();
  const readiness = evaluateApiServerReadiness(startup.checks);
  res.json({
    ok: true,
    service: 'galaxia-ai-api-server',
    posture: readiness.posture,
    mode: 'testnet-preview',
    compute: readiness.smbPilotReady ? 'live-inference' : 'simulated',
    liveGpuFleet: false,
    inferenceBilling: false,
    billing: readiness.billing,
    metering: readiness.metering,
    scores: readiness.scores,
    SMB_PILOT_READY: readiness.SMB_PILOT_READY,
    databaseConfigured: readiness.databaseConfigured,
    tenantSecurity: readiness.tenantSecurity,
    distributedRateLimit: readiness.distributedRateLimit,
    providerConfigured: readiness.providerConfigured,
    inference: readiness.inference,
    usage: readiness.usage,
    audit: readiness.audit,
    frontendConnected: readiness.frontendConnected,
    mainnetBlocked: readiness.mainnetBlocked,
    regulatoryStatus: readiness.regulatoryStatus,
    sentryConfigured: readiness.sentryConfigured,
    startup: {
      ready: startup.ready,
      state: startup.state,
      blockers: startup.blockers,
    },
    recommendation: readiness.recommendation,
    commit: getCommitSha(),
    timestamp: new Date().toISOString(),
  });
}));

// Multi-tenant API (Postgres + RLS) — requires self-hosted api-server with migrations applied
import tenantRouter from './routes/tenant';
app.use('/v1/tenant', tenantRouter);

// ==================== NODE ENDPOINTS ====================
import { requireNodeOperatorSecret } from './middleware/nodeOperatorAuth';

/**
 * POST /v1/nodes/register
 * Register a new compute node
 */
app.post('/v1/nodes/register', requireNodeOperatorSecret, async (req: Request, res: Response) => {
  try {
    const { device_id, wallet_address, capabilities, location } = req.body;
    const clientIP = req.ip || req.socket.remoteAddress || 'unknown';
    
    if (!device_id || !wallet_address || !capabilities) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const node = await registerNode(
      { device_id, wallet_address, capabilities, location },
      clientIP
    );
    
    res.json({
      success: true,
      node: {
        id: node.id,
        device_id: node.device_id,
        status: node.status,
        reputation: node.reputation,
      }
    });
  } catch (error: any) {
    logger.error('Node registration error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /v1/nodes/heartbeat
 * Update node health/heartbeat
 */
app.post('/v1/nodes/heartbeat', requireNodeOperatorSecret, async (req: Request, res: Response) => {
  try {
    const { device_id, cpu_usage, memory_usage, gpu_usage, active_tasks, response_time_ms } = req.body;
    
    if (!device_id) {
      return res.status(400).json({ error: 'device_id required' });
    }
    
    await updateNodeHealth(device_id, {
      cpu_usage,
      memory_usage,
      gpu_usage,
      active_tasks,
      response_time_ms,
    });
    
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Heartbeat error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /v1/nodes/tasks/:taskId/complete
 * Node reports task completion
 */
app.post('/v1/nodes/tasks/:taskId/complete', requireNodeOperatorSecret, async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { device_id, output, processing_time_ms } = req.body;
    
    if (!device_id || !output) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const node = await getNodeByDeviceId(device_id);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }
    
    await completeTask(taskId, node.id, output, processing_time_ms || 0);
    
    // Check if we have enough results for consensus
    const task = await getTask(taskId);
    if (task) {
      const result = await verifyTaskResults(taskId);
      if (result.consensus) {
        // Distribute payments to nodes
        await distributeNodePayments(taskId, task.assigned_nodes);
      }
    }
    
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Task completion error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /v1/nodes/tasks/:taskId/fail
 * Node reports task failure
 */
app.post('/v1/nodes/tasks/:taskId/fail', requireNodeOperatorSecret, async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { device_id, error_message } = req.body;
    
    if (!device_id) {
      return res.status(400).json({ error: 'device_id required' });
    }
    
    const node = await getNodeByDeviceId(device_id);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }
    
    await handleTaskFailure(taskId, node.id);
    
    res.json({ success: true });
  } catch (error: any) {
    logger.error('Task failure error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ==================== DEVELOPER API ENDPOINTS ====================

/**
 * POST /v1/inference
 * Main inference endpoint for developers
 * Supports both Galaxia ID and API key authentication
 */
app.post('/v1/inference', optionalGalaxiaAuth, authenticateApiKey, csrfProtection, rateLimit, verifyQuantumSignature, async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  const requestId = (req as any).id;
  
  try {
    const { model, input, priority, region, privacy_level } = req.body;
    
    // Validate request
    if (!model || !input) {
      return res.status(400).json({
        error: 'Missing required fields: model and input',
        code: 'INVALID_INPUT',
        request_id: requestId,
        mode: 'testnet-preview',
      });
    }

    const modelCheck = resolveModel(model);
    if (modelCheck.ok === false) {
      return res.status(modelCheck.code === 'MODEL_NOT_ALLOWED' ? 403 : 503).json({
        error: modelCheck.message,
        code: modelCheck.code,
        request_id: requestId,
        mode: 'testnet-preview',
      });
    }
    
    // Determine input type
    let inputType: 'text' | 'image' | 'audio' = 'text';
    if (model === 'stable-diffusion') inputType = 'image';
    if (model === 'whisper') inputType = 'audio';
    
    // Validate input
    if (!validateInput(input, inputType)) {
      return res.status(400).json({
        error: 'Invalid input: contains malicious content or exceeds size limits',
        request_id: requestId
      });
    }
    
    // Process privacy-preserving computation if requested
    const privacyLevel = privacy_level || 'public';
    let processedInput = input;
    let privacyFeatures: any = {};
    
    // Create temporary task ID for privacy processing
    const tempTaskId = uuidv4();
    
    if (privacyLevel !== 'public') {
      try {
        const privacyResult = await processPrivateTask(tempTaskId, input, privacyLevel);
        if (privacyResult.encryptedInput) {
          processedInput = privacyResult.encryptedInput;
          privacyFeatures.encrypted = true;
        }
        if (privacyResult.zkProof) {
          privacyFeatures.zkProof = true;
        }
        privacyFeatures.requiresTEE = privacyResult.requiresTEE;
      } catch (error: any) {
        logger.warn('Privacy processing failed, using standard mode', { error: error.message });
      }
    }
    
    // Check user balance
    if (req.userId) {
      const userWallet = req.galaxiaUser?.address;
      const balance = await getUserBalance(req.userId, userWallet);
      // Rough cost estimate
      const estimatedCost = inputType === 'text' ? 0.01 : inputType === 'image' ? 0.05 : 0.02;
      if (balance < estimatedCost) {
        return res.status(402).json({
          error: 'Insufficient balance',
          request_id: requestId,
          balance,
          required: estimatedCost
        });
      }
    }
    
    // Create task
    // Create task
    const task = await createTask({
      model_id: model,
      input_data: processedInput,
      input_type: inputType,
      priority: priority || 'standard',
      region: region || 'auto',
      api_key_id: req.apiKeyId,
    });
    
    // Store privacy settings
    if (privacyLevel !== 'public') {
      await pool.query(
        `INSERT INTO privacy_settings (task_id, privacy_level, encrypt_input, use_zk_proof)
         VALUES ($1, $2, $3, $4)`,
        [task.id, privacyLevel, privacyFeatures.encrypted, privacyFeatures.zkProof]
      );
    }
    
    // Assign to nodes
    const assignedNodes = await assignTask(task.id, {
      model_id: model,
      priority: priority || 'standard',
      region: region || 'auto',
    });
    
    // Enqueue task for async processing (with privacy level)
    await taskQueue.enqueue(task.id, model, input, inputType, privacyLevel as any);
    
    // Record on blockchain for verifiable computation
    try {
      const crypto = require('crypto');
      const inputHash = crypto.createHash('sha256').update(input).digest('hex');
      await recordOnChain(task.id, assignedNodes, inputHash);
    } catch (error: any) {
      logger.warn('Blockchain recording failed', { error: error.message });
    }
    
    // Return task ID immediately
    res.json({
      task_id: task.id,
      status: 'queued',
      nodes_assigned: assignedNodes.length,
      estimated_cost: task.cost_tokens,
      privacy_level: privacyLevel,
      privacy_features: privacyFeatures,
      platform_fee: 0, // Zero platform fee for competitive positioning
      request_id: requestId
    });
    
  } catch (error: any) {
    logger.error('Inference error:', error);
    res.status(500).json({
      error: 'Internal server error',
      request_id: requestId
    });
  }
});

/**
 * GET /v1/tasks/:taskId
 * Get task status and results
 */
app.get('/v1/tasks/:taskId', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { taskId } = req.params;
    
    const task = await getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Get consensus result if completed
    let finalOutput = null;
    if (task.status === 'completed') {
      const consensusResult = await pool.query(
        'SELECT final_output, confidence_score FROM consensus_results WHERE task_id = $1',
        [taskId]
      );
      if (consensusResult.rows.length > 0) {
        finalOutput = consensusResult.rows[0].final_output;
      }
    }
    
    res.json({
      task_id: task.id,
      status: task.status,
      model: task.model_id,
      priority: task.priority,
      nodes_used: task.assigned_nodes.length,
      latency_ms: task.latency_ms,
      cost_tokens: task.cost_tokens,
      result: finalOutput,
      created_at: task.created_at,
      completed_at: task.completed_at,
    });
  } catch (error: any) {
    logger.error('Get task error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /v1/models
 * Get available models and pricing
 */
app.get('/v1/models', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, type, cost_per_1k_tokens, cost_per_image, cost_per_minute, requires_gpu FROM models WHERE is_active = true'
    );
    
    res.json({
      models: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        type: row.type,
        pricing: {
          per_1k_tokens: parseFloat(row.cost_per_1k_tokens) || null,
          per_image: parseFloat(row.cost_per_image) || null,
          per_minute: parseFloat(row.cost_per_minute) || null,
        },
        requires_gpu: row.requires_gpu,
      }))
    });
  } catch (error: any) {
    logger.error('Get models error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /v1/api-keys
 * Generate new API key
 */
app.post('/v1/api-keys', async (req: Request, res: Response) => {
  try {
    const { user_id, name } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id required' });
    }
    
    const { apiKey, id } = await generateApiKey(user_id, name);
    
    res.json({
      api_key: apiKey,
      api_key_id: id,
      warning: 'Save this API key securely. It will not be shown again.',
    });
  } catch (error: any) {
    logger.error('API key generation error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ==================== ADMIN ENDPOINTS ====================

/**
 * GET /v1/admin/nodes
 * Get all nodes (admin only)
 */
import { requireAdmin } from './middleware/adminAuth';
app.get('/v1/admin/nodes', authenticateApiKey, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, device_id, wallet_address, capabilities, location, 
              reputation, status, tasks_completed, total_earnings, last_seen
       FROM nodes
       ORDER BY reputation DESC, last_seen DESC`
    );
    
    res.json({
      nodes: result.rows.map(row => ({
        id: row.id,
        device_id: row.device_id,
        wallet_address: row.wallet_address,
        capabilities: row.capabilities,
        location: row.location,
        reputation: parseFloat(row.reputation),
        status: row.status,
        tasks_completed: row.tasks_completed,
        total_earnings: parseFloat(row.total_earnings),
        last_seen: row.last_seen,
      }))
    });
  } catch (error: any) {
    logger.error('Admin nodes error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /v1/competitive/metrics
 * Get competitive positioning metrics
 */
app.get('/v1/competitive/metrics', async (req: Request, res: Response) => {
  try {
    const [competitive, token, payment] = await Promise.all([
      getCompetitiveMetrics(),
      getTokenEconomicsMetrics(),
      getPaymentEfficiency(),
    ]);
    
    res.json({
      mode: 'testnet-preview',
      simulated: true,
      disclaimer:
        'Competitive / token / payment figures from this endpoint are testnet or internal model outputs — not audited production revenue or live GPU capacity.',
      liveGpuFleet: false,
      inferenceBilling: false,
      competitive,
      token_economics: token,
      payment_efficiency: payment,
    });
  } catch (error: any) {
    logger.error('Competitive metrics error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /v1/admin/stats
 * Get network statistics
 */
app.get('/v1/admin/stats', authenticateApiKey, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [nodes, tasks, earnings] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total, 
                         COUNT(*) FILTER (WHERE status = 'online') as online,
                         AVG(reputation) as avg_reputation
                  FROM nodes`),
      pool.query(`SELECT COUNT(*) as total,
                         COUNT(*) FILTER (WHERE status = 'completed') as completed,
                         AVG(latency_ms) as avg_latency
                  FROM tasks`),
      pool.query(`SELECT SUM(total_earnings) as total_paid
                  FROM nodes`)
    ]);
    
    res.json({
      nodes: {
        total: parseInt(nodes.rows[0].total),
        online: parseInt(nodes.rows[0].online),
        avg_reputation: parseFloat(nodes.rows[0].avg_reputation) || 0,
      },
      tasks: {
        total: parseInt(tasks.rows[0].total),
        completed: parseInt(tasks.rows[0].completed),
        avg_latency_ms: parseFloat(tasks.rows[0].avg_latency) || 0,
      },
      earnings: {
        total_paid: parseFloat(earnings.rows[0].total_paid) || 0,
      }
    });
  } catch (error: any) {
    logger.error('Admin stats error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ==================== HELPER FUNCTIONS ====================
// (Task processing now handled by taskQueue service)

// 404 handler
app.use(notFoundHandler);

// Error handling middleware (must be last)
app.use(handleErrors);

// Start server
const server = app.listen(PORT, () => {
  logger.info(`Galaxia API Server running on port ${PORT}`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

