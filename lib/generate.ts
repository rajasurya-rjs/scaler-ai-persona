// Chat generation: retrieve → ground → generate with Groq (Llama-3.3-70B),
// exposing two real booking tools (get_availability / book_meeting). Wrapped in
// the security layer (injection detection on input, content segregation in the
// prompt, output guard). Embeddings/retrieval stay on Gemini.

import { llmChat, llmStream, type ChatMessage } from "./llm";
import { retrieve } from "./retriever";
import { buildSystemPrompt } from "./prompts";
import { formatContext, detectInjection, validateOutput } from "./security";
import { getAvailability, bookMeeting, calendarConfigured } from "./calendar";
import type { RetrievedChunk } from "./types";

export interface ChatTurn {
  role: "user" | "model";
  content: string;
}

export interface ChatResult {
  answer: string;
  citations: { title: string; url?: string; source: string; score: number }[];
  toolsUsed: string[];
  injectionFlagged: boolean;
}

const tools = [
  {
    type: "function",
    function: {
      name: "get_availability",
      description:
        "Fetch real open interview slots from the candidate's Google Calendar. Call this before proposing times.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "How many slots to fetch (default 5)." } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_meeting",
      description:
        "Book a real interview on the candidate's calendar at a chosen slot. Only call after the user picked a specific time and gave their name and email.",
      parameters: {
        type: "object",
        properties: {
          startISO: { type: "string", description: "Slot start in ISO 8601 (from get_availability)." },
          attendeeName: { type: "string", description: "The interviewer's full name." },
          attendeeEmail: { type: "string", description: "The interviewer's email for the invite." },
          notes: { type: "string", description: "Optional context for the meeting." },
        },
        required: ["startISO", "attendeeName", "attendeeEmail"],
      },
    },
  },
];

async function runTool(name: string, args: Record<string, unknown>): Promise<object> {
  try {
    if (!calendarConfigured()) {
      return { error: "Calendar not configured on the server yet. Ask the user to email to schedule." };
    }
    if (name === "get_availability") {
      const limit = Number(args?.limit ?? 5);
      const slots = await getAvailability(Math.min(Math.max(limit, 1), 8));
      return { slots, note: slots.length ? "Propose 2-3 of these." : "No open slots in the window." };
    }
    if (name === "book_meeting") {
      const a = args as Record<string, string>;
      return await bookMeeting({
        startISO: a.startISO,
        attendeeName: a.attendeeName,
        attendeeEmail: a.attendeeEmail,
        notes: a.notes,
      });
    }
    return { error: `Unknown tool: ${name}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function chat(history: ChatTurn[], userMessage: string): Promise<ChatResult> {
  const { flagged } = detectInjection(userMessage);

  // Retrieve grounding for the latest message (plus a little recent context).
  // k=5 balances recall (R@6 was 0.75, MRR 1.0 so the top hits carry the answer)
  // against free-tier token budget — fewer chunks = fewer input tokens per turn.
  const recent = history.slice(-2).map((t) => t.content).join(" ");
  const retrieved: RetrievedChunk[] = await retrieve(`${recent} ${userMessage}`.trim(), { k: 5 });
  const context = formatContext(retrieved);

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt({ context, injectionFlagged: flagged }) },
    ...history.map((t) => ({ role: t.role === "model" ? ("assistant" as const) : ("user" as const), content: t.content })),
    { role: "user", content: userMessage },
  ];

  const toolsUsed: string[] = [];
  let answer = "";

  // Tool-calling loop (cap iterations to avoid runaway).
  for (let i = 0; i < 5; i++) {
    const msg = await llmChat({ messages, tools, temperature: 0.3, max_tokens: 450 }, "chat");
    messages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length) {
      for (const tc of msg.tool_calls) {
        toolsUsed.push(tc.function.name);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await runTool(tc.function.name, args);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue;
    }

    answer = (msg.content ?? "").trim();
    break;
  }

  if (!answer) {
    answer = "Sorry — I had trouble forming that response. Could you rephrase, or shall I set up a quick call?";
  }

  const guarded = validateOutput(answer);

  return {
    answer: guarded.safe,
    citations: retrieved.map((c) => ({ title: c.title, url: c.url, source: c.source, score: Number(c.score.toFixed(3)) })),
    toolsUsed: [...new Set(toolsUsed)],
    injectionFlagged: flagged,
  };
}

// ---- Streaming variant (token-by-token, ChatGPT-style) ---------------------

export type StreamEvent =
  | { type: "token"; value: string }
  | { type: "status"; value: string }
  | { type: "replace"; value: string }
  | { type: "done"; citations: ChatResult["citations"]; toolsUsed: string[]; injectionFlagged: boolean };

function statusFor(tool: string): string {
  if (tool === "get_availability") return "Checking my calendar…";
  if (tool === "book_meeting") return "Booking your slot…";
  return "Working on it…";
}

// Backstop for models that leak tool-call syntax as visible text (e.g. the
// harmony `<function=name>…</function>` format). Strip it so the user never
// sees raw function tags in the reply.
function stripToolSyntax(text: string): string {
  return text
    .replace(/<function=[^>]*>[\s\S]*?<\/function>/gi, "")
    .replace(/<\/?function[^>]*>/gi, "")
    .replace(/<\|[^|]*\|>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function* chatStream(history: ChatTurn[], userMessage: string): AsyncGenerator<StreamEvent> {
  const { flagged } = detectInjection(userMessage);
  const recent = history.slice(-2).map((t) => t.content).join(" ");
  const retrieved: RetrievedChunk[] = await retrieve(`${recent} ${userMessage}`.trim(), { k: 5 });
  const context = formatContext(retrieved);

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt({ context, injectionFlagged: flagged }) },
    ...history.map((t) => ({ role: t.role === "model" ? ("assistant" as const) : ("user" as const), content: t.content })),
    { role: "user", content: userMessage },
  ];

  const toolsUsed: string[] = [];
  let finalText = "";

  for (let iter = 0; iter < 5; iter++) {
    let assistantContent = "";
    let emittedTokens = false;
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();

    for await (const choice of llmStream({ messages, tools, temperature: 0.3, max_tokens: 450 }, "chat")) {
      const d = choice.delta ?? {};
      if (d.content) {
        assistantContent += d.content;
        emittedTokens = true;
        yield { type: "token", value: d.content };
      }
      if (d.tool_calls) {
        for (const tc of d.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          toolAcc.set(idx, cur);
        }
      }
    }

    if (toolAcc.size > 0) {
      const tool_calls = [...toolAcc.values()].map((t) => ({
        id: t.id,
        type: "function" as const,
        function: { name: t.name, arguments: t.args },
      }));
      messages.push({ role: "assistant", content: assistantContent || null, tool_calls });
      // Any text streamed before the tool call is just preamble ("let me check…").
      // The real reply comes after the tool runs, so clear the preamble to avoid
      // the user seeing two stacked answers.
      if (emittedTokens) yield { type: "replace", value: "" };
      for (const t of tool_calls) {
        toolsUsed.push(t.function.name);
        yield { type: "status", value: statusFor(t.function.name) };
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(t.function.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await runTool(t.function.name, args);
        messages.push({ role: "tool", tool_call_id: t.id, content: JSON.stringify(result) });
      }
      continue; // stream the follow-up answer
    }

    finalText = assistantContent;
    break;
  }

  // Output guards (backstops, since we stream live):
  //  1. strip any leaked tool-call syntax,
  //  2. replace the whole reply if it tripped the system-prompt leak guard.
  const cleaned = stripToolSyntax(finalText);
  const guarded = validateOutput(cleaned);
  if (!guarded.ok) yield { type: "replace", value: guarded.safe };
  else if (cleaned !== finalText) yield { type: "replace", value: cleaned };

  yield {
    type: "done",
    citations: retrieved.map((c) => ({ title: c.title, url: c.url, source: c.source, score: Number(c.score.toFixed(3)) })),
    toolsUsed: [...new Set(toolsUsed)],
    injectionFlagged: flagged,
  };
}
