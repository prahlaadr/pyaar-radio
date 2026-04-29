---
version: alpha
name: Pyaar Radio
description: |
  DJ set planning tool — track library + setlist builder + harmonic mixing
  helper. Currently dark + red + NTS-radio-station register. **A re-theme to
  the warm-cream + monochrome + editorial Pyaar brand direction is pending
  and user-driven.** This file documents the AS-IS state, not the target
  state. See Reality Log for the re-theme decision hooks and observed drift.
colors:
  # Canonical tokens (defined in src/app/globals.css). These are 6 tokens
  # only — the actual codebase has SUBSTANTIAL drift, hardcoding many off-
  # token hex values across components. Drift catalog is in the Reality Log.
  # Mono-theme dark — no light variant.
  background: "#0a0a0b"          # near-black, page bg
  foreground: "#f0f0f0"           # off-white text
  muted: "#999999"                # de-emphasized labels (mid grey)
  border: "#222222"               # dividers
  surface: "#111112"              # card / panel bg
  accent: "#ff0000"               # pure red — live/active/selection only

typography:
  # Tight, dense, utility-first. No serif. No italic emphasis.
  nav-title:
    fontFamily: Rajdhani
    fontSize: 18px              # text-lg
    fontWeight: 600              # semibold tracking-tight
    lineHeight: 1.2
    letterSpacing: -0.015em
  body-md:
    fontFamily: Rajdhani
    fontSize: 14px              # text-sm
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Rajdhani
    fontSize: 12px              # text-xs — track-row, filter pills
    fontWeight: 400
    lineHeight: 1.5
  meta-md:
    fontFamily: Rajdhani
    fontSize: 12px              # uppercase tracking-wider — most labels
    fontWeight: 500
    lineHeight: 1
    letterSpacing: 0.05em
  meta-sm:
    fontFamily: Rajdhani
    fontSize: 10px              # text-[10px] — eyebrow labels, BPM cells
    fontWeight: 500
    lineHeight: 1
    letterSpacing: 0.05em
  meta-xs:
    fontFamily: Rajdhani
    fontSize: 10px              # tracking-widest variant
    fontWeight: 500
    lineHeight: 1
    letterSpacing: 0.1em
  filter-channel:
    fontFamily: Rajdhani
    fontSize: 12px              # text-xs uppercase tracking-wider semibold
    fontWeight: 500
    lineHeight: 1
    letterSpacing: 0.05em
  filter-pill:
    fontFamily: Rajdhani
    fontSize: 10px              # smaller pills (vibes, samay, sections)
    fontWeight: 500
    lineHeight: 1
    letterSpacing: 0.05em
  search-input:
    fontFamily: Rajdhani
    fontSize: 12px              # uppercase tracking-wider placeholder
    fontWeight: 400
    lineHeight: 1
    letterSpacing: 0.05em
  mono-num:
    fontFamily: Geist Mono
    fontSize: 12px              # BPM, durations, counts
    fontWeight: 400
    lineHeight: 1
    fontFeature: '"tnum"'

rounded:
  none: 0px         # filter pills, search inputs — square corners by default
  sm: 2px           # scrollbar thumb radius
  md: 4px           # rounded — view-mode toggles only
  full: 9999px      # status dots

spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  cell-py: 6px      # py-1.5 — track row height ~28px content
  panel-px: 20px    # px-5 — panel horizontal padding
  panel-py: 8px     # py-2 — top-bar vertical padding
  filter-pill-px: 8px    # px-2 — small filter pills (vibes)
  filter-pill-py: 2px    # py-0.5
  filter-channel-px: 12px # px-3 — bigger filter pills (channels)
  filter-channel-py: 4px  # py-1
  touch-min: 36px         # min-w-[36px] min-h-[36px] — icon buttons
  scrollbar-w: 4px

components:
  # ---- Search input ----
  search-input:
    backgroundColor: "#111111"        # off-token, drifted; should be {colors.surface}
    borderColor: "#333333"             # off-token; should be {colors.border}
    textColor: "{colors.foreground}"
    typography: "{typography.search-input}"
    rounded: "{rounded.none}"
    padding: 6px 12px
  search-input-focus:
    # Default focus: red border (matches accent)
    borderColor: "{colors.accent}"

  # ---- Filter pills (multiple modes) ----
  filter-channel-off:
    backgroundColor: "#111111"
    textColor: "{colors.muted}"
    typography: "{typography.filter-channel}"
    rounded: "{rounded.none}"
    padding: 4px 12px
  filter-channel-on:
    # Active channel: high-contrast white-on-black (NOT accent red)
    backgroundColor: "#ffffff"
    textColor: "#000000"
    typography: "{typography.filter-channel}"
    rounded: "{rounded.none}"
    padding: 4px 12px
  filter-vibe-off:
    backgroundColor: "#0a0a0a"
    textColor: "{colors.muted}"
    typography: "{typography.filter-pill}"
    rounded: "{rounded.none}"
    padding: 2px 8px
  filter-vibe-on:
    # Active vibe: red (the accent)
    backgroundColor: "#dc2626"          # bg-red-600 — Tailwind palette, not token
    textColor: "{colors.foreground}"
    typography: "{typography.filter-pill}"
    rounded: "{rounded.none}"
    padding: 2px 8px
  filter-samay-off:
    backgroundColor: "#111111"
    textColor: "{colors.muted}"
    typography: "{typography.filter-pill}"
    rounded: "{rounded.none}"
    padding: 2px 8px
  filter-samay-on:
    backgroundColor: "#ffffff"          # white — same as channel ON
    textColor: "#000000"
    typography: "{typography.filter-pill}"
    rounded: "{rounded.none}"
    padding: 2px 8px

  # ---- Section-mode pills (multi-color taxonomy) ----
  filter-section-tamil-active:
    backgroundColor: "#d97706"          # bg-amber-600 — Tailwind palette
    textColor: "{colors.foreground}"
    typography: "{typography.filter-pill}"
    rounded: "{rounded.none}"
    padding: 2px 8px
  filter-section-downtempo-active:
    backgroundColor: "#0891b2"          # bg-cyan-600
    textColor: "{colors.foreground}"
    typography: "{typography.filter-pill}"
    rounded: "{rounded.none}"
    padding: 2px 8px
  filter-section-ambient-active:
    backgroundColor: "#9333ea"          # bg-purple-600
    textColor: "{colors.foreground}"
    typography: "{typography.filter-pill}"
    rounded: "{rounded.none}"
    padding: 2px 8px
  filter-section-ilaiyaraaja-active:
    backgroundColor: "#dc2626"          # bg-red-600
    textColor: "{colors.foreground}"
    typography: "{typography.filter-pill}"
    rounded: "{rounded.none}"
    padding: 2px 8px

  # ---- View toggles (All / Albums) ----
  view-toggle-off:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.meta-sm}"
    rounded: "{rounded.md}"
    padding: 2px 8px
  view-toggle-on:
    backgroundColor: "#222222"          # = {colors.border} — surface that's the same as outline
    textColor: "{colors.foreground}"
    typography: "{typography.meta-sm}"
    rounded: "{rounded.md}"
    padding: 2px 8px

  # ---- Track row ----
  track-row:
    backgroundColor: transparent
    textColor: "#cccccc"                # off-token; close to but not exactly foreground
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
    padding: 6px 8px
  track-row-hover:
    backgroundColor: "#0a0a0a"          # off-token; deeper than border but not surface
  track-row-now-playing:
    backgroundColor: "#450a0a"          # bg-red-950/40 — Tailwind palette w/ alpha
    textColor: "#f87171"                 # text-red-400 — Tailwind palette

  # ---- Album header (sticky-ish in track list) ----
  album-header:
    backgroundColor: "#0a0a0a"
    textColor: "#888888"                 # off-token
    typography: "{typography.meta-xs}"
    rounded: "{rounded.none}"
    padding: 8px 8px

  # ---- Discover panel ----
  discover-panel:
    backgroundColor: "#060607"           # off-token; deepest surface
    borderColor: "{colors.border}"
    rounded: "{rounded.none}"
  discover-header:
    backgroundColor: "#0a0a0a"
    textColor: "{colors.muted}"
    typography: "{typography.meta-sm}"
    rounded: "{rounded.none}"
    padding: 6px 20px

  # ---- Icon buttons (+, play, ↻) ----
  icon-button:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.meta-sm}"
    rounded: "{rounded.none}"
    width: "{spacing.touch-min}"
    height: "{spacing.touch-min}"
  icon-button-add-hover:
    # + button hover: turns red (the accent)
    textColor: "{colors.accent}"
  icon-button-play-hover:
    textColor: "{colors.foreground}"

  # ---- Back link ----
  back-link:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
  back-link-hover:
    textColor: "{colors.foreground}"

  # ---- BPM input (numeric) ----
  bpm-input:
    backgroundColor: "#111111"
    borderColor: "#333333"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
    padding: 2px 8px
    width: 56px
---

# DESIGN.md — pyaar-radio

Source of truth for visual design on this site. Conforms to the [`google-labs-code/design.md`](https://github.com/google-labs-code/design.md) format spec. Lint with `bunx @google/design.md lint DESIGN.md`.

> ⚠️ **The Pyaar brand direction is warm cream + monochrome + editorial** (see `pyaarproject/DESIGN.md`). Pyaar-radio's current code does not match — it's dark + red + NTS-style. **A re-theme is pending and user-driven.** This DESIGN.md documents the **as-is** state, including substantial drift between the canonical tokens in `globals.css` and the hardcoded values in components. The drift catalog is the most important section for the re-theme; see the Reality Log.

## Overview

**DJ set planning tool — dense, utilitarian, late-night.** Currently rendered in the visual register of an underground UK radio station: pitch-black canvas, off-white text, hairline grey dividers at multiple shades of dark, pure red as the live/active/destructive accent. Square corners, small text, heavy uppercase tracking, virtualized lists.

The re-theme target is to converge on the Pyaar brand direction (warm cream + monochrome + editorial — print-zine, not nightclub). That re-theme will involve significant structural decisions: square→radiused corners, dark→light flip, red removal, multi-color section taxonomy collapse, density relaxation. Don't auto-execute it. Wait for user guidance.

## Colors

The site defines **6 canonical tokens**. The actual codebase contains many off-token hex values; those are not legitimized as tokens here, but every off-token color used in components is documented in the Reality Log catalog.

- **`background` (#0a0a0b):** Near-black canvas. Page bg.
- **`foreground` (#f0f0f0):** Off-white. Body text, headlines, active filter on red.
- **`muted` (#999999):** Mid-grey. De-emphasized labels — most of the UI chrome.
- **`border` (#222222):** Hairline dividers. The lightest dark used as a structural line.
- **`surface` (#111112):** Card / panel bg. Slightly lighter than page (1 unit lift).
- **`accent` (#ff0000):** Pure red. Used **only** for: live/now-playing state, active vibe filters, the + (add to setlist) hover, selection bg, focus borders. Not used decoratively.

**Selection:** `::selection { background: #ff0000; color: #000; }` — red on black, inverted.

**No light variant.** This is mono-theme dark. The re-theme will likely add a light variant or flip entirely.

## Typography

**Rajdhani** (`next/font/google`, weights 300/400/500/600/700) is the only sans. **Geist Mono** for tabular numerics (BPM, durations, key counts). **No serif italic stack** — DJ tool, no editorial register.

The dominant typographic signal is **uppercase tracking-wider** at small sizes. The site speaks in `text-xs` (12px) and `text-[10px]` (10px) labels almost exclusively. `text-sm` (14px) shows up in the nav title and search inputs. `text-lg` (18px) is the artist-name display in the top bar.

- **`nav-title` (18px / semibold / tracking-tight):** Top-bar artist name only.
- **`body-md` (14px) / `body-sm` (12px):** Track names, regular body.
- **`meta-md` (12px / 500 / tracking-wider):** Search input text, button labels, back link.
- **`meta-sm` (10px / 500 / tracking-wider):** Most filter pill labels, BPM cells, count indicators.
- **`meta-xs` (10px / tracking-widest):** Empty-state messaging, "No tracks in library."
- **`mono-num` (12px / Geist Mono / tabular-nums):** BPM column, durations, track counts.

Headings, hero copy, paragraph reading: all absent. This is a tool, not a content site.

## Layout

**No `max-w` containers.** The page fills the viewport. Three-column layout (artist list / track list / setlist) on desktop, single-column reorganization on mobile via overlays.

- **No section padding rhythm.** This is a single-page app, not a marketing site. Components define their own internal padding.
- **Panel padding:** Most lists/panels use `px-5` (20px) horizontal, `py-2`-`py-3` vertical (8-12px). Top bar in track list: `px-5 py-2`.
- **Track table density:** Rows ~28-36px tall (virtualized). Album header rows ~36px. Filter pills `py-0.5` to `py-1` (2-4px).
- **Filter panel:** `px-5 py-3 border-b border-[#222]`. Mobile collapses non-essential filters behind a "Filters (N)" toggle.
- **Sticky elements:** Table headers (`sticky top-0 bg-background`). No sticky nav like the marketing sites.
- **Top bar (within track list):** `px-5 py-2 border-b border-[#222]` — back button + artist name + track count + filter input + view toggles. Tight, utilitarian.
- **Mobile breakpoint:** `md:` (768px) for desktop expansion. `sm:` (640px) for showing/hiding the BPM/Key/Duration columns.

## Elevation & Depth

Depth is by **layered dark surfaces**, not shadows. The site uses a 5-step dark ramp where each step is ~10 units lighter than the last:

| Layer | Hex | Use |
|---|---|---|
| Deepest | `#060607` | Discover panel bg only |
| Page bg | `#0a0a0b` | `--background` |
| Panel deeper | `#0a0a0a` | Track row hover, album header, discover header |
| Surface | `#111112` | `--surface`, search inputs, panels |
| Border | `#151515`, `#222222` | Track row dividers, panel borders |

Notice the heavy off-token use — only `#0a0a0b` and `#111112` and `#222222` are tokens; the rest (`#060607`, `#0a0a0a`, `#151515`, `#333333`) are inline hex.

- **No shadows anywhere.** The dark register doesn't use them.
- **No backdrop-blur.** No glassmorphism.
- **Hover depth:** Track rows hover to `#0a0a0a` (one shade darker than page — barely visible). Buttons hover to lighten foreground color from muted (`#999`) to white (`#fff`).
- **Now-playing depth:** Red overlay (`bg-red-950/40` = `#450a0a` at 40% alpha). The only saturated state.

## Shapes

**Square corners by default.** The radius scale is minimal:

- **`rounded.none` (0px):** All filter pills, search inputs, track rows, panel borders, BPM inputs. The dominant shape.
- **`rounded.md` (4px):** View-mode toggles (All / Albums) only — the lone exception.
- **`rounded.full` (9999px):** Status dots inside cells (harmonic match indicator: `w-1.5 h-1.5 rounded-full bg-green-500`).
- **`rounded.sm` (2px):** Custom scrollbar thumb radius only.
- **Strokes:** `1.5px` for the hamburger / close icons. SVG arrows (↻, ▶, +) use plain text glyphs not SVG.
- **Custom scrollbar:** 4px wide, `#333` thumb, `#555` on hover (NTS-style — extra-thin scrollbars). Uses literal hex, not tokens.

## Components

This site has more components than the marketing sites because it's an interactive tool. Focus is on filter pills (multiple modes), track rows, and panel headers.

### Search input

- Standard: `bg-[#111] border border-[#333] px-3 py-1.5 text-xs uppercase tracking-wider placeholder-[#999] focus:outline-none focus:border-red-500`
- Width: `w-40 sm:w-52` (track list filter), `flex-1` (filter panel main search).
- Section-aware focus border: red (default) / amber (Tamil) / cyan (Downtempo) / purple (Ambient) — see Section taxonomy below.

### Filter pills

| Variant | OFF state | ON state |
|---|---|---|
| **Channel** (Rave / Rap / Soul) | `bg-[#111] text-[#999] hover:text-white px-3 py-1 text-xs uppercase tracking-wider` | `bg-white text-black` |
| **Samay** (Day / Night / Day-Night) | `bg-[#111] text-[#999] hover:text-white px-2 py-0.5 text-[10px]` | `bg-white text-black` |
| **Vibe** (Groove, Soulful, Rowdy …) | `bg-[#0a0a0a] text-[#999] hover:text-[#ccc] px-2 py-0.5 text-[10px]` | `bg-red-600 text-white` |
| **Desi** | `bg-[#111] text-[#999] hover:text-white` | `bg-red-600 text-white` |

Channels and samay use **white-on-black** for ON state (utilitarian high-contrast). Vibes and Desi use **red-on-white-text** for ON state. Distinction is intentional: channels/samay are filtering taxonomy, vibes/desi are mood/cultural marking.

### Section-mode taxonomy (multi-color)

`/tamil`, `/downtempo`, `/ambient`, `/tamil/ilaiyaraaja` are sub-modes of the app. Each has a distinct accent color:

| Section | Color (Tailwind) | Hex |
|---|---|---|
| Tamil | `amber-600` | `#d97706` |
| Downtempo | `cyan-600` | `#0891b2` |
| Ambient | `purple-600` | `#9333ea` |
| Ilaiyaraaja | `red-600` | `#dc2626` |

In each mode, filter inputs adopt the section color (`focus:border-{color}-500`), section-toggle buttons paint with `bg-{color}-600 text-white`, and links/labels offer a `hover:text-{color}-400` tint. **This is the most significant single re-theme decision** — the four-color taxonomy is the entire opposite of the monochrome warm-cream direction. Re-theme must collapse to a single accent, encode taxonomy via labels/badges instead of color, or formally except this as "categorical color allowed for app-mode."

### Track row

- Default: `border-b border-[#111] hover:bg-[#0a0a0a] cursor-pointer`. Cells: `px-2 py-1.5` for track name, `px-3 py-1.5` for numerics.
- Track name: `text-[#ccc] group-hover:text-white text-xs`.
- Genre subline: `text-[10px] text-[#999]`.
- Numerics (BPM, key, duration): `text-[#aaa]` for BPM, `text-[#888]` for key/duration. `tabular-nums`.
- Now-playing override: `bg-red-950/40 text-red-400`.
- Swipe-flash override (mobile): `bg-green-900/30` (added to setlist), `bg-blue-900/30` (preview play). The two non-red saturated colors used in the app.
- Touch interactions: tap to play, double-tap to add, swipe right to add (green flash), swipe left to play (blue flash). Documented in `track-list.tsx`.

### Album header (within track list)

- `bg-[#0a0a0a] border-b border-[#222] px-2 py-2`
- Album name: `text-[10px] text-[#888] uppercase tracking-wider`
- Year: `text-[10px] text-[#666] ml-2`
- Count: `text-[10px] text-[#888] ml-2`

### Discover panel

- Container: `bg-[#060607] border-b border-[#222]` — the only place the deepest dark shade appears.
- Header strip: `bg-[#0a0a0a] px-5 py-1.5 border-b border-[#222]` with "Discover" label and shuffle button.
- Items use the same track-row visual language but with `border-b border-[#151515]` (a 4th-tier divider).
- Shuffle button: `text-[#888] hover:text-white` with `↻` (refresh) glyph.

### Icon buttons (+, ▶, ↻)

- All use **glyphs** (`+`, `&#9654;`, `&#8635;`), not SVG icons.
- Container: `min-w-[36px] min-h-[36px] flex items-center justify-center` for touch.
- Default: `text-[#999]`. Add (+) hover: `hover:text-red-500`. Play (▶) hover: `hover:text-white`.

### View toggles (All / Albums)

- Container: `flex gap-1 text-[10px] uppercase tracking-wider`.
- OFF: `px-2 py-0.5 rounded text-[#999] hover:text-white`.
- ON: `px-2 py-0.5 rounded bg-[#222] text-white` — the only place `bg-[#222]` is used as a highlighted state. Notably, `#222` is the same value as `--border` — semantically different roles share the same value.

### BPM range input

- Numeric input pair: `w-14 px-2 py-0.5 bg-[#111] border border-[#333] text-xs text-white`.
- Range separator: em-dash (`&mdash;`).
- "×2" half-time toggle button next to it (only when range is active).

### Status dots (harmonic match indicators)

- Perfect/harmonic match: `w-1.5 h-1.5 rounded-full bg-green-500`.
- Energy match: `w-1.5 h-1.5 border border-yellow-500 rounded-full`.
- The only green/yellow in the app — small, semantic, info-bearing.

## Do's and Don'ts

**Do**
- Reference the 6 canonical tokens for new code (`background`, `foreground`, `muted`, `border`, `surface`, `accent`).
- Maintain `min-w-[36px] min-h-[36px]` on icon buttons for touch.
- Use `tabular-nums` (Geist Mono) on all numerics (BPM, key, duration).
- Prefer uppercase tracking-wider for labels — it's the established register.
- Use red sparingly — only for live/active/destructive state (now-playing, active vibe filter, + on hover).

**Don't (current rules — will change post-re-theme)**
- Don't introduce a new background lighter than `#222`. The dark ramp is the rhythm.
- Don't add rounded corners to filter pills. Square is the look.
- Don't use serif typography. Rajdhani-only.
- Don't use shadows or backdrop-blur — neither fits the register.
- Don't introduce additional section colors (currently amber/cyan/purple/red — already too many; flagged for re-theme).

**Don't (forward-compatible — anticipating re-theme)**
- Don't add new components hardcoding off-token hex if you can use a token. The drift catalog already has too many entries.
- Don't add new red-themed states. The re-theme will likely remove red entirely.

---

## Audit Protocol *(non-standard section)*

When asked to **"audit"** or **"design audit"**:

1. Scan `src/` for UI components and styles — `globals.css`, Tailwind classes, inline hex (especially `bg-[#...]`, `text-[#...]`, `border-[#...]` arbitrary values, plus any `bg-red-XXX`, `bg-amber-XXX`, etc. Tailwind palette usage).
2. Compare against the YAML tokens, components, and rules above.
3. Append findings to **Current Reality Log** below — date-stamped, discrepancies as bullets. **No code changes yet.**
4. Wait for explicit signal before fixing.

Lint with the framework CLI:

```bash
bunx @google/design.md lint DESIGN.md
```

## Current Reality Log *(non-standard section)*

### 2026-04-28 — Baseline + framework conversion + drift catalog

**Tokens captured from `src/app/globals.css`** — only 6 canonical tokens (`background`, `foreground`, `muted`, `border`, `surface`, `accent`). Mono-theme dark. No light variant.

**SUBSTANTIAL DRIFT — heavy hardcoded hex outside the token system.** This is the most important section for the re-theme. Catalog of every off-token value observed across components:

#### Drift colors (sorted by frequency / position in the dark ramp)

| Hex | Used as | Where it appears |
|---|---|---|
| `#060607` | Deepest dark | Discover panel bg (only) |
| `#0a0a0a` | Hover bg, panel deeper | Track row hover, album header, discover header — appears 8+ times |
| `#0a0a0b` | (= `--background`, token) | Page bg |
| `#111` / `#111111` / `#111112` | Surface | Search inputs, BPM inputs, off-state filter pills (channel, samay, desi) — appears 12+ times |
| `#151515` | Mid-tier divider | Discover-panel item dividers |
| `#222` / `#222222` | Border + active view-toggle bg | Most panel/section borders, track-list top-bar border, view-toggle ON bg — appears 10+ times. **Same value used for both `--border` and as a "highlighted" surface — semantically conflicting.** |
| `#333` / `#333333` | Search/input border | Form input borders, scrollbar thumb |
| `#555` | Scrollbar hover | Custom scrollbar `:hover` |
| `#666` | Year text | Album header year |
| `#888` | Album header text, dur/key | Track row dur/key cells, album info |
| `#999` / `#999999` | (= `--muted`, token) | Most label / off-state pill text |
| `#aaa` / `#aaaaaa` | BPM cell text | Track row BPM column |
| `#ccc` / `#cccccc` | Track-name text | Default track row text — **almost foreground but not quite** |
| `#f0f0f0` | (= `--foreground`, token) | Body text, headlines |

#### Drift colors (Tailwind palette — semantic / non-monochrome)

| Tailwind class | Hex | Used for |
|---|---|---|
| `bg-red-600` | `#dc2626` | Active vibe filter, Desi ON, Ilaiyaraaja section |
| `bg-red-950/40` | `#450a0a@40%` | Now-playing track row bg |
| `text-red-400` | `#f87171` | Now-playing track name, section hover hint |
| `text-red-500` | `#ef4444` | Add-to-setlist (+) button hover, focus ring |
| `bg-amber-600` / `text-amber-400` / `focus:border-amber-500` | `#d97706` etc. | Tamil section mode |
| `bg-cyan-600` / `text-cyan-400` / `focus:border-cyan-500` | `#0891b2` etc. | Downtempo section mode |
| `bg-purple-600` / `text-purple-400` / `focus:border-purple-500` | `#9333ea` etc. | Ambient section mode |
| `bg-green-500` | `#22c55e` | Harmonic match dot |
| `bg-green-900/30` | `#14532d@30%` | Swipe-right flash (added to setlist) |
| `bg-blue-900/30` | `#1e3a8a@30%` | Swipe-left flash (preview play) |
| `border-yellow-500` | `#eab308` | Energy match dot border |

#### Components-not-yet-audited

This audit covered: `globals.css`, `layout.tsx`, `track-list.tsx`, `filter-panel.tsx`, `page.tsx` (partial — file is 2000+ lines and will need its own pass). **Not yet covered:**

- `setlist.tsx`, `setlist-picker.tsx`, `playlist-picker.tsx` (likely additional drift)
- `tv-player.tsx`, `tv-guide.tsx` (TV mode UI)
- `youtube-player.tsx`, `import-modal.tsx`
- `artist-list.tsx`, `library-track-list.tsx`, `section-track-list.tsx`
- Sub-page layouts: `/tv`, `/login`, `/radar`, `/crate`, `/tamil`, `/downtempo`, `/ambient`

Next audit pass should walk these and append to this log.

#### Re-theme decision hooks (priority order)

When the user is ready to drive the re-theme, these are the structural decisions in rough order of impact:

1. **Mono-theme dark → light/dark themed?** The Pyaar brand direction is warm cream (light). Pyaar-radio could either flip entirely to light or add a light variant alongside the existing dark. DJ tools historically benefit from dark in low-light DJing contexts; consider a switch.
2. **Red accent → none?** The brand direction is monochrome (accent = foreground). Red currently encodes liveness, active state, and add-to-setlist. Each role needs a non-color encoding (weight, italic, position, indicator dot).
3. **Multi-color section taxonomy → ?** Amber/cyan/purple/red for Tamil/Downtempo/Ambient/Ilaiyaraaja. Options: collapse to monochrome with text labels, restrict to a small approved palette (warm-cream tints), or formally except as "categorical color for app modes."
4. **Square corners → radiused?** The pyaarproject brand uses `rounded.lg` (8px) on buttons/inputs. Re-theme could round filter pills and inputs without changing density.
5. **Typography stays Rajdhani (matches pyaarproject)** but currently lacks the serif italic emphasis. Consider adding `<em>` styling and editorial section labels for tonal consistency with the brand.
6. **Drift cleanup — collapse the 14+ hardcoded hex values to the 6 tokens (or extend the token set deliberately).** Most of `#0a0a0a` should be `surface-alt`, most of `#333` should be `border`, etc. This alone is substantial.
7. **Density relaxation?** Re-theme could keep DJ-tool density (necessary for table-based UIs) while softening visual weight via lighter shades and warmer tones.

### 2026-04-28 — Format conversion

- Restructured to conform to the `google-labs-code/design.md` spec. YAML frontmatter added with structured tokens (6 colors, 10 typography scales, 4 rounding levels, 14 spacing tokens, 25 components). Section order canonicalized: Overview → Colors → Typography → Layout → Elevation & Depth → Shapes → Components → Do's and Don'ts. Custom Audit Protocol / Reality Log sections appended as non-standard.
- The 6 canonical color tokens come directly from `globals.css` (already hex). All off-token hex values used in components are documented inline (`backgroundColor: "#111111"` etc.) and cataloged in the Reality Log — they are NOT promoted to tokens because doing so would legitimize the drift and make the re-theme harder.
- Mono-theme dark — no `dark-*` token block (no light variant exists).
