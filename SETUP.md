# SETUP — go live in ~1–2 hours

Everything below is **free tier**. Do the steps in order. ✅ = the deliverable it unlocks.

---

## 0. Prereqs (5 min)
- Node 20+ (`node -v`), a GitHub account, a Google account, a phone to test calls.
- Clone this repo, then: `cp .env.example .env.local` and `npm install`.

---

## 1. Ground the persona on YOUR data ✅ (RAG, no hardcoding)
1. **Resume:** put your resume at `data/resume/resume.pdf` (PDF, or `.txt`/`.md`).
2. **Gemini key (free, embeddings):** https://aistudio.google.com/apikey → set
   `GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local`. (Used only to embed the corpus +
   queries; its embedding quota is separate and ample.)
3. **Groq key (free, chat + voice brain + judge):** https://console.groq.com/keys →
   set `GROQ_API_KEY`. This powers the chat reasoning and the eval judge (and the
   voice agent inside Vapi). Chosen over Gemini chat because Groq's free request
   limits are far higher.
4. **Identity:** set `PERSONA_NAME`, `PERSONA_ROLE`, `NEXT_PUBLIC_PERSONA_NAME`,
   `GITHUB_USERNAME`. (Optional: `GITHUB_TOKEN` raises the rate limit 60→5000/hr —
   only needed if ingest hits the limit.)
4. Build the index:
   ```bash
   npm run ingest
   ```
   You should see `✅ Wrote data/index.json — N chunks, R repos, C commits`.
   Sanity-check it locally: `npm run dev` → open http://localhost:3000 and ask a
   few questions. Confirm answers cite your real repos/resume.

> Re-run `npm run ingest` whenever your resume or repos change.

---

## 2. Real calendar booking ✅ (Google Calendar)
1. **Google Cloud Console** → create a project → enable **Google Calendar API**.
2. **APIs & Services → Credentials → Create OAuth client ID → Web application.**
   Add redirect URI: `http://localhost:5599/oauth2callback`.
   Copy the Client ID + Secret into `.env.local`
   (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`).
   (If your OAuth consent screen is in "Testing", add your Google account as a test user.)
3. Mint a refresh token:
   ```bash
   npm run get-google-token
   ```
   Approve in the browser; paste the printed `GOOGLE_OAUTH_REFRESH_TOKEN` into `.env.local`.
4. Set booking prefs: `BOOKING_TIMEZONE` (e.g. `Asia/Kolkata`), `BOOKING_WORK_START/END`,
   `BOOKING_WORK_DAYS`, `BOOKING_DURATION_MIN`, `BOOKING_HOST_EMAIL` (your email).
5. Test: in the local chat, say "book me a call next week" → it should propose real
   open slots and, after you give a name+email, create a real event + invite.

---

## 3. Deploy the public chat ✅ (public URL)
1. Push this repo to GitHub (public).
2. https://vercel.com → New Project → import the repo → framework auto-detected (Next.js).
3. **Add ALL env vars** from `.env.local` into Vercel → Project → Settings →
   Environment Variables (Gemini key, persona vars, GitHub vars, all `GOOGLE_OAUTH_*`,
   `BOOKING_*`, and a `VAPI_SERVER_SECRET` you choose).
   - `data/index.json` is committed and deploys with the app — no DB needed.
   - ⚠️ Do **not** add `.env.local` to git; only the Vercel dashboard.
4. Deploy. Verify: open `https://<your-app>.vercel.app/api/health` → should show
   `ok:true`, your stats, and `calendarConfigured:true`. The chat URL is your **public chat deliverable**.

---

## 4. Voice agent ✅ (phone number)
1. **Groq key (free):** https://console.groq.com → add it in Vapi → Provider Keys
   (so the LLM runs on Groq's free tier).
2. Generate the assistant from your real data + deployed URL:
   ```bash
   PUBLIC_BASE_URL="https://<your-app>.vercel.app" VAPI_SERVER_SECRET="<same secret as Vercel>" npm run build:voice
   ```
   → writes `voice/vapi-assistant.json`.
3. **Create it in Vapi** (https://vapi.ai):
   - API path: set `VAPI_PRIVATE_KEY` in `.env.local`, run `tsx voice/build-vapi-assistant.ts --create`.
   - or Dashboard: create an assistant and paste values from `voice/vapi-assistant.json`
     (system prompt, model = Groq `llama-3.3-70b-versatile`, transcriber = Deepgram
     `nova-2`, the 3 tools pointing at `https://<app>/api/voice`, the speaking plans).
4. In the Vapi tool config, set the server secret header `x-vapi-secret` =
   `VAPI_SERVER_SECRET` so only Vapi can call `/api/voice`.
5. **Phone number:** Vapi → Phone Numbers → buy a number (free US number on trial) →
   assign to this assistant. **That number is your voice deliverable.**
6. Call it. Confirm: it introduces itself, answers a background question, handles you
   talking over it (barge-in), and books a slot on your real calendar.

> Booking detail: the generated config uses the repo's own calendar tools (same code
> as chat). To use Vapi's NATIVE Google Calendar instead, see `voice/README.md`.

---

## 5. Evals ✅ (PDF report)
```bash
npm run eval:all
```
- Edit `evals/golden-qa.json`: replace `REPLACE_REPO` with your real repo names; add
  5–10 of your own questions (including repo/commit-only facts).
- Make **5–10 real test calls**, log each in `evals/voice-calls.csv` (replace the
  sample rows) with real latency (from Vapi logs), WER counts, and booked 0/1.
- Open `evals/results/summary.json`, paste the numbers into `report/eval-report.md`,
  then export: `pandoc report/eval-report.md -o report/eval-report.pdf` (or print to PDF).

---

## 6. Loom (≤4 min) ✅
Suggested beats: (1) show the architecture diagram [docs/architecture.md] (30s);
(2) live call the number — ask a question, interrupt it, book a slot (90s);
(3) live chat — ask a repo question, then a prompt-injection probe; show it stays
grounded (60s); (4) one hard problem — the **prompt-injection / RAG-poisoning
defense** (segregation + output guard) or the **voice latency split** (45s).

---

## Submit
Form: https://forms.gle/MrZMGCKikHaFkA3J9 — voice number, chat URL, GitHub repo,
eval PDF, Loom. **Keep everything live 7+ days.** Watch your Vapi trial credit; top
up ~$5–10 if it runs low so the number never goes dead under unannounced calls.

## Troubleshooting
- `/api/health` 500 "index not found" → run `npm run ingest` and commit `data/index.json`, redeploy.
- Booking says "not configured" → the `GOOGLE_OAUTH_*` vars aren't in Vercel.
- Voice tool 401 → `VAPI_SERVER_SECRET` mismatch between Vapi and Vercel.
- GitHub rate limit during ingest → set `GITHUB_TOKEN`.
- Gemini 429 → free-tier rate limit; the ingest retries with backoff, just re-run.
