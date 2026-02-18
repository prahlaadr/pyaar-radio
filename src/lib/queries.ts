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

  if (filters.bpmMin > 0 || filters.bpmMax < 300) {
    const min = filters.bpmMin > 0 ? filters.bpmMin : 0;
    const max = filters.bpmMax < 300 ? filters.bpmMax : 999;
    if (filters.halfTime) {
      // Match original range OR double OR half
      const halfMin = Math.round(min / 2);
      const halfMax = Math.round(max / 2);
      const doubleMin = min * 2;
      const doubleMax = max * 2;
      conditions.push(`((bpm_high >= ${min} AND bpm_low <= ${max}) OR (bpm_high >= ${halfMin} AND bpm_low <= ${halfMax}) OR (bpm_high >= ${doubleMin} AND bpm_low <= ${doubleMax}))`);
    } else {
      if (filters.bpmMin > 0) conditions.push(`bpm_high >= ${min}`);
      if (filters.bpmMax < 300) conditions.push(`bpm_low <= ${max}`);
    }
  }

  // Search is handled client-side by Fuse.js for fuzzy matching

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return `SELECT * FROM artists ${where} ORDER BY channel, artist`;
}

export function buildTrackSearchQuery(search: string): string {
  const s = search.replace(/'/g, "''");
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
      "Video ID" as videoId,
      "Soundcloud ID" as soundcloudId
    FROM masterlist
    WHERE "Track Name" ILIKE '%${s}%'
      OR "Artist Name(s)" ILIKE '%${s}%'
    ORDER BY TRY_CAST(Popularity AS INT) DESC
    LIMIT 50
  `;
}

export function buildTrackLookupQuery(trackName: string, artistName: string): string {
  const t = trackName.replace(/'/g, "''");
  const a = artistName.replace(/'/g, "''");
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
      "Video ID" as videoId,
      "Soundcloud ID" as soundcloudId
    FROM masterlist
    WHERE "Track Name" ILIKE '${t}'
      AND "Artist Name(s)" ILIKE '%${a}%'
    LIMIT 1
  `;
}

export function buildBatchTrackLookupQuery(pairs: { track: string; artist: string }[]): string {
  const conditions = pairs.map(({ track, artist }) => {
    const t = track.replace(/'/g, "''");
    const a = artist.replace(/'/g, "''");
    return `("Track Name" ILIKE '${t}' AND "Artist Name(s)" ILIKE '%${a}%')`;
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
      "Video ID" as videoId,
      "Soundcloud ID" as soundcloudId
    FROM masterlist
    WHERE ${conditions.join(" OR ")}
  `;
}

export interface RadioArtist {
  artist: string;
  aliases: string[];
}

export function buildScoredRandomQuery(
  artists: RadioArtist[],
  currentBPM: number,
  compatibleKeys?: number[],
  excludeTrackKeys?: string[],
): string {
  const artistConditions = artists.map((a) => {
    const allNames = [a.artist, ...a.aliases];
    return allNames.map((name) => {
      const escaped = name.replace(/'/g, "''");
      return `LOWER(TRIM(split_part("Artist Name(s)", ';', 1))) = LOWER('${escaped}') OR "Artist Name(s)" ILIKE '%${escaped}%'`;
    }).join(" OR ");
  }).map((c) => `(${c})`).join(" OR ");

  const conditions = [`(${artistConditions})`];

  if (excludeTrackKeys && excludeTrackKeys.length > 0) {
    const excludeConds = excludeTrackKeys.map((k) => {
      const escaped = k.replace(/'/g, "''");
      return `'${escaped}'`;
    });
    conditions.push(`(LOWER("Track Name") || ':::' || LOWER("Artist Name(s)")) NOT IN (${excludeConds.join(",")})`);
  }

  // Score: BPM proximity (0-30 pts) + key compatibility (0-20 pts) + randomness
  const bpmScore = currentBPM > 0
    ? `GREATEST(0, 30 - ABS(COALESCE(TRY_CAST(Tempo AS FLOAT), 0) - ${currentBPM}))`
    : "0";

  const keyScore = compatibleKeys && compatibleKeys.length > 0
    ? `CASE WHEN TRY_CAST(Key AS INT) IN (${compatibleKeys.join(",")}) THEN 20 ELSE 0 END`
    : "0";

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
      "Video ID" as videoId,
      "Soundcloud ID" as soundcloudId
    FROM masterlist
    WHERE ${conditions.join(" AND ")}
    ORDER BY (${bpmScore} + ${keyScore} + RANDOM() * 15) DESC
    LIMIT 1
  `;
}

export function buildAvailableTagsQuery(): string {
  return `
    SELECT DISTINCT unnest(string_split(Tags, '|')) as tag
    FROM masterlist WHERE Tags <> '' AND Tags IS NOT NULL
    ORDER BY tag
  `;
}

export function buildTagRadioQuery(tags: string[]): string {
  const tagConds = tags.map((t) => {
    const escaped = t.replace(/'/g, "''");
    return `Tags ILIKE '%${escaped}%'`;
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
      "Video ID" as videoId,
      "Soundcloud ID" as soundcloudId
    FROM masterlist
    WHERE ${tagConds.join(" OR ")}
    ORDER BY RANDOM()
    LIMIT 1
  `;
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
      "Video ID" as videoId,
      "Soundcloud ID" as soundcloudId
    FROM masterlist
    WHERE ${conditions.map((c) => `(${c})`).join(" OR ")}
    ORDER BY TRY_CAST(Tempo AS FLOAT) DESC
  `;
}
