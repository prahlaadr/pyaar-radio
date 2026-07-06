"use client";

// Audit review page — shows every alert the `radar verify` pass has judged,
// grouped by verdict, with the SKIP candidates surfaced first so they can be
// previewed (▶ listen) and confirmed before dismissing. Save/Skip reuse the
// same /api/radar/triage endpoint as the main triage page.

import { useState, useEffect, useCallback } from "react";

interface Alert {
  id: number;
  artist: string;
  title: string;
  browseId: string;
  year: string;
  type: string;
  status: string;
  detectedAt: string;
  verify?: string;
  verifySource?: string;
  verifyNote?: string;
}

interface AlertsData {
  updatedAt: string;
  alerts: Alert[];
}

// verify_note (noise class) -> human reason
const REASON: Record<string, string> = {
  ost: "soundtrack",
  derivative: "deluxe / remaster / edition",
  vol_series: "mixtape vol-series",
  compilation: "compilation",
  themed_comp: "themed compilation",
  bonus_score: "score / bonus",
};

export default function RadarAuditPage() {
  const [data, setData] = useState<AlertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triaging, setTriaging] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch("/data/radar-alerts.json")
      .then((r) => {
        if (!r.ok) throw new Error("No radar alerts found. Run: python -m radar release && python -m radar verify");
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const triage = useCallback(async (id: number, status: "saved" | "dismissed") => {
    setTriaging((s) => new Set(s).add(id));
    try {
      const res = await fetch("/api/radar/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) {
        setData((prev) => {
          if (!prev) return prev;
          // Remove the row from the review list once actioned either way.
          return { ...prev, alerts: prev.alerts.filter((a) => a.id !== id) };
        });
      }
    } finally {
      setTriaging((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, []);

  // Only alerts that have been audited AND are still awaiting triage.
  const audited = (data?.alerts ?? []).filter((a) => a.verify && a.status === "new");
  const noise = audited.filter((a) => a.verify === "noise");
  const unconfirmed = audited.filter((a) => a.verify === "unconfirmed");
  const verified = audited.filter((a) => a.verify === "verified");

  return (
    <div className="min-h-screen bg-background text-white pt-[env(safe-area-inset-top)]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#222] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/radar" className="text-[10px] text-[#999] uppercase tracking-wider hover:text-white transition-colors">
            &larr; Triage
          </a>
          <h1 className="text-sm font-bold uppercase tracking-[0.2em]">Radar · Audit</h1>
        </div>
        <span className="text-[10px] text-[#999] uppercase tracking-wider tabular-nums font-mono">
          {audited.length} audited
        </span>
      </div>

      <div className="max-w-2xl mx-auto">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          </div>
        )}

        {error && (
          <div className="px-5 py-12 text-center">
            <p className="text-[#999] text-xs uppercase tracking-widest">{error}</p>
          </div>
        )}

        {data && !loading && (
          <>
            <div className="px-5 py-3 text-[10px] text-[#888] leading-relaxed border-b border-[#111]">
              Everything the Deezer check has judged. Preview any album with{" "}
              <span className="text-[#ccc]">▶ listen</span> before deciding. Save likes it on YT Music; Skip dismisses it.
            </div>

            <Section
              title="Suggested skips"
              count={noise.length}
              color="amber"
              blurb="Soundtracks, deluxe editions, comps, mixtape vol-series. Preview to confirm, then Skip."
            >
              {noise.map((a) => (
                <AuditRow key={a.id} alert={a} triaging={triaging.has(a.id)}
                  onSave={() => triage(a.id, "saved")} onDismiss={() => triage(a.id, "dismissed")} />
              ))}
            </Section>

            <Section
              title="Unconfirmed"
              count={unconfirmed.length}
              color="neutral"
              blurb="Clean titles not in Deezer's catalog for the artist — usually just too new. Likely real; preview before saving."
            >
              {unconfirmed.map((a) => (
                <AuditRow key={a.id} alert={a} triaging={triaging.has(a.id)}
                  onSave={() => triage(a.id, "saved")} onDismiss={() => triage(a.id, "dismissed")} />
              ))}
            </Section>

            <Section
              title="Verified real albums"
              count={verified.length}
              color="green"
              blurb="Confirmed as real releases by the artist. Safe to save."
            >
              {verified.map((a) => (
                <AuditRow key={a.id} alert={a} triaging={triaging.has(a.id)}
                  onSave={() => triage(a.id, "saved")} onDismiss={() => triage(a.id, "dismissed")} />
              ))}
            </Section>

            {audited.length === 0 && (
              <div className="px-5 py-20 text-center">
                <p className="text-[#888] text-xs uppercase tracking-widest">Nothing audited yet</p>
                <p className="text-[#888] text-[10px] uppercase tracking-wider mt-2">Run: python -m radar verify</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  title, count, color, blurb, children,
}: {
  title: string; count: number; color: "amber" | "neutral" | "green"; blurb: string; children: React.ReactNode;
}) {
  if (count === 0) return null;
  const dot = color === "amber" ? "text-amber-500" : color === "green" ? "text-green-500" : "text-[#888]";
  return (
    <div>
      <div className="px-5 py-2 border-b border-[#222] bg-[#0a0a0a] sticky top-0 z-10">
        <span className={`text-[10px] uppercase tracking-wider font-semibold ${dot}`}>
          {title} ({count})
        </span>
        <p className="text-[9px] text-[#777] normal-case tracking-normal mt-0.5">{blurb}</p>
      </div>
      {children}
    </div>
  );
}

function AuditRow({
  alert, triaging, onSave, onDismiss,
}: {
  alert: Alert; triaging: boolean; onSave: () => void; onDismiss: () => void;
}) {
  const reason = alert.verify === "noise" ? (REASON[alert.verifyNote ?? ""] ?? alert.verifyNote) : "";
  return (
    <div className="px-5 py-3 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-3 group transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-[#ccc] group-hover:text-white transition-colors truncate">{alert.title}</div>
        <div className="text-[10px] text-[#999] truncate">
          {alert.artist}
          {reason ? <span className="text-amber-600/80"> · {reason}</span> : null}
          {alert.verify === "verified" && alert.verifySource ? (
            <span className="text-green-700"> · {alert.verifySource}</span>
          ) : null}
        </div>
      </div>
      {alert.browseId && (
        <a
          href={`https://music.youtube.com/browse/${alert.browseId}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open album in YouTube Music (new tab)"
          className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[#999] hover:text-white border border-[#333] hover:border-red-500 rounded-sm shrink-0 transition-colors"
        >
          ▶ listen
        </a>
      )}
      <span className="text-[10px] text-[#999] tabular-nums font-mono shrink-0">{alert.year}</span>
      {triaging ? (
        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" />
      ) : (
        <div className="flex gap-1 shrink-0">
          <button onClick={onSave}
            className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-green-600 hover:text-white text-[#999] transition-colors">
            Save
          </button>
          <button onClick={onDismiss}
            className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#999] hover:text-white transition-colors">
            Skip
          </button>
        </div>
      )}
    </div>
  );
}
