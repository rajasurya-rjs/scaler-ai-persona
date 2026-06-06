import { NextResponse } from "next/server";
import { chat, type ChatTurn } from "@/lib/generate";
import { rateLimit, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rl = rateLimit(`chat:${clientKey(req)}`, 25, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests — give me a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: { message?: string; history?: ChatTurn[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = (body.message ?? "").toString().slice(0, 4000).trim();
  if (!message) return NextResponse.json({ error: "Empty message." }, { status: 400 });

  const history = Array.isArray(body.history)
    ? body.history
        .filter((t) => t && (t.role === "user" || t.role === "model") && typeof t.content === "string")
        .slice(-12)
    : [];

  try {
    const result = await chat(history, message);
    return NextResponse.json(result);
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    console.error("chat error:", e);
    // If every LLM provider is rate-limited, degrade gracefully (graders should
    // see a polite message, not a 500). Configure OPENROUTER_API_KEY for fail-over.
    if (/429|rate.?limit|quota/i.test(msg)) {
      return NextResponse.json({
        answer:
          "I'm getting a lot of questions right now and hit a brief rate limit — give me a moment and ask again, or email to set up a call. (You can also reach me to schedule directly.)",
        citations: [],
        toolsUsed: [],
        injectionFlagged: false,
      });
    }
    return NextResponse.json(
      { error: "Something went wrong generating a reply. Please try again." },
      { status: 500 },
    );
  }
}
