# Remaining-Work PRD — Ship the Scaler AI-Persona Assignment

**Goal:** Take the (already-built) codebase to a *live, submittable* state that passes every Hard Requirement and survives 7 days of unannounced probing.

**Reality check:** The code is done. Everything below is **accounts + deploy + recording + measurement** — the parts that need *your* credentials and *your* voice/face. I cannot do these for you (they require your Google/Vapi/Vercel/GitHub logins). One optional code task (T8) I *can* do.

Legend: 🔴 Hard requirement (fail = disqualified) · 🟠 Heavily graded · 🟢 Polish · ⏱ rough time · 👤 you / 🤖 me

---

## 0. Status snapshot

| Area | State |
|---|---|
| RAG ingest (resume + GitHub) | ✅ Done — 68 chunks, 10 repos, 109 commits in `data/index.json` |
| Chat (stream, grounding, injection defense, tools) | ✅ Done + today's fixes (latency/brevity/double-answer/3D) |
| Calendar booking **code** | ✅ Done (`lib/calendar.ts`) — but **not configured** (`calendarConfigured:false`) |
| Voice webhook **code** | ✅ Done (`app/api/voice/route.ts`) — but **no assistant / no number** |
| Evals: retrieval + groundedness | ✅ Ran with real numbers (`evals/results/`) |
| Evals: voice (latency/WER/booking) | ⚠️ Sample data only — needs real test calls |
| README + architecture doc | ✅ Present |
| **Live deploy / public URL** | ❌ Not deployed |
| **Phone number** | ❌ Not created |
| **Eval PDF / Loom** | ❌ Not produced |

**Critical path:** T1 (calendar) → T2 (deploy) → T3 (voice) must happen in this order, because voice needs the deployed URL, and both voice+chat need calendar configured.

---

## T1 — 🔴 Configure real Google Calendar booking · ⏱25 min · 👤
**Why:** Hard Requirement "Real calendar booking." Right now both chat and voice say *"I can't pull my calendar"* — an instant fail under probing.

**Steps** (full detail in `SETUP.md §2`):
1. Google Cloud Console → new project → enable **Google Calendar API**.
2. Credentials → OAuth client ID → **Web application** → add redirect URI `http://localhost:5599/oauth2callback`. Copy Client ID + Secret into `.env.local` (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`).
3. If consent screen is "Testing", add your Google account as a **test user**.
4. `npm run get-google-token` → approve in browser → paste the printed `GOOGLE_OAUTH_REFRESH_TOKEN` into `.env.local`.
5. Booking prefs are already set (`Asia/Kolkata`, 10:00–18:00, Mon–Fri, 30 min, host `founders@turocrates.ai`) — adjust if needed.

**Acceptance:** Restart dev server → `curl localhost:3939/api/health` shows `"calendarConfigured":true`. In chat, "book me a call next week" proposes real slots and, after name+email, creates a real event you can see in Google Calendar with an invite emailed.

---

## T2 — 🔴 Deploy public chat to Vercel · ⏱30 min · 👤
**Why:** Hard Requirement "Live at submission" + "Public chat URL."

**Steps** (full detail in `SETUP.md §3`):
1. `git init` (repo is currently *not* a git repo) → commit → push to a **public** GitHub repo.
   - Confirm `.gitignore` excludes `.env.local` (it does) but **includes `data/index.json`** (2.7 MB — it must ship; no DB).
2. Vercel → New Project → import repo (Next.js auto-detected).
3. Add **every** var from `.env.local` into Vercel → Settings → Environment Variables: Gemini key, Groq key, OpenRouter key, all `PERSONA_*`/`GITHUB_*`, all `GOOGLE_OAUTH_*` + `BOOKING_*`, and a real `VAPI_SERVER_SECRET` (pick a random string — **not** "change-me").
4. Set `PUBLIC_BASE_URL` to the real Vercel URL once known.
5. Deploy.

**Acceptance:** `https://<app>.vercel.app/api/health` → `ok:true` **and** `calendarConfigured:true`. Chat loads, 3D backdrop appears, a grounded answer + a real booking both work on the live URL.

---

## T3 — 🔴 Stand up the voice agent + phone number · ⏱45 min · 👤
**Why:** Part A (35%) + Hard Requirements: phone number, <2s first response, barge-in.

**Steps** (full detail in `SETUP.md §4`):
1. In Vapi → Provider Keys, add your **Groq** key (LLM runs on Groq free tier) and confirm **Deepgram** transcriber is available (Vapi provides one).
2. Generate config from real data + live URL:
   `PUBLIC_BASE_URL="https://<app>.vercel.app" VAPI_SERVER_SECRET="<same as Vercel>" npm run build:voice` → writes `voice/vapi-assistant.json`.
3. Create the assistant (API: set `VAPI_PRIVATE_KEY`, run `tsx voice/build-vapi-assistant.ts --create`; or paste the JSON in the dashboard).
4. Set the `x-vapi-secret` header on the tools = your `VAPI_SERVER_SECRET` (so only Vapi can call `/api/voice`).
5. Vapi → Phone Numbers → buy a number (free US number on trial) → assign to the assistant.

**Acceptance:** Call the number. It (a) introduces itself as your AI rep, (b) answers a background question grounded in your data, (c) lets you talk over it (barge-in) without crashing, (d) says "I don't know" when it should, (e) checks calendar, proposes slots, and **books a real event**. First response feels <2s.

**Latency note:** to hit <2s, in Vapi use Deepgram `nova-2` (STT), Groq `llama-3.3-70b-versatile` (LLM), and a fast TTS (Vapi default / Deepgram Aura / ElevenLabs Turbo). Keep the `search_background` tool result short (already capped at 2500 chars).

---

## T4 — 🟠 Run voice evals from real calls · ⏱30 min · 👤
**Why:** Part C (30%) requires measured first-response latency, WER, and booking success across N calls — **live numbers, not the sample rows.**

**Steps:**
1. Make **5–10 real test calls** to your number. Vary: background Q, repo-only fact, "I don't know" probe, interruption, full booking.
2. For each, from Vapi dashboard → Calls: log a row in `evals/voice-calls.csv` (replace sample rows) — `firstResponseMs`, `transcriptionErrors`, `transcriptionWords`, `booked` 0/1, notes.
3. `npm run eval:voice` (or `eval:all`) → regenerates `evals/results/voice.json` + `summary.json`.

**Acceptance:** `summary.json` shows real median/p95 first-response latency, WER %, and booking completion rate from your actual calls.

---

## T5 — 🟠 Produce the 1-page eval PDF · ⏱30 min · 👤
**Why:** Part C deliverable (30%). Must be **1 page**.

**Content (from the spec):** voice quality (latency/WER/booking rate), chat groundedness (hallucination rate + method + retrieval precision/recall — numbers already in `evals/results/`), **3 failure modes + root cause + fix**, **1 conscious tradeoff**, **what you'd build with 2 more weeks**.

> 💡 Use today's findings as real failure modes: (1) free-tier fallback (gpt-oss) hallucinated ungrounded facts + leaked `<function=>` syntax → switched fallback to llama-3.3-70b + added syntax strip; (2) tool-call preamble caused double answers → clear preamble on tool call; (3) slow fallback hung ~90s → added 14s first-token timeout + fast failover. The conscious tradeoff: **free models (cost) vs latency/reliability** — chose Groq free + accepted a daily token ceiling, mitigated with failover + timeout (see T8).

**Steps:** paste numbers into `report/eval-report.md` → `pandoc report/eval-report.md -o report/eval-report.pdf` (or browser print-to-PDF). Trim to one page.

**Acceptance:** `report/eval-report.pdf` exists, 1 page, all 6 sections present with real numbers.

---

## T6 — 🟠 Record the Loom (≤3 min) · ⏱30 min · 👤
**Why:** Required deliverable. Form says **≤3 min** (spec body says ≤4 — respect the **form's 3 min**).

**Beats:** architecture diagram (30s) → live call: ask, interrupt, book (75s) → live chat: repo question + a prompt-injection probe staying grounded (45s) → one hard problem you solved (30s; the injection/RAG-poisoning defense or the voice-latency split).

**Acceptance:** Loom link, ≤3:00, everything shown is *live* (no recordings of past runs).

---

## T7 — 🟢 README polish + cost breakdown · ⏱20 min · 👤
**Why:** Hard Requirement: "Clean README, architecture diagram, setup instructions, **brief cost breakdown (per call / per chat session)**."

**Steps:** README already has the sections; verify the **Cost breakdown** has concrete per-call (Vapi minutes + Groq tokens + Deepgram + TTS) and per-chat-session ($ ≈ Groq tokens + Gemini embed) numbers. Confirm `docs/architecture.md` diagram renders on GitHub.

**Acceptance:** A stranger can clone, follow README, and understand cost per call/chat.

---

## T8 — 🟠 Survive 7 days on free tier (Groq daily-limit resilience) · ⏱20 min · 🤖 (I can do this)
**Why:** Groq free tier is **100k tokens/day**, shared across every recruiter who calls/chats. Each turn ≈ 3k tokens → ~30 chat turns/day before it locks for ~24h. Across 7 days of unannounced probing, **it will run dry** and the persona goes dark — the worst possible failure for "live under probing."

**Recommended mitigation (pick one or stack):**
1. **Cheapest reliability:** add a **second Groq model fallback** — when `llama-3.3-70b-versatile` hits its daily cap, fall over to Groq `llama-3.1-8b-instant` (separate, much larger token budget; faster; slightly lower quality but grounded). Keeps it live + fast. *(small change to `lib/llm.ts` provider list.)*
2. **Bulletproof:** add a **paid Groq dev-tier key** (drop-in via `GROQ_API_KEY`, no code change) — removes the ceiling entirely. Best for the 7-day window.
3. Already in place: OpenRouter `llama-3.3-70b-instruct:free` failover + 14s timeout + friendly error (prevents hangs, but free OpenRouter is itself rate-limited).

**Acceptance:** When the 70b model returns a daily/quota 429, the next response still comes back grounded (from 8b-instant or paid tier), not an error.

> ⚠️ **Do not burn the daily quota testing before interviews** — one sanity check, not a loop.

---

## Submission checklist (the Google Form)
- [ ] Full name + email
- [ ] **Voice agent phone number** (T3)
- [ ] **Public chat URL** (T2) — verified `/api/health` ok + calendar true
- [ ] **Public GitHub repo** (T2) — README + architecture + cost breakdown (T7)
- [ ] **Eval report PDF** (T5)
- [ ] **Loom link ≤3 min** (T6)
- [ ] Total build time (honest)
- [ ] Everything stays live **7+ days**; watch Vapi credit + Groq quota (T8)

## Suggested order for tomorrow (≈3–3.5 hrs hands-on)
1. T1 calendar (25m) → 2. T8 resilience, I do it while you go (20m) → 3. T2 deploy (30m) → 4. T3 voice + number (45m) → 5. T4 test calls (30m) → 6. T5 PDF (30m) → 7. T6 Loom (30m) → 8. T7 README check (20m) → submit.

**Single biggest risk:** leaving T1/T3 to the last minute — OAuth consent screens and Vapi number provisioning sometimes need a verification step that isn't instant. Do those first.
