/**
 * siteMemory.ts
 * Lightweight de-duplication + LRU eviction for extracted text lines.
 * Two tiers:
 *  - in-memory Map for fast session lookups
 *  - optional persisted signature set in chrome.storage.local (async lazy)
 *
 * This module focuses on normalized line de-duplication. Upstream callers
 * should normalize with normalizeLine() before insertion (keeps concerns separated).
 */

import { normalizeLine } from './textUtils';
import { logger } from '@shared/logger';

interface MemoryEntry {
  line: string;      // original (trimmed) line
  norm: string;      // normalized version (key)
  ts: number;        // last access (for LRU)
  len: number;       // length (for potential future heuristics)
}

interface PersistShape {
  version: number;
  norms: string[];
}

const MAX_LINES = 20000;
const PERSIST_KEY = 'extract_line_norms_v1';
const PERSIST_VERSION = 1;

const store: Map<string, MemoryEntry> = new Map();
let loaded = false;
let loading = false;
let lastPersist = 0;
const PERSIST_INTERVAL_MS = 15_000;

/**
 * Attempt to load persistence (best-effort, silent failure).
 */
async function loadPersisted(): Promise<void> {
  if (loaded || loading) return;
  loading = true;
  try {
    const data = await chrome.storage.local.get(PERSIST_KEY);
    const raw = data[PERSIST_KEY] as PersistShape | undefined;
    if (raw && raw.version === PERSIST_VERSION && Array.isArray(raw.norms)) {
      const now = Date.now();
      for (const norm of raw.norms) {
        if (typeof norm !== 'string' || !norm) continue;
        store.set(norm, {
          line: norm, // original unknown; fallback
          norm,
            ts: now,
            len: norm.length
        });
      }
      logger.info('SiteMemory loaded persisted norms', { count: store.size });
    } else if (raw) {
      logger.warn('SiteMemory version mismatch, ignoring persisted data');
    }
  } catch (e) {
    logger.warn('SiteMemory load failed', { error: (e as Error).message });
  } finally {
    loaded = true;
    loading = false;
  }
}

/**
 * Schedule persistence if enough time has elapsed.
 */
async function maybePersist(): Promise<void> {
  const now = Date.now();
  if (now - lastPersist < PERSIST_INTERVAL_MS) return;
  lastPersist = now;
  try {
    const norms = Array.from(store.keys());
    const payload: PersistShape = {
      version: PERSIST_VERSION,
      norms
    };
    await chrome.storage.local.set({ [PERSIST_KEY]: payload });
  } catch (e) {
    logger.debug('SiteMemory persist skipped', { error: (e as Error).message });
  }
}

/**
 * Insert a line (already normalized or will normalize). Returns:
 *  - true if the line was new and inserted
 *  - false if it already existed (duplicate)
 */
export async function rememberLine(line: string, alreadyNormalized = false): Promise<boolean> {
  if (!loaded) {
    // fire & forget load
    loadPersisted();
  }
  const trimmed = line.trim();
  if (!trimmed) return false;
  const norm = alreadyNormalized ? trimmed : normalizeLine(trimmed);
  if (!norm) return false;

  const existing = store.get(norm);
  if (existing) {
    existing.ts = Date.now();
    return false;
  }
  // Insert new
  store.set(norm, {
    line: trimmed,
    norm,
    ts: Date.now(),
    len: trimmed.length
  });

  if (store.size > MAX_LINES) {
    evictLRU();
  }

  maybePersist();
  return true;
}

/**
 * Batch insert convenience.
 * Returns number of new lines added.
 */
export async function rememberLines(lines: string[], alreadyNormalized = false): Promise<number> {
  let added = 0;
  for (const l of lines) {
    if (await rememberLine(l, alreadyNormalized)) added++;
  }
  return added;
}

/**
 * Check existence without updating recency (pure look).
 */
export function hasLine(line: string, alreadyNormalized = false): boolean {
  const norm = alreadyNormalized ? line.trim() : normalizeLine(line);
  if (!norm) return false;
  return store.has(norm);
}

/**
 * Evict least recently used entries until size within threshold.
 */
function evictLRU(): void {
  const target = Math.floor(MAX_LINES * 0.9); // shrink to 90%
  const entries = Array.from(store.values());
  entries.sort((a, b) => a.ts - b.ts);
  let removed = 0;
  for (const e of entries) {
    if (store.size <= target) break;
    store.delete(e.norm);
    removed++;
  }
  logger.info('SiteMemory eviction', { removed, newSize: store.size });
}

/**
 * Export snapshot for tests / diagnostics.
 */
export function snapshot(limit = 50): MemoryEntry[] {
  return Array.from(store.values())
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
    .map(e => ({ ...e }));
}

/**
 * Size metrics.
 */
export function stats() {
  let totalChars = 0;
  for (const e of store.values()) totalChars += e.len;
  return {
    lines: store.size,
    totalChars,
    avgLen: store.size ? Math.round(totalChars / store.size) : 0,
    loaded
  };
}

/**
 * Force persistence (for tests).
 */
export async function flush(): Promise<void> {
  await maybePersist();
}
