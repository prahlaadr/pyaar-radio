"use client";

import { useState, useEffect, useCallback } from "react";
import { useTriagePicks, exportPicks, buildPicksPayload, isLocalhost, type PickStatus } from "@/lib/radar-triage";

interface Alert {
  id: number;
  artist: string;
  title: string;
  browseId: string;
  year: string;
  type: string;
  status: string;
  detectedAt: string;
  verify?: string; // "verified" | "unconfirmed" | "noise" | "" (not yet checked)
  verifySource?: string; // "deezer" | "local"
}

interface AlertsData {
  updatedAt: string;
  alerts: Alert[];
}

export default function RadarPage() {
  const [data, setData] = useState<AlertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const { picks, mark, unmark, loaded } = useTriagePicks();

  useEffect(() => {
    fetch("/data/radar-alerts.json")
      .then((r) => {
        if (!r.ok) throw new Error("No radar alerts found. Run: python -m radar release");
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  // Record the pick locally (persists across reloads). On localhost also hit the
  // API for an instant YT Music save/dismiss; on the deployed site the pick is
  // just queued for the Export → triage-apply flow.
  const act = useCallback(async (id: number, pick: PickStatus) => {
    mark(id, pick);
    if (!isLocalhost()) return;
    setBusy((s) => new Set(s).add(id));
    try {
      await fetch("/api/radar/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: pick === "saved" ? "saved" : "dismissed" }),
      });
    } catch {
      /* deployed / backend down — the localStorage pick still stands */
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, [mark]);

  const alerts = data?.alerts ?? [];
  // Pending = server-new and not yet picked this session.
  const pending = alerts.filter((a) => a.status === "new" && !picks[a.id]);
  // What the user has queued to save this session (drives Export + Apply).
  const savedPicks = alerts.filter((a) => picks[a.id] === "saved");
  const skippedCount = alerts.filter((a) => picks[a.id] === "skipped").length;
  const local = isLocalhost();

  // Kick off a fresh cloud scan (scan → reconcile → verify) via GitHub Actions.
  const refresh = useCallback(async () => {
    setWorking(true);
    setStatus("Starting scan…");
    try {
      const res = await fetch("/api/radar/refresh", { method: "POST" });
      const j = await res.json();
      setStatus(res.ok ? j.message : `Refresh failed: ${j.error}`);
    } catch (e) {
      setStatus(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorking(false);
    }
  }, []);

  // Save queued albums to YT Music in the cloud (dispatch triage-apply).
  const applyToCloud = useCallback(async () => {
    const payload = buildPicksPayload(alerts, picks);
    if (!payload.save.length) return;
    setWorking(true);
    setStatus(`Saving ${payload.save.length} to YT Music…`);
    try {
      const res = await fetch("/api/radar/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (res.ok) {
        setStatus(j.message);
        payload.save.forEach((s) => {
          const a = alerts.find((x) => x.browseId === s.browseId && x.title === s.title);
          if (a) unmark(a.id);
        });
      } else {
        setStatus(`Apply failed: ${j.error}`);
      }
    } catch (e) {
      setStatus(`Apply failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorking(false);
    }
  }, [alerts, picks, unmark]);

  return (
    <div className="min-h-screen bg-background text-white pt-[env(safe-area-inset-top)]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#222] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <a href="/" className="text-[10px] text-[#999] uppercase tracking-wider hover:text-white transition-colors shrink-0">
            &larr; Radio
          </a>
          <h1 className="text-sm font-bold uppercase tracking-[0.2em]">Radar</h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <a href="/radar/audit" className="text-[10px] text-[#999] uppercase tracking-wider hover:text-white transition-colors">
            Audit &rarr;
          </a>
          <button
            onClick={refresh}
            disabled={working}
            title="Run a fresh scan in the cloud (find new albums, drop already-liked)"
            className="px-2 py-0.5 text-[10px] uppercase tracking-wider border border-[#333] rounded-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:border-red-500 enabled:hover:text-white text-[#999]"
          >
            ⟳ Refresh
          </button>
          <button
            onClick={() => exportPicks(alerts, picks)}
            disabled={savedPicks.length === 0}
            title="Download picks JSON for triage-apply.yml"
            className="px-2 py-0.5 text-[10px] uppercase tracking-wider border border-[#333] rounded-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:border-green-500 enabled:hover:text-white text-[#999]"
          >
            Export ({savedPicks.length})
          </button>
        </div>
      </div>

      {/* Status line for refresh/apply */}
      {status && (
        <div className="px-5 py-2 border-b border-[#111] bg-[#0a0a0a] text-[10px] text-[#ccc] flex items-center justify-between gap-3">
          <span>{status}</span>
          <button onClick={() => setStatus(null)} className="text-[#777] hover:text-white shrink-0">✕</button>
        </div>
      )}

      {/* Mode banner */}
      {loaded && (
        <div className="px-5 py-2 border-b border-[#111] text-[9px] text-[#777] leading-relaxed">
          {local
            ? "Local: Save likes the album on YT Music instantly. Picks also persist in this browser."
            : "Save / Skip persist in this browser. Hit Apply to save your picks to YT Music in the cloud, or ⟳ Refresh to run a fresh scan. Export downloads the picks file if you'd rather apply manually."}
          {skippedCount > 0 && <span className="text-[#666]"> · {skippedCount} skipped this session</span>}
        </div>
      )}

      {/* Content */}
      <div className="max-w-2xl mx-auto">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          </div>
        )}

        {error && (
          <div className="px-5 py-12 text-center">
            <p className="text-[#999] text-xs uppercase tracking-widest">{error}</p>
            <p className="text-[#888] text-[10px] uppercase tracking-wider mt-3">Run: python -m radar release</p>
          </div>
        )}

        {data && !loading && (
          <>
            {/* Queued to save this session */}
            {savedPicks.length > 0 && (
              <div>
                <div className="px-5 py-2 border-b border-[#222] bg-[#0a0a0a] flex items-center justify-between gap-3">
                  <span className="text-[10px] text-green-500 uppercase tracking-wider font-semibold">
                    Queued to save ({savedPicks.length})
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={applyToCloud}
                      disabled={working}
                      title="Save these to YT Music in the cloud (dispatch triage-apply)"
                      className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-green-600 hover:bg-green-500 text-white rounded-sm transition-colors disabled:opacity-40"
                    >
                      ✓ Apply
                    </button>
                    <button
                      onClick={() => exportPicks(alerts, picks)}
                      className="text-[10px] text-[#999] uppercase tracking-wider hover:text-white transition-colors"
                    >
                      Export ↓
                    </button>
                  </div>
                </div>
                {savedPicks.map((alert) => (
                  <div key={alert.id} className="px-5 py-3 border-b border-[#111] flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[#ccc] truncate">{alert.title}</div>
                      <div className="text-[10px] text-[#999] truncate">{alert.artist}</div>
                    </div>
                    <span className="text-[10px] text-[#999] tabular-nums font-mono">{alert.year}</span>
                    <button
                      onClick={() => unmark(alert.id)}
                      className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#999] hover:text-white transition-colors"
                    >
                      Undo
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* New releases needing triage */}
            {pending.length > 0 && (
              <div>
                <div className="px-5 py-2 border-b border-[#222] bg-[#0a0a0a]">
                  <span className="text-[10px] text-red-500 uppercase tracking-wider font-semibold">
                    New Releases ({pending.length})
                  </span>
                </div>
                {pending.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    busy={busy.has(alert.id)}
                    onSave={() => act(alert.id, "saved")}
                    onDismiss={() => act(alert.id, "skipped")}
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {pending.length === 0 && savedPicks.length === 0 && (
              <div className="px-5 py-20 text-center">
                <p className="text-[#888] text-xs uppercase tracking-widest">No new releases</p>
                <p className="text-[#888] text-[10px] uppercase tracking-wider mt-2">All caught up</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Verification verdict from `radar verify` (Deezer catalog cross-check).
// Three states, deliberately asymmetric: a positive match is a strong confirm,
// a miss is only a weak signal (new releases lag the catalog), so "unconfirmed"
// is styled neutral — never as a warning.
function VerifyBadge({ alert }: { alert: Alert }) {
  const v = alert.verify;
  if (!v) return null;

  const config: Record<string, { label: string; cls: string; title: string }> = {
    verified: {
      label: "✓ real",
      cls: "text-green-500 border-green-900/60",
      title: "Confirmed as a real release by this artist on Deezer",
    },
    unconfirmed: {
      label: "· new?",
      cls: "text-[#888] border-[#333]",
      title: "Clean title but not in Deezer's catalog for this artist — usually just too new to be indexed, not a red flag",
    },
    noise: {
      label: "⚠ skip",
      cls: "text-amber-500 border-amber-900/60",
      title: "Looks like a soundtrack / deluxe / live / compilation — probably skip per original-releases-only",
    },
  };
  const c = config[v];
  if (!c) return null;

  return (
    <span
      title={c.title}
      className={`px-1.5 py-0.5 text-[9px] uppercase tracking-wider border rounded-sm tabular-nums shrink-0 ${c.cls}`}
    >
      {c.label}
    </span>
  );
}

function AlertRow({
  alert,
  busy,
  onSave,
  onDismiss,
}: {
  alert: Alert;
  busy: boolean;
  onSave: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="px-5 py-3 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-3 group transition-colors">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-[#ccc] group-hover:text-white transition-colors truncate">{alert.title}</div>
        <div className="text-[10px] text-[#999] truncate">
          {alert.artist}
          {alert.type === "album" ? "" : ` · ${alert.type}`}
        </div>
      </div>
      <VerifyBadge alert={alert} />
      {alert.browseId && (
        <a
          href={`https://music.youtube.com/browse/${alert.browseId}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Open album in YouTube Music (new tab)"
          className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[#999] hover:text-white border border-[#333] hover:border-red-500 rounded-sm shrink-0 transition-colors"
        >
          ▶ listen
        </a>
      )}
      <span className="text-[10px] text-[#999] tabular-nums font-mono shrink-0">{alert.year}</span>
      {busy ? (
        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" />
      ) : (
        <div className="flex gap-1 shrink-0">
          <button
            onClick={onSave}
            className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-green-600 hover:text-white text-[#999] transition-colors"
          >
            Save
          </button>
          <button
            onClick={onDismiss}
            className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#999] hover:text-white transition-colors"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
}
