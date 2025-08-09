/**
 * Domain allowlist loader.
 * Loads JSON list from rules/allowed-domains.json and provides helper predicates.
 * Secure defaults: if load fails, isAllowed() returns false.
 */
import { logger } from './logger';

let cachedDomains: Set<string> | null = null;
let loadAttempted = false;
let lastError: string | null = null;

async function loadRawList(): Promise<string[]> {
  const url = chrome.runtime.getURL('rules/allowed-domains.json');
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid JSON structure (expected array)');
    return (data as unknown[]).filter(d => typeof d === 'string').map(d => d.toLowerCase().trim()).filter(Boolean);
  } catch (e) {
    lastError = (e as Error).message;
    logger.warn('Allowlist load failed', { url, error: lastError });
    return [];
  }
}

/**
 * Loads and caches the allowlisted domains.
 */
export async function ensureAllowlistLoaded(): Promise<void> {
  if (cachedDomains || loadAttempted) return;
  loadAttempted = true;
  const list = await loadRawList();
  cachedDomains = new Set(list);
  logger.info('Allowlist loaded', { count: cachedDomains.size });
}

/**
 * Returns true only if host (or its parent domain) is in allowlist.
 * Example: sub.example.com matches example.com if example.com is listed.
 */
export async function isAllowedUrl(url: string): Promise<boolean> {
  try {
    await ensureAllowlistLoaded();
    if (!cachedDomains || !cachedDomains.size) return false;
    const host = new URL(url).hostname.toLowerCase();
    return isAllowedHost(host);
  } catch {
    return false;
  }
}

export function isAllowedHost(host: string): boolean {
  if (!cachedDomains || !cachedDomains.size) return false;
  host = host.toLowerCase();
  if (cachedDomains.has(host)) return true;
  // Check parent domains (e.g., sub.domain.tld -> domain.tld)
  const parts = host.split('.');
  while (parts.length > 2) {
    parts.shift();
    const candidate = parts.join('.');
    if (cachedDomains.has(candidate)) return true;
  }
  return false;
}

/**
 * For diagnostics / tests.
 */
export function getAllowlistSnapshot(): string[] {
  return cachedDomains ? Array.from(cachedDomains.values()).sort() : [];
}

export function getAllowlistLastError(): string | null {
  return lastError;
}
