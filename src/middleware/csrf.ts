/**
 * CSRF Protection Middleware
 * Implements Double Submit Cookie pattern for CSRF protection
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../index';

/**
 * Generate CSRF token
 */
export function generateCSRFToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * CSRF protection middleware
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Skip CSRF for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Get token from header
  const token = req.headers['x-csrf-token'] as string;
  
  // Get token from cookie
  const cookieToken = req.cookies?.['csrf-token'];

  // Verify tokens match
  if (!token || !cookieToken || token !== cookieToken) {
    logger.warn('CSRF token validation failed', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    
    return res.status(403).json({
      error: 'CSRF token validation failed'
    });
  }

  next();
}

/**
 * Set CSRF token cookie
 */
export function setCSRFToken(req: Request, res: Response, next: NextFunction) {
  // Generate token if not exists
  const token = req.cookies?.['csrf-token'] || generateCSRFToken();
  
  // Set cookie
  res.cookie('csrf-token', token, {
    httpOnly: false, // Must be accessible to JavaScript for Double Submit
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict',
    maxAge: 3600000 // 1 hour
  });

  // Add to response header for easy access
  res.setHeader('X-CSRF-Token', token);
  
  next();
}
