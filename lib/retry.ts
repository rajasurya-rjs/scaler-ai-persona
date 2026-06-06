// Retry helper that respects Gemini free-tier 429s. On rate-limit it honours the
// server's suggested retryDelay; otherwise it backs off exponentially.

export async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = (e as Error)?.message ?? "";
      const is429 = msg.includes("429") || /rate.?limit|quota|Too Many Requests/i.test(msg);
      if (!is429 && attempt >= 1) throw e; // non-rate-limit error: fail fast after one retry
      const suggested = parseRetryDelaySec(msg);
      const waitMs = suggested ? Math.min(suggested * 1000 + 500, 60_000) : 1000 * 2 ** attempt;
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

function parseRetryDelaySec(msg: string): number | null {
  const m = msg.match(/retryDelay"?:?\s*"?(\d+(?:\.\d+)?)s/i) || msg.match(/retry in (\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(parseFloat(m[1])) : null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
