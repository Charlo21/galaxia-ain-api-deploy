import { Request, Response, NextFunction } from 'express';
import { errorHandler, GalaxiaError } from '../utils/errors';
import { logger } from '../index';

/**
 * Enhanced error handling middleware
 */
export function handleErrors(err: Error, req: Request, res: Response, next: NextFunction) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Log error with full details
  logger.error({
    error: err.message,
    stack: isDevelopment ? err.stack : undefined, // Only log stack in development
    requestId: (req as any).id,
    path: req.path,
    method: req.method,
    ...(err instanceof GalaxiaError && { code: err.code, details: err.details }),
  });

  // Sanitize error response for production
  if (!isDevelopment) {
    // Don't expose internal error details
    const sanitizedError = new Error('Internal server error');
    return errorHandler(sanitizedError, req, res, next);
  }

  // Use centralized error handler
  return errorHandler(err, req, res, next);
}

/**
 * Async error wrapper for route handlers
 */
export function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 404 handler
 */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.path,
    request_id: (req as any).id,
  });
}

