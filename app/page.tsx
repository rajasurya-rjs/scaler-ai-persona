"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import { useChatStream, type Message as Msg } from "@/lib/useChatStream";
import { Message } from "@/components/Message";

const Scene3D = dynamic(() => import("@/components/Scene3D"), { ssr: false });

// Warm the heavy three.js/R3F chunk the moment this module evaluates (during
// hydration), in parallel with everything else — so it's already downloaded by
// the time we decide to show it, instead of starting the fetch after mount.
if (typeof window !== "undefined") void import("@/components/Scene3D");

const NAME = process.env.NEXT_PUBLIC_PERSONA_NAME ?? "this candidate";

const SUGGESTIONS = [
  "Why are you right for this AI Engineer Intern role?",
  "Tell me about your NotebookRAG project — stack & tradeoffs.",
  "What's your experience and education?",
  "Can we book a 30-min interview next week?",
];

const GREETING: Msg = {
  id: 1,
  role: "model",
  content: `Hi — I'm **${NAME}'s** AI representative. Ask me anything about ${NAME.split(" ")[0]}'s background, projects, or GitHub, or I can schedule an interview for you. What would you like to know?`,
};

export default function Home() {
  const { messages, send, agentState, busy } = useChatStream([GREETING]);
  const [input, setInput] = useState("");
  const [enable3D, setEnable3D] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let webgl = false;
    try {
      const c = document.createElement("canvas");
      webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webgl = false;
    }
    setEnable3D(webgl && !reduce);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentState]);

  const statusText = useMemo(
    () => (agentState === "thinking" ? "thinking…" : agentState === "streaming" ? "responding…" : "online"),
    [agentState],
  );

  const onSend = (text: string) => {
    if (!text.trim() || busy) return;
    setInput("");
    void send(text);
  };

  return (
    <main className="stage">
      {/* Gradient backdrop shows instantly and stays underneath; the WebGL scene
          fades in on top once its chunk has loaded — no blank/pop-in. */}
      <div className="bg-fallback" />
      {enable3D && (
        <div className="scene-layer">
          <Scene3D state={agentState} />
        </div>
      )}
      <div className="grain" />

      <div className="shell">
        <header className="hud">
          <div className="hud-left">
            <span className={`pulse ${agentState}`} />
            <div>
              <div className="hud-name">{NAME}</div>
              <div className="hud-sub">AI Representative · {statusText}</div>
            </div>
          </div>
          <div className="hud-right">RAG-grounded · résumé + GitHub</div>
        </header>

        <div className="thread">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <Message key={m.id} m={m} />
            ))}
          </AnimatePresence>
          <div ref={endRef} />
        </div>

        {messages.length <= 1 && (
          <div className="suggest">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => onSend(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
        )}

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            onSend(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend(input);
              }
            }}
            placeholder={`Message ${NAME.split(" ")[0]}'s AI…`}
            rows={1}
            disabled={busy}
          />
          <button className="send" type="submit" disabled={busy || !input.trim()} aria-label="Send">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M4 12l16-8-6 8 6 8-16-8z" fill="currentColor" />
            </svg>
          </button>
        </form>
      </div>
    </main>
  );
}
