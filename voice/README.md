# Voice Agent (Vapi) — setup

The voice agent is a [Vapi](https://vapi.ai) assistant whose persona, knowledge, and
booking tools are generated from your **real** ingested data. Most questions are
answered in-prompt for low latency; deep/specific questions hit the live RAG via
the `search_background` tool; interviews are booked on your **real Google
Calendar**.

```
Caller ──PSTN──► Twilio# ──► Vapi (STT: Deepgram · LLM: Groq Llama-3.3-70B · TTS)
                                │
                                ├─ search_background ─► https://<app>/api/voice ─► RAG (data/index.json)
                                └─ get_availability / book_meeting ─► /api/voice ─► Google Calendar
```

## 1. Generate the assistant config
```bash
npm run ingest          # builds data/index.json from resume + GitHub
PUBLIC_BASE_URL="https://<your-app>.vercel.app" npm run build:voice
```
This writes `voice/vapi-assistant.json` (and `voice/system-prompt.generated.md`).

## 2. Create the assistant in Vapi
- **Option A (API):** set `VAPI_PRIVATE_KEY` in `.env.local`, then
  `tsx voice/build-vapi-assistant.ts --create`.
- **Option B (dashboard):** Vapi → Assistants → create one, then paste the values
  from `voice/vapi-assistant.json` (system prompt, model = Groq `llama-3.3-70b-versatile`,
  transcriber = Deepgram `nova-2`, the tools, and the speaking plans).

Add your `GROQ_API_KEY` (free at console.groq.com) under Vapi → Provider Keys so
the LLM cost is on Groq's free tier.

## 3. Wire the tools
The generated config points all server tools at `https://<app>/api/voice`. Set
`VAPI_SERVER_SECRET` in both `.env.local`/Vercel and the Vapi tool config so the
endpoint only answers Vapi.

- `search_background` → RAG grounding (always used).
- `get_availability` + `book_meeting` → booking on your real Google Calendar
  (uses the same `lib/calendar.ts` as the chat — one source of truth).

## 4. Get a phone number
Vapi → Phone Numbers → buy a number (free US number on the trial) and assign it
to this assistant. That number is what you submit to Scaler.

## 5. Latency + barge-in (already configured)
- `startSpeakingPlan.waitSeconds: 0.4` + smart endpointing → fast first response.
- `stopSpeakingPlan` (numWords 1, voiceSeconds 0.2) → TTS cuts on barge-in.
- Groq = very low time-to-first-token; Deepgram nova = fast STT.
- Keep `maxTokens` low (250) and answers short (enforced in the prompt) for speed.

Measure real latency from Vapi's call logs (see `evals/`): time from end-of-user-
speech to first assistant audio. Target < 2s first response.

## Alternative: Vapi NATIVE Google Calendar tools
If you prefer Vapi's built-in calendar tools (Integrations → Tools Provider →
Google Calendar → Connect, then create the *Check Availability* and *Create Event*
tools):
1. Connect Google Calendar in the Vapi dashboard (one-click OAuth).
2. Create the two native tools; copy their tool IDs.
3. Set `VAPI_USE_NATIVE_CALENDAR=true`, `VAPI_CALENDAR_AVAILABILITY_TOOL_ID=…`,
   `VAPI_CALENDAR_CREATE_TOOL_ID=…`, then re-run `npm run build:voice`.

Both paths book on the same real Google Calendar. We default to the custom server
tools because they reuse the chat's tested calendar code and are fully reproducible
from this repo (the native tools depend on dashboard OAuth state and had some
edge-case reliability reports).
