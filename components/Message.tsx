"use client";

import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message as Msg } from "@/lib/useChatStream";

const NAME = process.env.NEXT_PUBLIC_PERSONA_NAME ?? "AI";
const INITIALS = NAME.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function dedupeCites(cites: NonNullable<Msg["citations"]>) {
  const seen = new Set<string>();
  const out: NonNullable<Msg["citations"]> = [];
  for (const c of cites) {
    const k = c.title + (c.url ?? "");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= 5) break;
  }
  return out;
}

export function Message({ m }: { m: Msg }) {
  const isUser = m.role === "user";
  const showThinking = m.streaming && !m.content && !m.status;

  return (
    <motion.div
      className={`msg ${isUser ? "user" : "model"}`}
      initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className={`avatar ${isUser ? "av-user" : "av-bot"}`}>{isUser ? "You" : INITIALS}</div>
      <div className="msg-body">
        <div className="bubble">
          {isUser ? (
            <span>{m.content}</span>
          ) : (
            <div className="md">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
                }}
              >
                {m.content}
              </ReactMarkdown>
              {m.streaming && m.content && <span className="caret" />}
            </div>
          )}

          {showThinking && (
            <div className="thinking">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          )}

          {m.status && !m.content && (
            <div className="status-pill">
              <span className="spinner" /> {m.status}
            </div>
          )}
        </div>

        {m.flagged && <div className="flag">⚠ flagged as possible prompt injection — answered safely</div>}

        {m.citations && m.citations.length > 0 && (
          <div className="cites">
            {dedupeCites(m.citations).map((c, i) => (
              <span className="cite" key={i}>
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer">
                    {c.title}
                  </a>
                ) : (
                  c.title
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
