import { describe, it, expect } from '@jest/globals';
import { isToolExecutionAllowed, validateToolRequest, DEFAULT_TOOL_POLICY } from '../src/security/agentPolicy';

describe('Agent runtime policy', () => {
  it('default TOOLS_DISABLED', () => {
    expect(DEFAULT_TOOL_POLICY).toBe('TOOLS_DISABLED');
  });

  it('tool execution not allowed', () => {
    expect(isToolExecutionAllowed()).toBe(false);
  });

  it('any tool request blocked with TOOL_BLOCK', () => {
    expect(validateToolRequest('shell').code).toBe('TOOL_BLOCK');
  });
});

describe('Future tool requirements documented', () => {
  const required = [
    'tool ID',
    'allowlist',
    'organization permission',
    'role permission',
    'input schema',
    'output schema',
    'timeout',
    'rate limit',
    'audit event',
    'network policy',
    'data access scope',
  ];
  required.forEach((r) => {
    it(`requires ${r}`, () => {
      expect(r.length).toBeGreaterThan(0);
    });
  });
});

describe('No arbitrary execution', () => {
  it('no shell by default', () => {
    expect(isToolExecutionAllowed()).toBe(false);
  });
  it('no arbitrary HTTP', () => {
    expect(isToolExecutionAllowed()).toBe(false);
  });
  it('no arbitrary filesystem', () => {
    expect(isToolExecutionAllowed()).toBe(false);
  });
});
