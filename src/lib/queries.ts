import type { ArtistFilters, ChapterType } from "./types";

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
      "Soundcloud ID" as soundcloudId,
      "Bandcamp ID" as bandcampId
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
      "Soundcloud ID" as soundcloudId,
      "Bandcamp ID" as bandcampId
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
      "Soundcloud ID" as soundcloudId,
      "Bandcamp ID" as bandcampId
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
    const allNames = [a.artist, ...a.aliases.filter((n) => !n.startsWith("~"))];
    return allNames.map((name) => {
      const escaped = name.replace(/'/g, "''").toLowerCase();
      return `_artists_lower LIKE '%;${escaped};%'`;
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
      "Soundcloud ID" as soundcloudId,
      "Bandcamp ID" as bandcampId
    FROM masterlist
    WHERE ${conditions.join(" AND ")}
    ORDER BY (${bpmScore} + ${keyScore} + RANDOM() * 15) DESC
    LIMIT 1
  `;
}

export function buildFilteredTracksQuery(
  artists: RadioArtist[],
  bpmMin = 0,
  bpmMax = 300,
  halfTime = false,
): string {
  const artistConditions = artists.map((a) => {
    const allNames = [a.artist, ...a.aliases.filter((n) => !n.startsWith("~"))];
    return allNames.map((name) => {
      const escaped = name.replace(/'/g, "''").toLowerCase();
      return `_artists_lower LIKE '%;${escaped};%'`;
    }).join(" OR ");
  }).map((c) => `(${c})`).join(" OR ");

  const conditions = [`(${artistConditions})`];

  if (bpmMin > 0 || bpmMax < 300) {
    const min = bpmMin > 0 ? bpmMin : 0;
    const max = bpmMax < 300 ? bpmMax : 999;
    const tempo = "TRY_CAST(Tempo AS FLOAT)";
    if (halfTime) {
      const halfMin = Math.round(min / 2);
      const halfMax = Math.round(max / 2);
      const doubleMin = min * 2;
      const doubleMax = max * 2;
      conditions.push(`(${tempo} IS NOT NULL AND ((${tempo} >= ${min} AND ${tempo} <= ${max}) OR (${tempo} >= ${halfMin} AND ${tempo} <= ${halfMax}) OR (${tempo} >= ${doubleMin} AND ${tempo} <= ${doubleMax})))`);
    } else {
      if (bpmMin > 0) conditions.push(`${tempo} >= ${min}`);
      if (bpmMax < 300) conditions.push(`${tempo} <= ${max}`);
    }
  }

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
      "Soundcloud ID" as soundcloudId,
      "Bandcamp ID" as bandcampId
    FROM masterlist
    WHERE ${conditions.join(" AND ")}
    ORDER BY "Artist Name(s)", TRY_CAST(Tempo AS FLOAT) DESC
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
      "Soundcloud ID" as soundcloudId,
      "Bandcamp ID" as bandcampId
    FROM masterlist
    WHERE ${tagConds.join(" OR ")}
    ORDER BY RANDOM()
    LIMIT 1
  `;
}

export function buildTagSectionQuery(tag: string, search: string, bpmMin: number, bpmMax: number, desi?: string): string {
  const conditions: string[] = [];
  const escapedTag = tag.replace(/'/g, "''");
  conditions.push(`Tags ILIKE '%${escapedTag}%'`);

  if (search) {
    const s = search.replace(/'/g, "''");
    conditions.push(`("Track Name" ILIKE '%${s}%' OR "Artist Name(s)" ILIKE '%${s}%' OR "Album Name" ILIKE '%${s}%')`);
  }

  if (bpmMin > 0) {
    conditions.push(`TRY_CAST(Tempo AS FLOAT) >= ${bpmMin}`);
  }
  if (bpmMax < 300) {
    conditions.push(`TRY_CAST(Tempo AS FLOAT) <= ${bpmMax}`);
  }

  if (desi) {
    conditions.push(`EXISTS (SELECT 1 FROM artists a WHERE a.desi = '${desi}' AND _artists_lower LIKE '%;' || LOWER(a.artist) || ';%')`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

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
      "Soundcloud ID" as soundcloudId,
      "Bandcamp ID" as bandcampId
    FROM masterlist
    ${where}
    ORDER BY "Artist Name(s)", "Track Name"
  `;
}

export function buildTamilQuery(search: string, bpmMin: number, bpmMax: number): string {
  const conditions: string[] = [];

  if (search) {
    const s = search.replace(/'/g, "''");
    conditions.push(`("Track Name" ILIKE '%${s}%' OR Artist ILIKE '%${s}%' OR Album ILIKE '%${s}%')`);
  }

  if (bpmMin > 0) {
    conditions.push(`TRY_CAST(Tempo AS FLOAT) >= ${bpmMin}`);
  }
  if (bpmMax < 300) {
    conditions.push(`TRY_CAST(Tempo AS FLOAT) <= ${bpmMax}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return `
    SELECT
      "Track Name" as trackName,
      Artist as artistNames,
      Album as albumName,
      TRY_CAST(Tempo AS FLOAT) as tempo,
      Duration as duration,
      "Video ID" as videoId
    FROM tamil
    ${where}
    ORDER BY Artist, "Track Name"
  `;
}

export function buildIlaiyaraajaQuery(search: string): string {
  const conditions: string[] = [];

  if (search) {
    const s = search.replace(/'/g, "''");
    conditions.push(`("Track Name" ILIKE '%${s}%' OR Film ILIKE '%${s}%')`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return `
    SELECT
      "Track Name" as trackName,
      Film as artistNames,
      '' as albumName,
      NULL as tempo,
      '' as duration,
      "Video ID" as videoId
    FROM ilaiyaraaja
    ${where}
    ORDER BY "Track Name", Film
  `;
}

export function buildTracksQuery(
  artistName: string,
  aliases: string[],
  bpmMin = 0,
  bpmMax = 300,
  halfTime = false,
): string {
  const allNames = [artistName, ...aliases.filter((a) => !a.startsWith("~"))];
  // Use pre-computed _artists_lower column: ';lowercase_name;' format enables fast LIKE contains
  const artistConds = allNames.map((name) => {
    const escaped = name.replace(/'/g, "''").toLowerCase();
    return `_artists_lower LIKE '%;${escaped};%'`;
  });

  const conditions = [`(${artistConds.join(" OR ")})`];

  if (bpmMin > 0 || bpmMax < 300) {
    const min = bpmMin > 0 ? bpmMin : 0;
    const max = bpmMax < 300 ? bpmMax : 999;
    const tempo = "TRY_CAST(Tempo AS FLOAT)";
    if (halfTime) {
      const halfMin = Math.round(min / 2);
      const halfMax = Math.round(max / 2);
      const doubleMin = min * 2;
      const doubleMax = max * 2;
      conditions.push(`(${tempo} IS NOT NULL AND ((${tempo} >= ${min} AND ${tempo} <= ${max}) OR (${tempo} >= ${halfMin} AND ${tempo} <= ${halfMax}) OR (${tempo} >= ${doubleMin} AND ${tempo} <= ${doubleMax})))`);
    } else {
      if (bpmMin > 0) conditions.push(`${tempo} >= ${min}`);
      if (bpmMax < 300) conditions.push(`${tempo} <= ${max}`);
    }
  }

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
      "Soundcloud ID" as soundcloudId,
      "Bandcamp ID" as bandcampId
    FROM masterlist
    WHERE ${conditions.join(" AND ")}
    ORDER BY TRY_CAST(Tempo AS FLOAT) DESC
  `;
}

// BPM range targets for each chapter type (energy arc)
const CHAPTER_BPM_OFFSETS: Record<ChapterType, { min: number; max: number }> = {
  intro: { min: -20, max: -5 },
  buildup: { min: -5, max: 10 },
  cruise: { min: -5, max: 5 },
  peak: { min: 5, max: 20 },
  comedown: { min: -15, max: -5 },
  closer: { min: -25, max: -10 },
};

/**
 * Suggest tracks for a chapter based on the average BPM/key of the prior chapter
 * and the target chapter type's energy profile.
 * Returns 3 tracks scored by BPM fit + key compatibility + randomness.
 */
export function buildChapterSuggestionQuery(
  avgBpm: number,
  compatibleKeys: number[],
  targetChapter: ChapterType,
  excludeTrackKeys?: string[],
): string {
  const offset = CHAPTER_BPM_OFFSETS[targetChapter];
  const targetBpm = avgBpm + (offset.min + offset.max) / 2;
  const bpmRange = Math.abs(offset.max - offset.min) / 2 + 10; // allow some slack

  const conditions: string[] = [
    `TRY_CAST(Tempo AS FLOAT) IS NOT NULL`,
    `TRY_CAST(Tempo AS FLOAT) BETWEEN ${Math.max(0, targetBpm - bpmRange)} AND ${targetBpm + bpmRange}`,
  ];

  if (excludeTrackKeys && excludeTrackKeys.length > 0) {
    const excludeConds = excludeTrackKeys.map((k) => `'${k.replace(/'/g, "''")}'`);
    conditions.push(`(LOWER("Track Name") || ':::' || LOWER("Artist Name(s)")) NOT IN (${excludeConds.join(",")})`);
  }

  const bpmScore = `GREATEST(0, 30 - ABS(TRY_CAST(Tempo AS FLOAT) - ${targetBpm}))`;
  const keyScore = compatibleKeys.length > 0
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
      "Soundcloud ID" as soundcloudId,
      "Bandcamp ID" as bandcampId
    FROM masterlist
    WHERE ${conditions.join(" AND ")}
    ORDER BY (${bpmScore} + ${keyScore} + RANDOM() * 10) DESC
    LIMIT 3
  `;
}
