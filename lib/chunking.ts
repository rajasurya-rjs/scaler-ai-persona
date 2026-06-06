// Lightweight, dependency-free chunking. The corpus is small (one resume + a
// few dozen repos), so we favour semantically-clean chunks over clever splits:
// split on blank lines / headings, then pack paragraphs up to a target size
// with a little overlap so context isn't severed mid-thought.

export interface ChunkOptions {
  targetChars?: number;
  overlapChars?: number;
}

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const targetChars = opts.targetChars ?? 1200;
  const overlapChars = opts.overlapChars ?? 150;

  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];

  // Split into paragraph-ish blocks first.
  const blocks = normalized.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  const chunks: string[] = [];
  let buf = "";

  const flush = () => {
    const t = buf.trim();
    if (t) chunks.push(t);
    buf = "";
  };

  for (const block of blocks) {
    // A single huge block (e.g. a long README section) → hard-split it.
    if (block.length > targetChars) {
      flush();
      for (const piece of hardSplit(block, targetChars, overlapChars)) chunks.push(piece);
      continue;
    }
    if ((buf + "\n\n" + block).length > targetChars) {
      flush();
      buf = block;
    } else {
      buf = buf ? buf + "\n\n" + block : block;
    }
  }
  flush();

  return chunks;
}

function hardSplit(text: string, size: number, overlap: number): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    out.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = end - overlap;
  }
  return out;
}
