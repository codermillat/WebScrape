/**
 * pagination.ts
 * Heuristics for discovering additional paginated / tabbed content.
 *
 * Strategy (incremental, safe):
 *  - Collect candidate anchors / buttons whose text matches pagination/tab tokens.
 *  - Avoid links that navigate off–host or contain file extensions (pdf, doc, etc.).
 *  - Provide three async sweep helpers; each returns an array of extracted HTMLStrings
 *    (callers will parse / walk separately to avoid mutating live DOM repeatedly).
 *
 * IMPORTANT: This module does NOT click or mutate the live page DOM directly for
 * extraction (avoids side‑effects). Instead, for each candidate href we try a fetch
 * (same-origin only) and return HTML text for caller to parse in a detached Document.
 *
 * Future Enhancements:
 *  - Add rate limiting / backoff.
 *  - Integrate with siteMemory to skip duplicate signature pages.
 *  - Add iframe discovery.
 */

import { logger } from '@shared/logger';

interface FetchPageResult {
  url: string;
  ok: boolean;
  status: number;
  html?: string;
  error?: string;
}

const MAX_PAGINATION_PAGES = 8;
const MAX_TAB_PAGES = 12;
const FETCH_TIMEOUT_MS = 10_000;

const PAGINATION_TOKEN_RE = /\b(page|pages?|next|prev|previous|older|newer|more)\b/i;
const TAB_TOKEN_RE = /\b(tab|overview|details?|fees?|structure|syllabus|curriculum|eligibility|admission|hostel|scholarship|placement)s?\b/i;
const BAD_EXT_RE = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|jpg|jpeg|png|gif|svg)(\?|$)/i;

function abortableFetch(url: string, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(to));
}

async function fetchSameOrigin(url: string): Promise<FetchPageResult> {
  try {
    const u = new URL(url, location.href);
    if (u.origin !== location.origin) {
      return { url: u.href, ok: false, status: 0, error: 'cross-origin-skip' };
    }
    const res = await abortableFetch(u.href, FETCH_TIMEOUT_MS);
    if (!res.ok) {
      return { url: u.href, ok: false, status: res.status, error: 'http-' + res.status };
    }
    const ct = res.headers.get('content-type') || '';
    if (!/text\/html/i.test(ct)) {
      return { url: u.href, ok: false, status: res.status, error: 'non-html' };
    }
    const html = await res.text();
    return { url: u.href, ok: true, status: res.status, html };
  } catch (e) {
    return { url, ok: false, status: 0, error: (e as Error).name };
  }
}

function collectCandidateLinks(tokenRe: RegExp, max: number): HTMLAnchorElement[] {
  const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
  const out: HTMLAnchorElement[] = [];
  const seen = new Set<string>();
  for (const a of anchors) {
    if (out.length >= max) break;
    const text = (a.textContent || '').trim();
    if (!text) continue;
    if (!tokenRe.test(text)) continue;
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    if (BAD_EXT_RE.test(href)) continue;
    const abs = a.href;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(a);
  }
  return out;
}

/**
 * Discover pagination-like links (next, older, page numbers).
 * Returns fetched HTML strings (limited).
 */
export async function sweepPagination(): Promise<string[]> {
  const candidates = collectCandidateLinks(PAGINATION_TOKEN_RE, MAX_PAGINATION_PAGES);
  const results: string[] = [];
  for (const a of candidates) {
    const r = await fetchSameOrigin(a.href);
    if (r.ok && r.html) {
      results.push(r.html);
    }
  }
  if (results.length) {
    logger.debug('Pagination sweep fetched pages', { count: results.length });
  }
  return results;
}

/**
 * Discover tab/section style links (e.g., Fees, Eligibility, Placement).
 */
export async function sweepTabs(): Promise<string[]> {
  const candidates = collectCandidateLinks(TAB_TOKEN_RE, MAX_TAB_PAGES);
  const results: string[] = [];
  for (const a of candidates) {
    const r = await fetchSameOrigin(a.href);
    if (r.ok && r.html) {
      results.push(r.html);
    }
  }
  if (results.length) {
    logger.debug('Tab sweep fetched pages', { count: results.length });
  }
  return results;
}

/**
 * Unified sweep: pagination + tabs (de-duplicated by fast length signature).
 */
export async function sweepExtended(): Promise<string[]> {
  const pages = await sweepPagination();
  const tabs = await sweepTabs();
  const merged: string[] = [];
  const sig = new Set<string>();
  for (const h of [...pages, ...tabs]) {
    const key = h.length + ':' + h.slice(0, 200);
    if (!sig.has(key)) {
      sig.add(key);
      merged.push(h);
    }
  }
  return merged;
}
