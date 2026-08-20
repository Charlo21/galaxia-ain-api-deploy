/**
 * Security Middleware
 * Additional security headers and protections
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../index';

/**
 * Configure CORS with security restrictions
 */
export function configureCORS() {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:5173'];

  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Galaxia-Token');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    
    next();
  };
}

/**
 * Request size limiter
 */
export function limitRequestSize(maxSize: string = '10mb') {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = req.headers['content-length'];
    
    if (contentLength) {
      const sizeInBytes = parseInt(contentLength, 10);
      const maxBytes = parseSize(maxSize);
      
      if (sizeInBytes > maxBytes) {
        return res.status(413).json({
          error: 'Request entity too large',
          maxSize
        });
      }
    }
    
    next();
  };
}

/**
 * Parse size string to bytes
 */
function parseSize(size: string): number {
  const units: { [key: string]: number } = {
    'kb': 1024,
    'mb': 1024 * 1024,
    'gb': 1024 * 1024 * 1024
  };
  
  const match = size.toLowerCase().match(/^(\d+)(kb|mb|gb)?$/);
  if (!match) {
    return 10 * 1024 * 1024; // Default 10MB
  }
  
  const value = parseInt(match[1], 10);
  const unit = match[2] || 'mb';
  
  return value * (units[unit] || units['mb']);
}

/**
 * Prevent information leakage in error responses
 */
export function sanitizeErrorResponse(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // In production, don't expose stack traces
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  if (!isDevelopment) {
    // Remove stack trace from error
    if (err.stack) {
      delete (err as any).stack;
    }
    
    // Sanitize error messages
    if (err.message) {
      // Remove sensitive paths
      err.message = err.message.replace(/\/[^\s]+/g, '[path]');
    }
  }
  
  next(err);
}

/**
 * Security headers middleware
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Additional security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Remove server header (Helmet does this, but ensure it)
  res.removeHeader('X-Powered-By');
  
  next();
}
