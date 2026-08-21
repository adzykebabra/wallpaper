# Bluerydge Arena — dual-monitor animated wallpaper

A single self-contained HTML file. Open
**`Bluerydge_Arena_Wallpaper.html`** in any modern browser, or point a
wallpaper engine (Lively, Wallpaper Engine, Plash, `xwinwrap`, …) at it.

Pixel-art fighters run along the top edge of the taskbar, right across both
screens — four at a time, drawn from a roster of sixteen so you rarely see
the same one twice in a row. When two meet head-on they duel; the loser goes
down and leaves a headstone or a cross that stands for thirty seconds before
fading. The Bluerydge mark sits centred on each monitor, over the brand's
hex-lattice and halftone background.

No network access, no frameworks, no build step required — the fonts are
embedded as base64 woff2, so it renders identically offline.

## Setup

**One instance spanning both monitors** (the default). Nothing to
configure — the wallpaper divides the desktop into two panels and puts a
logo on each. If you run three or four screens, add `?screens=3`.

**One instance per monitor** — for engines that drive each display
separately. Give the left screen `?screen=left` and the right one
`?screen=right` (or `?panel=0`, `?panel=1`, … for more than two). Each
window then renders its own slice of the same wide scene, so the skyline
and floor line up across the bezel. The two instances keep independent
clocks, so a fighter crossing the seam won't match up frame-for-frame.

## Lively Wallpaper

**As a wallpaper.** Lively → **+** (Add Wallpaper) → paste the path to
`Bluerydge_Arena_Wallpaper.html`, or drag the file into the window. Choose
**Web page** if prompted. To pass settings, either append them to the file
path (`…\Bluerydge_Arena_Wallpaper.html?taskbar=40&count=6`) or just press
**H** on the running wallpaper — Lively forwards keyboard input and the
choices are saved locally.

Under Lively → Settings → **Wallpaper**, set *Wallpaper input* to
**Desktop** so the H key reaches the page, and pick your span behaviour:
*Same wallpaper on all screens* vs *Span across all screens*. Span mode
pairs with the default `screens=2`; per-screen mode pairs with
`?screen=left` / `?screen=right`.

**As a screensaver.** Lively can run this animated page as a real Windows
screensaver — no static image needed. It is a one-time setup:

1. In Lively, go to **Library → Active Wallpapers → Screensaver**, and click
   *One time setup required to run screensaver*.
2. That points you at `lively_utility_screensaver.zip`. Extract it, copy the
   `.scr` file to `C:\Windows\Lively.scr`, right-click it and choose
   **Install**.
3. Windows opens its Screen Saver settings — pick **Lively**, set your wait
   time, **OK**.

Two caveats worth knowing: on the **Microsoft Store** build of Lively, the
app has to stay running in the background for the screensaver to fire (the
installer build doesn't need this), and some antivirus tools flag any `.scr`
as a false positive.

For screensaver duty add **`?drift=1`**. The logo then creeps slowly around
its position over a few minutes, so an OLED never bakes a static wordmark
into the panel. The fighters already move constantly, and the scene is dark,
which is what Lively's own docs recommend for burn-in.

## Lock screen

The Windows lock screen only accepts a **static image** — no engine, Lively
included, can run HTML there. Pre-rendered stills are in `lockscreen/`:

    lockscreen/bluerydge_arena_1920x1080.png
    lockscreen/bluerydge_arena_2560x1440.png
    lockscreen/bluerydge_arena_3440x1440.png
    lockscreen/bluerydge_arena_3840x2160.png

**Settings → Personalization → Lock screen → Personalize your lock screen →
Picture → Browse photos**, and pick the one matching your primary monitor.
The same file works under *Background → Picture* if you ever want a static
desktop too.

These are not screenshots — `?still=<seed>` composes the frame deliberately:
fighters spaced evenly, strides varied, a duel staged off-centre, and the
logo dropped to 58% height so the Windows clock doesn't land on it. The same
seed always renders the same image.

To render your own size, or a different composition:

    npm install --no-save playwright
    node tools/export.js 3440x1440
    SEED=12 COUNT=10 LOGOY=0.62 node tools/export.js

## Brand artwork

The background is drawn from the Bluerydge placemat's own visual language —
near-black navy, a loose hex lattice, halftone dot fields biased to the panel
edges, node-and-connector detail — and the centred lockup is the hexagon mark
(crimson outer ring, cyan inner ring, upward chevron) over the wordmark. It is
all drawn in vector/canvas, so it stays sharp from 1080p to 4K.

### Dropping in the real artwork

Two slots, both optional. Put a file in `assets/` and rebuild:

    python3 tools/build.py

| File | Replaces |
|------|----------|
| `assets/logo.svg` (or `.png`/`.webp`/`.jpg`) | The drawn lockup — your exact mark, on every monitor |
| `assets/placemat.png` (or `.svg`/`.webp`/`.jpg`) | The whole centred card, including the photo strips |

The build inlines whichever it finds as a data URI, so the wallpaper stays a
single offline file. A placemat wins over a logo; a logo wins over the drawn
mark. Nothing else changes — the fighters still run along the taskbar in
front. Delete the file and rebuild to go back to the drawn version.

**Prefer `.svg` for the logo.** A vector lockup stays sharp from a 1080p
laptop to a 4K panel; a small PNG will be upscaled and go soft.

## Fallen fighters

Losing a duel is fatal. The loser is knocked back, topples, fades, and a
marker rises where they fell — a stone headstone or a wooden cross, picked at
random, glowing faintly in that fighter's colour with their name above it for
a few seconds. Markers stand for **30 seconds**, fade over the last two, and
are capped at ten so the strip never fills up. A replacement fighter walks on
straight away, so there are always four.

Set `?duels=0` if you would rather nobody fought at all.

## Guest fighters

The wallpaper can draft extra fighters from a live source. **It does nothing
unless you ask it to** — the default makes no network request of any kind,
which is verified in the checks.

    ?guests=robohash    endless procedurally generated robots and monsters
    ?guests=pokeapi     ~490 creature sprites
    ?guests=endpoint    your own roster (default; inert until configured)
    ?guests=off         never touch the network

### Which sources actually work

The constraint is not the API, it is the sprite. To run along the taskbar at a
uniform height a character needs a **transparent background and a full body** —
then it can be trimmed to its content and scaled. An opaque portrait renders as
a floating rectangle. Checked directly:

| Source | Auth | CORS | Sprite | Usable |
|--------|------|------|--------|--------|
| [RoboHash](https://robohash.org) | none | `*` | 128px RGBA, transparent, full body | **yes** |
| [PokéAPI](https://pokeapi.co) | none | `*` | 96px palette PNG with alpha, full body | **yes** |
| [DiceBear](https://dicebear.com) | none | `*` | transparent SVG, but bust/head only | heads only |
| [Rick and Morty API](https://rickandmortyapi.com) | none | `*` | **JPEG — no alpha**, opaque portrait | no |
| Superhero API | key | — | photographic | no |

There is no single "characters from every universe" sprite database with an
open API and clean licensing — that does not exist. RoboHash is the closest
thing to endless, because every seed string is a distinct character.

### Licensing, before you ship this

* **RoboHash** images are CC-BY. Free for commercial use **with attribution** —
  the robot sets are by Zikri Kader, the monsters by Hrvoje Novakovic, and the
  other sets by Julian Peter Arias and David Revoy. Credit them wherever this
  wallpaper is distributed.
* **PokéAPI** serves Nintendo/Game Freak artwork. Fine on your own desktop;
  putting it on a company-branded wallpaper that clients might see is a
  trademark and copyright question for someone at Bluerydge to answer, not a
  technical one. It is opt-in for that reason.
* For a commercial deployment the clean options are a **CC0 pack**
  ([Kenney](https://kenney.nl), OpenGameArt filtered to CC0) served from your
  own host, or artwork you commission — either way via `?guests=endpoint`.

### Your own roster endpoint

Put your URL in `assets/guests-endpoint.txt` (see the `.example` beside it)
and rebuild. It must be `https://`; `http://localhost:PORT` is accepted for
local testing and the build prints a warning so a dev build is never shipped
by accident.

### Manifest

    {
      "version": 1,
      "hosts": ["cdn.bluerydge.com"],
      "characters": [
        { "name": "SENTINEL",
          "sprite": "https://cdn.bluerydge.com/arena/sentinel.png",
          "color": "#50c8ff",
          "scale": 1, "speed": 1, "ranged": false }
      ]
    }

| Field    | Required | Notes |
|----------|----------|-------|
| `name`   | yes | Shown on duel plates and gravestones. Trimmed to 14 printable ASCII chars, uppercased |
| `sprite` | yes | PNG/WebP with transparency, or a `data:` URI. Relative URLs resolve against the endpoint |
| `color`  | no  | `#rrggbb` glow colour. **Omit it and it is sampled from the sprite's own pixels** |
| `scale`  | no  | 0.5–1.6, relative to a standard fighter |
| `speed`  | no  | 0.4–2.0 |
| `ranged` | no  | Whether they take pot-shots |
| `hosts`  | no  | Extra hosts sprites may load from, besides the endpoint's own |

Sprites are trimmed of transparent margin so their feet land on the floor
line, scaled to fighter height, and given a neon halo in their colour.
Nearest-neighbour is used when upscaling and bilinear when downscaling, so
pixel art stays crisp and large art stays smooth.

### What it does and doesn't do

Guests are **a single still image**, so they cannot have a real run cycle the
way the built-in sixteen do — those are drawn skeletons with articulated
limbs and eighteen baked frames each. Guests get procedural motion instead:
a bounding hop, squash on the footfall, a little tilt, a lunge to attack.
At 56 px tall this reads correctly. Everything else treats them identically —
they enter the shuffled bag, duel, die, and leave a gravestone.

### Behaviour and limits

* Fetched on startup, then re-polled every 30 minutes, and only while the
  page is visible.
* The last good roster is cached in `localStorage`, so guests still appear
  when the machine boots offline.
* Sprites must be `https` and come from the endpoint's own host or one named
  in `hosts`. Never plain `http`, except a local dev endpoint pointing at
  itself.
* Capped at 24 guests per session. Names are stripped to printable ASCII and
  are only ever drawn with `fillText` — no manifest value reaches `innerHTML`.
* Every failure is silent: no endpoint, no network, bad JSON, a dead host, a
  broken image — you just get the built-in sixteen.
* Guests are only ever added during a session, never removed, so a mid-session
  refresh can't shift a fighter out from under itself. Retired guests simply
  stop being drafted.

Test it without deploying anything:

    node tools/guest-server.js 8777
    echo "http://localhost:8777/roster.json" > assets/guests-endpoint.txt
    python3 tools/build.py

## Settings

Press **H** over the wallpaper for the settings panel — monitors, fighter
size, taskbar height, crowd, frame cap, and toggles for duels, logo and
scanlines. Changes save to `localStorage`, and **Copy URL** gives you a link
with the same settings baked in, which is what a wallpaper engine wants.

Every setting is also a URL parameter:

| Parameter  | Default | Notes |
|------------|---------|-------|
| `screens`  | `2`     | Monitors the wallpaper spans (1–6) |
| `panel`    | `-1`    | `-1` draws the whole span; `0`,`1`,… draw one monitor |
| `screen`   | –       | Shorthand: `left` = `panel=0`, `right` = `panel=1` |
| `count`    | `4`     | Fighters on screen at once, across the whole span (1–16) |
| `scale`    | `2`     | Sprite pixel scale. Fighters are `28 × scale` px tall, so `2` ≈ 56 px |
| `taskbar`  | `48`    | Height of your taskbar in px — the fighters run on this line |
| `fps`      | `60`    | Frame cap. Drop to `30` on a laptop |
| `duels`    | `1`     | Set `0` for a plain parade — nobody duels, nobody dies |
| `logo`     | `1`     | Set `0` to hide the wordmarks |
| `logoy`    | `0`     | Logo height as a fraction of the screen; `0` = automatic |
| `drift`    | `0`     | Slowly creep the logo around — OLED burn-in insurance |
| `grain`    | `1`     | Scanline overlay |
| `guests`   | `endpoint` | Guest source: `endpoint`, `robohash`, `pokeapi`, or `off` |
| `card`     | `1`     | Show the placemat card; `0` falls back to the bare lockup |
| `still`    | `0`     | Non-zero freezes a composed frame, using the value as its seed |
| `maxDpr`   | `2`     | Device-pixel-ratio ceiling |

Match `taskbar` to your own bar (Windows 11 ≈ 48, Windows 10 ≈ 40, a hidden
bar ≈ 0) so the fighters land exactly on its top edge.

## Roster

RONIN-9 · VECTOR-X · SIR AEGIS · LUPUS · URSOK · MALPHAX · NOVA-7 ·
KESTREL · IRONCLAD · SERAPH · VIPER · GLACIA · EMBER · RAVEN · ZEPHYR ·
OBSIDIAN

Humanoids, two beasts and a hover drone, each with its own silhouette,
palette, weapon and gait, drawn as pixel art rather than glowing vectors so
they stay legible at 56 px tall.

Only four are on screen at a time, and casting draws from a shuffled bag
rather than at random — so no two on screen are ever the same fighter, and
all sixteen appear before any of them comes round again.

## How it performs

The previous build re-stroked every limb with `shadowBlur` onto a
4096×1152 canvas sixty times a second and forced a React re-render on every
hit. This one:

* paints the background **once** into its own canvas and repaints it only on
  resize;
* clears and redraws **only the bottom strip** each frame — roughly an eighth
  of the desktop;
* bakes every fighter, frame and facing into offscreen sprite sheets at
  startup, so a fighter costs one `drawImage` per frame with no filters;
* renders the logos as DOM/SVG, so they stay crisp at any DPI and cost
  nothing per frame;
* pauses entirely when the page is hidden.

Measured in Chromium: a steady 60 fps even at 28 fighters across a 5760×1080
triple-monitor span, flat at 9.5 MB heap over a 90-second soak. At the
default four fighters it is far below that.

## Editing

`Bluerydge_Arena_Wallpaper.html` is generated. Edit `src/app.js` or
`src/wallpaper.template.html`, then:

    python3 tools/build.py

See `tools/README.md` for the sprite contact-sheet helper.
