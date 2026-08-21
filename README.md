# Bluerydge Arena — dual-monitor animated wallpaper

A single self-contained HTML file. Open
**`Bluerydge_Arena_Wallpaper.html`** in any modern browser, or point a
wallpaper engine (Lively, Wallpaper Engine, Plash, `xwinwrap`, …) at it.

Sixteen pixel-art fighters run along the top edge of the taskbar, right
across both screens. When two of them meet head-on they trade a few blows
and move on. The Bluerydge mark sits centred on each monitor.

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
| `scale`    | `2`     | Sprite pixel scale. Fighters are `28 × scale` px tall, so `2` ≈ 56 px |
| `taskbar`  | `48`    | Height of your taskbar in px — the fighters run on this line |
| `density`  | `1`     | Crowd multiplier (0.2–4) |
| `fps`      | `60`    | Frame cap. Drop to `30` on a laptop |
| `duels`    | `1`     | Set `0` for a plain parade |
| `logo`     | `1`     | Set `0` to hide the wordmarks |
| `grain`    | `1`     | Scanline overlay |
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

Measured in Chromium: a steady 60 fps with 28 fighters across a 5760×1080
triple-monitor span, flat at 9.5 MB heap over a 90-second soak.

## Editing

`Bluerydge_Arena_Wallpaper.html` is generated. Edit `src/app.js` or
`src/wallpaper.template.html`, then:

    python3 tools/build.py

See `tools/README.md` for the sprite contact-sheet helper.
