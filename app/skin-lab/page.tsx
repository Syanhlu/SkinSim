"use client";

// Dev verification surface for the skin-model stage: lists every entry in
// public/models/manifest.json next to its source image and renders the
// downloaded GLB with <model-viewer> so a generated model can be inspected
// before it's wired into a reaction run.

import { useEffect, useState } from "react";
import { ModelViewer } from "../components/model-viewer";

interface SkinModelEntry {
  skin: string;
  image: string;
  taskId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  progress: number;
  model?: string;
  error?: string;
  updatedAt: string;
}

export default function SkinLabPage() {
  const [entries, setEntries] = useState<SkinModelEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch("/api/skin", { cache: "no-store" });
        const json = (await res.json()) as { manifest?: Record<string, SkinModelEntry> };
        if (!cancelled) setEntries(Object.values(json.manifest ?? {}));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <main style={{ minHeight: "100vh", background: "#0b0e14", color: "#e8eaf0", padding: "48px 32px", fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Skin Lab</h1>
      <p style={{ opacity: 0.6, marginBottom: 32 }}>
        Generated 3D models from the Meshy stage. Source image on the left, GLB on the right.
      </p>

      {loaded && entries.length === 0 && (
        <p style={{ opacity: 0.6 }}>
          No models yet — run <code>npm run skin:model -- beach.png</code> or POST /api/skin.
        </p>
      )}

      <div style={{ display: "grid", gap: 32 }}>
        {entries.map((entry) => (
          <section
            key={entry.skin}
            style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 24, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 24 }}
          >
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{entry.skin}</h2>
              <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 12 }}>
                {entry.status} · {entry.progress}%{entry.error ? ` · ${entry.error}` : ""}
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={entry.image} alt={`${entry.skin} source`} style={{ width: "100%", borderRadius: 12 }} />
            </div>
            <div style={{ minHeight: 420 }}>
              {entry.model ? (
                <ModelViewer
                  src={entry.model}
                  alt={`${entry.skin} 3D model`}
                  style={{ width: "100%", height: "100%", minHeight: 420, background: "#11151f", borderRadius: 12 }}
                />
              ) : (
                <div style={{ display: "grid", placeItems: "center", height: "100%", minHeight: 420, background: "#11151f", borderRadius: 12, opacity: 0.5 }}>
                  {entry.status === "failed" ? "Generation failed" : "Generating…"}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
