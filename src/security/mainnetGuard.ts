/**
 * MAINNET_BLOCKED — reject mainnet chain/RPC injection in AI paths.
 */
const BLOCKED_CHAIN_IDS = new Set([1, 56, 137, 42161, 10, 8453]);
const BLOCKED_RPC_PATTERNS = [
  /mainnet/i,
  /eth-mainnet/i,
  /ethereum\.org\/mainnet/i,
  /infura\.io\/v3\/.*mainnet/i,
];

export type MainnetGuardResult = { allowed: true } | { allowed: false; code: 'MAINNET_BLOCKED'; reason: string };

export function validateNoMainnetInjection(input: Record<string, unknown>): MainnetGuardResult {
  const chainId = input.chainId ?? input.chain_id ?? input.networkId;
  if (chainId !== undefined) {
    const n = Number(chainId);
    if (!Number.isNaN(n) && BLOCKED_CHAIN_IDS.has(n)) {
      return { allowed: false, code: 'MAINNET_BLOCKED', reason: `chainId ${n} blocked` };
    }
  }
  const rpc = String(input.rpcUrl ?? input.rpc_url ?? input.providerUrl ?? input.endpoint ?? '');
  if (rpc) {
    for (const pat of BLOCKED_RPC_PATTERNS) {
      if (pat.test(rpc)) {
        return { allowed: false, code: 'MAINNET_BLOCKED', reason: 'mainnet RPC pattern blocked' };
      }
    }
  }
  return { allowed: true };
}

export function assertMainnetBlockedPolicy(): boolean {
  return (process.env.ALLOW_MAINNET || 'false').toLowerCase() !== 'true';
}
