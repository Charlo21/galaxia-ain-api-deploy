/**
 * Galaxia ID Authentication Middleware
 * Replaces basic API key auth with Galaxia ID integration
 */

import { Request, Response, NextFunction } from 'express';
import { galaxiaIdService } from '../services/galaxia/galaxiaId';
import { AuthenticatedRequest } from './auth';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../index';

/**
 * Authenticate using Galaxia ID token
 */
export async function authenticateGalaxiaId(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);
    
    // Verify token with Galaxia ID service
    const user = await galaxiaIdService.verifyToken(token);
    
    // Attach user to request
    req.userId = user.id;
    req.galaxiaUser = user;
    
    next();
  } catch (error: any) {
    logger.warn('Galaxia ID authentication failed', {
      error: error.message,
      path: req.path,
    });

    // Fail closed — never fall back to API key when Bearer was presented but invalid
    res.status(401).json({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
      request_id: (req as any).id,
      mode: 'testnet-preview',
    });
  }
}

/**
 * Optional Galaxia ID authentication (doesn't fail if missing)
 */
export async function optionalGalaxiaAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const user = await galaxiaIdService.verifyToken(token);
      req.userId = user.id;
      req.galaxiaUser = user;
    }
  } catch (error) {
    // Silently fail - authentication is optional
  }
  
  next();
}

// Extend AuthenticatedRequest interface
declare module './auth' {
  interface AuthenticatedRequest extends Request {
    galaxiaUser?: {
      id: string;
      address: string;
      walletType: string;
    };
  }
}

