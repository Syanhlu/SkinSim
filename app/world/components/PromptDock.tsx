"use client";

// ─── PromptDock (plan §4.2) — hypothesis + variant A/B + Launch ──────────────
// Launch POSTs the Phase-3 proxy (POST /api/experiment) and hands the new
// experiment id to the parent, which switches the world to live mode. Built
// defensively: a 404/network failure shows a friendly "engine offline —
// replay mode" notice instead of erroring.

import { useState } from "react";

export default function PromptDock({
  onLaunched,
}: {
  onLaunched: (experimentId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [hypothesis, setHypothesis] = useState("");
  const [variantA, setVariantA] = useState("");
  const [variantB, setVariantB] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [proposalNote, setProposalNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (collapsed) {
    return (
      <div className="prompt-dock collapsed" onClick={() => setCollapsed(false)} role="button">
        <span className="dock-title">✎ Run your own experiment…</span>
      </div>
    );
  }

  const canLaunch = hypothesis.trim() && variantA.trim() && variantB.trim() && !busy;
  const canPropose = hypothesis.trim() && !proposing && !busy;

  async function propose() {
    if (!canPropose) return;
    setProposing(true);
    setProposalNote(null);
    try {
      const res = await fetch("/api/experiment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "variants", hypothesis: hypothesis.trim() }),
      });
      const body = (await res.json()) as {
        variants?: Array<{ text: string; angle: string; strategyNote: string }>;
        source?: string;
      };
      const variants = Array.isArray(body.variants) ? body.variants : [];
      if (!res.ok || variants.length < 2) {
        setProposalNote("Could not propose variants — write them by hand.");
        return;
      }
      setVariantA(variants[0].text);
      setVariantB(variants[1].text);
      setProposalNote(
        `${body.source === "agent" ? "Agent" : "Fallback"} proposal: A = ${variants[0].angle} angle, B = ${variants[1].angle} angle — edit freely.`,
      );
    } catch {
      setProposalNote("Could not propose variants — write them by hand.");
    } finally {
      setProposing(false);
    }
  }

  async function launch() {
    if (!canLaunch) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/experiment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hypothesis: hypothesis.trim(),
          variants: [
            { name: "A", text: variantA.trim() },
            { name: "B", text: variantB.trim() },
          ],
        }),
      });
      if (res.status === 404) {
        setNotice("Engine offline — staying in replay mode.");
        return;
      }
      let body: Record<string, unknown> | null = null;
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        body = null;
      }
      if (!res.ok || !body) {
        const message = body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
        setNotice(`Could not launch (${message}) — staying in replay mode.`);
        return;
      }
      const experimentId = firstString(body, ["experimentId", "experiment_id", "id"]);
      if (!experimentId) {
        setNotice("Engine answered without an experiment id — staying in replay mode.");
        return;
      }
      onLaunched(experimentId);
    } catch {
      setNotice("Engine offline — staying in replay mode.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prompt-dock">
      <p className="dock-title">
        Broadcast a new hypothesis to the crowd
        <button
          type="button"
          className="world-btn"
          style={{ float: "right", padding: "0 8px", fontSize: 11 }}
          onClick={() => setCollapsed(true)}
        >
          ×
        </button>
      </p>
      <div className="dock-row">
        <input
          value={hypothesis}
          onChange={(event) => setHypothesis(event.target.value)}
          placeholder="Hypothesis — e.g. A voucher-first promo lifts purchase intent…"
        />
      </div>
      <div className="dock-row">
        <input
          className="variant-input-a"
          value={variantA}
          onChange={(event) => setVariantA(event.target.value)}
          placeholder="Variant A ad copy (tiếng Việt)"
        />
        <input
          className="variant-input-b"
          value={variantB}
          onChange={(event) => setVariantB(event.target.value)}
          placeholder="Variant B ad copy (tiếng Việt)"
        />
      </div>
      <div className="dock-actions">
        <button type="button" className="world-btn" disabled={!canPropose} onClick={propose}>
          {proposing ? "Proposing…" : "✦ Propose variants"}
        </button>
        <button type="button" className="world-btn primary" disabled={!canLaunch} onClick={launch}>
          {busy ? "Launching…" : "Launch"}
        </button>
        {(notice || proposalNote) && <span className="dock-notice">{notice ?? proposalNote}</span>}
      </div>
    </div>
  );
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
