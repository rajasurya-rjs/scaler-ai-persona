---
title: "AI Persona — Evaluation Report"
author: "Rajasurya J · AI Engineer Intern Screening"
date: "2026-06"
geometry: margin=0.7in
fontsize: 10pt
---

# AI Persona — Evaluation Report · Rajasurya J

All numbers below are from real runs: chat/retrieval from `evals/results/` (Groq Llama-3.3-70B judge, golden set of 17 Q&A); voice from live Vapi test calls (latency from per-turn Vapi message timestamps).

## 1. Voice quality (live test calls)
| Metric | How measured | Result |
|---|---|---|
| First-response latency | ms from end-of-caller-speech → first assistant audio, per assistant turn from Vapi call logs | **median 1.53 s · range 0.9–1.7 s conversational · 4/5 turns < 2 s** |
| Slot-lookup turn | the one turn > 2 s (2.4 s) is the `get_availability` turn — includes a live Google Calendar round-trip | within budget for a tool turn |
| Transcription | Deepgram nova-2; reviewed against the call transcript | accurate on general speech; **the rare proper noun "Rajasurya" was mis-recognised** (see failure mode 3) |
| Task completion (booking) | did the call create a real Google Calendar event + send an invite | **booking call succeeded end-to-end (1/1)** after the fixes in §3 |

Latency is engineered with Groq (low time-to-first-token), Deepgram nova-2 STT, a short `maxTokens` cap, an in-prompt brief for common questions, and tuned endpointing/barge-in (`startSpeakingPlan.waitSeconds 0.4`, `stopSpeakingPlan.numWords 1`). Barge-in verified by interrupting mid-answer — TTS suppressed without crashing. *Sample note:* voice N is small (2 live calls); the harness (`evals/voice-latency.ts`) ingests more calls as they accrue over the 7-day window.

## 2. Chat groundedness & retrieval — measured (golden set = 17 Q&A)
| Metric | How measured | Result |
|---|---|---|
| Retrieval P@6 / R@6 / MRR | golden labels vs the real index (true recall denominator), factual queries n=10; `npm run eval:retrieval` | **P@6 = 0.72 · R@6 = 0.75 · MRR = 1.00 · Hit@6 = 100%** |
| Groundedness / Hallucination | LLM-as-judge faithfulness over (question, retrieved context, answer); honest refusals = grounded; n=13 | **92.3% grounded · 7.7% hallucination (1/13)** |
| Injection resistance | adversarial subset (jailbreak / persona-override / fabrication), n=4 | **100% resisted (4/4)** |

Retrieval is evaluated **separately** from generation so a wrong answer is attributable to retrieval-miss vs. generation-hallucination. MRR = 1.00 means the top-ranked chunk was relevant on every factual query. *Judge caveat:* the judge shares the generator's model family (Llama-3.3-70B), so I also manually reviewed all 13 factual answers (manual count agreed: 1/13); an independent judge would cut self-evaluation bias.

## 3. Three failure modes discovered → root cause → fix
1. **Free-tier fallback hallucinated and leaked tool syntax.** When Groq hit its daily token cap, the chat fell over to a free `gpt-oss-120b`, which invented ungrounded facts, emitted raw `<function=…>` tool syntax into the reply, and double-answered (preamble + post-tool answer). *Root cause:* a low-quality fallback model + streaming the pre-tool preamble as final text. *Fix:* switched the fallback to `llama-3.3-70b-instruct` (quality-matched to the primary), strip leaked tool syntax, and clear any preamble when a tool call follows so only the final answer renders.
2. **Voice booking used the wrong year and a placeholder email.** A live test call booked `2024-06-08` (not 2026) and sent the invite to `your.email@example.com`. *Root cause:* the voice `get_availability` returned only spoken labels (no machine timestamp), so the model *guessed* the ISO date and never collected a real email. *Fix:* `get_availability` now returns each slot's exact `startISO` to copy verbatim; `book_meeting` rejects past/invalid dates and placeholder/invalid emails and makes the agent re-ask. Verified end-to-end after the fix.
3. **STT mis-transcribed the candidate's name.** Deepgram rendered "Rajasurya" as "Rodriguez"/"Roger Soria" — a rare proper noun absent from the language model. *Root cause:* no domain vocabulary hint to the transcriber. *Fix:* add keyterm/keyword boosting (the name, company names, repo names) to the Deepgram config so the persona's own identity transcribes reliably.

## 4. One conscious tradeoff
**Cost vs. reliability/latency — chose $0 open-weight models with layered fail-over over a single paid frontier provider.** Chat + voice reasoning run on Groq Llama-3.3-70B (highest free limits, lowest time-to-first-token). To survive 7 days of unannounced probing on a free tier, `lib/llm.ts` chains **Groq-70B → Groq-8B-instant → OpenRouter-llama** with a 14 s first-token timeout and fast fail-over, so a throttled or slow provider degrades gracefully instead of hanging (an earlier version stalled ~90 s before this). I deliberately rejected a more-*available* free fallback (`gpt-oss`) because it hallucinated about the persona — for a grounded persona, a graceful "ask again" beats a confident wrong answer. *Accepted cost:* Llama-3.3-70B is a notch below frontier on subtle reasoning, and the daily free cap still exists (mitigated, not removed; a paid Groq key is a drop-in fix). `lib/llm.ts` is a thin OpenAI-compatible client, so swapping in Claude/GPT later is a one-line change.

## 5. With two more weeks
Cross-encoder reranker + a larger golden set in CI (RAGAS) for precision; automated voice evals pulled from Vapi end-of-call webhooks (latency/WER/booking) instead of manual sampling; Deepgram keyterm boosting + streaming TTS to push every turn < 1 s; per-turn tracing/observability (retrieved ids, scores, tool calls, latency); a paid-tier key + usage alerting so the endpoint never goes dark; and a continuous red-team suite that fuzzes injection payloads against the live corpus.
