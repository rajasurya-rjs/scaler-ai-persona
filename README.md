# AI Persona — Voice Agent + RAG Chat

A callable **voice agent** and a public **RAG-grounded chat** that answer questions
about my background and **autonomously book interviews on my real Google Calendar** —
no human in the loop. Built for the Scaler AI Engineer Intern screening assignment.

- 📞 **Voice:** call a phone number → my AI representative answers, handles barge-in,
  and books an interview.
- 💬 **Chat:** public URL → ask about my resume, GitHub repos (stack, purpose,
  tradeoffs), check availability, book a call. Stays grounded and honest under
  adversarial probing.
- 🧪 **Evals:** retrieval precision/recall, hallucination rate, injection resistance,
  voice latency + booking success — all reproducible from this repo.

> **Grounding, not hardcoding.** The persona reads my **real** resume + GitHub
> (READMEs, repo metadata, recent commit history) at ingest time and answers only
> from retrieved evidence. Questions whose answers live only in a repo README or
> commit log are answered from the index — by design.

---

## Architecture

```
                          ┌─────────────────────────── INGEST (build time) ──────────────────────────┐
                          │  resume.pdf ──pdf-parse─┐                                                  │
                          │  GitHub API ─repos/READMEs/commits─┐                                       │
                          │                          └─► chunk ─► Gemini gemini-embedding-001 ─► index.json
                          └───────────────────────────────────────────────────────────────────────────┘
                                                                     │ (prebuilt embeddings, ~hundreds of chunks)
                                                                     ▼
   ┌──────────── VOICE ────────────┐                    ┌──────────────── CHAT (Next.js on Vercel) ───────────────┐
   │ Caller ─PSTN─► Vapi           │                    │  Browser ─► /api/chat                                   │
   │  STT: Deepgram nova           │   search_background │     │  detect injection (security.ts)                  │
   │  LLM: Groq Llama-3.3-70B  ────┼───► /api/voice ◄────┼─────┤  retrieve top-k (in-memory cosine)               │
   │  TTS: Vapi voice              │   get_availability  │     │  ground w/ segregated <document> blocks          │
   │  barge-in + endpointing tuned │   book_meeting      │     │  Groq Llama-3.3-70B + tools                        │
   └───────────────┬───────────────┘                    │     │  output guard ─► answer + citations              │
                   │                                     │     └──────────────┬───────────────────────────────────┘
                   └─────────── book_meeting / get_availability ──────────────┤
                                                                              ▼
                                                          Google Calendar API (freeBusy + events.insert)
                                                                  → real availability, real invite
```

Detailed design + tradeoffs: [docs/architecture.md](docs/architecture.md).

### Why this shape
- **Tiny corpus → no vector DB.** One resume + a few dozen repos = a few hundred
  chunks. We ship the embedded index as JSON and do brute-force cosine search
  in-memory: sub-millisecond, $0 infra, serverless-friendly. A Pinecone/Chroma
  service would be cost and latency we don't need at this scale.
- **One calendar, two front doors.** Voice and chat call the **same**
  `lib/calendar.ts` (Google Calendar freeBusy + events.insert), so availability and
  bookings are always consistent.
- **Latency split for voice.** Common questions are answered from an in-prompt
  brief (distilled from real data) for speed; deep/specific questions hit the live
  RAG tool. Groq + Deepgram + tuned endpointing target a <2s first response.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Voice orchestration | **Vapi** | Native Google Calendar tools, free trial + free phone number, tunable barge-in/endpointing |
| Voice STT / LLM / TTS | **Deepgram nova / Groq Llama-3.3-70B / Vapi voice** | Low latency, free tiers |
| Chat app | **Next.js 14 (App Router) on Vercel** | Always-reachable public URL on free tier, one deploy |
| Chat + voice LLM | **Groq Llama-3.3-70B (free)** | Fast, high free-tier limits, tool-calling for booking |
| Embeddings | **Google Gemini `gemini-embedding-001` (free)** | 3072-dim, free tier, separate quota |
| Retrieval | **In-memory cosine over prebuilt index** | $0, fast at this corpus size |
| Booking | **Google Calendar API** (freeBusy + events.insert) | Real calendar, real invites, free |
| Evals | **TS harness + Groq LLM-judge** | Reproducible retrieval/groundedness/voice metrics |

Everything sits on a **free tier**. See [Cost breakdown](#cost-breakdown).

---

## Repo structure

```
lib/            core: embeddings, retriever, prompts, security, generate, calendar
scripts/        ingest.ts (build index), get-google-refresh-token.ts (OAuth)
app/            Next.js chat UI + API routes (/chat, /rag, /voice, /health)
voice/          Vapi assistant builder, system-prompt template, setup guide
evals/          golden-qa.json + retrieval / groundedness / voice harnesses
report/         1-page eval report (fill with real numbers → export PDF)
data/           resume/ (your PDF) + index.json (generated)
docs/           architecture + design decisions
SETUP.md        ← do this: exact step-by-step to go live
```

---

## Quick start

```bash
cp .env.example .env.local      # fill in keys (see SETUP.md)
npm install
# 1) drop your resume at data/resume/resume.pdf, set GITHUB_USERNAME + Gemini key (embeddings) + Groq key (chat)
npm run ingest                  # builds data/index.json from resume + GitHub
npm run dev                     # chat at http://localhost:3000
# 2) booking
npm run get-google-token        # one-time: mints Google Calendar refresh token
# 3) voice
npm run build:voice             # generates voice/vapi-assistant.json from real data
```

Full, ordered instructions (accounts, OAuth, deploy, phone number): **[SETUP.md](SETUP.md)**.

---

## Evals

```bash
npm run eval:all          # retrieval P/R + groundedness/injection + voice (from logged calls)
```
Writes `evals/results/summary.json`. Feed those numbers into
[report/eval-report.md](report/eval-report.md) and export to PDF.

- **Retrieval:** Precision@k, Recall@k (true denominator from the real index), MRR, Hit@k.
- **Groundedness:** LLM-judge faithfulness → hallucination rate; adversarial set → injection-resistance rate.
- **Voice:** first-response latency P50/P95, %<2s, WER-based transcription accuracy, booking success rate from real test calls (`evals/voice-calls.csv`).

---

## Cost breakdown

**Designed to run at $0 on free tiers** for the assignment + the 7-day live window.
Order-of-magnitude pay-as-you-go costs (if free limits are exceeded):

| Unit | Components | Approx. metered cost | Free-tier reality |
|---|---|---|---|
| **1 chat session** (~5 turns) | Groq Llama-3.3-70B (~12k in / 1.5k out tokens) + ~5 Gemini query embeddings + Vercel function | **≈ $0.002–0.005** | $0 — within Groq + Gemini-embedding free tiers and Vercel free |
| **1 voice call** (~3 min) | Vapi platform fee + Groq LLM + Deepgram STT + TTS + telephony | **a few cents/min, metered** — *measure on your own account; published per-minute figures vary and I verified none of them* | $0 — covered by Vapi's free trial credit during the eval window |
| **Ingest (one-time)** | Embedding a few hundred chunks with gemini-embedding-001 | **≈ $0** | $0 — within free tier |
| **Hosting (7 days)** | Vercel Hobby + Google Calendar API | **$0** | $0 |

> Honesty note: my research found **no reliable public per-minute price** for the
> voice platforms (every specific figure I checked failed verification), so the
> voice row is metered-and-measured, not quoted. The eval report records the
> actual cost-per-call observed on my Vapi dashboard.

**Keeping it live 7+ days:** Vercel free is always-reachable (no sleep). The only
non-zero risk is Vapi trial credit running low under repeated unannounced calls —
top up ~$5–10 if needed so the number never goes dead.

---

## Security / honesty posture

Prompt injection **cannot be fully prevented** (OWASP LLM01), and README/commit
text is externally authored — a real indirect-injection / RAG-poisoning vector. So
we use **defense-in-depth**, not a single block:
1. **Content segregation** — retrieved docs are wrapped in trust-labelled
   `<document>` blocks; the model is told everything inside is *data, never
   instructions*.
2. **Input heuristics** — obvious injection attempts are flagged (and shown in the UI).
3. **Output validation** — system-prompt leakage / persona breaks are caught and replaced.
4. **Grounded refusal** — unknown answers get an honest "I don't have that," never a fabrication.

Measured by the adversarial set in the evals (injection-resistance rate).

---

## License

MIT. Personal data (resume PDF, `.env.local`) is git-ignored and never committed.
