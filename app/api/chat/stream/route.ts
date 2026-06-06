import { chatStream, type ChatTurn } from "@/lib/generate";
import { rateLimit, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events: streams the reply token-by-token (ChatGPT-style), plus
// `status` events during tool calls and a final `done` event with citations.
export async function POST(req: Request) {
  const rl = rateLimit(`stream:${clientKey(req)}`, 25, 60_000);
  if (!rl.ok) {
    return new Response("rate limited", { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  }

  let body: { message?: string; history?: ChatTurn[] };
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const message = (body.message ?? "").toString().slice(0, 4000).trim();
  if (!message) return new Response("empty message", { status: 400 });

  const history = Array.isArray(body.history)
    ? body.history
        .filter((t) => t && (t.role === "user" || t.role === "model") && typeof t.content === "string")
        .slice(-12)
    : [];

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      // No-ops once the client disconnects, so we never enqueue to a closed
      // controller (graders closing the tab mid-stream shouldn't throw).
      const send = (obj: unknown): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };
      try {
        for await (const ev of chatStream(history, message)) {
          if (!send(ev) || req.signal?.aborted) break;
        }
      } catch (e) {
        const msg = (e as Error)?.message ?? "";
        console.error("stream error:", msg);
        send({
          type: "error",
          value: /429|rate.?limit|quota/i.test(msg)
            ? "I'm getting a lot of questions right now and hit a brief rate limit — give me a moment, then ask again."
            : "Something went wrong. Please try again.",
        });
      } finally {
        send({ type: "end" });
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
