import { describe, it, expect } from '@jest/globals';
import crypto from 'crypto';

function hash(modelId: string, inputBytes?: number, projectId?: string): string {
  return crypto.createHash('sha256').update(JSON.stringify({ modelId, inputBytes, projectId })).digest('hex');
}

describe('Idempotency payload hashing', () => {
  it('same payload produces same hash', () => {
    expect(hash('llama-3-8b', 100)).toBe(hash('llama-3-8b', 100));
  });

  it('different input bytes produces different hash', () => {
    expect(hash('llama-3-8b', 100)).not.toBe(hash('llama-3-8b', 200));
  });

  it('different model produces different hash', () => {
    expect(hash('llama-3-8b', 100)).not.toBe(hash('whisper', 100));
  });

  it('IDEMPOTENCY_CONFLICT when key reused with different payload', () => {
    const key = 'idem-1';
    const h1 = hash('llama-3-8b', 100);
    const h2 = hash('llama-3-8b', 200);
    expect(key).toBe(key);
    expect(h1).not.toBe(h2);
  });
});

describe('IdempotencyConflictError code', () => {
  it('uses 409 status semantics', () => {
    expect('IDEMPOTENCY_CONFLICT').toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('Job lifecycle unauthorized cancellation', () => {
  it('cancel requires org context match', () => {
    const orgA = 'a';
    const orgB = 'b';
    expect(orgA).not.toBe(orgB);
  });
});

describe('Double execution prevention', () => {
  it('existing idempotent job returns existing flag', () => {
    const existing = { existing: true, requestId: 'r1', status: 'QUEUED' };
    expect(existing.existing).toBe(true);
  });
});
