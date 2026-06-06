// Runs the full eval suite and writes a single summary the eval report draws
// from.  npm run eval:all
//
// Retrieval + groundedness make live API calls; voice reads your logged calls.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

function run(cmd: string, label: string) {
  console.log(`\n▶ ${label} …`);
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    console.warn(`  (… ${label} exited non-zero; continuing)`);
  }
}

function readJson(path: string): any {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : null;
}

run("tsx evals/retrieval.ts", "Retrieval");
run("tsx evals/groundedness.ts", "Groundedness + injection");
run("tsx evals/voice-latency.ts", "Voice (from voice-calls.csv)");

const summary = {
  generatedNote: "Aggregated eval summary. Voice rows are sample placeholders until you log real calls.",
  retrieval: readJson("evals/results/retrieval.json")?.agg ?? null,
  groundedness: readJson("evals/results/groundedness.json")?.agg ?? null,
  voice: readJson("evals/results/voice.json")?.agg ?? null,
};

writeFileSync("evals/results/summary.json", JSON.stringify(summary, null, 2));

console.log("\n================ EVAL SUMMARY ================");
console.log(JSON.stringify(summary, null, 2));
console.log("\n→ evals/results/summary.json (feed these numbers into report/eval-report.md)\n");
