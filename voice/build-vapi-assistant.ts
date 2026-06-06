// Generates a ready-to-import Vapi assistant config from your REAL ingested data
// (data/index.json) so the voice persona is grounded, not hardcoded.
//
//   npm run ingest                     # build the corpus first
//   tsx voice/build-vapi-assistant.ts  # writes voice/vapi-assistant.json
//   (optional) add --create with VAPI_PRIVATE_KEY set to POST it to Vapi.
//
// Design: most common questions are answered in-prompt (low latency) from a
// brief distilled from the resume + repo overviews; specific/deep questions hit
// the live RAG via the `search_background` tool. Booking uses our own calendar
// server tools (same real Google Calendar as the chat). To use Vapi's NATIVE
// Google Calendar tools instead, set VAPI_USE_NATIVE_CALENDAR=true and provide
// the dashboard tool IDs (see voice/README.md).

import { readFileSync, writeFileSync } from "node:fs";
import { loadDotEnv, env, persona } from "../lib/env";
import type { IndexFile } from "../lib/types";

loadDotEnv();

const DEPLOY_URL = env("PUBLIC_BASE_URL", env("DEPLOY_URL", "https://YOUR-APP.vercel.app")).replace(/\/$/, "");
const SERVER_SECRET = env("VAPI_SERVER_SECRET");

function buildBrief(idx: IndexFile): string {
  const resume = idx.chunks
    .filter((c) => c.source === "resume")
    .map((c) => c.text)
    .join("\n\n");
  const overview = idx.chunks.find((c) => c.source === "profile")?.text ?? "";
  const repoCards = idx.chunks
    .filter((c) => c.source === "github_repo")
    .map((c) => c.text)
    .join("\n\n");

  let brief = "";
  if (resume) brief += `RESUME / BACKGROUND:\n${resume}\n\n`;
  if (overview) brief += `${overview}\n\n`;
  if (repoCards) brief += `KEY REPOSITORIES (stack & purpose):\n${repoCards}\n`;

  // Keep the in-prompt brief lean for latency; deep detail comes from the tool.
  const MAX = 6000;
  return brief.length > MAX ? brief.slice(0, MAX) + "\n…(ask via search_background for more detail)" : brief;
}

function main() {
  const p = persona();
  const idx = JSON.parse(readFileSync("data/index.json", "utf-8")) as IndexFile;

  const template = readFileSync("voice/system-prompt.template.md", "utf-8");
  const systemPrompt = template
    .replaceAll("{{PERSONA_NAME}}", p.name)
    .replaceAll("{{PERSONA_ROLE}}", p.role)
    .replaceAll("{{PERSONA_BRIEF}}", buildBrief(idx));

  writeFileSync("voice/system-prompt.generated.md", systemPrompt);

  const serverTool = (name: string, description: string, properties: object, required: string[]) => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
    server: { url: `${DEPLOY_URL}/api/voice`, ...(SERVER_SECRET ? { secret: SERVER_SECRET } : {}) },
  });

  const useNative = env("VAPI_USE_NATIVE_CALENDAR") === "true";

  const functionTools = [
    serverTool(
      "search_background",
      "Look up specific facts about the candidate's resume, projects, GitHub repos, or commit history. Use for any detail not already known.",
      { query: { type: "string", description: "A focused question, e.g. 'tech stack of the RAG project'." } },
      ["query"],
    ),
    ...(useNative
      ? []
      : [
          serverTool(
            "get_availability",
            "Fetch real open interview slots from the candidate's Google Calendar before proposing times.",
            { limit: { type: "number", description: "How many slots (default 4)." } },
            [],
          ),
          serverTool(
            "book_meeting",
            "Book a real interview ONLY after the caller picked a slot and gave their real name + email. Never call with placeholder values.",
            {
              startISO: {
                type: "string",
                description:
                  "The EXACT startISO value returned by get_availability for the chosen slot (copy it verbatim). Never construct or guess this date.",
              },
              attendeeName: { type: "string", description: "The caller's real full name (ask them — never 'Your Name')." },
              attendeeEmail: {
                type: "string",
                description: "The caller's real email, confirmed by reading it back. Never a placeholder like your.email@example.com.",
              },
              notes: { type: "string", description: "Optional context." },
            },
            ["startISO", "attendeeName", "attendeeEmail"],
          ),
        ]),
  ];

  const nativeToolIds = [
    env("VAPI_CALENDAR_AVAILABILITY_TOOL_ID"),
    env("VAPI_CALENDAR_CREATE_TOOL_ID"),
  ].filter(Boolean);

  const assistant = {
    name: `${p.name} — AI Representative`,
    firstMessage: `Hi, thanks for calling! I'm ${p.name}'s AI representative. I can tell you about ${
      p.name.split(" ")[0]
    }'s background and projects, or set up an interview. What would you like to know?`,
    firstMessageMode: "assistant-speaks-first",
    // STT: Deepgram nova for low-latency, accurate transcription.
    transcriber: { provider: "deepgram", model: "nova-2", language: "en", smartFormat: true },
    // LLM: Groq Llama 3.3 70B — free + very low time-to-first-token (latency win).
    model: {
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      maxTokens: 250,
      messages: [{ role: "system", content: systemPrompt }],
      tools: functionTools,
      ...(useNative && nativeToolIds.length ? { toolIds: nativeToolIds } : {}),
    },
    // TTS: Vapi-native voice (included). Swap provider/voiceId in dashboard.
    voice: { provider: "vapi", voiceId: "Elliot" },
    // Low first-response latency + responsive endpointing.
    startSpeakingPlan: { waitSeconds: 0.4, smartEndpointingPlan: { provider: "livekit" } },
    // Barge-in: cut TTS quickly when the caller starts speaking.
    stopSpeakingPlan: { numWords: 1, voiceSeconds: 0.2, backoffSeconds: 1.0 },
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
    backgroundSound: "off",
    ...(SERVER_SECRET ? { serverMessages: [], server: { url: `${DEPLOY_URL}/api/voice`, secret: SERVER_SECRET } } : {}),
  };

  writeFileSync("voice/vapi-assistant.json", JSON.stringify(assistant, null, 2));
  console.log(
    `\n✅ Wrote voice/vapi-assistant.json (server URL: ${DEPLOY_URL}/api/voice, calendar: ${
      useNative ? "NATIVE Vapi Google Calendar" : "custom server tools"
    })\n`,
  );

  if (process.argv.includes("--create")) void createOnVapi(assistant);
}

async function createOnVapi(assistant: object) {
  const key = env("VAPI_PRIVATE_KEY");
  if (!key) {
    console.warn("⚠ VAPI_PRIVATE_KEY not set — skipping --create. Import the JSON in the dashboard instead.");
    return;
  }
  const res = await fetch("https://api.vapi.ai/assistant", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(assistant),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("❌ Vapi create failed:", JSON.stringify(data, null, 2));
    return;
  }
  console.log(`\n✅ Created Vapi assistant id=${data.id}. Attach a phone number to it in the dashboard.\n`);
}

main();
