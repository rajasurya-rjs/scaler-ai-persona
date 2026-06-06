// Provider-pluggable chat client (OpenAI-compatible, via fetch — no SDK).
// Primary: Groq (fast, free, native Vapi). Fallback: OpenRouter free model — if
// Groq is rate-limited or down, the request fails over instead of going dark,
// which protects the "stay live 7 days under unannounced probing" requirement.
// Both speak the OpenAI Chat Completions shape, so this stays tiny.

import { env, models } from "./env";
import { withRetry } from "./retry";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmParams {
  messages: ChatMessage[];
  tools?: unknown[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
}

interface Provider {
  name: string;
  url: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

type ModelKind = "chat" | "judge";

// Latency guards. A free fallback that queues must NOT make the user wait
// minutes — we abort and fail over (or surface a friendly error) instead.
const CONNECT_TIMEOUT_MS = 30_000; // non-streaming: cap the whole call
const FIRST_TOKEN_TIMEOUT_MS = 14_000; // streaming: time-to-first-token before we bail/fail over

function providers(kind: ModelKind): Provider[] {
  const list: Provider[] = [];

  const groqUrl = "https://api.groq.com/openai/v1/chat/completions";
  const groqKey = env("GROQ_API_KEY");
  const primaryModel = kind === "judge" ? models().judge : models().chat;
  if (groqKey) {
    list.push({ name: "groq", url: groqUrl, apiKey: groqKey, model: primaryModel });

    // Same-provider fallback model. The 70B model has a tight per-DAY free-tier
    // token cap; when it's exhausted we fail over to a smaller Groq model that
    // has its own (much larger) budget — keeps the persona LIVE and fast under
    // 7 days of unannounced probing instead of going dark. Quality dips slightly
    // but stays grounded (same RAG + tools + prompt).
    const groqFallback = env("GROQ_FALLBACK_MODEL", "llama-3.1-8b-instant");
    if (groqFallback && groqFallback !== primaryModel) {
      list.push({ name: "groq-fallback", url: groqUrl, apiKey: groqKey, model: groqFallback });
    }
  }

  const orKey = env("OPENROUTER_API_KEY");
  if (orKey) {
    list.push({
      name: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: orKey,
      model: env("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free"),
      // OpenRouter recommends (not requires) these for attribution.
      extraHeaders: {
        ...(env("OPENROUTER_SITE_URL") ? { "HTTP-Referer": env("OPENROUTER_SITE_URL") } : {}),
        "X-Title": env("OPENROUTER_APP_NAME", "AI Persona"),
      },
    });
  }

  return list;
}

export function llmConfigured(): boolean {
  return providers("chat").length > 0;
}

async function callProvider(p: Provider, params: LlmParams, fullRetry: boolean): Promise<ChatMessage> {
  const body = JSON.stringify({ model: p.model, ...params });
  const doFetch = async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), CONNECT_TIMEOUT_MS);
    let r: Response;
    try {
      r = await fetch(p.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json", ...(p.extraHeaders ?? {}) },
        body,
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`${p.name} ${r.status}: ${text.slice(0, 300)}`);
    }
    const data = (await r.json()) as { choices?: { message: ChatMessage }[] };
    if (!data.choices?.length) throw new Error(`${p.name}: empty response`);
    return data.choices[0].message;
  };
  // Last provider gets full 429-aware retry; earlier providers fail fast so we
  // fall over to the next provider quickly instead of waiting out a long backoff.
  return fullRetry ? withRetry(doFetch) : doFetch();
}

export async function llmChat(params: LlmParams, kind: ModelKind = "chat"): Promise<ChatMessage> {
  const provs = providers(kind);
  if (!provs.length) {
    throw new Error("No LLM provider configured. Set GROQ_API_KEY (and optionally OPENROUTER_API_KEY).");
  }
  let lastErr: unknown;
  for (let i = 0; i < provs.length; i++) {
    const isLast = i === provs.length - 1;
    try {
      return await callProvider(provs[i], params, isLast);
    } catch (e) {
      lastErr = e;
      if (!isLast) console.warn(`LLM provider ${provs[i].name} failed, falling back: ${(e as Error).message}`);
    }
  }
  throw lastErr;
}

// A single streamed delta (OpenAI shape): choices[0] with a partial delta.
export interface StreamChoice {
  delta?: { content?: string | null; tool_calls?: any[] };
  finish_reason?: string | null;
}

/**
 * Streaming variant. Yields OpenAI-style `choices[0]` deltas. Falls over to the
 * next provider ONLY if the primary fails before emitting any token (can't resume
 * a half-streamed answer), preserving the Groq→OpenRouter resilience.
 */
export async function* llmStream(params: LlmParams, kind: ModelKind = "chat"): AsyncGenerator<StreamChoice> {
  const provs = providers(kind);
  if (!provs.length) throw new Error("No LLM provider configured.");

  let lastErr: unknown;
  for (let i = 0; i < provs.length; i++) {
    const p = provs[i];
    let started = false;
    // Abort if the provider hasn't sent a first token in time — a queued free
    // model shouldn't strand the user for a minute; bail and fail over instead.
    const ac = new AbortController();
    let firstTokenTimer: ReturnType<typeof setTimeout> | null = setTimeout(
      () => ac.abort(),
      FIRST_TOKEN_TIMEOUT_MS,
    );
    const clearFirstTokenTimer = () => {
      if (firstTokenTimer) {
        clearTimeout(firstTokenTimer);
        firstTokenTimer = null;
      }
    };
    try {
      const r = await fetch(p.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json", ...(p.extraHeaders ?? {}) },
        body: JSON.stringify({ model: p.model, ...params, stream: true }),
        signal: ac.signal,
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`${p.name} ${r.status}: ${text.slice(0, 300)}`);
      }
      if (!r.body) throw new Error(`${p.name}: no stream body`);

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const data = s.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            const json = JSON.parse(data);
            const choice = json.choices?.[0];
            if (choice) {
              if (!started) clearFirstTokenTimer(); // got first token → cancel watchdog
              started = true;
              yield choice as StreamChoice;
            }
          } catch {
            /* ignore keep-alive / partial lines */
          }
        }
      }
      return; // provider stream finished cleanly
    } catch (e) {
      lastErr = e;
      const timedOut = ac.signal.aborted && !started;
      // Can't resume mid-stream → only fall back if nothing was emitted yet.
      if (!started && i < provs.length - 1) {
        console.warn(
          `stream provider ${p.name} ${timedOut ? "timed out before first token" : "failed"}, falling back: ${(e as Error).message}`,
        );
        continue;
      }
      throw e;
    } finally {
      clearFirstTokenTimer();
    }
  }
  throw lastErr;
}
