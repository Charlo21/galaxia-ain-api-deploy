/**
 * Structured API error codes for Galaxia AIN.
 * Safe for client exposure — no stack traces or secrets.
 */
export const ErrorCodes = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  TENANT_ACCESS_DENIED: 'TENANT_ACCESS_DENIED',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  MODEL_NOT_ALLOWED: 'MODEL_NOT_ALLOWED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_INPUT: 'INVALID_INPUT',
  TOOL_NOT_AUTHORIZED: 'TOOL_NOT_AUTHORIZED',
  SSRF_BLOCKED: 'SSRF_BLOCKED',
  WEBHOOK_INVALID: 'WEBHOOK_INVALID',
  WEBHOOK_NOT_CONFIGURED: 'WEBHOOK_NOT_CONFIGURED',
  MAINNET_BLOCKED: 'MAINNET_BLOCKED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export function safeError(
  code: ErrorCode,
  message: string,
  status: number,
  extra: Record<string, unknown> = {}
) {
  return {
    ok: false,
    error: message,
    code,
    mode: 'testnet-preview',
    ...extra,
  };
}

export function safeErrorResponse(
  res: { status: (n: number) => { json: (b: unknown) => void } },
  code: ErrorCode,
  message: string,
  status: number,
  extra?: Record<string, unknown>
) {
  res.status(status).json(safeError(code, message, status, extra));
}
