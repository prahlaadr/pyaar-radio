"use client";

// Browser-persistent triage picks for the radar pages.
//
// On the deployed site the /api/radar/triage route can't run (no Python, no
// browser.json, read-only FS), so Save/Skip clicks used to vanish on reload.
// This layer stores every pick in localStorage so decisions persist, and the
// "Export picks" button emits the exact JSON that triage-apply.yml consumes —
// so saves happen in the cloud via that workflow instead of the local backend.
//
// On localhost the pages ALSO call the API for instant YT Music saves; the
// localStorage pick is written either way, so the two stay consistent.

import { useCallback, useEffect, useState } from "react";

export type PickStatus = "saved" | "skipped";
const KEY = "radar-triage-picks-v1";

export interface AlertLike {
  id: number;
  artist: string;
  title: string;
  browseId: string;
  year: string;
}

export function isLocalhost(): boolean {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

export function useTriagePicks() {
  const [picks, setPicks] = useState<Record<number, PickStatus>>({});
  const [loaded, setLoaded] = useState(false);

  // Load once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setPicks(JSON.parse(raw));
    } catch {
      /* ignore corrupt/unavailable storage */
    }
    setLoaded(true);
  }, []);

  // Persist on every change (after the initial load, so we don't clobber it).
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(picks));
    } catch {
      /* ignore quota/private-mode errors */
    }
  }, [picks, loaded]);

  const mark = useCallback((id: number, status: PickStatus) => {
    setPicks((p) => ({ ...p, [id]: status }));
  }, []);

  const unmark = useCallback((id: number) => {
    setPicks((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  }, []);

  const clear = useCallback(() => setPicks({}), []);

  return { picks, mark, unmark, clear, loaded };
}

// The triage-apply.yml picks payload from the current saved picks. Schema
// mirrors triage-runs/*.json (source "radar_new" = album). Shared by Export
// (download) and Apply (POST to /api/radar/apply).
export function buildPicksPayload(alerts: AlertLike[], picks: Record<number, PickStatus>) {
  const saved = alerts.filter((a) => picks[a.id] === "saved");
  const skipped = alerts.filter((a) => picks[a.id] === "skipped");
  return {
    exportedAt: new Date().toISOString(),
    counts: {
      total: alerts.length,
      save: saved.length,
      skip: skipped.length,
      pending: alerts.length - saved.length - skipped.length,
    },
    save: saved.map((a) => ({
      artist: a.artist,
      title: a.title,
      year: a.year || "",
      source: "radar_new",
      browseId: a.browseId,
    })),
  };
}

// Build the picks file and trigger a browser download.
export function exportPicks(alerts: AlertLike[], picks: Record<number, PickStatus>) {
  const payload = buildPicksPayload(alerts, picks);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const day = new Date().toISOString().slice(0, 10);
  const el = document.createElement("a");
  el.href = url;
  el.download = `pyaar-triage-${day}.json`;
  document.body.appendChild(el);
  el.click();
  el.remove();
  URL.revokeObjectURL(url);
  return payload.save.length;
}
