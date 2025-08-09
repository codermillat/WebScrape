/**
 * llmPipeline.ts
 * Helpers for chunking extracted text and building structured prompts.
 * Focused purely on text shaping; NO network calls here.
 */

export interface ChunkOptions {
  maxChunkSize?: number; // approximate char budget per chunk
  minChunkSize?: number; // attempt to avoid very tiny trailing chunks
}

/**
 * Split content by lines while trying to keep sections cohesive.
 */
export function chunkText(content: string, opts: ChunkOptions = {}): string[] {
  const {
    maxChunkSize = 12000,
    minChunkSize = 2000
  } = opts;

  const lines = (content || '').split(/\n/);
  const out: string[] = [];
  let cur: string[] = [];
  let curLen = 0;

  function pushCur(force = false) {
    if (!cur.length) return;
    if (!force && curLen < minChunkSize && out.length) {
      // merge into previous
      const prev = out.pop()!;
      out.push(prev + '\n' + cur.join('\n'));
    } else {
      out.push(cur.join('\n'));
    }
    cur = [];
    curLen = 0;
  }

  for (const line of lines) {
    const l = line || '';
    const projected = curLen + l.length + 1;
    if (projected > maxChunkSize && cur.length) {
      pushCur();
    }
    cur.push(l);
    curLen += l.length + 1;
  }
  pushCur(true);
  return out;
}

/**
 * Primary structured extraction / organization prompt.
 */
export function buildStructuredPrompt(title: string, url: string, content: string): string {
  return `Return plain text ONLY. Do not fabricate. Use only facts present.
Sections (omit if absent) exactly this order:
RANKING
COURSES
FEES
ELIGIBILITY
ADMISSION PROCESS
SCHOLARSHIPS
PAYMENTS
VISA_FRRO
CONTACT
NOTES
Rules:
- Each section header alone on its own line.
- Preserve INR symbols, semester/year labels.
- Consolidate duplicates; keep concise.
- End output with: Source: ${url}

TITLE: ${title}
URL: ${url}

CONTENT START
${content}
CONTENT END`;
}

/**
 * Secondary synthesis prompt that merges multiple cleaned structured chunks.
 */
export function buildSynthesisPrompt(title: string, url: string, structuredSegments: string[]): string {
  return `Merge the following already-structured segments into ONE consolidated output.
Do NOT invent data. Remove strict duplicates. Preserve section ordering & headers.
Maintain the exact allowed section list; omit empty ones. End with 'Source: ${url}'.

Title: ${title}
URL: ${url}

SEGMENTS:
${structuredSegments.map((s, i) => `--- Segment ${i + 1} ---\n${s}`).join('\n')}`;
}
