import type { ArtistFilters } from "./types";

export function buildArtistQuery(filters: ArtistFilters): string {
  const conditions: string[] = [];

  if (filters.channels.length > 0) {
    const list = filters.channels.map((c) => `'${c}'`).join(", ");
    conditions.push(`channel IN (${list})`);
  }

  if (filters.samay) {
    conditions.push(`samay LIKE '%${filters.samay}%'`);
  }

  if (filters.desi) {
    conditions.push(`desi = '${filters.desi}'`);
  }

  if (filters.vibes.length > 0) {
    const vibeConds = filters.vibes.map((v) => `vibes ILIKE '%${v}%'`);
    conditions.push(`(${vibeConds.join(" AND ")})`);
  }

  if (filters.bpmMin > 0) {
    conditions.push(`bpm_high >= ${filters.bpmMin}`);
  }

  if (filters.bpmMax < 300) {
    conditions.push(`bpm_low <= ${filters.bpmMax}`);
  }

  if (filters.search) {
    conditions.push(`artist ILIKE '%${filters.search.replace(/'/g, "''")}%'`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return `SELECT * FROM artists ${where} ORDER BY channel, artist`;
}

export function buildTracksQuery(artistName: string, aliases: string[]): string {
  const allNames = [artistName, ...aliases];
  const conditions = allNames.map((name) => {
    const escaped = name.replace(/'/g, "''");
    return `LOWER(TRIM(split_part("Artist Name(s)", ';', 1))) = LOWER('${escaped}')
      OR "Artist Name(s)" ILIKE '%${escaped}%'`;
  });

  return `
    SELECT
      "Track Name" as trackName,
      "Artist Name(s)" as artistNames,
      "Album Name" as albumName,
      Genres as genres,
      TRY_CAST(Tempo AS FLOAT) as tempo,
      Duration as duration,
      TRY_CAST(Key AS INT) as key,
      TRY_CAST(Popularity AS INT) as popularity,
      "Video ID" as videoId
    FROM masterlist
    WHERE ${conditions.map((c) => `(${c})`).join(" OR ")}
    ORDER BY TRY_CAST(Tempo AS FLOAT) DESC
  `;
}
