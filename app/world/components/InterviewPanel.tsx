"use client";

// ─── InterviewPanel (plan §4.2) — right drawer: persona card + chat ──────────
// Live path: POST /api/interview (proxied to MiroShark, key server-side).
// Fallback path: when the proxy answers 503/{fallback:true} (or the fetch
// fails), answers come from the canned Q&As bundled in the timeline JSON
// (plan §4.4). History is kept per agent+variant for the session.

import { useEffect, useRef, useState } from "react";
import type { CannedInterview, WorldAgent, WorldTimeline } from "@/lib/world/types";

interface ChatMessage {
  from: "user" | "agent";
  text: string;
  source?: "live" | "canned" | "offline";
  pending?: boolean;
}

// Session-scoped history so re-opening an agent keeps the transcript.
const historyCache = new Map<string, ChatMessage[]>();

const DEFAULT_QUESTIONS = [
  "Bạn nghĩ gì về quảng cáo này?",
  "Why didn't this convince you?",
  "Bạn có định mua thử không?",
];

export default function InterviewPanel({
  agent,
  timeline,
  onClose,
}: {
  agent: WorldAgent;
  timeline: WorldTimeline;
  onClose: () => void;
}) {
  const cacheKey = `${timeline.variantLabel}:${agent.id}`;
  const [messages, setMessages] = useState<ChatMessage[]>(() => historyCache.get(cacheKey) ?? []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const canned: CannedInterview[] = timeline.interviews?.[agent.id] ?? [];
  const suggested = canned.length > 0 ? canned.map((qa) => qa.question) : DEFAULT_QUESTIONS;

  useEffect(() => {
    historyCache.set(cacheKey, messages);
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, cacheKey]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setDraft("");
    setMessages((current) => [
      ...current,
      { from: "user", text: trimmed },
      { from: "agent", text: "đang suy nghĩ…", pending: true },
    ]);

    const answer = await fetchAnswer(trimmed);
    setMessages((current) => {
      const next = current.filter((message) => !message.pending);
      next.push({ from: "agent", text: answer.text, source: answer.source });
      return next;
    });
    setBusy(false);
  }

  async function fetchAnswer(question: string): Promise<{ text: string; source: ChatMessage["source"] }> {
    // Live interview against the (still extant) simulation when possible.
    if (timeline.simulationId) {
      try {
        const res = await fetch("/api/interview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            simulationId: timeline.simulationId,
            agentName: agent.name,
            agentId: agent.id,
            question,
          }),
        });
        const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (res.ok && body && typeof body.answer === "string" && body.answer.trim()) {
          return { text: body.answer.trim(), source: "live" };
        }
        // fall through to canned on {fallback:true} or any other failure
      } catch {
        // engine unreachable — canned below
      }
    }
    return cannedAnswer(question);
  }

  function cannedAnswer(question: string): { text: string; source: ChatMessage["source"] } {
    if (canned.length > 0) {
      const exact = canned.find((qa) => qa.question.trim().toLowerCase() === question.trim().toLowerCase());
      if (exact) return { text: exact.answer, source: "canned" };
      // Unscripted question — rotate through the canned answers so the agent
      // still responds in persona.
      const asked = messages.filter((message) => message.from === "user").length;
      return { text: canned[asked % canned.length].answer, source: "canned" };
    }
    return {
      text: "『engine offline』 — nhân vật này chưa có câu trả lời thu sẵn. Hãy thử một nhân vật được đánh dấu.",
      source: "offline",
    };
  }

  const demo = agent.demographics;
  const metaLine = [
    demo.age !== undefined ? `${demo.age} tuổi` : null,
    demo.gender,
    demo.occupation,
    demo.region,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="interview-panel">
      <div className="panel-head">
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h3 className="persona-name">{agent.name}</h3>
        {metaLine && <p className="persona-meta">{metaLine}</p>}
        <p className="persona-meta">Reality {timeline.variantLabel}</p>
        <p className="persona-bio">{agent.personaSummary}</p>
      </div>

      <div className="panel-chat" ref={chatRef}>
        {messages.length === 0 && (
          <div className="chat-msg from-agent">
            …? <span className="chat-source">click a suggested question or ask your own</span>
          </div>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={`chat-msg ${message.from === "user" ? "from-user" : "from-agent"}${
              message.pending ? " pending" : ""
            }`}
          >
            {message.text}
            {message.source && (
              <span className="chat-source">
                {message.source === "live" ? "live · in persona" : message.source === "canned" ? "replay · pre-recorded" : "offline"}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="suggested">
        {suggested.slice(0, 3).map((question) => (
          <button key={question} type="button" onClick={() => ask(question)} disabled={busy}>
            {question}
          </button>
        ))}
      </div>

      <div className="panel-input">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") ask(draft);
          }}
          placeholder="Hỏi nhân vật này…"
          disabled={busy}
        />
        <button type="button" className="world-btn" onClick={() => ask(draft)} disabled={busy || !draft.trim()}>
          Ask
        </button>
      </div>
    </div>
  );
}
