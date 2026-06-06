import { NextResponse } from "next/server";
import { retrieve } from "@/lib/retriever";
import { getAvailability, bookMeeting } from "@/lib/calendar";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vapi custom-tool webhook. ONE endpoint that handles every server tool the
 * voice agent might call, so voice + chat share the exact same RAG + calendar
 * code. Optional — if you use Vapi's NATIVE Google Calendar tools you only need
 * the `search_background` tool here for RAG grounding.
 *
 * Vapi POSTs { message: { type: "tool-calls", toolCalls/toolCallList: [...] } }
 * and expects { results: [ { toolCallId, result } ] }.
 */
export async function POST(req: Request) {
  // Optional shared-secret check (set VAPI_SERVER_SECRET + matching header in Vapi).
  const secret = env("VAPI_SERVER_SECRET");
  if (secret && req.headers.get("x-vapi-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const calls = extractToolCalls(body);
  if (!calls.length) return NextResponse.json({ results: [] });

  const results = await Promise.all(
    calls.map(async (c) => ({ toolCallId: c.id, result: await dispatch(c.name, c.args) })),
  );
  return NextResponse.json({ results });
}

interface ParsedCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

function extractToolCalls(body: any): ParsedCall[] {
  const msg = body?.message ?? body;
  const raw = msg?.toolCalls ?? msg?.toolCallList ?? msg?.tool_calls ?? [];
  return (Array.isArray(raw) ? raw : []).map((t: any) => {
    const name = t?.function?.name ?? t?.name ?? "";
    let args = t?.function?.arguments ?? t?.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    return { id: t?.id ?? t?.toolCallId ?? "", name, args };
  });
}

async function dispatch(name: string, args: Record<string, any>): Promise<string> {
  try {
    switch (name) {
      case "search_background": {
        const query = String(args.query ?? "").slice(0, 1000);
        if (!query) return "No query provided.";
        const chunks = await retrieve(query, { k: 4 });
        if (!chunks.length) return "I don't have information on that in my background.";
        // Concise, speakable grounding — the voice LLM composes the final answer.
        return chunks.map((c) => `[${c.title}] ${c.text}`).join("\n\n").slice(0, 2500);
      }
      case "get_availability": {
        const slots = await getAvailability(Math.min(Number(args.limit ?? 4), 6));
        if (!slots.length) return "I don't have open slots in the next couple of weeks. Please suggest a time and I'll check.";
        return "Available slots: " + slots.map((s) => s.label).join("; ") + ". Each is 30 minutes.";
      }
      case "book_meeting": {
        const res = await bookMeeting({
          startISO: String(args.startISO ?? args.start ?? ""),
          attendeeName: String(args.attendeeName ?? args.name ?? ""),
          attendeeEmail: String(args.attendeeEmail ?? args.email ?? ""),
          notes: args.notes ? String(args.notes) : undefined,
        });
        return res.success
          ? `Booked. A calendar invite has been sent. The meeting is confirmed.`
          : `Could not book that slot: ${res.error ?? "unknown error"}. Let me offer another time.`;
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (e) {
    return `Error running ${name}: ${(e as Error).message}`;
  }
}
