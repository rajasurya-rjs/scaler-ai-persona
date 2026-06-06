// Voice eval aggregator. Computes first-response latency distribution, WER-based
// transcription accuracy, and task (booking) completion rate from your real test
// calls logged in evals/voice-calls.csv. Optionally pulls raw call logs from the
// Vapi API for reference.
//
//   tsx evals/voice-latency.ts
//
// IMPORTANT: the rows shipped in voice-calls.csv are SAMPLE placeholders. Replace
// them with your own real test calls before quoting numbers in the report.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { loadDotEnv, env } from "../lib/env";

loadDotEnv();

interface CallRow {
  callId: string;
  firstResponseMs: number;
  transcriptionErrors: number;
  transcriptionWords: number;
  booked: number;
}

function parseCsv(path: string): CallRow[] {
  const lines = readFileSync(path, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const header = lines.shift();
  if (!header) return [];
  return lines.map((line) => {
    const [callId, frm, errs, words, booked] = line.split(",");
    return {
      callId,
      firstResponseMs: Number(frm),
      transcriptionErrors: Number(errs),
      transcriptionWords: Number(words),
      booked: Number(booked),
    };
  });
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const csv = "evals/voice-calls.csv";
  if (!existsSync(csv)) {
    console.error("No evals/voice-calls.csv found.");
    process.exit(1);
  }
  const rows = parseCsv(csv);
  if (!rows.length) {
    console.error("No call rows in voice-calls.csv.");
    process.exit(1);
  }

  const latencies = rows.map((r) => r.firstResponseMs).sort((a, b) => a - b);
  const totalErrors = rows.reduce((s, r) => s + r.transcriptionErrors, 0);
  const totalWords = rows.reduce((s, r) => s + r.transcriptionWords, 0);
  const booked = rows.filter((r) => r.booked === 1).length;

  const agg = {
    calls: rows.length,
    firstResponseMs: {
      p50: pct(latencies, 50),
      p95: pct(latencies, 95),
      mean: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      min: latencies[0],
      max: latencies[latencies.length - 1],
      pctUnder2000ms: round(rows.filter((r) => r.firstResponseMs < 2000).length / rows.length),
    },
    transcription: {
      wer: round(totalWords ? totalErrors / totalWords : 0),
      accuracy: round(totalWords ? 1 - totalErrors / totalWords : 0),
      totalWords,
    },
    taskCompletion: {
      bookingSuccessRate: round(booked / rows.length),
      booked,
      ofCalls: rows.length,
    },
  };

  mkdirSync("evals/results", { recursive: true });
  writeFileSync("evals/results/voice.json", JSON.stringify({ agg, rows }, null, 2));

  console.log("\n=== Voice eval (from real test calls) ===");
  console.log(agg);
  console.log("→ evals/results/voice.json\n");

  if (env("VAPI_PRIVATE_KEY")) await dumpVapiCalls();
}

async function dumpVapiCalls() {
  try {
    const url = new URL("https://api.vapi.ai/call");
    url.searchParams.set("limit", "50");
    if (env("VAPI_ASSISTANT_ID")) url.searchParams.set("assistantId", env("VAPI_ASSISTANT_ID"));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${env("VAPI_PRIVATE_KEY")}` } });
    if (!res.ok) {
      console.warn(`(Vapi call dump skipped: ${res.status})`);
      return;
    }
    const calls = await res.json();
    writeFileSync("evals/results/voice-raw.json", JSON.stringify(calls, null, 2));
    console.log(`(Dumped ${Array.isArray(calls) ? calls.length : "?"} raw Vapi calls → evals/results/voice-raw.json)\n`);
  } catch (e) {
    console.warn("(Vapi call dump failed: " + (e as Error).message + ")");
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

main().catch((e) => {
  console.error("voice eval failed:", e.message);
  process.exit(1);
});
