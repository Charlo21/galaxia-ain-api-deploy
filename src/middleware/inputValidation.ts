/**
 * Input Validation Middleware
 * Validates and sanitizes user inputs to prevent injection attacks
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../index';

/**
 * Sanitize string input
 */
export function sanitizeString(input: string, maxLength: number = 1000): string {
  if (typeof input !== 'string') {
    return '';
  }
  
  // Remove null bytes
  let sanitized = input.replace(/\0/g, '');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

/**
 * Validate UUID format
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate wallet address format
 */
export function isValidWalletAddress(address: string): boolean {
  // Basic validation - adjust based on blockchain
  if (!address || typeof address !== 'string') {
    return false;
  }
  
  // Minimum length check
  if (address.length < 20 || address.length > 100) {
    return false;
  }
  
  // Alphanumeric and some special chars
  const addressRegex = /^[a-zA-Z0-9._-]+$/;
  return addressRegex.test(address);
}

/**
 * Validate numeric input
 */
export function validateNumber(
  value: any,
  min?: number,
  max?: number
): number | null {
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
  
  if (isNaN(num) || !isFinite(num)) {
    return null;
  }
  
  if (min !== undefined && num < min) {
    return null;
  }
  
  if (max !== undefined && num > max) {
    return null;
  }
  
  return num;
}

/**
 * Validate JSON input
 */
export function validateJSON(input: string): any {
  try {
    const parsed = JSON.parse(input);
    // Prevent prototype pollution
    return JSON.parse(JSON.stringify(parsed));
  } catch {
    return null;
  }
}

/**
 * Sanitize object recursively
 */
export function sanitizeObject(obj: any, maxDepth: number = 10): any {
  if (maxDepth <= 0) {
    return {};
  }
  
  if (obj === null || obj === undefined) {
    return null;
  }
  
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  
  if (typeof obj === 'number') {
    return isFinite(obj) ? obj : 0;
  }
  
  if (typeof obj === 'boolean') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, maxDepth - 1));
  }
  
  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // Sanitize key
        const sanitizedKey = sanitizeString(key, 100);
        sanitized[sanitizedKey] = sanitizeObject(obj[key], maxDepth - 1);
      }
    }
    return sanitized;
  }
  
  return obj;
}

/**
 * Middleware to validate request body
 */
export function validateRequestBody(rules: {
  [key: string]: {
    required?: boolean;
    type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
    min?: number;
    max?: number;
    pattern?: RegExp;
    custom?: (value: any) => boolean;
  };
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body || {};
      const errors: string[] = [];
      
      for (const [field, rule] of Object.entries(rules)) {
        const value = body[field];
        
        // Check required
        if (rule.required && (value === undefined || value === null || value === '')) {
          errors.push(`${field} is required`);
          continue;
        }
        
        // Skip validation if field is optional and not provided
        if (!rule.required && (value === undefined || value === null)) {
          continue;
        }
        
        // Type validation
        if (rule.type) {
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          if (actualType !== rule.type) {
            errors.push(`${field} must be of type ${rule.type}`);
            continue;
          }
        }
        
        // String validations
        if (rule.type === 'string' && typeof value === 'string') {
          if (rule.min !== undefined && value.length < rule.min) {
            errors.push(`${field} must be at least ${rule.min} characters`);
          }
          if (rule.max !== undefined && value.length > rule.max) {
            errors.push(`${field} must be at most ${rule.max} characters`);
          }
          if (rule.pattern && !rule.pattern.test(value)) {
            errors.push(`${field} format is invalid`);
          }
        }
        
        // Number validations
        if (rule.type === 'number') {
          const num = validateNumber(value, rule.min, rule.max);
          if (num === null) {
            errors.push(`${field} must be a valid number`);
          }
        }
        
        // Custom validation
        if (rule.custom && !rule.custom(value)) {
          errors.push(`${field} validation failed`);
        }
      }
      
      if (errors.length > 0) {
        return res.status(400).json({
          error: 'Validation failed',
          errors
        });
      }
      
      // Sanitize body
      req.body = sanitizeObject(req.body);
      next();
    } catch (error: any) {
      logger.error('Request validation error', { error: error.message });
      res.status(400).json({ error: 'Invalid request' });
    }
  };
}
