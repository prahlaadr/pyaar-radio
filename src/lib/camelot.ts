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
