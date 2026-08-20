/**
 * Retry utility with exponential backoff
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryable?: (error: any) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryable: () => true,
};

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;
  let delay = opts.initialDelay;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if error is retryable
      if (!opts.retryable(error)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === opts.maxRetries) {
        break;
      }

      // Wait before retry
      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelay);
    }
  }

  throw lastError;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retryable error checker for database operations
 */
export function isRetryableDatabaseError(error: any): boolean {
  // PostgreSQL connection errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return true;
  }

  // PostgreSQL specific retryable errors
  if (error.code === '57P01' || error.code === '57P02' || error.code === '57P03') {
    return true; // Admin shutdown, crash, cannot connect
  }

  // Deadlock detection
  if (error.code === '40P01') {
    return true; // Deadlock detected
  }

  return false;
}

/**
 * Retryable error checker for network operations
 */
export function isRetryableNetworkError(error: any): boolean {
  if (!error.response) {
    // Network error (no response)
    return true;
  }

  // Retry on 5xx errors
  const status = error.response?.status;
  if (status >= 500 && status < 600) {
    return true;
  }

  // Retry on 429 (rate limit)
  if (status === 429) {
    return true;
  }

  return false;
}

