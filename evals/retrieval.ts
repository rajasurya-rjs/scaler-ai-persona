// Retrieval quality eval: Precision@k, Recall@k, MRR, Hit@k over the golden set.
// Relevance is judged by matching each query's `relevant` labels against the
// chunk ids/titles/sources in the real index — so recall has a true denominator
// (the count of matching chunks actually in the corpus).
//
//   npm run eval:retrieval

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadDotEnv } from "../lib/env";
import { retrieve } from "../lib/retriever";
import type { IndexFile } from "../lib/types";

loadDotEnv();

interface QA {
  id: string;
  category: string;
  question: string;
  relevant: string[];
}

const K = Number(process.env.EVAL_K ?? 6);

function labelMatches(chunk: { id: string; title: string; source: string }, label: string): boolean {
  const l = label.toLowerCase();
  const bare = l.replace(/^repo-/, "");
  return (
    chunk.id.toLowerCase().includes(l) ||
    chunk.source.toLowerCase() === l ||
    chunk.title.toLowerCase().includes(bare)
  );
}

async function main() {
  const idx = JSON.parse(readFileSync("data/index.json", "utf-8")) as IndexFile;
  const corpus = idx.chunks.map((c) => ({ id: c.id, title: c.title, source: c.source }));
  const golden = JSON.parse(readFileSync("evals/golden-qa.json", "utf-8")) as { qa: QA[] };

  const rows: any[] = [];
  let skipped = 0;

  for (const qa of golden.qa) {
    if (qa.question.includes("REPLACE_REPO") || qa.relevant.some((r) => r.includes("REPLACE"))) {
      skipped++;
      continue;
    }
    const relevantIds = new Set(
      corpus.filter((c) => qa.relevant.some((label) => labelMatches(c, label))).map((c) => c.id),
    );
    if (relevantIds.size === 0) {
      skipped++;
      continue;
    }

    const retrieved = await retrieve(qa.question, { k: K, minScore: 0 });
    const retrievedIds = retrieved.map((r) => r.id);
    const hits = retrievedIds.filter((id) => relevantIds.has(id));

    const precision = hits.length / Math.max(1, retrievedIds.length);
    const recall = hits.length / relevantIds.size;
    const firstRelevantRank = retrievedIds.findIndex((id) => relevantIds.has(id)) + 1;
    const rr = firstRelevantRank > 0 ? 1 / firstRelevantRank : 0;

    rows.push({
      id: qa.id,
      category: qa.category,
      precisionAtK: round(precision),
      recallAtK: round(recall),
      reciprocalRank: round(rr),
      hit: hits.length > 0,
      relevantInCorpus: relevantIds.size,
      hitsInTopK: hits.length,
    });
  }

  // Retrieval relevance is only well-defined for factual lookups; adversarial /
  // availability queries intentionally have no "relevant document" to retrieve
  // (the security/booking layers handle them), so we report them separately.
  const FACTUAL = new Set(["fit", "resume", "repo"]);
  const factual = rows.filter((r) => FACTUAL.has(r.category));

  const aggFor = (rs: any[]) => ({
    queries: rs.length,
    meanPrecisionAtK: round(mean(rs.map((r) => r.precisionAtK))),
    meanRecallAtK: round(mean(rs.map((r) => r.recallAtK))),
    mrr: round(mean(rs.map((r) => r.reciprocalRank))),
    hitRateAtK: round(mean(rs.map((r) => (r.hit ? 1 : 0)))),
  });

  const agg = {
    k: K,
    queriesEvaluated: rows.length,
    queriesSkipped: skipped,
    // Headline number for the report: factual lookups only.
    factual: aggFor(factual),
    overall: aggFor(rows),
  };

  mkdirSync("evals/results", { recursive: true });
  writeFileSync("evals/results/retrieval.json", JSON.stringify({ agg, rows }, null, 2));

  console.log("\n=== Retrieval eval (k=" + K + ") ===");
  console.table(rows);
  console.log(agg);
  if (skipped) console.log(`(skipped ${skipped} queries — fill REPLACE_REPO placeholders to include repo-specific ones)`);
  console.log("→ evals/results/retrieval.json\n");
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

main().catch((e) => {
  console.error("eval:retrieval failed:", e.message);
  process.exit(1);
});
