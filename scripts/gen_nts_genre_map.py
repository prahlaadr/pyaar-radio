import csv, json, urllib.request

tax = json.load(urllib.request.urlopen('https://www.nts.live/api/v2/genres'))
# exact forward map: any NTS top-name or subgenre-name (lowercased) -> top-genre name
fwd = {}
TOPS = []
for g in tax['results']:
    top = g['name']
    TOPS.append(top)
    fwd[top.strip().lower()] = top
    for s in g.get('subgenres', []):
        fwd[s['name'].strip().lower()] = top

T = {t: t for t in TOPS}  # convenience: exact top names
def top(name):  # resolve a partial top label to the real one
    for t in TOPS:
        if t.startswith(name): return t
    raise KeyError(name)

AMBIENT=top('ambient'); ELEC=top('electronica'); HIPHOP=top("hip-hop"); NEWCLUB=top('new club')
UKD=top('uk dance'); HOUSE=top('house'); POSTPUNK=top('post punk'); ALTROCK=top('alternative rock')
ROCK='rock'; METAL='metal'; AVANT=top('avant'); CARIB=top('caribbean'); LATIN=top('latin')
JAZZ='jazz'; SOUL=top('soul'); DISCO=top('disco'); AFRICAN=top('african'); ASIA='asia'
CLASS=top('classical'); OTHER='other'

# hand-map for high-frequency tokens the taxonomy names don't cover verbatim
HAND = {
  'idm':ELEC,'downtempo':ELEC,'future bass':ELEC,'lo-fi beats':ELEC,'lo-fi':ELEC,
  'chillwave':ELEC,'chillstep':ELEC,
  'alternative r&b':SOUL,'r&b':SOUL,'neo soul':SOUL,'indie soul':SOUL,'classic soul':SOUL,
  'quiet storm':SOUL,'motown':SOUL,'retro soul':SOUL,
  'desi':ASIA,'tamil pop':ASIA,'hindi pop':ASIA,'kollywood':ASIA,'telugu pop':ASIA,
  'tamil dance':ASIA,'tollywood':ASIA,'punjabi pop':ASIA,'sufi':ASIA,'kannada pop':ASIA,
  'punjabi hip hop':ASIA,'indian indie':ASIA,'desi hip hop':ASIA,'devotional':ASIA,
  'tamil hip hop':ASIA,'bangla pop':ASIA,'marathi pop':ASIA,'malayalam pop':ASIA,
  'mollywood':ASIA,
  'melodic rap':HIPHOP,'southern hip hop':HIPHOP,'alternative hip hop':HIPHOP,'jazz rap':HIPHOP,
  'east coast hip hop':HIPHOP,'old school hip hop':HIPHOP,'west coast hip hop':HIPHOP,
  'boom bap':HIPHOP,'underground hip hop':HIPHOP,'rage rap':HIPHOP,'lo-fi hip hop':HIPHOP,
  'trap soul':HIPHOP,'crunk':HIPHOP,
  'bass music':UKD,'drumstep':UKD,'breakbeat':HOUSE,'drum and bass':UKD,'uk garage':UKD,
  'liquid funk':UKD,'uk grime':UKD,
  'lo-fi house':HOUSE,'minimal techno':HOUSE,'jazz house':HOUSE,'melodic house':HOUSE,
  'melodic techno':HOUSE,'acid house':HOUSE,
  'nu jazz':JAZZ,'jazz funk':JAZZ,'acid jazz':JAZZ,'experimental jazz':JAZZ,'indie jazz':JAZZ,
  'jazz beats':JAZZ,
  'neo-psychedelic':ALTROCK,'indie':ALTROCK,'alternative rock':ALTROCK,
  'bedroom pop':OTHER,'art pop':OTHER,'baroque pop':OTHER,
  'plunderphonics':AVANT,'electroacoustic':AVANT,'musique concrète':AVANT,
  'afropop':AFRICAN,'afro r&b':AFRICAN,'afroswing':AFRICAN,'afropiano':NEWCLUB,
  'roots reggae':CARIB,
  # residual sweep (2026-08-25): high-frequency tokens that mapped to nothing
  'disco house':HOUSE,'progressive house':HOUSE,'acid techno':HOUSE,'french house':HOUSE,
  'nu disco':DISCO,'post-disco':DISCO,'disco':DISCO,
  'gangster rap':HIPHOP,'chicago drill':HIPHOP,'hardcore hip hop':HIPHOP,
  'progressive rock':ROCK,'post-rock':ALTROCK,'progressive metal':METAL,'djent':METAL,
  'cool jazz':JAZZ,'vocal jazz':JAZZ,'jazz ballads':JAZZ,'brazilian jazz':JAZZ,
  'mpb':LATIN,'urbano latino':LATIN,'latin':LATIN,
  'northern soul':SOUL,'uk r&b':SOUL,'afro soul':AFRICAN,
  'edm trap':NEWCLUB,'miami bass':HOUSE,'ballroom vogue':NEWCLUB,
  'alté':AFRICAN,'azonto':AFRICAN,'hiplife':AFRICAN,'egyptian pop':AFRICAN,'ragga':CARIB,
  'desi pop':ASIA,'hindi indie':ASIA,'hindi hip hop':ASIA,'sandalwood':ASIA,'japanese classical':ASIA,
  'neoclassical':CLASS,'ambient folk':AMBIENT,'space music':AMBIENT,
  'avant-garde':AVANT,'lo-fi indie':ALTROCK,'slowcore':ALTROCK,'electronic':ELEC,
}
fwd.update(HAND)

# scan library tokens, build reverse map top -> sorted set of raw tokens present in data
bucket_tokens = {t: set() for t in TOPS}
tok_count = {}
tot=tagged=0
with open('public/data/masterlist.csv') as f:
    for r in csv.DictReader(f):
        tot+=1
        g=(r.get('Genres') or '').strip()
        if not g: continue
        tagged+=1
        for raw in g.split(','):
            t=raw.strip().lower()
            if not t: continue
            tok_count[t]=tok_count.get(t,0)+1
            if t in fwd: bucket_tokens[fwd[t]].add(t)

covered=0
with open('public/data/masterlist.csv') as f:
    for r in csv.DictReader(f):
        g=(r.get('Genres') or '').strip()
        if not g: continue
        toks={x.strip().lower() for x in g.split(',') if x.strip()}
        if any(x in fwd for x in toks): covered+=1

# Subgenre ontology, scoped to the library. A subgenre is "covered" when a library
# token exactly matches its (trimmed, lowercased) NTS name. Keep the NTS display
# name (original casing) but match on the actual library token.
sub_display = {}   # display name -> top genre
sub_tokens = {}    # display name -> set of matching library tokens
sub_count = {}     # display name -> track-token count (for ordering)
for g in tax['results']:
    for s in g.get('subgenres', []):
        key = s['name'].strip().lower()
        if key in tok_count:
            disp = s['name']
            sub_display[disp] = g['name']
            sub_tokens.setdefault(disp, set()).add(key)
            sub_count[disp] = sub_count.get(disp, 0) + tok_count[key]
# top genre -> its covered subgenres (>=10 songs), ordered by count desc. Sparse
# subgenres roll UP into their top: no dedicated chip, but their songs still
# surface when you pick the top genre (its token set includes them).
MIN_SUBGENRE_SONGS = 10
top_subs = {t: [] for t in TOPS}
for disp, top in sub_display.items():
    if sub_count[disp] >= MIN_SUBGENRE_SONGS:
        top_subs[top].append(disp)
for t in top_subs:
    top_subs[t].sort(key=lambda d: -sub_count[d])

# Per-surface facet presence ("T:top"/"S:sub"): which NTS facets actually have
# songs among (a) liked songs, (b) curated artists' tracks. The filter shows the
# whole-masterlist ontology otherwise, so playlist-only genres (e.g. Luk Thung by
# artists you don't follow) leak in. These scope the chip list per surface.
cur_artists = set()
with open('public/data/artists.csv') as f:
    for r in csv.DictReader(f):
        cur_artists.add((r.get('artist') or '').strip().lower())
        for a in (r.get('aliases') or '').split('|'):
            if a.strip(): cur_artists.add(a.strip().lower())
tok2sub = {}
for disp, tks in sub_tokens.items():
    for tk in tks: tok2sub.setdefault(tk, disp)
facets_liked, facets_browse = set(), set()
with open('public/data/masterlist.csv') as f:
    for r in csv.DictReader(f):
        g = (r.get('Genres') or '').strip().lower()
        if not g: continue
        facets = set()
        for t in (x.strip() for x in g.split(',') if x.strip()):
            if t in fwd: facets.add('T:' + fwd[t])
            if t in tok2sub: facets.add('S:' + tok2sub[t])
        if (r.get('Liked') or '').strip().lower() == 'yes': facets_liked |= facets
        arts = [a.strip().lower() for a in (r.get('Artist Name(s)') or '').replace(';', ',').split(',')]
        if any(a in cur_artists for a in arts): facets_browse |= facets

# emit TS
lines=[]
lines.append("// AUTO-GENERATED by scripts/gen_nts_genre_map.py — do not edit by hand.")
lines.append("// Maps the library's free-text Spotify genre tokens onto NTS's controlled")
lines.append("// top-level vocabulary (nts.live/api/v2/genres). Used to filter the track")
lines.append("// library by NTS genre. Exact taxonomy matches + a hand-map of the")
lines.append("// high-frequency residual. Keys are NTS top-genres; values are the raw")
lines.append("// lowercase tokens (as they appear in the Genres column) that roll up to it.")
lines.append("")
lines.append("export const NTS_GENRES: string[] = [")
for t in TOPS:
    if bucket_tokens[t]:
        lines.append(f"  {json.dumps(t)},")
lines.append("];")
lines.append("")
lines.append("export const NTS_GENRE_TOKENS: Record<string, string[]> = {")
for t in TOPS:
    toks=sorted(bucket_tokens[t])
    if toks:
        lines.append(f"  {json.dumps(t)}: {json.dumps(toks)},")
lines.append("};")
lines.append("")
lines.append("// NTS episode/show genres arrive as subgenre objects whose id is")
lines.append("// `genres-<groupId>-<sub>`. This rolls a groupId up to its top-genre so the")
lines.append("// NTS tab and the track library share one set of filter chips.")
lines.append("export const NTS_GROUP_TO_TOP: Record<string, string> = {")
for g in tax['results']:
    lines.append(f"  {json.dumps(g['id'])}: {json.dumps(g['name'])},")
lines.append("};")
lines.append("")
lines.append("// Drill-down ontology (mirrors nts.live/explore/genre), scoped to the")
lines.append("// subgenres the library actually has. NTS_SUBGENRES[top] = ordered covered")
lines.append("// subgenre display names; NTS_SUBGENRE_TOKENS[sub] = the raw Genres tokens")
lines.append("// that subgenre matches (display name may differ from token, e.g. \"Hip Hop \").")
lines.append("export const NTS_SUBGENRES: Record<string, string[]> = {")
for t in TOPS:
    if top_subs[t]:
        lines.append(f"  {json.dumps(t)}: {json.dumps(top_subs[t])},")
lines.append("};")
lines.append("")
lines.append("export const NTS_SUBGENRE_TOKENS: Record<string, string[]> = {")
for disp in sorted(sub_display, key=lambda d: (sub_display[d], -sub_count[d])):
    lines.append(f"  {json.dumps(disp)}: {json.dumps(sorted(sub_tokens[disp]))},")
lines.append("};")
lines.append("")
lines.append("// Full-taxonomy token→top map (every NTS subgenre + top name, lowercased).")
lines.append("// Used to filter items whose genres are already NTS names (e.g. albums")
lines.append("// enriched from Discogs) regardless of what the track library covers.")
full_t2t = {}
for g in tax['results']:
    full_t2t[g['name'].strip().lower()] = g['name']
    for s in g.get('subgenres', []):
        full_t2t[s['name'].strip().lower()] = g['name']
lines.append("export const NTS_TOKEN_TO_TOP: Record<string, string> = {")
for k in sorted(full_t2t):
    lines.append(f"  {json.dumps(k)}: {json.dumps(full_t2t[k])},")
lines.append("};")
lines.append("")
lines.append("// Per-surface facet presence (\"T:top\"/\"S:sub\") — the NTS facets that")
lines.append("// actually have songs in your liked set / curated-artist library. Used to")
lines.append("// prune the filter chips per surface so playlist-only genres don't show.")
lines.append(f"export const NTS_FACETS_LIKED: string[] = {json.dumps(sorted(facets_liked))};")
lines.append("")
lines.append(f"export const NTS_FACETS_BROWSE: string[] = {json.dumps(sorted(facets_browse))};")
lines.append("")
open('src/lib/nts-genre-map.ts','w').write("\n".join(lines)+"\n")

print(f"coverage: {covered}/{tagged} tagged tracks ({100*covered//tagged}%), {100*covered//tot}% of all {tot}")
print("buckets with tokens:", sum(1 for t in TOPS if bucket_tokens[t]))
print("distinct tokens mapped:", sum(len(bucket_tokens[t]) for t in TOPS))
print("covered subgenres:", len(sub_display), "across", sum(1 for t in TOPS if top_subs[t]), "top genres")
