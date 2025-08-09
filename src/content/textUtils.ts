/**
 * textUtils.ts
 * Pure utility helpers for text normalization, hashing, and signatures.
 */
export function cleanText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 0)
    .join('\n');
}

/**
 * Normalize a single line for de-duplication.
 * Lowercase, collapse whitespace, strip most punctuation (retain currency + digits).
 */
export function normalizeLine(line: string): string {
  return line
    .toLowerCase()
    .replace(/[^a-z0-9₹$€.\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Stable signature across large bodies of text (truncate & normalize).
 * Numbers replaced to reduce noise.
 */
export function stableSignatureBlock(text: string): string {
  const t = (text || '')
    .toLowerCase()
    .replace(/[0-9]+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return t.slice(0, 5000);
}

export async function sha256Hex(str: string): Promise<string> {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Cheap non-cryptographic hash for short keys (djb2 variant).
 */
export function fastHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/**
 * Build a combined lightweight signature (fastHash of stable block + length).
 */
export function combinedSignature(text: string): string {
  const block = stableSignatureBlock(text);
  return fastHash(block) + ':' + text.length;
}
