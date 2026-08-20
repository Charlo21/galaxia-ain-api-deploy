import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { taskQueue } from '../services/taskQueue';

/**
 * Health check endpoint data
 */
export async function getHealthData(): Promise<{
  status: string;
  database: { connected: boolean; latency?: number };
  queue: { queued: number; processing: number };
  timestamp: string;
}> {
  const startTime = Date.now();
  let dbConnected = false;
  let dbLatency: number | undefined;

  try {
    await pool.query('SELECT 1');
    dbConnected = true;
    dbLatency = Date.now() - startTime;
  } catch (error) {
    dbConnected = false;
  }

  const queueStatus = taskQueue.getStatus();

  return {
    status: dbConnected ? 'healthy' : 'unhealthy',
    database: {
      connected: dbConnected,
      latency: dbLatency,
    },
    queue: queueStatus,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Metrics endpoint data
 */
export async function getMetrics(): Promise<{
  nodes: {
    total: number;
    online: number;
    offline: number;
    avg_reputation: number;
  };
  tasks: {
    total: number;
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    avg_latency_ms: number;
  };
  performance: {
    requests_per_minute: number;
    error_rate: number;
  };
}> {
  const client = await pool.connect();
  
  try {
    // Node metrics
    const nodesResult = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'online' AND last_seen > NOW() - INTERVAL '5 minutes') as online,
        COUNT(*) FILTER (WHERE status = 'offline' OR last_seen < NOW() - INTERVAL '5 minutes') as offline,
        AVG(reputation) as avg_reputation
      FROM nodes
    `);

    // Task metrics
    const tasksResult = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'queued') as queued,
        COUNT(*) FILTER (WHERE status = 'assigned' OR status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        AVG(latency_ms) as avg_latency_ms
      FROM tasks
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `);

    const queueStatus = taskQueue.getStatus();

    return {
      nodes: {
        total: parseInt(nodesResult.rows[0].total),
        online: parseInt(nodesResult.rows[0].online),
        offline: parseInt(nodesResult.rows[0].offline),
        avg_reputation: parseFloat(nodesResult.rows[0].avg_reputation) || 0,
      },
      tasks: {
        total: parseInt(tasksResult.rows[0].total),
        queued: parseInt(tasksResult.rows[0].queued) + queueStatus.queued,
        processing: parseInt(tasksResult.rows[0].processing) + queueStatus.processing,
        completed: parseInt(tasksResult.rows[0].completed),
        failed: parseInt(tasksResult.rows[0].failed),
        avg_latency_ms: parseFloat(tasksResult.rows[0].avg_latency_ms) || 0,
      },
      performance: getRequestMetrics(),
    };
  } finally {
    client.release();
  }
}

/**
 * Request metrics middleware
 */
const requestMetrics = {
  count: 0,
  errors: 0,
  startTime: Date.now(),
  requestsByMinute: new Map<number, number>(), // Track requests per minute
  errorsByMinute: new Map<number, number>(),   // Track errors per minute
};

export function trackRequest(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const minute = Math.floor(now / 60000); // Current minute timestamp
  
  requestMetrics.count++;
  
  // Track requests per minute
  requestMetrics.requestsByMinute.set(
    minute,
    (requestMetrics.requestsByMinute.get(minute) || 0) + 1
  );
  
  // Clean up old data (keep last 60 minutes)
  const cutoff = minute - 60;
  for (const [key] of requestMetrics.requestsByMinute) {
    if (key < cutoff) {
      requestMetrics.requestsByMinute.delete(key);
    }
  }
  
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      requestMetrics.errors++;
      requestMetrics.errorsByMinute.set(
        minute,
        (requestMetrics.errorsByMinute.get(minute) || 0) + 1
      );
    }
  });
  
  next();
}

export function getRequestMetrics() {
  const now = Date.now();
  const currentMinute = Math.floor(now / 60000);
  
  // Calculate requests per minute (average of last 5 minutes)
  let totalRequests = 0;
  let totalErrors = 0;
  let minuteCount = 0;
  
  for (let i = 0; i < 5; i++) {
    const minute = currentMinute - i;
    const requests = requestMetrics.requestsByMinute.get(minute) || 0;
    const errors = requestMetrics.errorsByMinute.get(minute) || 0;
    totalRequests += requests;
    totalErrors += errors;
    if (requests > 0) minuteCount++;
  }
  
  const requestsPerMinute = minuteCount > 0 ? totalRequests / minuteCount : 0;
  const errorRate = requestMetrics.count > 0 
    ? (requestMetrics.errors / requestMetrics.count) * 100 
    : 0;
  
  return {
    requests_per_minute: Math.round(requestsPerMinute * 100) / 100,
    error_rate: Math.round(errorRate * 100) / 100,
    total_requests: requestMetrics.count,
    total_errors: requestMetrics.errors,
  };
}

