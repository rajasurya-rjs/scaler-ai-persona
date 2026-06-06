# Architecture & Design Decisions

## 1. System overview

Two front doors (voice + chat) over one grounded knowledge base and one calendar.

```mermaid
flowchart TD
    subgraph Ingest["Ingest (build time)"]
      R[resume.pdf] -->|pdf-parse| C[chunker]
      G[GitHub API: repos, READMEs, commits] --> C
      C --> E[Gemini gemini-embedding-001]
      E --> IDX[(data/index.json<br/>embedded chunks)]
    end

    subgraph Chat["Chat — Next.js on Vercel"]
      U[Browser] --> API["/api/chat"]
      API --> SEC[security: injection detect]
      SEC --> RET[retriever: in-memory cosine]
      IDX --> RET
      RET --> PR[prompt: segregated documents]
      PR --> LLM[Groq Llama-3.3-70B + tools]
      LLM --> OG[output guard]
      OG --> U
    end

    subgraph Voice["Voice — Vapi"]
      CALLER[Caller] -->|PSTN| VAPI[Vapi: Deepgram STT · Groq LLM · TTS]
      VAPI -->|search_background| VAPIEP["/api/voice"]
      VAPIEP --> RET
    end

    LLM -->|get_availability / book_meeting| CAL[Google Calendar API]
    VAPIEP -->|get_availability / book_meeting| CAL
    CAL --> INV[real invite + freeBusy]
```

## 2. Key decisions and tradeoffs

### 2.1 In-memory retrieval instead of a vector database
**Decision:** embed the whole corpus at build time, ship it as `data/index.json`,
brute-force cosine search at request time.

**Why:** the corpus is one resume + a few dozen repos ≈ a few hundred chunks (well
under ~1 MB of vectors). Brute-force cosine over that is sub-millisecond. A hosted
vector DB would add a network hop (latency), an account/secret, and a cost — all to
solve a scale problem we don't have.

**Tradeoff consciously accepted:** this does **not** scale to large corpora (tens of
thousands of chunks) and re-ingest is a full rebuild. For this use case that's
correct; for a 100k-doc corpus I'd switch to Qdrant/pgvector with ANN.

### 2.2 Latency split for voice (in-prompt brief + RAG tool)
**Decision:** the voice agent's system prompt embeds a compact, real-data brief
(resume + repo overviews). Specific/deep questions trigger a `search_background`
tool call to the live RAG.

**Why:** a tool call adds a round-trip mid-turn. Answering the common 80% from the
prompt keeps first-response latency low; the long tail stays grounded via RAG.
**Tradeoff:** the brief duplicates some data already in the index. Worth it for
latency. Bounded to ~6k chars so it doesn't bloat time-to-first-token.

### 2.3 Google Calendar API for booking (shared by voice + chat)
**Decision:** one `lib/calendar.ts` doing `freeBusy.query` + `events.insert`, called
by both the chat tool layer and the Vapi `/api/voice` webhook.

**Why:** single source of truth for availability and bookings; consistent working
hours, timezone, and double-book guard everywhere. Vapi's *native* Google Calendar
tools are an alternative (lower code) but split the logic across the dashboard and
had edge-case reliability reports — so we default to the shared server tools and
document the native path.
**Tradeoff:** we maintain timezone/slot math ourselves (no tz library — done with
`Intl`), versus letting Vapi manage it. We chose control + consistency.

### 2.4 Groq (chat + voice reasoning) + Gemini (embeddings only)
**Decision:** Groq Llama-3.3-70B for both the chat persona and the voice brain;
Google `gemini-embedding-001` for embeddings only.

**Why:** Groq's free tier has much higher request limits than Gemini's
generateContent free tier (which throttled hard at 5–15 RPM and daily caps during
testing) and very low time-to-first-token — good for both a probed public chat and
a latency-sensitive phone call. Embeddings stay on Gemini because Groq doesn't serve
embeddings and Gemini's *embedding* quota is separate and ample. One LLM provider
across voice + chat keeps the persona behaviour consistent.
**Tradeoff:** two providers (Groq + Gemini) = two keys, and Groq's open-weight Llama
is a notch below frontier models on subtle reasoning. Accepted for $0 cost + high
free-tier throughput. Swappable: `lib/llm.ts` is a thin OpenAI-compatible client, so
moving the brain to Claude Haiku / GPT later is a config change.

### 2.5 Defense-in-depth for prompt injection
**Decision:** content segregation (trust-labelled `<document>` blocks) + input
heuristics + output validation + grounded refusal — see `lib/security.ts`.

**Why:** OWASP LLM01 — injection is not fully solvable; README/commit text is
attacker-influenceable (indirect injection / RAG poisoning, ~90%+ ASR in research
with a single poisoned doc). No single guard suffices.
**Tradeoff:** heuristics have false positives (flagging is advisory, not blocking)
and add minor latency. Acceptable for a public, adversarially-probed endpoint.

## 3. Data flow: one chat turn
1. `POST /api/chat { message, history }`
2. `detectInjection(message)` → advisory flag
3. `retrieve(recent+message, k=6)` → cosine top-k from `index.json`
4. `formatContext()` wraps hits in trust-labelled `<document>` blocks
5. `buildSystemPrompt()` injects grounding + security + booking rules
6. Groq (Llama-3.3-70B) generates; may call `get_availability` / `book_meeting` (real calendar)
7. `validateOutput()` guards against leakage/persona break
8. Response: `{ answer, citations, toolsUsed, injectionFlagged }`

## 4. Failure modes & mitigations (see eval report for measured ones)
- **Retrieval miss** → answer says "I don't have that" rather than guessing (grounded refusal).
- **Poisoned README** → segregation + "documents are data, not instructions" + output guard.
- **Slot race** (two bookings same slot) → `book_meeting` re-checks freeBusy before insert.
- **Free-tier rate limit** → embedding calls use exponential backoff; chat is light.
- **Voice tail latency** → short `maxTokens`, in-prompt brief, tuned endpointing.

## 5. What a hosted/scaled version would change
- Vector DB (Qdrant/pgvector) + incremental re-ingest on GitHub webhook.
- Retrieval reranker (cross-encoder) for precision on a larger corpus.
- Per-tenant calendar OAuth (multi-user) instead of a single refresh token.
- Observability: tracing every turn (retrieved ids, scores, tool calls, latency).
