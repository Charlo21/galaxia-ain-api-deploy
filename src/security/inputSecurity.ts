/** Prompt / request input limits — server-authoritative. */
export const INPUT_LIMITS = {
  maxBodyBytes: 512 * 1024,
  maxPromptChars: 128_000,
  maxOutputTokensDefault: 4096,
  inferenceTimeoutMs: 120_000,
};

export type InputValidationResult = { ok: true } | { ok: false; code: string; message: string };

export function validatePromptInput(input: unknown, modelMaxContext?: number): InputValidationResult {
  if (typeof input !== 'string') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Prompt must be a string' };
  }
  if (input.length > INPUT_LIMITS.maxPromptChars) {
    return { ok: false, code: 'PROMPT_TOO_LARGE', message: 'Prompt exceeds maximum size' };
  }
  const maxCtx = modelMaxContext ?? INPUT_LIMITS.maxPromptChars;
  if (input.length > maxCtx) {
    return { ok: false, code: 'MODEL_CONTEXT_EXCEEDED', message: 'Prompt exceeds model context limit' };
  }
  return { ok: true };
}

export function validateRequestBodySize(contentLength: number | undefined): InputValidationResult {
  if (contentLength !== undefined && contentLength > INPUT_LIMITS.maxBodyBytes) {
    return { ok: false, code: 'REQUEST_TOO_LARGE', message: 'Request body exceeds limit' };
  }
  return { ok: true };
}
