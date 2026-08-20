import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import crypto from 'crypto';

export interface AuthenticatedRequest extends Request {
  apiKeyId?: string;
  userId?: string;
}

/**
 * Authenticate API key
 */
export async function authenticateApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    
    if (!apiKey) {
      res.status(401).json({ error: 'API key required' });
      return;
    }
    
    // Hash the provided key
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    // Look up API key
    const result = await pool.query(
      'SELECT * FROM api_keys WHERE key_hash = $1 AND is_active = true',
      [keyHash]
    );
    
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }
    
    const apiKeyRecord = result.rows[0];
    
    // Check expiration
    if (apiKeyRecord.expires_at && new Date(apiKeyRecord.expires_at) < new Date()) {
      res.status(401).json({ error: 'API key expired' });
      return;
    }
    
    // Attach to request
    req.apiKeyId = apiKeyRecord.id;
    req.userId = apiKeyRecord.user_id;
    
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Rate limiting middleware
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const apiKeyId = req.apiKeyId;
  if (!apiKeyId) {
    next();
    return;
  }
  
  const now = Date.now();
  const limit = 100; // 100 requests per minute
  const windowMs = 60 * 1000; // 1 minute
  
  const record = rateLimitMap.get(apiKeyId);
  
  if (!record || now > record.resetAt) {
    // New window
    rateLimitMap.set(apiKeyId, { count: 1, resetAt: now + windowMs });
    next();
    return;
  }
  
  if (record.count >= limit) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil((record.resetAt - now) / 1000),
    });
    return;
  }
  
  record.count++;
  next();
}

/**
 * Generate API key
 */
export async function generateApiKey(userId: string, name?: string): Promise<{
  apiKey: string;
  id: string;
}> {
  // Generate random API key
  const apiKey = `galx_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  const result = await pool.query(
    `INSERT INTO api_keys (user_id, key_hash, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, keyHash, name || 'Default API Key']
  );
  
  return {
    apiKey,
    id: result.rows[0].id,
  };
}

