# Bluerydge Arena — dual-monitor animated wallpaper

A single self-contained HTML file. Open
**`Bluerydge_Arena_Wallpaper.html`** in any modern browser, or point a
wallpaper engine (Lively, Wallpaper Engine, Plash, `xwinwrap`, …) at it.

Pixel-art fighters run along the top edge of the taskbar, right across both
screens — four at a time, drawn from a roster of sixteen so you rarely see
the same one twice in a row. When two meet head-on they trade a few blows
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
| `duels`    | `1`     | Set `0` for a plain parade |
| `logo`     | `1`     | Set `0` to hide the wordmarks |
| `logoy`    | `0`     | Logo height as a fraction of the screen; `0` = automatic |
| `drift`    | `0`     | Slowly creep the logo around — OLED burn-in insurance |
| `grain`    | `1`     | Scanline overlay |
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
