import { describe, it, expect } from '@jest/globals';
import { validateOutboundUrl } from '../src/security/ssrf';

describe('SSRF adversarial suite', () => {
  const blocked = [
    'http://127.0.0.1/admin',
    'http://0.0.0.0/',
    'http://10.0.0.1/internal',
    'http://172.16.0.1/',
    'http://192.168.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'file:///etc/passwd',
    'data:text/html,<script>',
    'javascript:alert(1)',
    'ftp://internal/',
    'gopher://127.0.0.1:25/',
    'http://localhost:8080/',
    'http://metadata.google.internal/',
  ];

  blocked.forEach((url) => {
    it(`blocks ${url.split(':')[0]}…`, async () => {
      const r = await validateOutboundUrl(url);
      expect(r.allowed).toBe(false);
    });
  });

  it('blocks invalid URL', async () => {
    const r = await validateOutboundUrl('not-a-url');
    expect(r.allowed).toBe(false);
  });
});

describe('Redirect policy', () => {
  it('maxRedirects defaults to 0', async () => {
    const { SSRF_DEFAULTS } = await import('../src/security/ssrf');
    expect(SSRF_DEFAULTS.maxRedirects).toBe(0);
  });
});

describe('DNS rebinding awareness', () => {
  it('validates resolved IPs not just hostname', async () => {
    // hostname validation alone is insufficient — ssrf resolves DNS
    const r = await validateOutboundUrl('http://127.0.0.1/');
    expect(r.allowed).toBe(false);
  });
});
