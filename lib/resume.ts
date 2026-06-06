// Resume loader (ingest-time only). Supports PDF (via pdf-parse) and plain text
// / markdown. Kept out of the Next.js runtime bundle — only the ingest script
// imports it.

import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

export async function loadResumeText(path: string): Promise<string> {
  if (!existsSync(path)) {
    throw new Error(
      `Resume not found at "${path}". Drop your resume there (PDF/TXT/MD) or set RESUME_PATH.`,
    );
  }
  const ext = extname(path).toLowerCase();

  if (ext === ".pdf") {
    // pdf-parse is CommonJS; require it lazily so non-PDF paths don't need it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require("pdf-parse");
    const buf = readFileSync(path);
    const data = await pdfParse(buf);
    return cleanup(data.text);
  }

  if (ext === ".txt" || ext === ".md" || ext === ".markdown") {
    return cleanup(readFileSync(path, "utf-8"));
  }

  throw new Error(`Unsupported resume format "${ext}". Use .pdf, .txt, or .md.`);
}

function cleanup(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    // collapse hard-wrapped PDF lines but keep paragraph breaks
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
