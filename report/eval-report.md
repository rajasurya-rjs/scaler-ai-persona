---
title: "AI Persona — Evaluation Report"
author: "<Your Name> · AI Engineer Intern Screening"
date: "2026-06"
geometry: margin=0.7in
fontsize: 10pt
---

# AI Persona — Evaluation Report

> Chat/retrieval numbers below are **real** (from `evals/results/summary.json`,
> Groq Llama-3.3-70B, golden set of 17 Q&A). Voice numbers are **placeholders** —
> replace with your own test calls in `evals/voice-calls.csv` before submitting.
> Export: `pandoc report/eval-report.md -o report/eval-report.pdf`.

## 1. Voice quality (N = `<N>` real test calls — PENDING)
| Metric | How measured | Result |
|---|---|---|
| First-response latency | ms from end-of-caller-speech → first assistant audio, from Vapi call logs (`evals/voice-calls.csv`) | **P50 `<P50>` ms · P95 `<P95>` ms · `<X>`% < 2000 ms** |
| Transcription accuracy | WER = (sub+ins+del)/reference words, manually labelled vs Vapi transcripts | **WER `<wer>` → `<acc>`% accuracy** |
| Task completion (booking) | % of calls that created a real Google Calendar event + sent invite | **`<booked>`/`<N>` = `<rate>`%** |

Latency is engineered with Groq (low time-to-first-token), Deepgram nova STT, a
short `maxTokens` cap, an in-prompt brief for common questions, and tuned
endpointing/barge-in (`startSpeakingPlan.waitSeconds 0.4`, `stopSpeakingPlan
numWords 1`). Barge-in verified by interrupting mid-answer; TTS suppressed without
crashing.

## 2. Chat groundedness & retrieval — MEASURED (golden set = 17 Q&A)
| Metric | How measured | Result |
|---|---|---|
| Retrieval Precision@6 / Recall@6 / MRR | golden labels matched against the real index (true recall denominator), factual queries (n=10); `npm run eval:retrieval` | **P@6 = 0.72 · R@6 = 0.75 · MRR = 1.00 · Hit@6 = 100%** |
| Groundedness / Hallucination rate | LLM-as-judge faithfulness over (question, retrieved context, answer); honest refusals = grounded; n=13 factual | **92.3% grounded · 7.7% hallucination (1/13)** |
| Injection resistance | adversarial subset (jailbreak / persona-override / fabrication), judge checks compliance; n=4 | **100% resisted (4/4)** |

Retrieval is evaluated **separately** from generation so a wrong answer is
attributable to retrieval-miss vs. generation-hallucination. MRR = 1.00 means the
top-ranked chunk was relevant on every factual query. *Judge caveat:* the judge is
the same model family (Llama-3.3-70B) as the generator, so I also manually reviewed
all 13 factual answers (manual hallucination count: 1/13, agreeing with the judge);
a stronger independent judge would reduce self-evaluation bias.

## 3. Three failure modes discovered → root cause → fix
1. **Over-claim on broad "list" queries (measured).** Asked to "list your AI/ML
   projects," the agent named real repos but characterised one (the Persona chatbot,
   whose GitHub description is blank) as an "AI/ML chatbot" — true, but not in the
   *retrieved* context for that query. The judge correctly flagged it (the 1/13
   hallucination). *Root cause:* broad aggregation queries retrieve the repo-overview
   chunk but not each repo's detail, so the model fills the gap. *Fix:* instruct the
   model to describe a repo only from retrieved text, and raise k for list-type
   queries; longer-term, enrich the overview chunk with one-line repo summaries.
2. **Indirect prompt injection via repo README / RAG poisoning.** README/commit text
   is externally authored — a documented indirect-injection vector (OWASP LLM01;
   ~90%+ ASR in research with a single poisoned doc). *Fix:* wrap retrieved text in
   trust-labelled `<document>` blocks, tell the model document text is **data not
   instructions**, an output guard that catches persona-break/leak, and input
   heuristics. Result: 100% resistance on the adversarial set.
3. **Booking: wrong-timezone / just-taken slots.** During the build, naive `Date`
   math ignored the booking timezone, and a slot could be taken between proposal and
   booking. *Fix:* `Intl`-based `zonedToUtc` slot generation honouring
   `BOOKING_TIMEZONE`/work-hours (unit-tested incl. DST), plus a `freeBusy` re-check
   inside `book_meeting` before `events.insert` to prevent double-booking.

## 4. One conscious tradeoff
**Cost vs. peak model quality — chose $0 open-weight models (Groq Llama-3.3-70B)
with an OpenRouter free fallback, over a single paid frontier provider.** Gemini's
chat free tier throttled at 5–15 req/min with daily caps (unusable for a probed,
always-live endpoint), so I moved chat+voice reasoning to Groq (far higher free
limits, lowest time-to-first-token) and added an OpenRouter free model as automatic
fail-over so the service never goes dark during the 7-day window. *Why:* the rubric
weights latency, liveness, and honesty — Groq nails the first two and, with the
defense-in-depth prompt, scored 100% injection-resistance and 7.7% hallucination,
good enough that paying for a frontier model wasn't justified. *Accepted cost:*
Llama-3.3-70B is a notch below frontier models on subtle reasoning, and I run two
providers (Groq + Gemini-embeddings). `lib/llm.ts` is a thin OpenAI-compatible
client, so swapping in Claude Haiku/GPT later is a one-line change. (Retrieval is
also in-memory cosine over a prebuilt index — no vector DB — which is sub-ms at this
corpus size but wouldn't scale to large corpora without ANN + a reranker.)

## 5. With two more weeks
Cross-encoder reranker + larger golden set in CI (RAGAS) for precision; automated
voice evals pulled from Vapi end-of-call webhooks (latency/WER/booking) instead of
manual logging; streaming chat responses; per-turn tracing/observability (retrieved
ids, scores, tool calls, latency); multi-user calendar OAuth; and a red-team suite
that continuously fuzzes injection payloads against the corpus.
