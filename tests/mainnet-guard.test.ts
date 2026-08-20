import { describe, it, expect } from '@jest/globals';
import { validateNoMainnetInjection, assertMainnetBlockedPolicy } from '../src/security/mainnetGuard';

describe('Mainnet injection guard', () => {
  it('blocks chainId 1', () => {
    const r = validateNoMainnetInjection({ chainId: 1 });
    expect(r.allowed).toBe(false);
    if (r.allowed === false) expect(r.code).toBe('MAINNET_BLOCKED');
  });

  it('blocks chain_id string mainnet', () => {
    const r = validateNoMainnetInjection({ chain_id: '1' });
    expect(r.allowed).toBe(false);
  });

  it('blocks mainnet RPC URL', () => {
    const r = validateNoMainnetInjection({ rpcUrl: 'https://eth-mainnet.example.com' });
    expect(r.allowed).toBe(false);
  });

  it('allows testnet chainId', () => {
    const r = validateNoMainnetInjection({ chainId: 11155111 });
    expect(r.allowed).toBe(true);
  });

  it('MAINNET_BLOCKED policy default', () => {
    delete process.env.ALLOW_MAINNET;
    expect(assertMainnetBlockedPolicy()).toBe(true);
  });

  it('rejects arbitrary mainnet contract address injection field', () => {
    const r = validateNoMainnetInjection({ endpoint: 'https://mainnet.infura.io/v3/key' });
    expect(r.allowed).toBe(false);
  });
});

describe('AI path must not execute blockchain', () => {
  it('inference body with chainId fails', () => {
    expect(validateNoMainnetInjection({ model: 'gpt-4', chainId: 1 }).allowed).toBe(false);
  });
});
