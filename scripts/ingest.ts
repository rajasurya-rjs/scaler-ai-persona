// ============================================================================
//  Ingestion pipeline:  resume + GitHub  ->  chunks  ->  embeddings  ->  index
//
//  Run:  npm run ingest
//  Output: data/index.json   (imported by the runtime retriever; tiny corpus,
//          so we ship the whole embedded index and do in-memory cosine search —
//          zero vector-DB cost, serverless-friendly.)
// ============================================================================

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadDotEnv, env, persona, models } from "../lib/env";
import { fetchUserRepos, type GitHubRepo } from "../lib/github";
import { loadResumeText } from "../lib/resume";
import { chunkText } from "../lib/chunking";
import { embedBatch } from "../lib/embeddings";
import type { Chunk, EmbeddedChunk, IndexFile } from "../lib/types";

loadDotEnv();

const OUT = "data/index.json";
const INDEX_VERSION = 1;

async function main() {
  const p = persona();
  console.log(`\n🧩 Ingesting persona corpus for ${p.name} (@${p.githubUsername || "?"})\n`);

  const chunks: Chunk[] = [];
  let resumeChars = 0;
  let commitCount = 0;

  // --- 1. Resume ------------------------------------------------------------
  try {
    const resumePath = env("RESUME_PATH", "data/resume/resume.pdf");
    const resumeText = await loadResumeText(resumePath);
    resumeChars = resumeText.length;
    chunkText(resumeText, { targetChars: 1100, overlapChars: 120 }).forEach((text, i) => {
      chunks.push({
        id: `resume-${i}`,
        text,
        source: "resume",
        title: "Resume",
        meta: { part: i + 1 },
      });
    });
    console.log(`  ✓ Resume: ${resumeChars} chars → ${chunks.length} chunks`);
  } catch (e) {
    console.warn(`  ⚠ Resume skipped: ${(e as Error).message}`);
  }

  // --- 2. GitHub repos ------------------------------------------------------
  let repos: GitHubRepo[] = [];
  if (p.githubUsername) {
    repos = await fetchUserRepos(p.githubUsername);
    console.log(`  ✓ GitHub: ${repos.length} repos fetched`);
  } else {
    console.warn("  ⚠ GITHUB_USERNAME not set — skipping GitHub.");
  }

  for (const r of repos) {
    // (a) Repo "card": stack, purpose, signals — answers stack/purpose questions.
    const card =
      `Repository: ${r.name}\n` +
      `URL: ${r.url}\n` +
      (r.description ? `Description: ${r.description}\n` : "") +
      (r.homepage ? `Live/Homepage: ${r.homepage}\n` : "") +
      `Primary language: ${r.language ?? "n/a"}\n` +
      `Languages: ${r.languages.join(", ") || "n/a"}\n` +
      (r.topics.length ? `Topics: ${r.topics.join(", ")}\n` : "") +
      `Stars: ${r.stars} · Forks: ${r.forks}\n` +
      `Created: ${r.createdAt.slice(0, 10)} · Last pushed: ${r.pushedAt.slice(0, 10)}`;
    chunks.push({
      id: `repo-${r.name}-card`,
      text: card,
      source: "github_repo",
      title: `repo: ${r.name} (overview)`,
      url: r.url,
      meta: { repo: r.name, language: r.language, stars: r.stars },
    });

    // (b) README, chunked.
    if (r.readme && r.readme.trim()) {
      chunkText(r.readme, { targetChars: 1200, overlapChars: 150 }).forEach((text, i) => {
        chunks.push({
          id: `repo-${r.name}-readme-${i}`,
          text: `From the README of repo "${r.name}":\n\n${text}`,
          source: "github_readme",
          title: `repo: ${r.name} (README)`,
          url: r.url,
          meta: { repo: r.name, part: i + 1 },
        });
      });
    }

    // (c) Recent commit messages — grounds "commit history" questions.
    if (r.recentCommits.length) {
      commitCount += r.recentCommits.length;
      const commitText =
        `Recent commit messages in repo "${r.name}" (most recent first):\n` +
        r.recentCommits.map((c) => `- ${c.date.slice(0, 10)}: ${c.message}`).join("\n");
      chunks.push({
        id: `repo-${r.name}-commits`,
        text: commitText,
        source: "github_commit",
        title: `repo: ${r.name} (recent commits)`,
        url: `${r.url}/commits`,
        meta: { repo: r.name, count: r.recentCommits.length },
      });
    }
  }

  // --- 3. Profile overview chunk (helps "list your projects" queries) -------
  if (repos.length) {
    const overview =
      `${p.name}'s public GitHub projects (@${p.githubUsername}):\n` +
      repos
        .map(
          (r) =>
            `- ${r.name}${r.language ? ` [${r.language}]` : ""}: ${r.description ?? "no description"} (${r.url})`,
        )
        .join("\n");
    chunks.push({
      id: "profile-repos",
      text: overview,
      source: "profile",
      title: "GitHub projects overview",
      url: `https://github.com/${p.githubUsername}`,
    });
  }

  if (!chunks.length) {
    throw new Error("No content ingested. Add a resume and/or set GITHUB_USERNAME, then re-run.");
  }

  // --- 4. Embed -------------------------------------------------------------
  console.log(`\n  ⏳ Embedding ${chunks.length} chunks with ${models().embed} ...`);
  const vectors = await embedBatch(chunks.map((c) => c.text), "RETRIEVAL_DOCUMENT");
  const embedded: EmbeddedChunk[] = chunks.map((c, i) => ({ ...c, embedding: vectors[i] }));

  // --- 5. Write index -------------------------------------------------------
  const index: IndexFile = {
    version: INDEX_VERSION,
    // Stamped by the OS clock at build time; safe in a script (not the workflow runtime).
    builtAt: new Date().toISOString(),
    embedModel: models().embed,
    persona: { name: p.name, role: p.role, githubUsername: p.githubUsername },
    stats: {
      chunks: embedded.length,
      repos: repos.length,
      resumeChars,
      commits: commitCount,
    },
    chunks: embedded,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(index));
  const sizeKb = Math.round(Buffer.byteLength(JSON.stringify(index)) / 1024);
  console.log(
    `\n✅ Wrote ${OUT} — ${embedded.length} chunks, ${repos.length} repos, ${commitCount} commits (${sizeKb} KB)\n`,
  );
}

main().catch((e) => {
  console.error(`\n❌ Ingest failed: ${e.message}\n`);
  process.exit(1);
});
