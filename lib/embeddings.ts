// Embeddings via Google Gemini (free tier: text-embedding-004) + cosine math.
// One module used by both the ingest script and the runtime retriever so the
// query is embedded with the exact same model as the corpus.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { env, envRequired, models } from "./env";

let client: GoogleGenerativeAI | null = null;
function genai(): GoogleGenerativeAI {
  if (!client) client = new GoogleGenerativeAI(envRequired("GOOGLE_GENERATIVE_AI_API_KEY"));
  return client;
}

/**
 * Embed a single text. `taskType` lets Gemini optimise asymmetric retrieval:
 * documents are embedded as RETRIEVAL_DOCUMENT, queries as RETRIEVAL_QUERY.
 */
export async function embed(
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT",
): Promise<number[]> {
  const model = genai().getGenerativeModel({ model: models().embed });
  const res = await model.embedContent({
    content: { role: "user", parts: [{ text }] },
    taskType: taskType as never,
  });
  return res.embedding.values;
}

/** Embed many documents with a small concurrency cap (free-tier friendly). */
export async function embedBatch(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT",
  concurrency = 4,
): Promise<number[][]> {
  const out: number[][] = new Array(texts.length);
  let i = 0;
  async function worker() {
    while (i < texts.length) {
      const idx = i++;
      out[idx] = await withRetry(() => embed(texts[idx], taskType));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, worker));
  return out;
}

export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // Free tier rate limits → exponential backoff (1s, 2s, 4s).
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastErr;
}

export const _internal = { withRetry };
export { env };
