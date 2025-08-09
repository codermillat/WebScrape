/**
 * fees.ts
 * Fee / table heuristic synthesis extracted from legacy logic, simplified & modular.
 */
import { cleanText } from './textUtils';
import type { ExtractTable } from './domWalker';

export interface FeeSynthesis {
  lines: string[];
  tables: ExtractTable[];
}

interface RawTable {
  caption?: string;
  header: string[];
  body: string[][];
}

const FEE_HEADER_REGEX = /(fee|fees|semester|sem|year|tuition|amount|annual|programme|program|course)/i;
const FEE_LINE_REGEX = /(fee|₹|rs\.?|amount|semester|sem|year)/i;

/**
 * Convert a live HTMLTableElement into a RawTable structure.
 */
export function tableElementToRaw(t: HTMLTableElement, maxRows = 200): RawTable | null {
  const rows = Array.from(t.querySelectorAll('tr'));
  if (rows.length < 2) return null;

  const headerRow = rows[0] as HTMLTableRowElement;
  const headerCells = Array.from(headerRow.querySelectorAll('th,td'))
    .map(c => cleanText(c.textContent));
  const headerJoined = headerCells.join(' ').toLowerCase();
  if (!FEE_HEADER_REGEX.test(headerJoined)) return null;

  const body: string[][] = [];
  for (const tr of rows.slice(1, maxRows)) {
    const cols = Array.from(tr.querySelectorAll('th,td'))
      .map(c => cleanText(c.textContent))
      .filter(Boolean);
    if (cols.length) body.push(cols);
  }
  if (!body.length) return null;

  const caption = t.querySelector('caption')?.textContent || undefined;
  return {
    caption: caption ? cleanText(caption) : undefined,
    header: headerCells,
    body
  };
}

/**
 * Heuristic synthesis of fee lines from extracted tables already normalized.
 */
export function synthesizeFeesFromExtractTables(tables: ExtractTable[]): string[] {
  const out: string[] = [];
  for (const tbl of tables) {
    // Only process if header present in first row (common pattern) or caption suggests fees
    const firstRow = tbl.rows[0] || [];
    const headerJoined = firstRow.join(' ').toLowerCase();
    const captionJoined = (tbl.caption || '').toLowerCase();
    if (!(FEE_HEADER_REGEX.test(headerJoined) || FEE_HEADER_REGEX.test(captionJoined))) continue;

    // For two-column tables treat as key-value
    for (const r of tbl.rows.slice(1)) {
      if (!r.length) continue;
      if (r.length === 2) {
        const line = `${r[0]} — ${r[1]}`;
        if (FEE_LINE_REGEX.test(line)) out.push(line);
      } else {
        const joined = r.join(' | ');
        if (FEE_LINE_REGEX.test(joined)) out.push(joined);
      }
    }
  }
  return dedupePreserveOrder(out);
}

/**
 * Direct HTMLDocument scan (detached content) for fallback.
 */
export function extractFeeTablesFromDocument(doc: Document, maxTables = 40): ExtractTable[] {
  const tables = Array.from(doc.querySelectorAll('table'));
  const out: ExtractTable[] = [];
  for (const t of tables) {
    if (!(t instanceof HTMLTableElement)) continue;
    const raw = tableElementToRaw(t);
    if (!raw) continue;
    const rows: string[][] = [];
    // Reconstruct rows (header + body)
    if (raw.header.length) rows.push(raw.header);
    rows.push(...raw.body);
    out.push({
      caption: raw.caption,
      rows
    });
    if (out.length >= maxTables) break;
  }
  return out;
}

/**
 * Public synthesis entry combining lines & tables for consumer usage.
 */
export function buildFeeSynthesis(tables: ExtractTable[]): FeeSynthesis {
  const lines = synthesizeFeesFromExtractTables(tables);
  return { lines, tables };
}

/**
 * Simple order-preserving de-duplication for string arrays.
 */
function dedupePreserveOrder(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    if (!seen.has(l)) {
      seen.add(l);
      out.push(l);
    }
  }
  return out;
}
