/**
 * SSRF hardening for any URL-fetch functionality.
 * Blocks loopback, link-local, metadata, and private ranges.
 */
import dns from 'dns/promises';
import net from 'net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
]);

const BLOCKED_SCHEMES = new Set(['file:', 'data:', 'javascript:', 'ftp:', 'gopher:']);

function isPrivateIp(ip: string): boolean {
  if (!net.isIP(ip)) return false;
  if (ip === '0.0.0.0' || ip === '::' || ip === '::1' || ip === '127.0.0.1') return true;
  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  const parts = ip.split('.').map(Number);
  if (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  return false;
}

export type SsrfCheckResult = { allowed: true } | { allowed: false; reason: string };

export async function validateOutboundUrl(raw: string): Promise<SsrfCheckResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: 'invalid URL' };
  }

  if (BLOCKED_SCHEMES.has(url.protocol)) {
    return { allowed: false, reason: `blocked scheme ${url.protocol}` };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { allowed: false, reason: `unsupported scheme ${url.protocol}` };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { allowed: false, reason: 'blocked hostname' };
  }

  if (net.isIP(host) && isPrivateIp(host)) {
    return { allowed: false, reason: 'private/reserved IP' };
  }

  // Resolve and check all A/AAAA records
  try {
    const [v4, v6] = await Promise.all([
      dns.resolve4(host).catch(() => [] as string[]),
      dns.resolve6(host).catch(() => [] as string[]),
    ]);
    for (const ip of [...v4, ...v6]) {
      if (isPrivateIp(ip)) {
        return { allowed: false, reason: `DNS resolved to blocked IP ${ip}` };
      }
    }
  } catch {
    return { allowed: false, reason: 'DNS resolution failed or blocked' };
  }

  return { allowed: true };
}

export const SSRF_DEFAULTS = {
  connectTimeoutMs: 5000,
  totalTimeoutMs: 15000,
  maxResponseBytes: 2 * 1024 * 1024,
  maxRedirects: 0,
  allowedContentTypes: ['application/json', 'text/plain', 'text/html'],
};
