"use client";

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
}

interface AlertsData {
  updatedAt: string;
  alerts: Alert[];
}

export default function RadarPage() {
  const [data, setData] = useState<AlertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triaging, setTriaging] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch("/data/radar-alerts.json")
      .then((r) => {
        if (!r.ok) throw new Error("No radar alerts found. Run: python -m radar release");
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
          if (status === "dismissed") {
            return { ...prev, alerts: prev.alerts.filter((a) => a.id !== id) };
          }
          return {
            ...prev,
            alerts: prev.alerts.map((a) => (a.id === id ? { ...a, status } : a)),
          };
        });
      }
    } finally {
      setTriaging((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, []);

  const newAlerts = data?.alerts.filter((a) => a.status === "new") ?? [];
  const savedAlerts = data?.alerts.filter((a) => a.status === "saved") ?? [];

  return (
    <div className="min-h-screen bg-background text-white pt-[env(safe-area-inset-top)]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#222] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="text-[10px] text-[#999] uppercase tracking-wider hover:text-white transition-colors"
          >
            &larr; Radio
          </a>
          <h1 className="text-sm font-bold uppercase tracking-[0.2em]">Radar</h1>
        </div>
        {data?.updatedAt && (
          <span className="text-[10px] text-[#999] uppercase tracking-wider tabular-nums font-mono">
            {new Date(data.updatedAt).toLocaleDateString()}
          </span>
        )}
      </div>

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
            <p className="text-[#888] text-[10px] uppercase tracking-wider mt-3">
              Run: python -m radar release
            </p>
          </div>
        )}

        {data && !loading && (
          <>
            {/* New releases needing triage */}
            {newAlerts.length > 0 && (
              <div>
                <div className="px-5 py-2 border-b border-[#222] bg-[#0a0a0a]">
                  <span className="text-[10px] text-red-500 uppercase tracking-wider font-semibold">
                    New Releases ({newAlerts.length})
                  </span>
                </div>
                {newAlerts.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    triaging={triaging.has(alert.id)}
                    onSave={() => triage(alert.id, "saved")}
                    onDismiss={() => triage(alert.id, "dismissed")}
                  />
                ))}
              </div>
            )}

            {/* Already saved */}
            {savedAlerts.length > 0 && (
              <div>
                <div className="px-5 py-2 border-b border-[#222] bg-[#0a0a0a]">
                  <span className="text-[10px] text-[#999] uppercase tracking-wider">
                    Saved ({savedAlerts.length})
                  </span>
                </div>
                {savedAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="px-5 py-3 border-b border-[#111] flex items-center gap-3 opacity-60"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[#ccc] truncate">{alert.title}</div>
                      <div className="text-[10px] text-[#999] truncate">{alert.artist}</div>
                    </div>
                    <span className="text-[10px] text-[#999] tabular-nums font-mono">{alert.year}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {newAlerts.length === 0 && savedAlerts.length === 0 && (
              <div className="px-5 py-20 text-center">
                <p className="text-[#888] text-xs uppercase tracking-widest">No new releases</p>
                <p className="text-[#888] text-[10px] uppercase tracking-wider mt-2">
                  All caught up
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AlertRow({
  alert,
  triaging,
  onSave,
  onDismiss,
}: {
  alert: Alert;
  triaging: boolean;
  onSave: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="px-5 py-3 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-3 group transition-colors">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-[#ccc] group-hover:text-white transition-colors truncate">
          {alert.title}
        </div>
        <div className="text-[10px] text-[#999] truncate">
          {alert.artist}
          {alert.type === "album" ? "" : ` · ${alert.type}`}
        </div>
      </div>
      <span className="text-[10px] text-[#999] tabular-nums font-mono shrink-0">{alert.year}</span>
      {triaging ? (
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
