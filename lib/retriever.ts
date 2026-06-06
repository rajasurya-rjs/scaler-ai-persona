// Runtime retriever. Loads the prebuilt embedded index once (module singleton)
// and does brute-force cosine search. The corpus is small (hundreds of chunks),
// so this is sub-millisecond and needs no vector DB.

import { embed, cosineSim } from "./embeddings";
import type { IndexFile, RetrievedChunk } from "./types";

// Bundled at build time. `resolveJsonModule` makes this a typed import.
// If the file is missing (forgot to run `npm run ingest`), fail loudly.
let _index: IndexFile | null = null;

function loadIndex(): IndexFile {
  if (_index) return _index;
  try {
    // Lazy require so a missing index doesn't crash unrelated routes at import time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const data = require("../data/index.json") as IndexFile;
    if (!data?.chunks?.length) throw new Error("empty");
    _index = data;
    return data;
  } catch {
    throw new Error(
      "RAG index not found or empty. Run `npm run ingest` to build data/index.json before starting the app.",
    );
  }
}

export function indexMeta() {
  const idx = loadIndex();
  return { ...idx.persona, stats: idx.stats, builtAt: idx.builtAt, embedModel: idx.embedModel };
}

export interface RetrieveOptions {
  k?: number;
  /** Drop chunks below this cosine score (reduces off-topic grounding). */
  minScore?: number;
}

export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<RetrievedChunk[]> {
  const k = opts.k ?? 6;
  const minScore = opts.minScore ?? 0.45;
  const idx = loadIndex();

  const qvec = await embed(query, "RETRIEVAL_QUERY");

  const scored: RetrievedChunk[] = idx.chunks.map((c) => {
    const { embedding, ...rest } = c;
    return { ...rest, score: cosineSim(qvec, embedding) };
  });

  scored.sort((a, b) => b.score - a.score);

  const top = scored.filter((c) => c.score >= minScore).slice(0, k);
  // Always return at least the single best hit so the model has *something*
  // to ground on (it can still say "I don't know" if it's irrelevant).
  return top.length ? top : scored.slice(0, 1);
}
