/**
 * Custom error classes for better error handling
 */

export class GalaxiaError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR',
    public details?: any
  ) {
    super(message);
    this.name = 'GalaxiaError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends GalaxiaError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends GalaxiaError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends GalaxiaError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends GalaxiaError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} with id ${id} not found` : `${resource} not found`;
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends GalaxiaError {
  constructor(retryAfter?: number) {
    super('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED', { retryAfter });
    this.name = 'RateLimitError';
  }
}

export class InsufficientBalanceError extends GalaxiaError {
  constructor(balance: number, required: number) {
    super('Insufficient balance', 402, 'INSUFFICIENT_BALANCE', { balance, required });
    this.name = 'InsufficientBalanceError';
  }
}

export class NodeUnavailableError extends GalaxiaError {
  constructor(message: string = 'No eligible nodes available') {
    super(message, 503, 'NODE_UNAVAILABLE');
    this.name = 'NodeUnavailableError';
  }
}

export class TaskProcessingError extends GalaxiaError {
  constructor(message: string, details?: any) {
    super(message, 500, 'TASK_PROCESSING_ERROR', details);
    this.name = 'TaskProcessingError';
  }
}

/**
 * Error handler middleware
 */
export function errorHandler(err: Error, req: any, res: any, next: any) {
  if (err instanceof GalaxiaError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      details: err.details,
      request_id: req.id,
    });
  }

  // Unknown error
  return res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    request_id: req.id,
    ...(process.env.NODE_ENV === 'development' && { details: err.message, stack: err.stack }),
  });
}

