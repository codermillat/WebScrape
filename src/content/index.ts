/**
 * New content script orchestrator (Phase 2 full pipeline).
 * This replaces the legacy monolithic content.js once manifest swap occurs.
 *
 * Features:
 *  - Single-pass DOM walk (domWalker)
 *  - Fee table heuristic synthesis (fees)
 *  - Optional extended sweep (pagination + tabs) with detached parsing
 *  - De-duplication memory (siteMemory) for incremental browsing
 *  - Lightweight allowlist enforcement (shared/allowlist)
 *  - Structured prompt helpers (llmPipeline) – NOT calling network here
 *
 * Messaging:
 *  chrome.runtime.sendMessage({ action: 'pipelineExtract', extended: true })
 *    -> { ok, meta, extract, fees, extraPagesCount }
 *
 * Safe to keep side-effects minimal; only DOM reads + optional fetches (same-origin).
 */

import { logger } from '@shared/logger';
import { walkDocument, type ExtractResult } from './domWalker';
import { buildFeeSynthesis } from './fees';
import { sweepExtended } from './pagination';
import { ensureAllowlistLoaded, isAllowedUrl } from '@shared/allowlist';
import { rememberLines } from './siteMemory';
import { chunkText, buildStructuredPrompt } from './llmPipeline';
import { cleanText, normalizeLine } from './textUtils';

const USE_NEW_PIPELINE = true; // Flip to false to disable without rebuild (quick hot toggle).
const EXTENDED_TIMEOUT_MS = 8000;
const MAX_EXTRA_PAGES = 10;
const MAX_MERGED_PARAGRAPHS = 8000; // character budget for merged additional pages
const VERSION = 'p2-pipeline-1';

declare global {
  interface Window {
    __pipelineLoaded?: boolean;
  }
}

if (window.__pipelineLoaded) {
  logger.debug('Content pipeline already initialized – skipping duplicate load');
} else {
  window.__pipelineLoaded = true;
  bootstrap();
}

function bootstrap() {
  logger.info('Content pipeline bootstrap', { version: VERSION, useNew: USE_NEW_PIPELINE });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;

    if (msg.action === 'pipelinePing') {
      sendResponse({ ok: true, version: VERSION, newPipeline: USE_NEW_PIPELINE });
      return true;
    }

    if (msg.action === 'pipelineExtract') {
      if (!USE_NEW_PIPELINE) {
        sendResponse({ ok: false, error: 'Pipeline disabled (flag)', version: VERSION });
        return true;
      }
      void runPipeline(msg.extended === true)
        .then(res => sendResponse(res))
        .catch(err => {
          logger.error('Pipeline extract failed', { error: err.message });
          sendResponse({ ok: false, error: err.message || 'extract failed' });
        });
      return true; // async
    }

    return false;
  });
}

/**
 * Run the full extraction pipeline.
 */
async function runPipeline(extended: boolean) {
  const url = location.href;
  await ensureAllowlistLoaded();
  const allowed = await isAllowedUrl(url);
  if (!allowed) {
    return { ok: false, error: 'Domain not allowlisted', url };
  }

  const t0 = performance.now();
  const base: ExtractResult = walkDocument({
    includeHidden: true,
    excludeBoilerplate: true,
    maxTables: 60,
    maxLinks: 1200
  });

  const feeSynth = buildFeeSynthesis(base.tables);
  // Remember lines (normalized) for dedupe across visits
  try {
    const allLines: string[] = [
      ...base.headings,
      ...base.paragraphs,
      ...base.lists,
      ...feeSynth.lines
    ];
    await rememberLines(allLines.map(l => normalizeLine(l)), true);
  } catch (e) {
    logger.debug('Line memory update failed', { error: (e as Error).message });
  }

  let extraPagesMerged = '';
  let extraPagesCount = 0;

  if (extended) {
    try {
      const extController = new AbortController();
      const timer = setTimeout(() => extController.abort(), EXTENDED_TIMEOUT_MS);
      const pages = await sweepExtended();
      clearTimeout(timer);
      const limited = pages.slice(0, MAX_EXTRA_PAGES);
      extraPagesCount = limited.length;
      if (limited.length) {
        const parser = new DOMParser();
        const paragraphs: string[] = [];
        for (const html of limited) {
          if (paragraphs.join('\n').length > MAX_MERGED_PARAGRAPHS) break;
            const doc = parser.parseFromString(html, 'text/html');
            const snippet = collectDetachedParagraphs(doc);
            if (snippet) paragraphs.push(snippet);
        }
        extraPagesMerged = paragraphs.join('\n').slice(0, MAX_MERGED_PARAGRAPHS);
      }
    } catch (e) {
      logger.debug('Extended sweep aborted or failed', { error: (e as Error).message });
    }
  }

  const meta = {
    url,
    title: base.title,
    length: base.rawLength,
    tables: base.tables.length,
    feeLines: feeSynth.lines.length,
    extended,
    extraPagesCount
  };

  const structuredCandidate = buildStructuredCandidate(base, feeSynth.lines, extraPagesMerged);
  const chunks = chunkText(structuredCandidate, { maxChunkSize: 12000 });

  const deltaMs = Math.round(performance.now() - t0);

  logger.info('Pipeline extract complete', {
    ms: deltaMs,
    lines: feeSynth.lines.length,
    tables: base.tables.length,
    extended,
    extraPagesCount,
    chunks: chunks.length
  });

  return {
    ok: true,
    version: VERSION,
    meta,
    extract: {
      base,
      fees: feeSynth.lines,
      extraPagesMerged
    },
    structuredCandidate,
    chunkPromptsPreview: chunks.slice(0, 2).map(c => c.slice(0, 280)),
    structuredPromptExample: buildStructuredPrompt(base.title, url, chunks[0] || '')
  };
}

/**
 * Build a merged string that preserves hierarchy without over-inflating token count.
 */
function buildStructuredCandidate(base: ExtractResult, feeLines: string[], extra: string): string {
  const parts: string[] = [];
  if (base.title) {
    parts.push('== TITLE ==');
    parts.push(base.title);
  }
  if (base.headings.length) {
    parts.push('\n== HEADINGS ==');
    parts.push(...base.headings);
  }
  if (base.paragraphs.length) {
    parts.push('\n== PARAGRAPHS ==');
    parts.push(...base.paragraphs);
  }
  if (base.lists.length) {
    parts.push('\n== LISTS ==');
    parts.push(...base.lists);
  }
  if (feeLines.length) {
    parts.push('\n== FEES SYNTHESIS ==');
    parts.push(...feeLines);
  }
  if (base.tables.length) {
    parts.push('\n== TABLES (RAW FIRST ROW SAMPLE) ==');
    base.tables.slice(0, 20).forEach(t => {
      const head = t.rows[0]?.join(' | ') || '';
      if (head) parts.push(head);
    });
  }
  if (extra) {
    parts.push('\n== EXTENDED PAGES MERGED ==');
    parts.push(extra);
  }
  return cleanText(parts.join('\n').trim());
}

/**
 * Detached document paragraph collector (simple).
 */
function collectDetachedParagraphs(doc: Document): string {
  const sel = ['h1','h2','h3','p','li'].join(',');
  const nodes = Array.from(doc.querySelectorAll(sel));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    let txt = (n.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    if (n.tagName === 'LI') txt = '• ' + txt;
    if (!seen.has(txt)) {
      seen.add(txt);
      out.push(txt);
    }
    if (out.length > 400) break;
  }
  return out.join('\n');
}

// Ephemeral visual marker so manual QA can confirm injection.
(function indicator() {
  try {
    const id = 'pipeline-indicator-badge';
    if (document.getElementById(id)) return;
    const el = document.createElement('div');
    el.id = id;
    el.textContent = 'Pipeline Active';
    el.style.cssText = 'position:fixed;top:4px;right:4px;background:#1e40af;color:#fff;font:11px system-ui;padding:3px 6px;border-radius:4px;z-index:2147483647;opacity:.85;';
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  } catch (e) {
    // ignore
  }
})();
