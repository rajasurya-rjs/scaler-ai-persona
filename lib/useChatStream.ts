"use client";

import { useCallback, useRef, useState } from "react";

export type AgentState = "idle" | "thinking" | "streaming";

export interface Citation {
  title: string;
  url?: string;
  source: string;
  score: number;
}

export interface Message {
  id: number;
  role: "user" | "model";
  content: string;
  citations?: Citation[];
  flagged?: boolean;
  status?: string; // transient tool status ("Checking my calendar…")
  streaming?: boolean;
}

export function useChatStream(initial: Message[]) {
  const [messages, setMessages] = useState<Message[]>(initial);
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [busy, setBusy] = useState(false);

  const idRef = useRef(initial.length + 1);
  const bufRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const streamingIdRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    if (!bufRef.current || streamingIdRef.current == null) return;
    const chunk = bufRef.current;
    bufRef.current = "";
    const id = streamingIdRef.current;
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

  const patch = useCallback((id: number, p: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...p } : m)));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const msg = text.trim();
      if (!msg || busy) return;
      setBusy(true);
      setAgentState("thinking");

      const history = messages
        .filter((m) => !m.streaming)
        .map((m) => ({ role: m.role, content: m.content }));

      const userId = idRef.current++;
      const botId = idRef.current++;
      streamingIdRef.current = botId;
      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", content: msg },
        { id: botId, role: "model", content: "", streaming: true },
      ]);

      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: msg, history }),
        });
        if (!res.ok || !res.body) throw new Error(`stream failed (${res.status})`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let firstToken = true;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith("data:")) continue;
            const data = s.slice(5).trim();
            if (!data) continue;
            let ev: any;
            try {
              ev = JSON.parse(data);
            } catch {
              continue;
            }
            if (ev.type === "token") {
              if (firstToken) {
                firstToken = false;
                setAgentState("streaming");
                patch(botId, { status: undefined });
              }
              bufRef.current += ev.value;
              scheduleFlush();
            } else if (ev.type === "status") {
              patch(botId, { status: ev.value });
            } else if (ev.type === "replace") {
              flush();
              patch(botId, { content: ev.value });
            } else if (ev.type === "error") {
              flush();
              patch(botId, { content: ev.value, status: undefined });
            } else if (ev.type === "done") {
              flush();
              patch(botId, { citations: ev.citations, flagged: ev.injectionFlagged });
            }
          }
        }
      } catch {
        flush();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId
              ? { ...m, status: undefined, content: m.content || "Sorry — I hit a snag. Please try again." }
              : m,
          ),
        );
      } finally {
        flush();
        patch(botId, { streaming: false, status: undefined });
        streamingIdRef.current = null;
        setAgentState("idle");
        setBusy(false);
      }
    },
    [busy, messages, patch, scheduleFlush, flush],
  );

  return { messages, send, agentState, busy };
}
