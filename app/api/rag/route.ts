import { NextResponse } from "next/server";
import { retrieve } from "@/lib/retriever";
import { formatContext } from "@/lib/security";
import { rateLimit, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generic retrieval endpoint. Returns concise grounded snippets (NOT a second
 * LLM call) so a caller — e.g. the voice agent's `search_background` tool — gets
 * low-latency grounding it can speak from. Also handy for testing retrieval.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`rag:${clientKey(req)}`, 40, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  let body: { query?: string; k?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const query = (body.query ?? "").toString().slice(0, 1000).trim();
  if (!query) return NextResponse.json({ error: "Empty query" }, { status: 400 });

  const chunks = await retrieve(query, { k: Math.min(body.k ?? 4, 8) });
  return NextResponse.json({
    grounding: formatContext(chunks),
    snippets: chunks.map((c) => ({ title: c.title, url: c.url, text: c.text, score: Number(c.score.toFixed(3)) })),
  });
}
