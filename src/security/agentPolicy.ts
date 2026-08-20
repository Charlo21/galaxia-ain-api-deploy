/**
 * Future agent/tool runtime policy — no live agent runtime in AIN today.
 * Default: TOOLS_DISABLED
 */
export const AGENT_RUNTIME_STATUS = 'NOT_IMPLEMENTED' as const;
export const DEFAULT_TOOL_POLICY = 'TOOLS_DISABLED' as const;

export type ToolDefinition = {
  id: string;
  allowlist: string[];
  orgPermission: string;
  rolePermission: string;
  inputSchema: string;
  outputSchema: string;
  timeoutMs: number;
  rateLimitPerMin: number;
  networkPolicy: 'DENY_ALL' | 'ALLOWLIST';
  dataAccessScope: 'NONE' | 'ORG_READ' | 'PROJECT_READ';
};

export function isToolExecutionAllowed(): boolean {
  return false;
}

export function validateToolRequest(_toolId: string): { allowed: false; code: 'TOOL_BLOCK' } {
  return { allowed: false, code: 'TOOL_BLOCK' };
}
