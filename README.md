# Portal Valley — dual-monitor animated wallpaper

A single self-contained HTML file. Open **`Portal_Valley_Wallpaper.html`** in
any modern browser, or point a wallpaper engine (Lively, Wallpaper Engine,
Plash, `xwinwrap`, …) at it.

A painted valley runs continuously across your monitors, changing biome from
left to right — deep rainforest, a waterfall gorge at the centre of the span,
then terraced fields and a stilt village. Pixel-art fighters run along the top
edge of the taskbar; guests drop in from a slowly turning **pentagonal portal
in the sky, rendered with three.js, which is the sun by day and the moon by
night** and keeps real hours: rising on the left, peaking at midday or
midnight, setting on the right. The whole scene follows the clock — stars and
lit hut windows at night, a violet cast at dawn and dusk.

Works fully offline. Fonts and three.js are embedded; with guests off it makes
no network request at all.

## Setup — spanning two screens

The wallpaper adapts to whatever window it is given, so spanning is decided
by **one setting in your wallpaper engine**, not in the file:

**Lively:** Settings → Wallpaper → **Placement → Span across all displays**,
then apply the wallpaper. Lively then hands it one window covering both
monitors and the valley runs continuously across them — one sun, one gorge
(nudged so it never straddles the bezel), fighters and flyovers crossing
freely. Lively's default placement is *Per display*, which duplicates the
whole valley on each monitor — if that happens, this is the setting to
change. The wallpaper detects that situation itself (two displays, window
only one wide) and shows a one-time note saying exactly this.

Also set *Wallpaper input* to Desktop so the **H**/**L** hotkeys reach it.
For the screensaver, Lively's one-time `.scr` setup applies (Library →
Active Wallpapers → Screensaver).

**Engines that can't span** (or if you prefer per-display windows): give
each monitor its own instance — `?screen=left&seed=7` and
`?screen=right&seed=7`. Each renders its own slice of the same valley; the
same `seed` on both is what makes the halves match across the bezel.
`?panel=0/1/2` extends this to three or more monitors (with `?screens=3`).

The Windows lock screen only takes a still image — pre-rendered stills are in
`lockscreen/`, or render your own with `node tools/export.js 3440x1440`.

## The world is rolled, not scripted

Each machine rolls a **world seed** on first run and keeps it: where the
gorge sits, which side the rainforest holds, how dense the village is, every
tree and hut placement. `?seed=7` reproduces a specific valley — pass the
same seed to both instances if you run per-monitor mode, so the halves match.

Behaviour is procedural too. Every fighter appearance rolls a personality —
aggression, mischief, sociability, courage, showmanship — and what happens
when two meet is **scored, not scripted**: the same pair might duel, spar as
friends, wrestle, greet each other with a hop, play piggyback, gang up, give
chase, or one may simply flee a much stronger opponent. Fight cadence itself
comes from the personalities in it.

## What happens down there

* **Four fighters** at a time from a roster of thirty drawn characters,
  plus live guests. Casting is a shuffled bag, so no two on screen repeat.
  The cast includes a hero wing: STARDUST and BLACK TERROR are real
  public-domain golden-age heroes (Fox Features and Nedor, 1940s — the
  originals belong to everyone now), joined by originals on modern
  super-archetypes — FORGE-1 the armoured inventor (jets over traffic,
  golden repulsor strikes), RAMPAGE the gamma brute, STORMHAMMER the storm
  god (lightning strikes), and ARACHNE the spider acrobat (blinks past).
  There are no open-source Marvel characters — Marvel is Disney IP — which
  is exactly why the public-domain forties heroes are here instead.
* **Guests** arrive through the portal: the pentagon flares, a beam opens —
  golden by day, silver by night — and they drop out of the sky. Default
  source is `mix` (RoboHash robots + PokéAPI creatures); `?guests=off` for
  a fully offline wallpaper. Sprites are trimmed and scaled so everyone
  stands the same height.
* **Encounters**: duels, wrestling, piggybacks, two-on-one gang-ups, and the
  outnumbered fighter's ultimate. Losers topple and leave a headstone or
  cross for 30 seconds. Everyone fighting wears a nameplate.
* **Monster raids**: every minute or two, skeletons, kobolds, bugbears,
  ghouls or ogres crawl out of the forest — occasionally led by a **boss**,
  half again as big with three times the hp. Every hero on screen drops what
  they are doing, converges, and they cut the raiders down together. Kills
  share experience with everyone who joined the hunt; monsters burst rather
  than leaving graves. `?raids=0` for peace.
* **Progression**: wins earn levels — cape, better weapon, evolution with
  wings at 3, plates and shield, bulk, and a crowned final form at 6 that
  stays on the field and is befriended or avoided. Press **L** for the
  standings; progress survives reloads.
* **Passing moves**: vault, wing-glide, jetpack, or blink past oncoming
  traffic. Heroes with a signature exit prefer it.
* **Creature balls**: creatures from the portal sometimes land still packed
  in a capture ball that sits glinting in the grass. A passing fighter picks
  it up and hurls it at someone — bowling them over — and the creature bursts
  out on impact. Creatures fight raiders with typed elemental attacks judged
  from their own colours (embers, water, leaves, sparks, psychic motes), and
  a killing blow **evolves** them: their real next form is looked up live and
  the sprite swaps mid-scene (Pikachu comes back as Raichu), with a
  growth-only evolution as the offline fallback.
* **Flyovers**: an eagle, a dragon, or a giant insect occasionally crosses
  the sky and drops a treasure chest. Whoever reaches it first opens it —
  an XP cache, a swiftness draught, or a giant's elixir that works exactly
  like it sounds.

## Settings

**H** opens the panel; **L** the leaderboard. Everything is a URL parameter
too — `Copy URL` bakes the current settings into a link:

| Parameter  | Default | Notes |
|------------|---------|-------|
| `screens`  | `2`     | Monitors the wallpaper spans (1–6) |
| `panel` / `screen` | – | Per-monitor mode: `screen=left/right` or `panel=N` |
| `count`    | `4`     | Fighters on screen (1–16); raiders are extra |
| `scale`    | `2`     | Sprite pixel scale (fighters ≈ `28 × scale` px tall) |
| `taskbar`  | `48`    | Your taskbar height — the ground line sits on it |
| `fps`      | `60`    | Frame cap |
| `guests`   | `mix`   | `mix`, `robohash`, `pokeapi`, `endpoint`, `off` |
| `duels`    | `1`     | `0` = nobody fights at all |
| `raids`    | `1`     | `0` = no monsters |
| `levels`   | `1`     | Progression on/off; `seedxp=14` previews final forms |
| `portal`   | `1`     | `0` = everyone walks in from the edges |
| `ambient`  | `1`     | Follow the real clock; `hour=22` pins any time of day |
| `seed`     | auto    | World seed; rolled once per machine, `seed=N` reproduces a valley |
| `still`    | `0`     | Non-zero renders one composed, deterministic frame |
| `grain`    | `0`     | Scanline overlay, off by default for the valley |
| `maxDpr`   | `2`     | Device-pixel-ratio ceiling |

## Guest sources and licensing

`mix` pulls half RoboHash (CC-BY — credit Zikri Kader, Hrvoje Novakovic,
Julian Peter Arias, David Revoy if you redistribute) and half PokéAPI
(Nintendo artwork — fine on a personal desktop; think before shipping it
anywhere public). `endpoint` uses your own hosted roster: put an https URL in
`assets/guests-endpoint.txt`, rebuild, and serve the manifest documented in
`assets/guests.example.json`. Test locally with `node tools/guest-server.js`.
Every failure path is silent — bad network simply means the built-in cast.

## Performance

The valley is painted once per resize (and re-tinted every ten minutes as the
light changes); only the animation strip redraws per frame; every fighter is
one `drawImage` from a pre-baked sheet. The three.js portal renders a small
transparent canvas at 30fps, measures its own cost, and drops to a lazy
twice-a-second spin on machines without GPU acceleration. The page pauses
when hidden.

## Editing

`Portal_Valley_Wallpaper.html` is generated — edit `src/` and run:

    python3 tools/build.py

`tools/preview.js` screenshots it headlessly; `tools/spritesheet.js` renders
the fighter contact sheet (`?debug=1`); `tools/export.js` renders lock-screen
stills.
