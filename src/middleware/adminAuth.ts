/**
 * Admin Authentication Middleware
 * Protects admin endpoints with role-based access control
 */

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { pool } from '../config/database';
import { logger } from '../index';

/**
 * Check if user has admin role
 */
export async function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Must be authenticated first
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if user has admin role
    const result = await pool.query(
      `SELECT role FROM users WHERE id = $1`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const userRole = result.rows[0].role;
    
    // Check for admin role (can be 'admin' or 'super_admin')
    if (userRole !== 'admin' && userRole !== 'super_admin') {
      logger.warn('Unauthorized admin access attempt', {
        userId: req.userId,
        ip: req.ip,
        path: req.path
      });
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    // Attach role to request
    (req as any).userRole = userRole;
    next();
  } catch (error: any) {
    logger.error('Admin auth check failed', { error: error.message });
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Check for super admin role (for critical operations)
 */
export async function requireSuperAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const result = await pool.query(
      `SELECT role FROM users WHERE id = $1`,
      [req.userId]
    );

    if (result.rows.length === 0 || result.rows[0].role !== 'super_admin') {
      logger.warn('Unauthorized super admin access attempt', {
        userId: req.userId,
        ip: req.ip,
        path: req.path
      });
      res.status(403).json({ error: 'Super admin access required' });
      return;
    }

    (req as any).userRole = 'super_admin';
    next();
  } catch (error: any) {
    logger.error('Super admin auth check failed', { error: error.message });
    res.status(500).json({ error: 'Authentication error' });
  }
}
