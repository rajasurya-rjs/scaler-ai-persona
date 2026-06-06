// GitHub ingestion via the public REST API (no SDK dependency).
// Pulls repos, READMEs, languages, topics, and recent commit messages so the
// RAG corpus can answer "what's the tech stack / purpose / commit history" of
// any public repo — exactly what the assignment says they'll probe.

import { env, envInt } from "./env";

const API = "https://api.github.com";

export interface GitHubRepo {
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  homepage: string | null;
  language: string | null;
  languages: string[];
  topics: string[];
  stars: number;
  forks: number;
  pushedAt: string;
  createdAt: string;
  isFork: boolean;
  isArchived: boolean;
  readme: string | null;
  recentCommits: { message: string; date: string; url: string }[];
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ai-persona-ingest",
  };
  const token = env("GITHUB_TOKEN");
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: headers() });
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = res.headers.get("x-ratelimit-reset");
    throw new Error(
      `GitHub rate limit hit. ${env("GITHUB_TOKEN") ? "" : "Set GITHUB_TOKEN to raise 60→5000/hr. "}` +
        `Resets at ${reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : "soon"}.`,
    );
  }
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function ghRaw(path: string, accept: string): Promise<string | null> {
  const res = await fetch(`${API}${path}`, { headers: { ...headers(), Accept: accept } });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.text();
}

export async function fetchUserRepos(username: string): Promise<GitHubRepo[]> {
  if (!username) throw new Error("GITHUB_USERNAME is not set.");

  const maxRepos = envInt("GITHUB_MAX_REPOS", 30);
  const commitsPerRepo = envInt("GITHUB_COMMITS_PER_REPO", 30);
  const includeOnly = splitList(env("GITHUB_INCLUDE_ONLY"));
  const exclude = new Set(splitList(env("GITHUB_EXCLUDE")));

  // Most-recently-pushed first (best signal for "what they're working on").
  type RawRepo = {
    name: string;
    full_name: string;
    description: string | null;
    html_url: string;
    homepage: string | null;
    language: string | null;
    topics?: string[];
    stargazers_count: number;
    forks_count: number;
    pushed_at: string;
    created_at: string;
    fork: boolean;
    archived: boolean;
  };

  const raw = await gh<RawRepo[]>(
    `/users/${encodeURIComponent(username)}/repos?per_page=100&sort=pushed&direction=desc`,
  );

  let selected = raw
    .filter((r) => (includeOnly.length ? includeOnly.includes(r.name) : true))
    .filter((r) => !exclude.has(r.name));

  // Prefer original (non-fork) repos unless explicitly included.
  if (!includeOnly.length) selected = selected.filter((r) => !r.fork);
  selected = selected.slice(0, maxRepos);

  const repos: GitHubRepo[] = [];
  for (const r of selected) {
    const [readme, languages, commits] = await Promise.all([
      fetchReadme(r.full_name),
      fetchLanguages(r.full_name),
      fetchRecentCommits(r.full_name, commitsPerRepo),
    ]);
    repos.push({
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      url: r.html_url,
      homepage: r.homepage,
      language: r.language,
      languages,
      topics: r.topics ?? [],
      stars: r.stargazers_count,
      forks: r.forks_count,
      pushedAt: r.pushed_at,
      createdAt: r.created_at,
      isFork: r.fork,
      isArchived: r.archived,
      readme,
      recentCommits: commits,
    });
  }
  return repos;
}

async function fetchReadme(fullName: string): Promise<string | null> {
  // The .raw media type returns decoded markdown directly.
  return ghRaw(`/repos/${fullName}/readme`, "application/vnd.github.raw");
}

async function fetchLanguages(fullName: string): Promise<string[]> {
  try {
    const langs = await gh<Record<string, number>>(`/repos/${fullName}/languages`);
    return Object.keys(langs);
  } catch {
    return [];
  }
}

async function fetchRecentCommits(
  fullName: string,
  count: number,
): Promise<{ message: string; date: string; url: string }[]> {
  if (count <= 0) return [];
  try {
    type RawCommit = {
      html_url: string;
      commit: { message: string; author: { date: string } | null };
    };
    const commits = await gh<RawCommit[]>(`/repos/${fullName}/commits?per_page=${Math.min(count, 100)}`);
    return commits.map((c) => ({
      message: c.commit.message.split("\n")[0].slice(0, 200),
      date: c.commit.author?.date ?? "",
      url: c.html_url,
    }));
  } catch {
    return [];
  }
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
