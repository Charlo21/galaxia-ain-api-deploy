/**
 * Enhanced Rate Limiting Middleware
 * Uses database-backed rate limiting for distributed systems
 */

import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { pool } from '../config/database';
import { logger } from '../index';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyGenerator?: (req: Request) => string; // Custom key generator
}

/**
 * Database-backed rate limiter
 */
export function createRateLimiter(config: RateLimitConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = config.keyGenerator
        ? config.keyGenerator(req)
        : (req as AuthenticatedRequest).apiKeyId || req.ip || 'anonymous';
      
      const now = Date.now();
      const windowStart = now - config.windowMs;
      
      // Clean up old entries
      await pool.query(
        `DELETE FROM rate_limits WHERE reset_at < $1`,
        [new Date(windowStart)]
      );
      
      // Get current count
      const result = await pool.query(
        `SELECT count, reset_at FROM rate_limits 
         WHERE key = $1 AND reset_at > $2`,
        [key, new Date(windowStart)]
      );
      
      let count = 0;
      let resetAt = new Date(now + config.windowMs);
      
      if (result.rows.length > 0) {
        count = parseInt(result.rows[0].count) || 0;
        resetAt = new Date(result.rows[0].reset_at);
      }
      
      // Check limit
      if (count >= config.maxRequests) {
        const retryAfter = Math.ceil((resetAt.getTime() - now) / 1000);
        
        res.setHeader('X-RateLimit-Limit', config.maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', resetAt.toISOString());
        res.setHeader('Retry-After', retryAfter.toString());
        
        logger.warn('Rate limit exceeded', {
          key,
          count,
          limit: config.maxRequests,
          path: req.path
        });
        
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter,
          limit: config.maxRequests
        });
      }
      
      // Increment count
      await pool.query(
        `INSERT INTO rate_limits (key, count, reset_at, created_at)
         VALUES ($1, 1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) 
         DO UPDATE SET 
           count = rate_limits.count + 1,
           reset_at = EXCLUDED.reset_at
         WHERE rate_limits.reset_at < EXCLUDED.reset_at`,
        [key, resetAt]
      );
      
      // Set headers
      res.setHeader('X-RateLimit-Limit', config.maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', (config.maxRequests - count - 1).toString());
      res.setHeader('X-RateLimit-Reset', resetAt.toISOString());
      
      next();
    } catch (error: any) {
      logger.error('Rate limiting error', { error: error.message });
      // Fail open - allow request if rate limiting fails
      next();
    }
  };
}

/**
 * Create rate limit table if it doesn't exist
 */
export async function initializeRateLimitTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key VARCHAR(255) PRIMARY KEY,
        count INTEGER DEFAULT 1,
        reset_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);
    `);
  } catch (error: any) {
    logger.error('Failed to initialize rate limit table', { error: error.message });
  }
}
