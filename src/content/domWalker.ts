/**
 * domWalker.ts
 * Single-pass DOM traversal producing a structured extraction result.
 * Keeps logic pure: no side-effects outside reading the live DOM.
 */
import { cleanText } from './textUtils';

export interface ExtractTable {
  caption?: string;
  rows: string[][];
}

export interface ExtractImage {
  alt: string;
  src: string;
  caption?: string;
}

export interface ExtractLink {
  text: string;
  href: string;
}

export interface ExtractResult {
  title: string;
  headings: string[];
  paragraphs: string[];
  lists: string[];
  tables: ExtractTable[];
  links: ExtractLink[];
  images: ExtractImage[];
  meta: Record<string, string>;
  rawLength: number;
}

/**
 * Options controlling traversal inclusion.
 */
export interface WalkerOptions {
  includeHidden?: boolean;
  excludeBoilerplate?: boolean;
  maxTables?: number;
  maxTableRows?: number;
  maxLinks?: number;
  maxImages?: number;
}

/**
 * Boilerplate selector list (navigation, headers, ads).
 * Kept small; further refinement can move to config.
 */
const BOILERPLATE_SELECTORS = [
  'header', 'nav', 'footer', 'aside',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[class*="nav"]', '[id*="nav"]', '[class*="menu"]',
  '[class*="footer"]', '[id*="footer"]', '[class*="sidebar"]',
  '.ads', '[class*="ad-"]', '[id*="ad-"]'
];

function isElementVisible(el: Element): boolean {
  const style = (el instanceof HTMLElement) ? getComputedStyle(el) : null;
  if (!style) return true;
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = (el as HTMLElement).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isBoilerplate(el: Element, exclude: boolean): boolean {
  if (!exclude) return false;
  try {
    return BOILERPLATE_SELECTORS.some(sel => (el as HTMLElement).closest(sel));
  } catch {
    return false;
  }
}

function collectMeta(): Record<string, string> {
  const out: Record<string, string> = {};
  document.querySelectorAll('meta[name], meta[property]').forEach(m => {
    const name = m.getAttribute('name') || m.getAttribute('property');
    const content = m.getAttribute('content');
    if (name && content && !out[name]) {
      out[name] = content.trim();
    }
  });
  return out;
}

function extractTable(el: HTMLTableElement, maxRows: number): ExtractTable | null {
  const rows: string[][] = [];
  const trs = Array.from(el.querySelectorAll('tr'));
  for (const tr of trs.slice(0, maxRows)) {
    const cells = Array.from(tr.querySelectorAll('th,td'))
      .map(c => cleanText(c.textContent))
      .filter(Boolean);
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return null;
  const caption = el.querySelector('caption')?.textContent || undefined;
  return { caption: caption ? cleanText(caption) : undefined, rows };
}

export function walkDocument(options: WalkerOptions = {}): ExtractResult {
  const {
    includeHidden = true,
    excludeBoilerplate = false,
    maxTables = 40,
    maxTableRows = 100,
    maxLinks = 800,
    maxImages = 200
  } = options;

  const headings: string[] = [];
  const paragraphs: string[] = [];
  const lists: string[] = [];
  const tables: ExtractTable[] = [];
  const links: ExtractLink[] = [];
  const images: ExtractImage[] = [];

  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT, null);
  const seenText = new Set<string>();

  while (walker.nextNode()) {
    const el = walker.currentNode as HTMLElement;
    if (!el) continue;
    if (!includeHidden && !isElementVisible(el)) continue;
    if (isBoilerplate(el, excludeBoilerplate)) continue;

    const tag = el.tagName;
    switch (tag) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        const t = cleanText(el.textContent);
        if (t && !seenText.has('h:' + t)) {
          headings.push(`${tag}: ${t}`);
          seenText.add('h:' + t);
        }
        break;
      }
      case 'P': case 'BLOCKQUOTE': {
        const t = cleanText(el.textContent);
        if (t && !seenText.has('p:' + t)) {
          paragraphs.push(tag === 'BLOCKQUOTE' ? '> ' + t : t);
          seenText.add('p:' + t);
        }
        break;
      }
      case 'LI': {
        const t = cleanText(el.textContent);
        if (t && !seenText.has('li:' + t)) {
          lists.push('• ' + t);
          seenText.add('li:' + t);
        }
        break;
      }
      case 'TABLE': {
        if (tables.length >= maxTables) break;
        const tbl = extractTable(el as HTMLTableElement, maxTableRows);
        if (tbl) tables.push(tbl);
        break;
      }
      case 'A': {
        if (links.length >= maxLinks) break;
        const a = el as HTMLAnchorElement;
        const href = a.getAttribute('href') || '';
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) break;
        const text = cleanText(a.textContent);
        if (text) {
          links.push({ text, href: a.href || href });
        }
        break;
      }
      case 'IMG': {
        if (images.length >= maxImages) break;
        const alt = el.getAttribute('alt') || '';
        const src = (el as HTMLImageElement).currentSrc || el.getAttribute('src') || '';
        if (src) {
          const cap = el.closest('figure')?.querySelector('figcaption')?.textContent || undefined;
            images.push({
            alt: cleanText(alt),
            src,
            caption: cap ? cleanText(cap) : undefined
          });
        }
        break;
      }
      default:
        break;
    }
  }

  const title = cleanText(document.querySelector('title')?.textContent || document.title || '');
  const meta = collectMeta();
  const rawLength =
    headings.join('\n').length +
    paragraphs.join('\n').length +
    lists.join('\n').length;

  return {
    title,
    headings,
    paragraphs,
    lists,
    tables,
    links,
    images,
    meta,
    rawLength
  };
}
