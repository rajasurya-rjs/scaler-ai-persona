// Prompt-injection defense-in-depth. Research is unambiguous: injection can't be
// fully prevented (OWASP LLM01), and README/commit content is externally
// authored — a textbook indirect-injection / RAG-poisoning vector. So we layer:
//   1. Content segregation — wrap retrieved docs in delimiters + tell the model
//      everything inside is DATA, never instructions.
//   2. Input heuristics — flag obvious injection attempts in the user message.
//   3. Output validation — catch system-prompt leakage / persona breaks.
// None of these is a silver bullet; together they raise the bar a lot.

import type { RetrievedChunk } from "./types";

const TRUST: Record<string, "owner" | "external"> = {
  resume: "owner", // the candidate's own document
  profile: "owner",
  github_repo: "external", // metadata is mostly safe but treat as data
  github_readme: "external", // attacker-influenceable
  github_commit: "external", // attacker-influenceable
};

/**
 * Render retrieved chunks as clearly-delimited, trust-labelled DATA blocks.
 * The model is told (in the system prompt) to treat everything inside
 * <document>…</document> as information to cite, never as commands.
 */
export function formatContext(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return "(no relevant documents were retrieved)";
  return chunks
    .map((c, i) => {
      const trust = TRUST[c.source] ?? "external";
      const cite = c.url ? ` url="${c.url}"` : "";
      // Defuse any nested closing tags an attacker may have embedded.
      const safe = c.text.replace(/<\/?document/gi, "&lt;document");
      return (
        `<document id="${i + 1}" source="${c.source}" trust="${trust}"${cite}>\n` +
        `${safe}\n` +
        `</document>`
      );
    })
    .join("\n\n");
}

const INJECTION_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /ignore (all |the |your |previous |above )?(prior |previous )?(instructions|prompts?|rules)/i, label: "ignore-instructions" },
  { re: /disregard (the |your |all |previous )?(instructions|context|rules)/i, label: "disregard" },
  { re: /you are (now |actually )?(a |an )?(?!helpful)/i, label: "role-override" },
  { re: /(reveal|print|repeat|show|expose|leak).{0,30}(system )?(prompt|instructions|rules)/i, label: "prompt-extraction" },
  { re: /(new|updated|real) (instructions|system prompt|directive)/i, label: "fake-instructions" },
  { re: /pretend (to be|that you)/i, label: "pretend" },
  { re: /\bDAN\b|jailbreak|developer mode/i, label: "jailbreak" },
  { re: /act as (if )?(a |an )?/i, label: "act-as" },
  { re: /from now on,? (you|respond|answer)/i, label: "from-now-on" },
];

export function detectInjection(text: string): { flagged: boolean; labels: string[] } {
  const labels = INJECTION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
  return { flagged: labels.length > 0, labels };
}

/**
 * Cheap output guard. If the model parrots the system prompt verbatim or claims
 * to have switched persona, we blank it and return a safe deflection.
 */
const OUTPUT_LEAK_PATTERNS = [
  /you are .*'s ai representative/i, // verbatim system-prompt echo
  /my (system )?(prompt|instructions) (are|is|say)/i,
  /i am now (a|an|in) /i,
  /\bas an ai language model\b/i,
];

export function validateOutput(answer: string): { ok: boolean; safe: string } {
  for (const re of OUTPUT_LEAK_PATTERNS) {
    if (re.test(answer)) {
      return {
        ok: false,
        safe:
          "I'm here to talk about my background, projects, and fit for this role — happy to dig into any of that, or to set up a call. What would you like to know?",
      };
    }
  }
  return { ok: true, safe: answer };
}
