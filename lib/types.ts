// Shared types for the RAG corpus and retrieval.

export type SourceType = "resume" | "github_readme" | "github_repo" | "github_commit" | "profile";

export interface Chunk {
  id: string;
  /** The text that gets embedded and shown to the LLM as grounding context. */
  text: string;
  /** Where this came from — used for citations and trust labelling. */
  source: SourceType;
  /** Human-readable origin, e.g. "Resume", "repo: my-cool-project (README)". */
  title: string;
  /** Optional clickable link (repo URL, commit URL). */
  url?: string;
  /** Free-form extra metadata (repo name, language, stars, date...). */
  meta?: Record<string, string | number | boolean | null>;
}

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

export interface IndexFile {
  /** Schema/version so the runtime can reject stale indexes. */
  version: number;
  /** ISO timestamp the index was built (stamped by the ingest script). */
  builtAt: string;
  embedModel: string;
  /** The persona this corpus describes. */
  persona: { name: string; role: string; githubUsername: string };
  /** Plain counts for the README / eval report. */
  stats: {
    chunks: number;
    repos: number;
    resumeChars: number;
    commits: number;
  };
  chunks: EmbeddedChunk[];
}

export interface RetrievedChunk extends Chunk {
  score: number;
}
