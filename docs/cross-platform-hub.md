# Cross-Platform Listening Hub

Pyaar Radio is a repo for music/shows saved across platforms, all playable in-app
without leaving. Alongside the YT Music library it pulls saved items from **NTS**
and **SoundCloud** as tabs (Bandcamp is planned, deferred). Each source follows
the app's spine: a sync script commits static JSON to the repo, the tab renders it.

Tabs live in the **Sources** row under Browse/Liked/Albums/Setlists (`page.tsx`).

## NTS (saved episodes + hosts)

Favourites are **not** a REST API. They live in **Firebase Firestore** (project
`nts-ios-app`), and Firestore security rules deny arbitrary collection queries, so
the only way to read them is an **authenticated headless DOM render**.

- **Auth = Firebase Auth.** The signed-in user (with a durable `refreshToken`) is in
  browser IndexedDB `firebaseLocalStorageDb`. We store the refresh token as the
  `NTS_REFRESH_TOKEN` GitHub secret and mint fresh ID tokens headlessly in CI via
  `securetoken.googleapis.com/v1/token` (kills cookie expiry). API key + uid are in
  `scripts/sync_nts.py`.
- **Scrape** (`scripts/sync_nts.py`, Playwright): inject the Firebase user into
  IndexedDB via `add_init_script`, load `/my-nts/favourites/{shows,episodes}`, scrape
  anchors. Gotchas: NTS keeps persistent Firestore sockets so `networkidle` never
  fires -> use `domcontentloaded` + `wait_for_selector`. The pages also render
  "Up Next" + "Recommendations" carousels full of /shows/ links -> **scope to
  `.my-nts__list-container`** and extract shows only on the shows page, episodes only
  on the episodes page, or you get pollution.
- **Enrich via the PUBLIC API** (no auth): `GET /api/v2/shows/{alias}` and
  `/shows/{alias}/episodes/{slug}`. Episodes carry `audio_sources` (soundcloud /
  mixcloud), `genres`, `moods`, `intensity`. Host drill-down uses
  `/api/v2/shows/{alias}/episodes?offset=N` (fixed 12/page, total in
  `metadata.resultset.count`) — permissive CORS, so the panel calls it client-side.
- **Playback in-app**: soundcloud source -> SC widget; mixcloud source -> Mixcloud
  embed iframe. See the player pattern below.
- Output: `public/data/nts.json` `{syncedAt, shows[], episodes[]}`. Daily workflow
  `.github/workflows/sync-nts.yml`. UI: `src/components/nts-panel.tsx`.

## SoundCloud (liked tracks + followed playlists)

**No auth needed** — his likes + playlist-likes are public, readable with just a
`client_id` scraped from soundcloud.com JS (fallback hardcoded). user_id `128154028`.
Endpoints: `api-v2.soundcloud.com/users/{uid}/track_likes` and `/playlist_likes`
(linked_partitioning, follow `next_href`). `scripts/sync_sc.py` ->
`public/data/sc.json` `{syncedAt, clientId, likes[], playlists[]}`. Daily workflow
`sync-sc.yml`.

- **CORS gotcha:** `api-v2.soundcloud.com` **blocks cross-origin browser fetches**
  (unlike nts.live/api). So playlist drill-down can't fetch tracks client-side ->
  server proxy `src/app/api/sc-playlist/route.ts` does the `/playlists/{id}` +
  `/tracks?ids=` hydration; the browser calls `/api/sc-playlist?id=`.
- UI `src/components/sc-panel.tsx`: subtabs (Liked / Playlists) + a live filter over
  the likes.

## Player extension pattern (reuse for new sources)

`Track` has optional `soundcloudUrl?` + `mixcloudKey?` (`src/lib/types.ts`).
`youtube-player.tsx` routes those in `playTrack` **before** its YouTube-search
fallback. **Gotcha:** the YT-search fallback runs before the numeric `soundcloudId`
check, so a Track with only `soundcloudId` gets mis-played as a YT result — always
set `soundcloudUrl` (the permalink) for SC-sourced tracks. Mixcloud/Bandcamp use
external embed iframes (no programmatic play/seek). A panel plays a track by calling
`setNowPlaying(track)`.

## NTS genre labeling (shared vocabulary across both libraries)

NTS's taxonomy (`/api/v2/genres`, 20 top-genres / 442 subgenres) only labels NTS's
own content — there is no endpoint to classify an arbitrary track. So we adopt NTS's
controlled vocabulary as a **shared genre axis** and map the library's free-text
Spotify `Genres` onto it.

- `src/lib/nts-genre-map.ts` is **auto-generated** by `scripts/gen_nts_genre_map.py`
  (exact taxonomy match + a hand-map of the high-frequency residual; ~92% of tagged
  tracks). Regenerate after taxonomy/library changes: `python3
  scripts/gen_nts_genre_map.py`. Exports `NTS_GENRES` (chip order),
  `NTS_GENRE_TOKENS` (bucket -> raw tokens), `NTS_GROUP_TO_TOP` (roll NTS subgenre
  ids up to a top-genre).
- **NTS tab**: `sync_nts.py` stores rolled-up `ntsGenres` on shows/episodes; the
  panel shows chips that filter Hosts + Saved Episodes + host drill-downs.
- **Track library**: an additive "NTS" filter row in `filter-panel.tsx`
  (`filters.ntsGenres`, URL `?nts=`). `ntsGenreClause()` in `queries.ts` expands a
  selected bucket to its raw tokens and matches them **whole-token, comma-anchored**
  against `Genres` (`',' || REPLACE(LOWER(Genres),', ',',') || ','` LIKE
  `'%,token,%'`) so "dub" never bleeds into "dub techno". Applied in
  `buildFilteredTracksQuery`; selecting a chip auto-switches to the Tracks view.
- **Constraint:** the mapping is 100% client-side. The CI-owned `masterlist.csv` and
  its upstream sync are never touched. Note `vibes` (artist-level, `artists.csv`) is a
  separate coarse facet from track-level `Genres` (Spotify), which is the map source.

## Benign console notes (not bugs)

- Mixcloud logs `encrypted-media is not allowed` (it probes for EME/DRM, falls back
  to plain HLS which streams fine).
- A React hydration warning fires on any deep-linked `?tab=` (e.g. `?tab=liked`,
  `?tab=nts`) because the server renders the default tab and the client reads `?tab=`
  from the URL. Pre-existing app pattern; React recovers.
