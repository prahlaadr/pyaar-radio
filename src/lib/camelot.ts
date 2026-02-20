// Camelot key system for DJ harmonic mixing
// Pitch class (0-11) → Camelot notation

export const CAMELOT: Record<number, string> = {
  0: "8B",
  1: "3B",
  2: "10B",
  3: "5B",
  4: "12B",
  5: "7B",
  6: "2B",
  7: "9B",
  8: "4B",
  9: "11B",
  10: "6B",
  11: "1B",
};

// Reverse lookup: Camelot notation → pitch class
const PITCH_FROM_CAMELOT: Record<string, number> = {};
for (const [pitch, camelot] of Object.entries(CAMELOT)) {
  PITCH_FROM_CAMELOT[camelot] = Number(pitch);
}

export function pitchToCamelot(key: number): string {
  return CAMELOT[key] ?? "—";
}

/**
 * Get compatible pitch classes for harmonic mixing.
 * Returns pitch classes that are Camelot-compatible with the given key:
 * - Same key (perfect match)
 * - +7 semitones (perfect fifth up = +1 on Camelot wheel)
 * - -7 semitones / +5 (perfect fifth down = -1 on Camelot wheel)
 * - +3 semitones (relative major/minor = B↔A at same number)
 * - -3 semitones (relative major/minor = B↔A at same number)
 */
export function getCompatibleKeys(key: number): number[] {
  const mod = (n: number) => ((n % 12) + 12) % 12;
  return [
    key,              // same key
    mod(key + 7),     // +1 on wheel (fifth up)
    mod(key + 5),     // -1 on wheel (fifth down)
    mod(key + 3),     // relative major/minor
    mod(key - 3),     // relative major/minor (other direction)
  ];
}

export type KeyCompatibility = "perfect" | "harmonic" | "energy" | "incompatible";

/**
 * Determine the compatibility between two keys.
 * - "perfect": same Camelot key
 * - "harmonic": ±1 on the Camelot wheel (adjacent number, same letter)
 * - "energy": relative major/minor (same number, different letter: B↔A)
 * - "incompatible": no harmonic relationship
 */
export function getKeyCompatibility(keyA: number, keyB: number): KeyCompatibility {
  const mod = (n: number) => ((n % 12) + 12) % 12;

  if (keyA === keyB) return "perfect";

  // ±1 on Camelot wheel = ±7 semitones (perfect fifth)
  if (mod(keyB - keyA) === 7 || mod(keyA - keyB) === 7) return "harmonic";

  // Relative major/minor = ±3 semitones
  if (mod(keyB - keyA) === 3 || mod(keyA - keyB) === 3) return "energy";

  return "incompatible";
}

/**
 * Score a transition between two tracks for setlist sorting.
 * Higher score = smoother transition.
 * BPM: 0-30 points (linear proximity, 1 point per BPM closer)
 * Key: 0/10/20 points (incompatible/energy/harmonic+perfect)
 */
export function scoreTransition(
  fromKey: number, fromTempo: number,
  toKey: number, toTempo: number,
): number {
  const bpmScore = fromTempo > 0 && toTempo > 0
    ? Math.max(0, 30 - Math.abs(toTempo - fromTempo))
    : 0;
  let keyScore = 0;
  if (fromKey > 0 && toKey > 0) {
    const compat = getKeyCompatibility(fromKey, toKey);
    if (compat === "perfect" || compat === "harmonic") keyScore = 20;
    else if (compat === "energy") keyScore = 10;
  }
  return bpmScore + keyScore;
}

/**
 * Sort setlist tracks for optimal harmonic flow.
 * Greedy nearest-neighbor: keeps first track as anchor,
 * then always picks the unplaced track with the best transition.
 */
export function sortByHarmonicFlow<T extends { key: number; tempo: number }>(tracks: T[]): T[] {
  if (tracks.length < 3) return tracks;
  const remaining = new Set(tracks.keys());
  const sorted: T[] = [tracks[0]];
  remaining.delete(0);

  for (let i = 1; i < tracks.length; i++) {
    const prev = sorted[i - 1];
    let bestIdx = -1;
    let bestScore = -1;
    for (const idx of remaining) {
      const score = scoreTransition(prev.key, prev.tempo, tracks[idx].key, tracks[idx].tempo);
      if (score > bestScore) { bestScore = score; bestIdx = idx; }
    }
    sorted.push(tracks[bestIdx]);
    remaining.delete(bestIdx);
  }
  return sorted;
}
