// Centralised, typed environment access. Works in Next.js (runtime) and in
// standalone tsx scripts (which load .env.local first via `loadDotEnv()`).

export function loadDotEnv(): void {
  // Only needed for CLI scripts; Next.js injects env vars itself.
  // Lazy-required so the runtime bundle never pulls dotenv into the edge/server.
  if (process.env.__DOTENV_LOADED) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dotenv = require("dotenv");
    dotenv.config({ path: ".env.local" });
    dotenv.config({ path: ".env" });
    process.env.__DOTENV_LOADED = "1";
  } catch {
    // dotenv is a devDependency; in production env vars come from the host.
  }
}

export function env(key: string, fallback = ""): string {
  const v = process.env[key];
  if (v === undefined) return fallback;
  // Treat unfilled .env.example placeholders as unset so optional keys
  // (GITHUB_TOKEN, GROQ, OAuth, VAPI…) don't get sent as real values.
  if (v.startsWith("PASTE_") || v === "change-me-to-a-random-string") return fallback;
  return v;
}

export function envRequired(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const persona = () => ({
  name: env("PERSONA_NAME", "the candidate"),
  role: env("PERSONA_ROLE", "AI Engineer Intern candidate"),
  githubUsername: env("GITHUB_USERNAME"),
});

export const models = () => ({
  chat: env("CHAT_MODEL", "llama-3.3-70b-versatile"), // Groq
  embed: env("EMBED_MODEL", "gemini-embedding-001"), // Gemini
  judge: env("JUDGE_MODEL", "llama-3.3-70b-versatile"), // Groq
});
