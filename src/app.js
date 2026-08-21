/* ============================================================================
   PORTAL VALLEY — dual-monitor animated wallpaper
   Standalone, dependency-free, offline. No frameworks, no network.

   Design notes
   ------------
   * The background is painted ONCE into #scene and only repainted on resize.
   * Only the bottom strip (#fx) is cleared and redrawn per frame, so the
     per-frame fill area is ~1/8 of the desktop instead of all of it.
   * Fighters are pixel-art sprites baked into offscreen sheets at startup.
     Per frame each one costs a single drawImage — no shadowBlur, no vector
     re-tracing, no layout thrash. This is what the old build got wrong: it
     re-stroked every limb with shadowBlur on a 4096x1152 canvas 60x a second
     and forced a React re-render on every hit.
   ========================================================================= */
(function () {
'use strict';

/* -------------------------------------------------------------- config -- */

var DEFAULTS = {
  screens: 2,     // how many monitors the wallpaper spans
  panel: -1,      // -1 = draw the whole span; 0..n-1 = only that monitor
  scale: 2,       // sprite pixel scale; fighter height = 28 * scale css px
  taskbar: 48,    // px from the bottom of the screen the ground line sits at
  count: 4,       // fighters on screen at once, across the whole span
  fps: 60,        // frame cap
  duels: 1,
  raids: 1,       // monsters crawl out of the forest; heroes unite against them
  portal: 1,      // arrivals drop from the sky portal instead of walking on
  levels: 1,      // fighters gain experience, kit and evolutions from wins
  ambient: 1,     // real time of day drives the sky and the portal
  hour: -1,       // override the clock (0-23.99); -1 = use the real time
  seedxp: 0,      // preview switch: start every fighter with this much record
  grain: 0,       // scanlines suit a cyber scene; off for the valley
  maxDpr: 2,
  guests: 'mix',        // 'mix' | 'robohash' | 'pokeapi' | 'endpoint' | 'off'
  seed: 0,        // world seed; 0 rolls one on first run and keeps it
  still: 0        // >0 freezes a composed frame, using this value as the seed
};
var NUM = { screens: 1, panel: 1, scale: 1, taskbar: 1, count: 1, fps: 1,
            maxDpr: 1, still: 1, seedxp: 1, hour: 1, seed: 1 };
var LIMITS = {
  screens: [1, 6], panel: [-1, 5], scale: [1, 5], taskbar: [0, 400],
  count: [1, 16], fps: [10, 144], maxDpr: [1, 3], seedxp: [0, 400],
  still: [0, 999999], hour: [-1, 23.99], seed: [0, 999999]
};

/* Where guest fighters come from. Only 'endpoint' is on by default, and with
   no GUEST_ENDPOINT configured that means no network traffic at all.

   The public sources are opt-in via ?guests=<name>. Both were checked for a
   transparent, full-body sprite and an open CORS policy — without alpha a
   sprite cannot be trimmed to a common height and just renders as a box. */
var SOURCES = {
  off:      { hosts: [] },
  endpoint: { hosts: [] },
  robohash: { hosts: ['robohash.org'] },
  pokeapi:  { hosts: ['pokeapi.co', 'raw.githubusercontent.com'] },
  mix:      { hosts: ['robohash.org', 'pokeapi.co', 'raw.githubusercontent.com'] }
};

var cfg = (function () {
  var c = {}, k;
  for (k in DEFAULTS) c[k] = DEFAULTS[k];
  try {
    var saved = JSON.parse(localStorage.getItem('arena.wallpaper.cfg') || '{}');
    for (k in saved) if (k in c) c[k] = saved[k];
  } catch (e) { /* private mode / disabled storage — defaults are fine */ }
  try {
    var q = new URLSearchParams(location.search);
    // ?screen=left|right is the shorthand the old build used for per-monitor setup
    var legacy = q.get('screen');
    if (legacy === 'left') c.panel = 0;
    else if (legacy === 'right') c.panel = 1;
    q.forEach(function (v, key) {
      if (!(key in c)) return;
      if (key === 'guests') { c[key] = v; return; }
      c[key] = NUM[key] ? parseFloat(v) : (v === '0' || v === 'false' ? 0 : 1);
    });
  } catch (e) {}
  c = clampCfg(c);
  if (!c.seed) {                       // roll this machine's valley once
    c.seed = 1 + ((Math.random() * 999998) | 0);
    try { localStorage.setItem('arena.wallpaper.cfg', JSON.stringify(c)); } catch (e) {}
  }
  return c;
})();

function clampCfg(c) {
  for (var k in LIMITS) {
    var L = LIMITS[k];
    if (typeof c[k] !== 'number' || c[k] !== c[k]) c[k] = DEFAULTS[k];
    c[k] = Math.min(L[1], Math.max(L[0], c[k]));
  }
  c.screens = Math.round(c.screens);
  c.scale = Math.round(c.scale);
  c.panel = Math.round(c.panel);
  c.still = Math.round(c.still);
  c.count = Math.round(c.count);
  c.seedxp = Math.round(c.seedxp);
  if (c.panel >= c.screens) c.panel = -1;
  c.guests = String(c.guests);
  if (c.guests === '1' || c.guests === 'true') c.guests = 'mix';
  if (c.guests === '0' || c.guests === 'false') c.guests = 'off';
  if (!SOURCES[c.guests]) c.guests = 'mix';
  return c;
}

function saveCfg() {
  try { localStorage.setItem('arena.wallpaper.cfg', JSON.stringify(cfg)); } catch (e) {}
}

/* A wallpaper must never show a red error box. Log and carry on. */
window.addEventListener('error', function (e) {
  try { console.error('[arena]', e.message || e.type, e.filename || '', e.lineno || ''); } catch (x) {}
});

/* ---------------------------------------------------------- pixel utils -- */

var ART_W = 46,   // sprite cell width in art pixels (weapons/wings need the room)
    ART_H = 38,   // sprite cell height in art pixels
    FEET  = 33,   // art row the feet rest on
    MIDX  = 18;   // art column the body is centred on

function mkCanvas(w, h) {
  var c = document.createElement('canvas');
  c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  return c;
}
function ctx2d(c, alpha) {
  var g = c.getContext('2d', { alpha: alpha !== false });
  g.imageSmoothingEnabled = false;
  return g;
}
function rgba(hex, a) {
  var n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function mix(a, b, t) {
  var x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  var r = Math.round(((x >> 16) & 255) * (1 - t) + ((y >> 16) & 255) * t);
  var g = Math.round(((x >> 8) & 255) * (1 - t) + ((y >> 8) & 255) * t);
  var b2 = Math.round((x & 255) * (1 - t) + (y & 255) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b2).toString(16).slice(1);
}
/* Swapped for a seeded generator while composing a still, so exporting the
   same seed twice gives byte-identical output. */
var RNG = Math.random;
function rnd(a, b) { return a + RNG() * (b - a); }
function pick(arr) { return arr[(RNG() * arr.length) | 0]; }

/* Square-capped Bresenham line — the workhorse for pixel-art limbs. */
function pline(g, x0, y0, x1, y1, w, col) {
  g.fillStyle = col;
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  var err = dx + dy, e2, o = w >> 1, guard = 0;
  for (;;) {
    g.fillRect(x0 - o, y0 - o, w, w);
    if ((x0 === x1 && y0 === y1) || ++guard > 400) break;
    e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
/* Outlined limb: dark casing, body colour, then a lit edge. */
function limb(g, x0, y0, x1, y1, w, col, dark, lit) {
  pline(g, x0, y0, x1, y1, w + 2, dark);
  pline(g, x0, y0, x1, y1, w, col);
  if (lit && w > 2) pline(g, x0, y0 - 1, x1, y1 - 1, 1, lit);
}
/* Two-segment limb whose joint kicks out as the limb compresses — this is
   what makes an 8-frame run read at 56 pixels tall. */
function jointed(g, ax, ay, bx, by, reach, w, col, dark, kick) {
  var dx = bx - ax, dy = by - ay;
  var d = Math.sqrt(dx * dx + dy * dy);
  var bend = Math.max(0, reach - d) * 0.55 + 1;
  var jx = ax + dx * 0.5 + kick * bend, jy = ay + dy * 0.5;
  limb(g, ax, ay, jx, jy, w, col, dark);
  limb(g, jx, jy, bx, by, w, col, dark);
  return [jx, jy];
}

function box(g, x, y, w, h, col, dark) {
  if (dark) { g.fillStyle = dark; g.fillRect(x - 1, y - 1, w + 2, h + 2); }
  g.fillStyle = col; g.fillRect(x, y, w, h);
}
function dot(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }

/* ------------------------------------------------------------- roster --- */
/* kind   humanoid | beast | hover
   head   visor helm hood horn crown mask dome wolf bear skull
   wep    blade gun sword bow staff hammer dagger claw scythe cannon fist
   Colours: c1 armour, c2 casing/shadow, c3 neon trim, c4 face/visor light  */

/* Guest roster endpoint. Set at build time from assets/guests-endpoint.txt;
   empty means the wallpaper never touches the network. See README. */
var GUEST_ENDPOINT = '__GUEST_ENDPOINT__';

var GUEST_MAX = 40;          // hard ceiling on drafted guests per session
var GUEST_REFRESH = 1800;    // seconds between manifest polls
var GUEST_CACHE = 'arena.wallpaper.guests';
var GUEST_MAX_W = 42;        // art px; the cell is ART_W wide, leave a margin

var ROSTER = [
  { id:'ronin',  name:'RONIN-9',   kind:'humanoid', c1:'#2a6ea8', c2:'#08203a', c3:'#00e5ff', c4:'#dffaff',
    head:'visor',  wep:'blade',  cape:1, ranged:0, spd:1.05 },
  { id:'vector', name:'VECTOR-X',  kind:'humanoid', c1:'#a8283f', c2:'#33060f', c3:'#ff3b4d', c4:'#ffd7de',
    head:'mask',   wep:'gun',    ranged:1, spd:1.12 },
  { id:'aegis',  name:'SIR AEGIS', kind:'humanoid', c1:'#8a6a1f', c2:'#3a2a08', c3:'#ffd166', c4:'#fff2c9',
    head:'helm',   wep:'sword',  shield:1, ranged:0, spd:0.82, heavy:1 },
  { id:'lupus',  name:'LUPUS',     kind:'beast',    c1:'#6b3fa8', c2:'#1c0d33', c3:'#b06bff', c4:'#efe0ff',
    head:'wolf',   wep:'claw',   tail:1, ranged:0, spd:1.35 },
  { id:'ursok',  name:'URSOK',     kind:'beast',    c1:'#7a4a18', c2:'#301a05', c3:'#ff9e3d', c4:'#ffe2bd',
    head:'bear',   wep:'claw',   ranged:0, spd:0.78, heavy:1, bulk:1 },
  { id:'malphax',name:'MALPHAX',   kind:'humanoid', c1:'#9c2f10', c2:'#2c0a02', c3:'#ff5a1f', c4:'#ffc08a',
    head:'horn',   wep:'scythe', wings:'bat', tail:1, ranged:1, spd:0.98 },
  { id:'nova',   name:'NOVA-7',    kind:'hover',    c1:'#20618f', c2:'#0a2338', c3:'#7fe8ff', c4:'#ffffff',
    head:'dome',   wep:'cannon', ranged:1, spd:0.9 },
  { id:'kestrel',name:'KESTREL',   kind:'humanoid', c1:'#2b8f63', c2:'#062418', c3:'#4dffa8', c4:'#dcffee',
    head:'hood',   wep:'bow',    cape:1, ranged:1, spd:1.22 },
  { id:'ironclad',name:'IRONCLAD', kind:'humanoid', c1:'#6e7a89', c2:'#20262f', c3:'#a8d4ff', c4:'#e6f2ff',
    head:'helm',   wep:'hammer', ranged:0, spd:0.7, heavy:1, bulk:1 },
  { id:'seraph', name:'SERAPH',    kind:'humanoid', c1:'#c9b47f', c2:'#4a3f26', c3:'#ffe07a', c4:'#fff6dc',
    head:'crown',  wep:'staff',  wings:'feather', ranged:1, spd:0.95 },
  { id:'viper',  name:'VIPER',     kind:'humanoid', c1:'#3f8f2b', c2:'#0c2408', c3:'#a6ff3d', c4:'#e9ffc9',
    head:'hood',   wep:'dagger', ranged:0, spd:1.4 },
  { id:'glacia', name:'GLACIA',    kind:'humanoid', c1:'#2a6f8f', c2:'#0a2733', c3:'#9ff0ff', c4:'#ffffff',
    head:'crown',  wep:'staff',  cape:1, ranged:1, spd:0.9 },
  { id:'ember',  name:'EMBER',     kind:'humanoid', c1:'#8f3a12', c2:'#341005', c3:'#ffb03d', c4:'#fff0cf',
    head:'mask',   wep:'fist',   ranged:0, spd:1.1 },
  { id:'raven',  name:'RAVEN',     kind:'humanoid', c1:'#4a3f66', c2:'#160f24', c3:'#c86bff', c4:'#f0dcff',
    head:'hood',   wep:'dagger', cape:1, ranged:0, spd:1.28 },
  { id:'zephyr', name:'ZEPHYR',    kind:'humanoid', c1:'#3585c2', c2:'#07223a', c3:'#5fd0ff', c4:'#e8fbff',
    head:'visor',  wep:'blade',  ranged:0, spd:1.32 },
  { id:'obsidian',name:'OBSIDIAN', kind:'humanoid', c1:'#6a5a90', c2:'#1a1230', c3:'#8a5cff', c4:'#cdb6ff',
    head:'skull',  wep:'hammer', ranged:0, spd:0.72, heavy:1, bulk:1 },

  /* ── challengers ──────────────────────────────────────────────────────
     Original characters built on well-worn archetypes — the gi martial
     artist, the grappler, the clawed feral, the optic-beam ranger, the
     storm-caller. Archetypes are not ownable; specific characters are, so
     none of these is a likeness of anyone's. They arrive by portal.       */
  { id:'kensho', name:'KENSHO',    kind:'humanoid', c1:'#d8dbe2', c2:'#3b4048', c3:'#ff7a3d', c4:'#ffe1c2',
    head:'mask',   wep:'fist',   ranged:1, spd:1.05, challenger:1 },
  { id:'lotus',  name:'LOTUS',     kind:'humanoid', c1:'#2f7fd0', c2:'#0b2748', c3:'#7fd4ff', c4:'#e9f8ff',
    head:'visor',  wep:'fist',   ranged:0, spd:1.38, challenger:1 },
  { id:'titanov',name:'TITANOV',   kind:'humanoid', c1:'#b05a3a', c2:'#3b1a10', c3:'#ffb37a', c4:'#ffe3cc',
    head:'mask',   wep:'fist',   ranged:0, spd:0.68, heavy:1, bulk:1, grappler:1, challenger:1 },
  { id:'razorclaw',name:'RAZORCLAW',kind:'humanoid',c1:'#c8a83c', c2:'#3a2e08', c3:'#ffe066', c4:'#fff6cc',
    head:'mask',   wep:'claw',   ranged:0, spd:1.30, challenger:1 },
  { id:'tempesta',name:'TEMPESTA', kind:'humanoid', c1:'#cfd6e6', c2:'#39415a', c3:'#9fe8ff', c4:'#ffffff',
    head:'crown',  wep:'staff',  cape:1, ranged:1, spd:0.96, challenger:1 },
  { id:'visor',  name:'VISOR',     kind:'humanoid', c1:'#2f5fa8', c2:'#0d1f3d', c3:'#ff4d4d', c4:'#ffd6d6',
    head:'visor',  wep:'gun',    ranged:1, spd:1.02, challenger:1 },
  { id:'ferro',  name:'FERRO',     kind:'hover',    c1:'#8e2f6f', c2:'#2a0c22', c3:'#ff7fd8', c4:'#ffe3f6',
    head:'dome',   wep:'cannon', ranged:1, spd:0.9, challenger:1 },
  { id:'nightstep',name:'NIGHTSTEP',kind:'humanoid',c1:'#3a2a6e', c2:'#120a26', c3:'#7d5cff', c4:'#d8ccff',
    head:'hood',   wep:'dagger', cape:1, ranged:0, spd:1.42, challenger:1 },

  /* ── the hero wing. STARDUST and BLACK TERROR are real public-domain
     characters — golden-age heroes from defunct 1940s publishers (Fox
     Features and Nedor), whose original characters belong to everyone now;
     these are my own pixel renditions of them. The other four are originals
     on modern super-archetypes — the armored inventor, the gamma brute, the
     storm god, the spider acrobat — with move sets to match: the inventor
     jets over traffic, the acrobat blinks, the brute and the god hit like
     falling masonry, and the two casters strike with their element.        */
  { id:'forge',   name:'FORGE-1',  kind:'humanoid', c1:'#b02a20', c2:'#3a0d08', c3:'#ffd24d', c4:'#fff2c0',
    head:'visor',  wep:'fist',   ranged:1, spd:1.0, hero:1, passPref:'jet',
    elem: { cols: ['#ffd24d', '#fff2c0', '#ffffff'], n: 12 } },
  { id:'rampage', name:'RAMPAGE',  kind:'humanoid', c1:'#3f9e3f', c2:'#12300f', c3:'#8aff5e', c4:'#e0ffc9',
    head:'mask',   wep:'fist',   ranged:0, spd:0.72, heavy:1, bulk:1, grow:1.14, hero:1 },
  { id:'stormhammer', name:'STORMHAMMER', kind:'humanoid', c1:'#7a8ba8', c2:'#232c3d', c3:'#8ad8ff', c4:'#ffffff',
    head:'helm',   wep:'hammer', cape:1, ranged:1, spd:0.88, heavy:1, hero:1,
    elem: { cols: ['#ffe25e', '#8ad8ff', '#ffffff'], n: 16 } },
  { id:'arachne', name:'ARACHNE',  kind:'humanoid', c1:'#c03048', c2:'#3d0a14', c3:'#4d7dff', c4:'#d8e4ff',
    head:'mask',   wep:'claw',   ranged:0, spd:1.45, hero:1, passPref:'blink' },
  { id:'stardust',name:'STARDUST', kind:'humanoid', c1:'#d8b34a', c2:'#4a3a12', c3:'#ffe98a', c4:'#fffbe0',
    head:'crown',  wep:'staff',  cape:1, ranged:1, spd:0.94, hero:1,
    elem: { cols: ['#ffe98a', '#ffffff', '#c8b4ff'], n: 14 } },
  { id:'blackterror', name:'BLACK TERROR', kind:'humanoid', c1:'#2a2a34', c2:'#0c0c12', c3:'#e8e8f0', c4:'#ffffff',
    head:'skull',  wep:'fist',   cape:1, ranged:0, spd:0.95, bulk:1, hero:1 },

  /* ── the raid bench: monsters that crawl out of the forest. Never drafted
     into the normal rotation (off:1); they only appear as a raid, and the
     heroes on screen drop what they are doing to put them down together. */
  { id:'skeleton', name:'SKELETON', kind:'humanoid', c1:'#cfc8b8', c2:'#4a463c', c3:'#e8e2d0', c4:'#fffef4',
    head:'skull',  wep:'sword',  ranged:0, spd:0.9, monster:1, off:1, hp: 3 },
  { id:'kobold',  name:'KOBOLD',   kind:'humanoid', c1:'#a05430', c2:'#361a0c', c3:'#ff8a4d', c4:'#ffd8bd',
    head:'horn',   wep:'dagger', ranged:0, spd:1.35, monster:1, off:1, hp: 2, grow: 0.8 },
  { id:'bugbear', name:'BUGBEAR',  kind:'humanoid', c1:'#6e5638', c2:'#251c10', c3:'#c8a05e', c4:'#f0dfc0',
    head:'hood',   wep:'hammer', ranged:0, spd:0.7, monster:1, off:1, hp: 5, heavy:1, bulk:1, grow: 1.15 },
  { id:'ghoul',   name:'GHOUL',    kind:'humanoid', c1:'#5e7a4a', c2:'#1e2a16', c3:'#a8d86e', c4:'#e8ffc9',
    head:'mask',   wep:'claw',   ranged:0, spd:1.15, monster:1, off:1, hp: 3 },
  { id:'ogre',    name:'OGRE',     kind:'humanoid', c1:'#7a6248', c2:'#2a2014', c3:'#d8b078', c4:'#ffe9c9',
    head:'horn',   wep:'fist',   ranged:0, spd:0.6, monster:1, off:1, hp: 6, heavy:1, bulk:1, grow: 1.22 }
];

/* --------------------------------------------------------- pose engine -- */
/* Anchors, facing right, in art coordinates. */
var HIP_B = [15, 24], HIP_F = [20, 24],   // back / front hip
    SH_B  = [15, 17], SH_F  = [21, 17],   // back / front shoulder
    HEADC = [18, 9];                      // head centre

/* Foot path for one leg at cycle position p in [0,1). Stance drags the foot
   backwards along the ground; swing lifts it and throws it forward. */
var LEG = FEET - 24;              // hip-to-ground, in art pixels

function footAt(p, stride, lift) {
  p = p - Math.floor(p);
  if (p < 0.55) {                              // stance: planted, dragging back
    var s = p / 0.55;
    return [Math.round(stride * (1 - 2 * s)), LEG];
  }
  var s2 = (p - 0.55) / 0.45;                  // swing: lifted and thrown forward
  return [Math.round(-stride + 2 * stride * s2),
          Math.round(LEG - lift * Math.sin(Math.PI * s2))];
}

function runPose(p, spec) {
  var stride = spec.bulk ? 7 : 9, lift = spec.heavy ? 4 : 6;
  var fF = footAt(p, stride, lift), fB = footAt(p + 0.5, stride, lift);
  var swing = Math.sin(p * Math.PI * 2), bounce = Math.abs(Math.sin(p * Math.PI * 2));
  return {
    bob: -Math.round(2 * bounce),
    lean: spec.heavy ? 1 : 2,
    footF: fF, footB: fB,
    handF: [Math.round(-swing * 6 + 1), Math.round(5 + swing * 2)],
    handB: [Math.round(swing * 6 - 1), Math.round(5 - swing * 2)],
    atk: 0, tail: swing * 4, cape: 4 + swing * 1.5
  };
}
function idlePose(p, spec) {
  var b = Math.sin(p * Math.PI * 2);
  return {
    bob: -Math.round(Math.max(0, b)),
    lean: 0,
    footF: [3, LEG], footB: [-4, LEG],
    handF: [2, 4], handB: [-2, 5],
    atk: 0.15, tail: b * 2, cape: 1 + b * 0.6
  };
}
/* Wind-up, strike, follow-through, recover. */
function atkPose(i, spec) {
  var K = [-0.5, 1, 0.75, 0.25][i];
  return {
    bob: i === 1 ? -1 : 0,
    lean: Math.round(K * 2),
    footF: [Math.round(3 + K * 5), LEG], footB: [-4, LEG],
    handF: [Math.round(K * 7), Math.round(6 - K * 5)],
    handB: [Math.round(-K * 3 - 1), 6],
    atk: K, tail: -K * 3, cape: 1 + K * 3
  };
}
function hitPose(spec) {
  return {
    bob: 1, lean: -2,
    footF: [-2, LEG], footB: [-6, LEG],
    handF: [-4, 3], handB: [-5, 2],
    atk: -0.4, tail: -3, cape: -2
  };
}

/* ------------------------------------------------------------ artwork --- */
/* Everything below draws in art pixels into a context already scaled by the
   bake factor, so every fillRect lands on an exact pixel boundary.          */

function drawHead(g, s, hx, hy) {
  var c1 = s.c1, c2 = s.c2, c3 = s.c3, c4 = s.c4;
  var x = hx - 4, y = hy - 4;                       // 8x8 head box

  if (s.head === 'hood') {
    box(g, x, y, 8, 8, c2, '#00000055');
    pline(g, x - 1, y + 7, x + 1, y - 1, 3, c1);    // hood ridge
    pline(g, x + 1, y - 1, x + 7, y + 1, 3, c1);
    dot(g, x + 5, y + 3, 3, 2, c3);                 // eye glow
    dot(g, x + 5, y + 3, 1, 1, c4);
    return;
  }
  if (s.head === 'dome') {
    box(g, x, y + 1, 8, 7, c1, c2);
    dot(g, x + 1, y, 6, 2, c2);
    dot(g, x + 1, y + 2, 6, 3, rgba(c3, 0.85));     // glass
    dot(g, x + 4, y + 3, 3, 1, c4);
    return;
  }
  box(g, x, y, 8, 8, c1, c2);
  dot(g, x, y + 6, 8, 2, c2);                       // jaw shadow

  if (s.head === 'visor') {
    dot(g, x + 1, y + 3, 8, 2, c3);                 // full-width visor band
    dot(g, x + 6, y + 3, 3, 2, c4);
    dot(g, x - 1, y - 1, 10, 2, mix(c1, '#ffffff', 0.22));   // brow plate
    pline(g, x + 1, y - 1, x - 4, y + 1, 2, c3);    // swept fin
    dot(g, x - 5, y + 1, 2, 1, c4);
  } else if (s.head === 'mask') {
    dot(g, x + 1, y + 2, 7, 3, c2);
    dot(g, x + 5, y + 3, 3, 1, c3);
    dot(g, x + 2, y + 3, 2, 1, c3);
    dot(g, x + 4, y + 6, 4, 1, c3);                 // respirator vent
  } else if (s.head === 'helm') {
    dot(g, x - 1, y - 3, 10, 3, c1); dot(g, x - 1, y - 4, 10, 1, mix(c1, '#ffffff', 0.25));
    pline(g, x + 4, y - 4, x + 1, y - 9, 1, c3);    // plume
    pline(g, x + 1, y - 9, x - 2, y - 11, 1, c4);
    dot(g, x + 1, y + 2, 8, 2, c2);                 // eye slit
    dot(g, x + 5, y + 2, 3, 2, c3);
    dot(g, x + 4, y + 4, 1, 4, c2); dot(g, x + 7, y + 4, 2, 3, mix(c1, '#ffffff', 0.18));
  } else if (s.head === 'horn') {
    pline(g, x + 1, y, x - 2, y - 6, 2, c3); dot(g, x - 3, y - 8, 2, 3, c3);
    pline(g, x + 6, y, x + 9, y - 6, 2, c3); dot(g, x + 9, y - 8, 2, 3, c3);
    dot(g, x + 5, y + 3, 3, 2, c3); dot(g, x + 2, y + 3, 2, 2, rgba(c3, 0.7));
    dot(g, x + 3, y + 6, 5, 1, c2);
  } else if (s.head === 'crown') {
    dot(g, x, y - 2, 8, 2, c3);
    dot(g, x, y - 4, 1, 2, c3); dot(g, x + 4, y - 5, 1, 3, c3); dot(g, x + 7, y - 4, 1, 2, c3);
    dot(g, x + 4, y - 6, 1, 1, c4);
    dot(g, x + 1, y + 3, 8, 2, c4); dot(g, x + 5, y + 3, 3, 2, c3);
    dot(g, x - 1, y + 1, 1, 5, c3); dot(g, x + 8, y + 1, 1, 5, c3);
  } else if (s.head === 'royal') {
    dot(g, x - 1, y - 3, 10, 3, c3);                     // band
    dot(g, x - 1, y - 4, 10, 1, mix(c3, '#ffffff', 0.5));
    var pts = [[-1, 5], [1, 7], [3, 9], [5, 7], [7, 5]];
    for (var pi = 0; pi < pts.length; pi++) {
      dot(g, x + pts[pi][0], y - 3 - pts[pi][1], 2, pts[pi][1], c3);
      dot(g, x + pts[pi][0], y - 4 - pts[pi][1], 2, 2, mix(c3, '#ffffff', 0.65));
    }
    dot(g, x + 3, y - 15, 2, 2, '#ffffff');              // centre gem
    dot(g, x + 1, y + 3, 8, 2, c4);
    dot(g, x + 5, y + 3, 3, 2, c3);
    dot(g, x - 1, y + 1, 1, 6, c3); dot(g, x + 8, y + 1, 1, 6, c3);
  } else if (s.head === 'skull') {
    dot(g, x + 1, y + 2, 3, 3, '#05030a'); dot(g, x + 5, y + 2, 3, 3, '#05030a');
    dot(g, x + 5, y + 3, 2, 2, c3); dot(g, x + 2, y + 3, 2, 2, rgba(c3, 0.75));
    dot(g, x + 2, y + 6, 6, 1, c4);
    for (var i = 0; i < 3; i++) dot(g, x + 3 + i * 2, y + 6, 1, 2, c2);
  }
}

/* Weapon held in the front hand. k = swing amount, -0.5 .. 1 */
function drawWeapon(g, s, hx, hy, k) {
  var c1 = s.c1, c2 = s.c2, c3 = s.c3, c4 = s.c4, w = s.wep;
  var sw = k * 1.0;                                  // forward reach

  if (w === 'blade' || w === 'sword' || w === 'dagger') {
    var len = w === 'dagger' ? 7 : (w === 'sword' ? 13 : 12);
    var ax = hx + 2 + sw * 4, ay = hy - 1;
    var tx = ax + len * (0.35 + 0.65 * Math.max(0, sw + 0.35));
    var ty = ay - len * (0.85 - 0.8 * Math.max(0, sw));
    limb(g, ax, ay, tx, ty, w === 'sword' ? 3 : 2, c4, c2);
    pline(g, ax, ay, tx, ty, 1, c3);
    dot(g, hx, hy - 1, 3, 3, c2);                    // grip
    if (w !== 'dagger') pline(g, ax - 1, ay - 2, ax + 1, ay + 2, 2, c3);  // guard
    if (k > 0.6) { pline(g, ax + 2, ay - 4, tx + 2, ty - 2, 1, rgba(c3, 0.55)); } // swing arc
  } else if (w === 'gun') {
    var gc = mix(c2, '#ffffff', 0.22);
    dot(g, hx - 1, hy - 2, 3, 4, gc);
    box(g, hx + 1, hy - 2, 6, 2, gc, '#00000066');
    dot(g, hx + 6, hy - 2, 1, 2, c3);                    // muzzle
    dot(g, hx + 1, hy - 3, 3, 1, c3);                    // sight rail
    dot(g, hx, hy + 1, 3, 2, gc);                        // grip
    if (k > 0.6) { dot(g, hx + 8, hy - 3, 3, 4, c4); dot(g, hx + 11, hy - 2, 2, 2, c3); }
  } else if (w === 'cannon') {
    box(g, hx - 1, hy - 3, 11, 5, c1, c2);
    dot(g, hx + 9, hy - 3, 3, 5, c3);
    dot(g, hx + 1, hy - 4, 5, 2, c2);
    dot(g, hx + 2, hy - 1, 3, 2, c4);
    if (k > 0.6) { dot(g, hx + 12, hy - 4, 4, 7, c3); dot(g, hx + 15, hy - 2, 3, 3, c4); }
  } else if (w === 'bow') {
    var bx = hx + 3 + sw * 3;
    pline(g, bx, hy - 8, bx + 3, hy - 4, 2, c1); pline(g, bx + 3, hy - 4, bx + 3, hy + 2, 2, c1);
    pline(g, bx + 3, hy + 2, bx, hy + 6, 2, c1);
    pline(g, bx, hy - 8, bx - (k > 0.4 ? 3 : 0), hy - 1, 1, c3);
    pline(g, bx - (k > 0.4 ? 3 : 0), hy - 1, bx, hy + 6, 1, c3);
    if (k > 0.6) pline(g, bx + 4, hy - 1, bx + 12, hy - 1, 1, c4);
  } else if (w === 'staff') {
    var stx = hx + 2 + sw * 3;
    limb(g, stx, hy - 11, stx - 1, hy + 5, 2, mix(c1, '#ffffff', 0.15), c2);
    dot(g, stx - 2, hy - 15, 5, 4, c3);
    dot(g, stx - 1, hy - 14, 3, 2, c4);
    dot(g, stx - 3, hy - 13, 1, 1, rgba(c3, 0.7)); dot(g, stx + 3, hy - 13, 1, 1, rgba(c3, 0.7));
    if (k > 0.6) { dot(g, stx + 4, hy - 15, 3, 3, rgba(c3, 0.8)); dot(g, stx + 8, hy - 13, 2, 2, rgba(c4, 0.7)); }
  } else if (w === 'hammer') {
    var mx = hx + 4 + sw * 5, my = hy - 7 - sw * 3;
    limb(g, hx - 1, hy + 4, mx + 1, my + 1, 2, mix(c1, '#ffffff', 0.1), c2);
    box(g, mx - 2, my - 3, 6, 7, mix(c1, '#ffffff', 0.2), c2);
    dot(g, mx + 3, my - 3, 1, 8, c3);                    // striking face
    dot(g, mx - 2, my - 3, 6, 1, c3);
    dot(g, mx, my, 2, 3, rgba(c3, 0.55));
  } else if (w === 'scythe') {
    var px2 = hx + 2 + sw * 3;
    limb(g, px2, hy - 12, px2 - 2, hy + 6, 2, mix(c1, '#ffffff', 0.2), c2);
    pline(g, px2, hy - 12, px2 + 6, hy - 11, 2, c4);
    pline(g, px2 + 6, hy - 11, px2 + 9, hy - 7, 2, c4);
    pline(g, px2 + 1, hy - 11, px2 + 7, hy - 9, 1, c3);
    dot(g, px2 - 1, hy - 13, 3, 2, c3);
  } else if (w === 'claw') {
    for (var i2 = 0; i2 < 3; i2++) pline(g, hx, hy - 2 + i2 * 2, hx + 4 + sw * 3, hy - 4 + i2 * 3, 1, c4);
    dot(g, hx - 1, hy - 2, 3, 5, c1);
  } else if (w === 'fist') {
    box(g, hx - 1, hy - 2, 5, 5, c1, c2);
    dot(g, hx + 2, hy - 1, 2, 3, c3);
    if (k > 0.6) { dot(g, hx + 5, hy - 2, 3, 5, rgba(c3, 0.8)); dot(g, hx + 8, hy - 1, 2, 3, rgba(c4, 0.7)); }
  }
}

function drawCape(g, s, sx, sy, wave) {
  var big = s.capeBig || 0;                        // rank makes it flow further
  var c = mix(s.c2, s.c1, 0.35 + big * 0.12), e = rgba(s.c3, 0.55);
  var reach = 1 + big * 0.55, w0 = 5 + big;
  var x1 = sx - 3 * reach, y1 = sy + 7;
  var x2 = sx - (6 + wave * 0.7) * reach, y2 = sy + 13 - wave * 0.5;
  var x3 = sx - (9 + wave) * reach, y3 = sy + (16 + big * 3) - wave;
  pline(g, sx + 1, sy - 1, x1, y1, w0, c);
  pline(g, x1, y1, x2, y2, w0 - 1, c);
  pline(g, x2, y2, x3, y3, Math.max(2, w0 - 2), c);
  pline(g, x2 + 1, y2 + 1, x3 + 1, y3 + 1, 1, e);
  if (big) {                                       // a second, trailing fold
    pline(g, x1, y1 + 2, x3 - 2, y3 - 3, Math.max(2, w0 - 3), mix(c, '#000000', 0.25));
    pline(g, x2, y2 + 2, x3 - 3, y3 + 1, 1, e);
  }
  dot(g, sx - 1, sy - 2, 4, 2, s.c3);              // clasp
  if (big > 1) dot(g, sx - 2, sy - 3, 6, 1, mix(s.c3, '#ffffff', 0.5));
}

function drawWings(g, s, sx, sy, flap, kind) {
  var edge = s.c3, up = Math.round(flap * 2);

  if (kind === 'bat') {
    var rib = mix(s.c1, '#ffffff', 0.15), memb = rgba(s.c1, 0.55);
    for (var side = 0; side < 2; side++) {
      var ox = sx - 1 - side * 2, oy = sy + 1 + side * 3;
      var tx = ox - 9, ty = oy - 7 + up + side * 4;
      /* membrane: three scallops hanging off the leading edge */
      for (var r = 1; r <= 3; r++) {
        pline(g, ox - 1, oy + 1, tx + r * 3, ty + r * 3, 1, memb);
        dot(g, tx + r * 3 - 1, ty + r * 3, 2, 2, memb);
      }
      limb(g, ox, oy, ox - 5, ty, 1, rib, s.c2);         // leading edge
      limb(g, ox - 5, ty, tx, ty + 1, 1, rib, s.c2);
      dot(g, tx - 1, ty, 2, 2, edge);                    // claw tip
    }
  } else {
    for (var w = 0; w < 2; w++) {
      var bx = sx - 1 - w * 2, by = sy + 1 + w * 3;
      for (var f = 0; f < 4; f++) {                      // four separated primaries
        var len = 9 - f * 2;
        pline(g, bx, by + f * 2, bx - len, by - 3 + f * 3 - up, 1,
              f % 2 ? s.c4 : mix(s.c4, s.c1, 0.45));
      }
      pline(g, bx, by - 1, bx - 8, by - 5 - up, 2, s.c4);   // shoulder of the wing
      dot(g, bx - 9, by - 6 - up, 2, 2, rgba(edge, 0.9));
    }
  }
}

function drawTail(g, s, bx, by, wag) {
  var c = s.c1, d = s.c2;
  limb(g, bx, by, bx - 6, by - 2 + wag, 3, c, d);
  limb(g, bx - 6, by - 2 + wag, bx - 11, by - 5 + wag * 1.6, 2, c, d);
  dot(g, bx - 13, by - 7 + Math.round(wag * 1.6), 3, 3, s.c3);
}

function drawHumanoid(g, s, P) {
  var c1 = s.c1, c2 = s.c2, c3 = s.c3;
  var bulk = s.bulk ? 1 : 0, lean = P.lean | 0, bob = P.bob | 0;
  var lw = 3 + bulk, aw = 2 + bulk;
  var rim = mix(c1, '#ffffff', 0.30);
  var back = mix(c1, '#000000', 0.42);

  var hipBx = HIP_B[0] + lean, hipFx = HIP_F[0] + lean, hipY = 24 + bob;
  var fBx = HIP_B[0] + P.footB[0], fBy = 24 + P.footB[1];
  var fFx = HIP_F[0] + P.footF[0], fFy = 24 + P.footF[1];
  var shBx = SH_B[0] + lean, shFx = SH_F[0] + lean, shY = 16 + bob;
  var hBx = shBx + P.handB[0], hBy = shY + P.handB[1];
  var hFx = shFx + P.handF[0], hFy = shY + P.handF[1];
  var tx = 14 - bulk + lean, tw = 8 + bulk * 2, ty = 15 + bob;

  if (s.cape) drawCape(g, s, tx + 1, ty + 1, P.cape);
  if (s.wings) drawWings(g, s, tx + 1, ty + 1, P.cape * 0.25, s.wings);
  if (s.tail) drawTail(g, s, tx + 1, 23 + bob, P.tail);

  /* back limbs sit a shade darker so the silhouette still reads at 56px */
  jointed(g, hipBx, hipY, fBx, fBy, LEG, lw, back, c2, 1);
  dot(g, fBx - 2, fBy - 1, 5, 2, c2);
  jointed(g, shBx, shY, hBx, hBy, 8, aw, back, c2, -1);
  if (s.shield) {
    var sx2 = hBx - 4;
    box(g, sx2, hBy - 7, 6, 12, mix(c1, '#ffffff', 0.12), c2);
    dot(g, sx2, hBy - 7, 6, 1, c3);
    dot(g, sx2, hBy + 4, 6, 1, c3);
    dot(g, sx2 + 1, hBy - 3, 4, 4, c3);
    dot(g, sx2 + 2, hBy - 2, 2, 2, mix(c3, '#ffffff', 0.6));
  }

  jointed(g, hipFx, hipY, fFx, fFy, LEG, lw, c1, c2, 1);
  dot(g, fFx - 2, fFy - 1, 6, 2, c2);
  dot(g, fFx + 2, fFy - 1, 2, 1, c3);

  /* torso */
  box(g, tx, ty, tw, 9, c1, c2);
  dot(g, tx, ty + 7, tw, 2, c2);                       // belt
  dot(g, tx + tw - 2, ty, 2, 8, rim);                  // rim light, front edge
  dot(g, tx, ty, tw, 1, rim);
  dot(g, tx + 2, ty + 2, 2, 3, c3);                    // core light
  dot(g, tx - 1, ty - 1, tw + 2, 2, mix(c1, '#ffffff', 0.14));   // shoulder plate
  if (s.heavy) { dot(g, tx - 2, ty - 1, 3, 4, c1); dot(g, tx + tw - 1, ty - 1, 3, 4, rim); }

  drawHead(g, s, HEADC[0] + lean, HEADC[1] + bob);

  jointed(g, shFx, shY, hFx, hFy, 8, aw, c1, c2, -1);
  drawWeapon(g, s, hFx, hFy, P.atk);
}

function drawBeast(g, s, P) {
  var c1 = s.c1, c2 = s.c2, c3 = s.c3, c4 = s.c4;
  var bulk = s.bulk ? 1 : 0, bob = P.bob | 0;
  var bodyY = 21 + bob, bodyH = 6 + bulk;
  var back = mix(c1, '#000000', 0.35);

  /* gallop: rear pair and front pair run a half cycle apart */
  var legs = [
    [11, P.footB, back], [14, P.footF, back],          // rear
    [24, P.footF, c1],  [27, P.footB, c1]              // front
  ];
  for (var i = 0; i < 2; i++) {
    var L = legs[i], lx = L[0], fx = L[0] + L[1][0] * 0.7, fy = 24 + L[1][1];
    jointed(g, lx, bodyY + bodyH, fx, fy, fy - bodyY - bodyH, 3, L[2], c2, -1);
    dot(g, fx - 2, fy - 1, 4, 2, c2);
  }
  if (s.tail) drawTail(g, s, 10, bodyY + 2, P.tail);

  /* barrel */
  box(g, 11, bodyY, 18, bodyH, c1, c2);
  dot(g, 11, bodyY, 18, 2, mix(c1, '#ffffff', 0.14));
  dot(g, 12, bodyY + bodyH - 1, 16, 2, c2);
  for (var q = 0; q < 3; q++) dot(g, 14 + q * 4, bodyY + 1, 2, 2, rgba(c3, 0.75));

  for (var j = 2; j < 4; j++) {
    var M = legs[j], mx = M[0], mfx = M[0] + M[1][0] * 0.7, mfy = 24 + M[1][1];
    jointed(g, mx, bodyY + bodyH - 1, mfx, mfy, mfy - bodyY - bodyH, 3, M[2], c2, 1);
    dot(g, mfx - 1, mfy - 1, 4, 2, c2);
    for (var cl = 0; cl < 2; cl++) dot(g, mfx + 2 + cl, mfy - 1, 1, 1, c4);
  }

  /* neck + skull + snout */
  var hx = 31, hy = 17 + bob;
  limb(g, 27, bodyY + 1, hx - 2, hy + 3, 5, c1, c2);
  box(g, hx - 4, hy - 2, 8, 7, c1, c2);
  box(g, hx + 3, hy + 1, 5, 4, c1, c2);                // muzzle
  dot(g, hx + 7, hy + 2, 2, 2, c2);                    // nose
  dot(g, hx + 1, hy, 3, 2, c3); dot(g, hx + 2, hy, 1, 1, c4);   // eye
  for (var t2 = 0; t2 < 3; t2++) dot(g, hx + 4 + t2, hy + 4, 1, 2, c4);  // teeth
  if (s.head === 'wolf') {
    pline(g, hx - 3, hy - 2, hx - 5, hy - 8, 2, c1); dot(g, hx - 6, hy - 9, 2, 2, c3);
    pline(g, hx + 1, hy - 2, hx + 1, hy - 8, 2, c1);  dot(g, hx, hy - 9, 2, 2, c3);
    for (var m = 0; m < 4; m++) pline(g, 26 - m, bodyY - 1, 24 - m, bodyY - 4 - (m % 2), 1, c3);  // mane
  } else {
    dot(g, hx - 5, hy - 5, 4, 4, c1); dot(g, hx - 4, hy - 4, 2, 2, c3);
    dot(g, hx + 1, hy - 6, 4, 4, c1); dot(g, hx + 2, hy - 5, 2, 2, c3);
  }
  if (P.atk > 0.5) {
    for (var s2 = 0; s2 < 3; s2++) pline(g, hx + 8, hy + s2 * 2, hx + 13 + s2, hy - 3 + s2 * 3, 1, rgba(c4, 0.8));
  }
}

function drawHover(g, s, P) {
  var c1 = s.c1, c2 = s.c2, c3 = s.c3, c4 = s.c4;
  var bob = P.bob | 0, y = 14 + bob, lean = P.lean | 0;

  /* thruster plume — the "legs" phase drives the flicker */
  var f = 3 + ((P.footF[0] + 6) % 3);
  for (var i = 0; i < 3; i++) {
    var w = 7 - i * 2, a = [0.85, 0.6, 0.35][i];
    dot(g, 18 - (w >> 1) + lean, y + 13 + i * 2, w, 3, rgba(i ? c3 : c4, a));
  }
  dot(g, 16 + lean, y + 19, 4, f - 1, rgba(c3, 0.35));

  box(g, 12 + lean, y, 13, 11, c1, c2);                // hull
  dot(g, 12 + lean, y, 13, 2, mix(c1, '#ffffff', 0.18));
  dot(g, 12 + lean, y + 9, 13, 2, c2);
  dot(g, 14 + lean, y + 3, 4, 4, rgba(c3, 0.9));       // reactor
  dot(g, 15 + lean, y + 4, 2, 2, c4);
  box(g, 9 + lean, y + 2, 4, 6, c2, null);             // back pod
  box(g, 24 + lean, y + 2, 4, 6, c1, c2);              // front pod
  dot(g, 27 + lean, y + 3, 2, 4, c3);
  drawHead(g, s, 18 + lean, y - 5);
  var hFx = 26 + lean + Math.round(P.atk * 4), hFy = y + 6;
  drawWeapon(g, s, hFx, hFy, P.atk);
}

function drawBody(g, s, P) {
  if (s.kind === 'beast') drawBeast(g, s, P);
  else if (s.kind === 'hover') drawHover(g, s, P);
  else drawHumanoid(g, s, P);
}

/* --------------------------------------------------------- sprite bake -- */
/* One sheet per fighter per facing. 18 cells:
     0-7  run   8-11 idle   12-15 attack   16 hit   17 hit-flash          */

var F_RUN = 0, F_IDLE = 8, F_ATK = 12, F_HIT = 16, F_FLASH = 17, CELLS = 18;

var CAN_FILTER = (function () {
  try { var g = ctx2d(mkCanvas(2, 2)); g.filter = 'blur(1px)'; return g.filter !== 'none'; }
  catch (e) { return false; }
})();

function poseFor(i, s) {
  if (i < F_IDLE) return runPose(i / 8, s);
  if (i < F_ATK) return idlePose((i - F_IDLE) / 4, s);
  if (i < F_HIT) return atkPose(i - F_ATK, s);
  return hitPose(s);
}

function bakeCell(s, i, K) {
  var cell = mkCanvas(ART_W * K, ART_H * K);
  var g = ctx2d(cell);
  var P = poseFor(i, s);

  /* neon halo: the same silhouette flooded with the trim colour, blurred */
  if (CAN_FILTER) {
    var halo = mkCanvas(ART_W * K, ART_H * K), hg = ctx2d(halo);
    hg.setTransform(K, 0, 0, K, 0, 0);
    var flood = {}; for (var k in s) flood[k] = s[k];
    flood.c1 = flood.c2 = flood.c4 = s.c3;
    if (s.grow && s.grow !== 1) {
      hg.translate(MIDX, FEET); hg.scale(s.grow, s.grow); hg.translate(-MIDX, -FEET);
    }
    drawBody(hg, flood, P);
    g.save();
    g.filter = 'blur(' + (1.1 * K).toFixed(2) + 'px)';
    g.globalAlpha = 0.42; g.drawImage(halo, 0, 0);
    g.globalAlpha = 0.24; g.drawImage(halo, 0, 0);
    g.restore();
  }

  g.setTransform(K, 0, 0, K, 0, 0);
  if (s.grow && s.grow !== 1) {
    g.translate(MIDX, FEET); g.scale(s.grow, s.grow); g.translate(-MIDX, -FEET);
  }
  drawBody(g, s, P);
  g.setTransform(1, 0, 0, 1, 0, 0);

  return cell;
}

function bakeSheets(s, K) {
  var w = ART_W * K, h = ART_H * K;
  var R = mkCanvas(w * CELLS, h), L = mkCanvas(w * CELLS, h);
  var gr = ctx2d(R), gl = ctx2d(L);
  for (var i = 0; i < CELLS; i++) {
    var cell = bakeCell(s, i === F_FLASH ? F_HIT : i, K);
    if (i === F_FLASH) {
      var fg = ctx2d(cell);
      fg.globalCompositeOperation = 'source-atop';
      fg.fillStyle = 'rgba(255,255,255,0.72)';
      fg.fillRect(0, 0, cell.width, cell.height);
      fg.globalCompositeOperation = 'source-over';
    }
    gr.drawImage(cell, i * w, 0);
    gl.save(); gl.translate((i + 1) * w, 0); gl.scale(-1, 1); gl.drawImage(cell, 0, 0); gl.restore();
  }
  return { right: R, left: L, cw: w, ch: h };
}

/* Grave markers. GRAVE_H art px tall — about half a fighter — so they read
   as scenery beside the taskbar rather than competing with the runners. */
var GRAVE_W = 16, GRAVE_H = 18;

function drawGravestone(g) {
  var dark = '#262b33', stone = '#8b95a3', lit = '#bcc6d4', shade = '#5d6672';

  /* rounded-top slab, built row by row so the cap curves properly */
  g.fillStyle = dark;                                   // silhouette + outline
  g.fillRect(4, 1, 8, 2); g.fillRect(3, 2, 10, 2); g.fillRect(2, 3, 12, 13);
  g.fillStyle = stone;                                  // face, cap curving in
  g.fillRect(5, 2, 6, 1); g.fillRect(4, 3, 8, 1); g.fillRect(3, 4, 10, 11);

  g.fillStyle = lit;  g.fillRect(4, 4, 2, 11); g.fillRect(5, 3, 3, 1);
  g.fillStyle = shade; g.fillRect(11, 4, 2, 11); g.fillRect(9, 3, 2, 1);

  g.fillStyle = shade;                                  // engraved cross
  g.fillRect(7, 7, 2, 6);
  g.fillRect(6, 8, 4, 2);

  g.fillStyle = dark;  g.fillRect(0, GRAVE_H - 3, GRAVE_W, 3);   // plinth
  g.fillStyle = stone; g.fillRect(1, GRAVE_H - 3, GRAVE_W - 2, 2);
  g.fillStyle = lit;   g.fillRect(1, GRAVE_H - 3, GRAVE_W - 2, 1);
}

function drawCross(g) {
  var wood = '#8a6b45', lit = '#b08d5e', dark = '#2a1f14', shade = '#5f4a30';
  g.fillStyle = dark; g.fillRect(6, 1, 5, GRAVE_H - 3);            // upright
  g.fillStyle = wood; g.fillRect(7, 2, 3, GRAVE_H - 5);
  g.fillStyle = lit; g.fillRect(7, 2, 1, GRAVE_H - 5);
  g.fillStyle = dark; g.fillRect(2, 5, 13, 5);                     // crossbeam
  g.fillStyle = wood; g.fillRect(3, 6, 11, 3);
  g.fillStyle = lit; g.fillRect(3, 6, 11, 1);
  g.fillStyle = shade; g.fillRect(3, 8, 11, 1);
  g.fillStyle = dark; g.fillRect(4, GRAVE_H - 3, 9, 3);            // mound
  g.fillStyle = '#3d4a3a'; g.fillRect(5, GRAVE_H - 3, 7, 2);
}

var graveSheets = null;

function bakeGraves(K) {
  var out = [];
  [drawGravestone, drawCross].forEach(function (fn) {
    var c = mkCanvas(GRAVE_W * K, GRAVE_H * K), g = ctx2d(c);
    g.setTransform(K, 0, 0, K, 0, 0);
    fn(g);
    out.push(c);
  });
  graveSheets = out;
}

/* Soft coloured blob reused for ground glow, muzzle flash and projectiles.
   Baked once per colour so runtime never touches a gradient. */
var blobCache = {};
function glowBlob(color) {
  if (blobCache[color]) return blobCache[color];
  var S = 64, c = mkCanvas(S, S), g = ctx2d(c);
  var grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, rgba(color, 0.95));
  grd.addColorStop(0.35, rgba(color, 0.42));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return (blobCache[color] = c);
}

/* --------------------------------------------------------- progression --
   A win is experience. Experience is levels. Each level bolts something new
   onto the fighter — a cape, a better weapon, wings — and levels 3 and 6 are
   full evolutions. Progress is per character, not per appearance, so RONIN-9
   carries his record across the whole session and survives a reload.

   The trick that makes this cheap: the drawn fighters are already described
   by a spec (cape, wings, weapon, headgear, bulk), so "gains wings" is one
   field and a re-bake of that character's eighteen cells — about 10ms.     */

var LEVEL_XP = [0, 1, 2, 4, 7, 10, 14];       // wins needed for levels 0..6
var MAX_LEVEL = 6;
var XP_STORE = 'arena.wallpaper.xp';

function levelFor(xp) {
  var l = 0;
  for (var i = 1; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) l = i;
  return l;
}

var WEAPON_UP = {
  blade: 'sword', dagger: 'blade', gun: 'cannon', fist: 'hammer',
  claw: 'scythe', bow: 'staff', sword: 'sword', hammer: 'hammer',
  staff: 'staff', scythe: 'scythe', cannon: 'cannon'
};

function snapshotBase(spec) {
  if (spec.base) return;
  spec.base = {
    c1: spec.c1, c3: spec.c3, wep: spec.wep, head: spec.head,
    cape: spec.cape, wings: spec.wings, heavy: spec.heavy,
    bulk: spec.bulk, shield: spec.shield, grow: 1
  };
}

/* Rebuild the spec from its base plus everything the level has earned. */
function applyProgression(spec) {
  snapshotBase(spec);
  var b = spec.base, L = spec.lvl || 0;
  spec.c1 = b.c1; spec.c3 = b.c3; spec.wep = b.wep; spec.head = b.head;
  spec.cape = b.cape; spec.wings = b.wings; spec.heavy = b.heavy;
  spec.bulk = b.bulk; spec.shield = b.shield; spec.grow = 1; spec.aura = 0;
  spec.capeBig = 0;

  if (L >= 1) spec.cape = 1;                              // a cape for the first win
  if (L >= 2) spec.wep = WEAPON_UP[b.wep] || b.wep;       // better weapon
  if (L >= 3) {                                           // EVOLUTION
    spec.wings = b.wings || (/demon|ember|malphax|obsidian|raven/.test(spec.id) ? 'bat' : 'feather');
    spec.c1 = mix(b.c1, '#ffffff', 0.18);
    spec.c3 = mix(b.c3, '#ffffff', 0.15);
    spec.grow = 1.08;
  }
  if (L >= 4) { spec.heavy = 1; spec.shield = 1; spec.capeBig = 1; }
  if (L >= 5) { spec.bulk = 1; spec.grow = 1.14; }
  if (L >= MAX_LEVEL) {                                   // FINAL FORM
    spec.head = 'royal';
    spec.capeBig = 2;
    spec.wep = 'scythe';
    spec.c1 = mix(b.c1, '#ffffff', 0.30);
    spec.c3 = mix(b.c3, '#ffffff', 0.28);
    spec.grow = 1.22;
    spec.aura = 1;
  }
}

function loadXP() {
  if (cfg.seedxp > 0) {                    // preview: everyone starts with a record
    for (var q = 0; q < ROSTER.length; q++) {
      var sq = ROSTER[q];
      sq.xp = cfg.seedxp; sq.lvl = levelFor(sq.xp); applyProgression(sq);
    }
    return;
  }
  try {
    var raw = JSON.parse(localStorage.getItem(XP_STORE) || '{}');
    for (var i = 0; i < ROSTER.length; i++) {
      var sp = ROSTER[i], v = raw[sp.id];
      if (typeof v === 'number' && v >= 0 && v < 100000) {
        sp.xp = v; sp.lvl = levelFor(v); applyProgression(sp);
      }
    }
  } catch (e) {}
}

function saveXP() {
  try {
    var out = {};
    for (var i = 0; i < ROSTER.length; i++) if (ROSTER[i].xp) out[ROSTER[i].id] = ROSTER[i].xp;
    localStorage.setItem(XP_STORE, JSON.stringify(out));
  } catch (e) {}
}

/* Award a win. Returns the new level if the fighter went up, else 0. */
function awardXP(actor, n) {
  var spec = actor.s;
  if (!cfg.levels || spec.monster) return 0;
  spec.xp = (spec.xp || 0) + (n || 1);
  var was = spec.lvl || 0, now = levelFor(spec.xp);
  if (now === was) { saveXP(); return 0; }

  spec.lvl = now;
  applyProgression(spec);
  if (bakedAt) {
    sheets[actor.i] = spec.guest ? bakeGuestSheets(spec, bakedAt) : bakeSheets(spec, bakedAt);
  }
  saveXP();
  renderBoard();

  var big = (now === 3 || now === MAX_LEVEL);
  if (now === MAX_LEVEL) fireworks.push({ x: actor.x, col: spec.c3, t: 0, next: 0, n: 7 });
  levelups.push({
    x: actor.x, t: 0, col: spec.c3, big: big,
    text: now === MAX_LEVEL ? 'FINAL FORM' : (now === 3 ? 'EVOLVED' : 'LEVEL ' + now)
  });
  burst(actor.x, V.groundY - FEET * V.S * 0.5, big ? 34 : 16,
        [spec.c3, '#ffffff', spec.c1], big ? 1.5 : 0.9);
  return now;
}

function isFinal(spec) { return (spec.lvl || 0) >= MAX_LEVEL; }

/* ---------------------------------------------------------- guest cast --
   A guest is a single still image, not a drawn skeleton, so it cannot have
   a real run cycle. It gets procedural motion instead — bob, squash on the
   footfall, a little tilt — which reads correctly at this size. Everything
   downstream (duels, defeat, graves, the shuffled bag) treats guests exactly
   like the built-in sixteen.                                              */

function guestPose(i) {
  if (i < F_IDLE) {                               // run: a bounding hop
    var p = i / 8, b = Math.sin(p * Math.PI * 2), land = Math.max(0, -b);
    return { dx: 0, dy: 0, lift: 2.4 * Math.max(0, b),
             sx: 1 + land * 0.10, sy: 1 - land * 0.12, rot: b * 0.075 };
  }
  if (i < F_ATK) {                                // idle: breathing
    var q = Math.sin((i - F_IDLE) / 4 * Math.PI * 2);
    return { dx: 0, dy: 0, lift: 0.5 * Math.max(0, q), sx: 1, sy: 1 + q * 0.02, rot: 0 };
  }
  if (i < F_HIT) {                                // attack: wind up, lunge
    var K = [-0.45, 1, 0.7, 0.2][i - F_ATK];
    return { dx: K * 5, dy: 0, lift: Math.max(0, K) * 1.5,
             sx: 1 + K * 0.06, sy: 1 - K * 0.04, rot: K * 0.16 };
  }
  return { dx: -3, dy: 0, lift: 0, sx: 1.04, sy: 0.96, rot: -0.22 };   // hit
}

function paintGuestCell(g, spec, P, K) {
  g.save();
  g.setTransform(K, 0, 0, K, 0, 0);
  g.translate(MIDX + P.dx, FEET + P.dy - P.lift);
  g.rotate(P.rot);
  g.scale(P.sx * (spec.grow || 1), P.sy * (spec.grow || 1));
  /* Upscaling pixel art with bilinear turns it to mush, and downscaling with
     nearest drops whole rows. Pick per sprite by which way we're going. */
  g.imageSmoothingEnabled = (spec.dw * K) < spec.sw * 0.95;
  g.imageSmoothingQuality = 'high';
  try {
    g.drawImage(spec.img, spec.sx0, spec.sy0, spec.sw, spec.sh,
                -spec.dw / 2, -spec.dh, spec.dw, spec.dh);
  } catch (e) { /* a broken image must never take the wallpaper down */ }
  g.restore();
}

function bakeGuestSheets(spec, K) {
  var w = ART_W * K, h = ART_H * K;
  var R = mkCanvas(w * CELLS, h), L = mkCanvas(w * CELLS, h);
  var gr = ctx2d(R), gl = ctx2d(L);

  for (var i = 0; i < CELLS; i++) {
    var P = guestPose(i === F_FLASH ? F_HIT : i);
    var cell = mkCanvas(w, h), g = ctx2d(cell);

    if (CAN_FILTER) {                             // neon halo from the silhouette
      var sil = mkCanvas(w, h), sgx = ctx2d(sil);
      paintGuestCell(sgx, spec, P, K);
      sgx.setTransform(1, 0, 0, 1, 0, 0);
      sgx.globalCompositeOperation = 'source-in';
      sgx.fillStyle = spec.c3; sgx.fillRect(0, 0, w, h);
      g.save();
      g.filter = 'blur(' + (1.3 * K).toFixed(2) + 'px)';
      g.globalAlpha = 0.45; g.drawImage(sil, 0, 0);
      g.globalAlpha = 0.25; g.drawImage(sil, 0, 0);
      g.restore();
    }

    paintGuestCell(g, spec, P, K);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (i === F_FLASH) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(255,255,255,0.72)';
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
    }
    gr.drawImage(cell, i * w, 0);
    gl.save(); gl.translate((i + 1) * w, 0); gl.scale(-1, 1); gl.drawImage(cell, 0, 0); gl.restore();
  }
  return { right: R, left: L, cw: w, ch: h };
}

var sheets = [];            // parallel to ROSTER
var bakedAt = 0;            // scale the current sheets were baked at

function bakeAll(K, onDone) {
  bakedAt = K; sheets = new Array(ROSTER.length);
  for (var q = 0; q < ROSTER.length; q++) if (ROSTER[q].lvl) applyProgression(ROSTER[q]);
  blobCache = {};
  bakeGraves(K);
  var i = 0;
  (function chunk() {
    var t0 = (window.performance || Date).now();
    while (i < ROSTER.length && (window.performance || Date).now() - t0 < 12) {
      sheets[i] = ROSTER[i].guest ? bakeGuestSheets(ROSTER[i], K) : bakeSheets(ROSTER[i], K);
      i++;
    }
    if (i < ROSTER.length) requestAnimationFrame(chunk); else onDone();
  })();
}

/* --------------------------------------------------------------- view --- */

var sceneEl = document.getElementById('scene'),
    skyEl   = document.getElementById('sky'),
    beamEl  = document.getElementById('beam'),
    fxEl    = document.getElementById('fx'),
    marksEl = document.getElementById('marks'),
    gradeEl = document.getElementById('grade'),
    bootEl  = document.getElementById('boot');
var sg = ctx2d(sceneEl, false), fg = ctx2d(fxEl, true), bg = ctx2d(beamEl, true),
    sy = ctx2d(skyEl, true);

var V = {};   // live view metrics

function measure() {
  var W = Math.max(320, window.innerWidth), H = Math.max(240, window.innerHeight);
  var dpr = Math.min(cfg.maxDpr, window.devicePixelRatio || 1);
  var solo = cfg.panel >= 0;                       // one instance per monitor
  var panelW = solo ? W : W / cfg.screens;
  var S = cfg.scale;
  var groundY = Math.max(40, H - cfg.taskbar);
  var stripTop = Math.max(0, Math.round(groundY - (FEET * S + 52)));

  /* The portal is the sun by day and the moon by night, and it keeps real
     hours: rising on the left, peaking at midday or midnight, setting right. */
  var VW0 = solo ? W * cfg.screens : W;
  var hf = cfg.hour >= 0 ? cfg.hour : 13;
  if (cfg.hour < 0 && cfg.ambient) {
    var dn = new Date(); hf = dn.getHours() + dn.getMinutes() / 60;
  }
  var isDay = hf >= 6 && hf < 18;
  var arc = isDay ? (hf - 6) / 12 : ((hf >= 18 ? hf - 18 : hf + 6) / 12);
  var sunR = Math.max(30, Math.min(150, H * 0.058));
  var sun = {
    day: isDay, p: arc, r: sunR, hour: hf,
    x: VW0 * (0.14 + 0.72 * arc),
    y: Math.round(H * (0.34 - 0.16 * Math.sin(Math.PI * arc)))
  };
  /* The fall happens on a separate, narrow, full-height canvas that only
     exists while someone is actually falling — so the per-frame clear stays
     a bottom strip, not the whole screen. */

  V = {
    W: W, H: H, dpr: dpr, S: S,
    U: Math.min(2.4, Math.max(0.7, H / 1080)),     // scene scale vs. a 1080p screen
    VW: solo ? W * cfg.screens : W,                // virtual span width
    OFF: solo ? cfg.panel * W : 0,                 // virtual x of this window's left edge
    panelW: panelW, panels: cfg.screens,
    groundY: groundY, stripTop: stripTop, stripH: H - stripTop, sun: sun,
    cellW: ART_W * S, cellH: ART_H * S,
    dprInt: Math.max(1, Math.min(3, Math.round(dpr)))
  };

  sceneEl.width = Math.round(W * dpr); sceneEl.height = Math.round(H * dpr);
  sceneEl.style.width = W + 'px'; sceneEl.style.height = H + 'px';
  fxEl.width = Math.round(W * dpr); fxEl.height = Math.round(V.stripH * dpr);
  fxEl.style.width = W + 'px'; fxEl.style.height = V.stripH + 'px';
  fxEl.style.top = V.stripTop + 'px';

  var bw = Math.max(320, Math.round(sun.r * 7));
  V.beamW = bw;
  V.beamL = Math.round(sun.x - V.OFF - bw / 2);
  beamEl.width = Math.round(bw * dpr); beamEl.height = Math.round(groundY * dpr);
  beamEl.style.width = bw + 'px'; beamEl.style.height = groundY + 'px';
  beamEl.style.left = V.beamL + 'px'; beamEl.style.top = '0px';

  skyEl.width = Math.round(W * dpr); skyEl.height = Math.round(groundY * dpr);
  skyEl.style.width = W + 'px'; skyEl.style.height = groundY + 'px';
  sg = ctx2d(sceneEl, false); fg = ctx2d(fxEl, true); bg = ctx2d(beamEl, true);
  sy = ctx2d(skyEl, true);
}

/* deterministic PRNG so the skyline is stable across repaints */
function seeded(seed) {
  var s = seed >>> 0;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* --------------------------------------------------------------- scene --
   A painted valley that runs continuously across the whole span, changing
   biome from left to right: deep rainforest, then a waterfall gorge at the
   centre, then terraced fields and a stilt village. Everything is seeded,
   drawn in virtual coordinates minus V.OFF (so per-monitor instances line
   up across the bezel), and repainted only on resize or the ten-minute
   ambient tick — never per frame.                                          */

function nightAmt(h) {
  if (h >= 8 && h < 16.5) return 0;
  if (h >= 16.5 && h < 19.5) return (h - 16.5) / 3;
  if (h >= 19.5 || h < 5) return 1;
  return 1 - (h - 5) / 3;                      // 5..8 dawn
}
function duskAmt(h) {                          // warm cast at both twilights
  var d1 = Math.max(0, 1 - Math.abs(h - 6.6) / 1.6);
  var d2 = Math.max(0, 1 - Math.abs(h - 17.6) / 1.6);
  return Math.max(d1, d2);
}

function wseed(n) { return seeded((cfg.seed * 977 + n) >>> 0); }

/* The valley's layout is itself rolled from the seed: where the gorge sits,
   which side the rainforest holds, how dense the village is. Same seed,
   same valley — a different machine gets a different one. */
var LAYOUT = null;
function layout() {
  if (LAYOUT && LAYOUT.seed === cfg.seed) return LAYOUT;
  var r = wseed(1);
  LAYOUT = {
    seed: cfg.seed,
    gorgeU: 0.40 + r() * 0.20,          // the falls wander around mid-span
    mirror: r() < 0.5,                  // half of all valleys run village→forest
    huts: 6 + (r() * 6) | 0,
    giants: 4 + (r() * 4) | 0
  };
  return LAYOUT;
}
function bu(u) { return layout().mirror ? 1 - u : u; }   // biome-space u

/* biome weights along the span, u = x / VW (already biome-space) */
function wForest(u)  { var g = layout().gorgeU; return Math.max(0, Math.min(1, (g + 0.05 - bu(u)) / 0.18 + 0.4)); }
function wVillage(u) { var g = layout().gorgeU; return Math.max(0, Math.min(1, (bu(u) - g - 0.06) / 0.16)); }

function paintScene() {
  var W = V.W, H = V.H, G = V.groundY, U = V.U, OFF = V.OFF, VW = V.VW;
  var h = V.sun.hour, nite = nightAmt(h), dusk = duskAmt(h);
  sg.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
  sg.clearRect(0, 0, W, H);

  /* sky */
  var top = mix(mix('#4e9fd6', '#060d22', nite), '#7a4a6e', dusk * 0.45);
  var mid = mix(mix('#9fd0e8', '#0d1e38', nite), '#e08a56', dusk * 0.55);
  var hor = mix(mix('#d8ecda', '#14304a', nite), '#f2b070', dusk * 0.6);
  var sky = sg.createLinearGradient(0, 0, 0, G);
  sky.addColorStop(0, top); sky.addColorStop(0.62, mid); sky.addColorStop(1, hor);
  sg.fillStyle = sky; sg.fillRect(0, 0, W, G);

  /* stars */
  if (nite > 0.25) {
    var rs = wseed(31);
    sg.fillStyle = 'rgba(235,244,255,' + (0.75 * (nite - 0.25) / 0.75).toFixed(3) + ')';
    for (var st = 0; st < 140; st++) {
      var sxx = rs() * VW - OFF, syy = rs() * G * 0.65, rr2 = rs();
      if (sxx < -4 || sxx > W + 4) continue;
      sg.fillRect(sxx, syy, rr2 > 0.9 ? 2 : 1, rr2 > 0.9 ? 2 : 1);
    }
  }

  /* light around the portal-sun */
  var sunSX = V.sun.x - OFF;
  if (sunSX > -W && sunSX < W * 2) {
    var warm = V.sun.day ? '255,214,140' : '190,210,255';
    var glowA = V.sun.day ? 0.5 : 0.34;
    var gl = sg.createRadialGradient(sunSX, V.sun.y, 0, sunSX, V.sun.y, H * 0.55);
    gl.addColorStop(0, 'rgba(' + warm + ',' + glowA + ')');
    gl.addColorStop(0.4, 'rgba(' + warm + ',' + (glowA * 0.3).toFixed(3) + ')');
    gl.addColorStop(1, 'rgba(' + warm + ',0)');
    sg.fillStyle = gl;
    sg.fillRect(sunSX - H * 0.6, V.sun.y - H * 0.6, H * 1.2, H * 1.2);
  }

  /* clouds */
  var rc = wseed(47);
  for (var cl = 0; cl < 9; cl++) {
    var cx2 = rc() * VW - OFF, cy2 = G * (0.1 + rc() * 0.3);
    var cw2 = (120 + rc() * 260) * U, chh = cw2 * (0.16 + rc() * 0.08);
    if (cx2 < -cw2 || cx2 > W + cw2) continue;
    sg.fillStyle = rgba(mix('#ffffff', '#26364f', nite), 0.10 + rc() * 0.08);
    sg.beginPath(); sg.ellipse(cx2, cy2, cw2, chh, 0, 0, 7); sg.fill();
    sg.beginPath(); sg.ellipse(cx2 - cw2 * 0.4, cy2 + chh * 0.4, cw2 * 0.55, chh * 0.7, 0, 0, 7); sg.fill();
  }

  ridge(23, G - 300 * U, 90 * U,
        mix(mix('#7fae9c', '#132b3d', nite), '#c98a6a', dusk * 0.3),
        mix(mix('#5d9483', '#0e2233', nite), '#a86e52', dusk * 0.3));
  ridge(59, G - 210 * U, 70 * U,
        mix(mix('#4f8a66', '#0c1e2c', nite), '#8a6248', dusk * 0.25),
        mix(mix('#39704e', '#091723', nite), '#6e4c38', dusk * 0.25));

  forest(G, U, nite);
  waterfallGorge(G, U, nite);
  village(G, U, nite);

  /* ground band: forest floor on the left drying to a village path right */
  var gnd = sg.createLinearGradient(0 - OFF, 0, VW - OFF, 0);
  gnd.addColorStop(0, mix('#2c4a2e', '#0a1410', nite));
  gnd.addColorStop(0.5, mix('#33503a', '#0c1713', nite));
  gnd.addColorStop(1, mix('#5c4a33', '#171410', nite));
  sg.fillStyle = gnd; sg.fillRect(0, G, W, H - G);
  var gl2 = sg.createLinearGradient(0, G - 16 * U, 0, G);
  gl2.addColorStop(0, 'rgba(0,0,0,0)');
  gl2.addColorStop(1, rgba(mix('#e8f2c8', '#28425c', nite), 0.28));
  sg.fillStyle = gl2; sg.fillRect(0, G - 16 * U, W, 16 * U);
  sg.fillStyle = rgba(mix('#f2f8dc', '#9fc4e8', nite), nite > 0.5 ? 0.22 : 0.4);
  sg.fillRect(0, G, W, Math.max(1, Math.round(1.4 * U)));

  /* grass tufts / village lanterns along the edge */
  var rg = wseed(83);
  for (var gt = 0; gt < VW / (26 * U); gt++) {
    var gx2 = rg() * VW, u2 = gx2 / VW, gsx = gx2 - OFF;
    if (gsx < -8 || gsx > W + 8) continue;
    if (wVillage(u2) > 0.6 && rg() < 0.2) {
      sg.fillStyle = rgba('#ffb45e', 0.35 + nite * 0.6);      // lantern
      sg.fillRect(gsx, G - 7 * U, 2 * U, 2 * U);
      sg.fillStyle = rgba('#5c4a33', 0.8);
      sg.fillRect(gsx + 0.6 * U, G - 5 * U, 0.8 * U, 5 * U);
    } else if (wForest(u2) > 0.3) {
      sg.strokeStyle = rgba(mix('#4a7a44', '#12241c', nite), 0.7);
      sg.lineWidth = Math.max(1, U * 0.8);
      sg.beginPath();
      sg.moveTo(gsx, G); sg.lineTo(gsx + (rg() - 0.5) * 5 * U, G - (3 + rg() * 5) * U);
      sg.stroke();
    }
  }

  /* fireflies deep in the forest at night */
  if (nite > 0.5) {
    var rf = wseed(101);
    for (var ff = 0; ff < 40; ff++) {
      var fx2 = rf() * VW, fu = fx2 / VW, fsx = fx2 - OFF;
      if (wForest(fu) < 0.4 || fsx < 0 || fsx > W) continue;
      sg.fillStyle = rgba('#d8ff8a', 0.25 + rf() * 0.45);
      sg.fillRect(fsx, G - (20 + rf() * 130) * U, 2, 2);
    }
  }

  /* valley mist */
  var mist = sg.createLinearGradient(0, G - 90 * U, 0, G);
  mist.addColorStop(0, 'rgba(210,230,235,0)');
  mist.addColorStop(1, rgba(mix('#dcecec', '#1c3346', nite), 0.16));
  sg.fillStyle = mist; sg.fillRect(0, G - 90 * U, W, 90 * U);

  /* god rays fanning down from the portal-sun by day */
  var sunSX2 = V.sun.x - OFF;
  if (nite < 0.6 && sunSX2 > -W * 0.5 && sunSX2 < W * 1.5) {
    sg.save();
    sg.globalCompositeOperation = 'lighter';
    var rayA = (0.06 - nite * 0.08);
    for (var ry = 0; ry < 5; ry++) {
      var ang = -0.5 + ry * 0.25 + (cfg.seed % 7) * 0.03;
      var rw = (30 + ry * 14) * U;
      var ray = sg.createLinearGradient(sunSX2, V.sun.y, sunSX2 + Math.sin(ang) * H, G);
      ray.addColorStop(0, 'rgba(255,236,180,' + Math.max(0, rayA).toFixed(3) + ')');
      ray.addColorStop(1, 'rgba(255,236,180,0)');
      sg.fillStyle = ray;
      sg.beginPath();
      sg.moveTo(sunSX2, V.sun.y);
      sg.lineTo(sunSX2 + Math.sin(ang) * H - rw, G);
      sg.lineTo(sunSX2 + Math.sin(ang) * H + rw, G);
      sg.closePath(); sg.fill();
    }
    sg.restore();
  }

  bloomPass(nite);
}

/* A cheap true bloom: the finished scene, downsampled and blurred, added
   back over itself. Runs at paint time only, so it costs one frame per
   repaint, not per frame. */
function bloomPass(nite) {
  if (!CAN_FILTER) return;
  try {
    var bw = Math.max(64, V.W >> 2), bh = Math.max(36, V.H >> 2);
    var off = mkCanvas(bw, bh), og = ctx2d(off);
    og.filter = 'blur(' + Math.max(3, 5 * V.U).toFixed(1) + 'px) saturate(1.25)';
    og.drawImage(sceneEl, 0, 0, bw, bh);
    sg.save();
    sg.globalCompositeOperation = 'lighter';
    sg.globalAlpha = 0.10 + nite * 0.10;
    sg.drawImage(off, 0, 0, V.W, V.H);
    sg.restore();
  } catch (e) { /* a scene without bloom is still a scene */ }
}

/* rolling ridge line filled to the ground, drawn with a horizontal gradient
   so the biome hue drifts smoothly left to right */
function ridge(seed, baseY, amp, colL, colR) {
  var r = wseed(seed), W = V.W, OFF = V.OFF;
  var p1 = r() * 7, p2 = r() * 7, f1 = 0.0022 + r() * 0.001, f2 = 0.005 + r() * 0.002;
  var grad = sg.createLinearGradient(-OFF, 0, V.VW - OFF, 0);
  grad.addColorStop(0, colL); grad.addColorStop(1, colR);
  sg.fillStyle = grad;
  sg.beginPath();
  sg.moveTo(-4, V.groundY);
  for (var x = -4; x <= W + 4; x += 6) {
    var vx = x + OFF;
    sg.lineTo(x, baseY + Math.sin(vx * f1 + p1) * amp + Math.sin(vx * f2 + p2) * amp * 0.35);
  }
  sg.lineTo(W + 4, V.groundY);
  sg.closePath(); sg.fill();
}

/* layered rainforest canopy with a few emergent crowns */
function forest(G, U, nite) {
  var layers = [
    [131, 150, 46, mix('#2e6b46', '#0a1f24', nite)],
    [173, 96, 38, mix('#3d8a52', '#0d2a2c', nite)],
    [211, 52, 30, mix('#54a862', '#123a34', nite)]
  ];
  for (var L = 0; L < layers.length; L++) {
    var r = wseed(layers[L][0]), baseY = G - layers[L][1] * U, blob = layers[L][2] * U;
    sg.fillStyle = layers[L][3];
    sg.beginPath();
    sg.moveTo(-6, G + 4);
    for (var x = -6; x <= V.W + 6; x += blob * 0.6) {
      var u = (x + V.OFF) / V.VW, w = wForest(u);
      if (w < 0.03) { sg.lineTo(x, G + 4); continue; }
      var y = baseY + (r() - 0.5) * 26 * U + (1 - w) * (G - baseY) * 0.9;
      sg.arc(x, y, blob * (0.7 + r() * 0.5) * (0.35 + w * 0.65), Math.PI, 0);
    }
    sg.lineTo(V.W + 6, G + 4);
    sg.closePath(); sg.fill();
  }
  /* emergent giants: broad crowns clear of the canopy, buttressed trunks */
  var re = wseed(251);
  for (var t = 0; t < layout().giants; t++) {
    var vx = re() * V.VW, u2 = vx / V.VW, x2 = vx - V.OFF;
    var gu2 = layout().mirror ? 1 - layout().gorgeU : layout().gorgeU;
    if (wForest(u2) < 0.55 || Math.abs(u2 - gu2) < 0.09 || x2 < -120 || x2 > V.W + 120) continue;
    var th = (165 + re() * 45) * U, tw = (9 + re() * 4) * U;
    var lean = (re() - 0.5) * 14 * U;
    var trunk = mix('#4a3826', '#0e0b08', nite);
    var crown = mix('#57a865', '#123a30', nite);
    var crownL = mix('#79c47e', '#1a4a3a', nite);
    sg.strokeStyle = trunk; sg.lineCap = 'round';
    sg.lineWidth = tw;
    sg.beginPath(); sg.moveTo(x2, G + 2); sg.quadraticCurveTo(x2 + lean * 0.4, G - th * 0.55, x2 + lean, G - th); sg.stroke();
    sg.lineWidth = tw * 0.5;                            // two main boughs
    sg.beginPath(); sg.moveTo(x2 + lean * 0.7, G - th * 0.8);
    sg.lineTo(x2 + lean - 26 * U, G - th - 10 * U); sg.stroke();
    sg.beginPath(); sg.moveTo(x2 + lean * 0.7, G - th * 0.8);
    sg.lineTo(x2 + lean + 24 * U, G - th - 6 * U); sg.stroke();
    var cxT = x2 + lean, cyT = G - th - 8 * U;
    var puffs = [[-52, 8, 44], [50, 4, 40], [0, -22, 56], [-22, -8, 40], [26, -14, 38]];
    for (var b = 0; b < puffs.length; b++) {
      sg.fillStyle = b === 2 ? crownL : crown;
      sg.beginPath();
      sg.ellipse(cxT + puffs[b][0] * U, cyT + puffs[b][1] * U,
                 puffs[b][2] * U * (0.85 + re() * 0.3), puffs[b][2] * 0.55 * U, 0, 0, 7);
      sg.fill();
    }
  }
}

/* the centrepiece: a gorge with falls at mid-span */
function waterfallGorge(G, U, nite) {
  var gu = layout().mirror ? 1 - layout().gorgeU : layout().gorgeU;
  var cx = V.VW * gu - V.OFF, W2 = 240 * U;
  if (cx < -W2 * 2 || cx > V.W + W2 * 2) return;
  var topY = G - 195 * U;
  var rock = mix('#5a5348', '#141410', nite), rockL = mix('#726a58', '#1c1b16', nite);
  var water = mix('#bfe8f0', '#3d6e8a', nite * 0.8), foam = mix('#ffffff', '#7aa8c8', nite * 0.7);

  /* the shadowed back wall of the gorge, falls pouring out of it */
  var gapW = 78 * U;
  var back = sg.createLinearGradient(0, topY, 0, G);
  back.addColorStop(0, mix('#2c2822', '#070706', nite));
  back.addColorStop(1, mix('#1c1a16', '#040404', nite));
  sg.fillStyle = back;
  sg.fillRect(cx - gapW / 2 - 8 * U, topY - 4 * U, gapW + 16 * U, G - topY + 4 * U);

  /* cliff shoulders, stepped */
  var r = wseed(307);
  [-1, 1].forEach(function (dir) {
    var grd = sg.createLinearGradient(cx + dir * gapW / 2, 0, cx + dir * (gapW / 2 + 170 * U), 0);
    grd.addColorStop(0, rock); grd.addColorStop(1, rockL);
    sg.fillStyle = grd;
    sg.beginPath();
    var px = cx + dir * gapW / 2;
    sg.moveTo(px, topY - 2 * U);
    for (var y = topY; y < G; y += 30 * U) {
      px += dir * (10 + r() * 20) * U;
      sg.lineTo(px, y + 14 * U);
      sg.lineTo(px + dir * 6 * U, y + 30 * U);
    }
    sg.lineTo(cx + dir * (gapW / 2 + 200 * U), G + 4);
    sg.lineTo(cx + dir * gapW / 2, G + 4);
    sg.closePath(); sg.fill();
    sg.strokeStyle = rgba(mix('#8a8070', '#242018', nite), 0.5);   // strata
    sg.lineWidth = Math.max(1, U);
    for (var sy = topY + 26 * U; sy < G - 20 * U; sy += 34 * U) {
      sg.beginPath();
      sg.moveTo(cx + dir * (gapW / 2 + 8 * U), sy);
      sg.lineTo(cx + dir * (gapW / 2 + (60 + r() * 90) * U), sy + (r() - 0.5) * 10 * U);
      sg.stroke();
    }
  });
  /* lip the water pours over */
  sg.fillStyle = rockL;
  sg.fillRect(cx - gapW / 2 - 10 * U, topY - 9 * U, gapW + 20 * U, 9 * U);
  sg.fillStyle = rgba(foam, 0.85);
  sg.fillRect(cx - gapW / 2, topY - 4 * U, gapW, 4 * U);

  /* three streams: a broad main fall and two side threads */
  [[0, 34], [-26, 12], [24, 9]].forEach(function (f) {
    var fx = cx + f[0] * U, fw = f[1] * U;
    var fall = sg.createLinearGradient(0, topY, 0, G);
    fall.addColorStop(0, rgba(foam, 0.95));
    fall.addColorStop(0.25, rgba(water, 0.85));
    fall.addColorStop(0.8, rgba(water, 0.7));
    fall.addColorStop(1, rgba(foam, 0.95));
    sg.fillStyle = fall;
    sg.fillRect(fx - fw / 2, topY - 2 * U, fw, G - topY + 2 * U);
    var rf = wseed(401 + f[0]);
    sg.fillStyle = rgba('#ffffff', nite > 0.5 ? 0.35 : 0.55);
    for (var st = 0; st < 8; st++) {
      sg.fillRect(fx - fw / 2 + rf() * fw, topY + rf() * (G - topY),
                  Math.max(1, U * 1.2), (8 + rf() * 16) * U);
    }
  });

  /* boulders, plunge pool, spray */
  sg.fillStyle = rock;
  sg.beginPath(); sg.ellipse(cx - 44 * U, G - 4 * U, 16 * U, 8 * U, 0, 0, 7); sg.fill();
  sg.beginPath(); sg.ellipse(cx + 40 * U, G - 3 * U, 12 * U, 6 * U, 0, 0, 7); sg.fill();
  sg.fillStyle = rgba(water, 0.8);
  sg.beginPath(); sg.ellipse(cx, G - U, 92 * U, 10 * U, 0, 0, 7); sg.fill();
  sg.fillStyle = rgba(foam, 0.55);
  sg.beginPath(); sg.ellipse(cx - 6 * U, G - 3 * U, 46 * U, 5 * U, 0, 0, 7); sg.fill();
  sg.beginPath(); sg.ellipse(cx + 30 * U, G - 2 * U, 20 * U, 3.5 * U, 0, 0, 7); sg.fill();
  for (var m = 0; m < 5; m++) {
    sg.fillStyle = rgba('#eef6f6', 0.12 - m * 0.018);
    sg.beginPath();
    sg.ellipse(cx + (m - 2) * 26 * U, G - (14 + m * 15) * U, (40 + m * 18) * U, (11 + m * 5) * U, 0, 0, 7);
    sg.fill();
  }
}

/* stilt huts and terraces on the right */
function village(G, U, nite) {
  var r = wseed(613);
  /* terraced hillside behind the huts */
  for (var tr = 0; tr < 5; tr++) {
    var ty = G - (46 + tr * 26) * U;
    var band = mix(tr % 2 ? '#7da05a' : '#8fae62', tr % 2 ? '#15251c' : '#182a1e', nite);
    var grad = sg.createLinearGradient(-V.OFF, 0, V.VW - V.OFF, 0);
    if (layout().mirror) {
      grad.addColorStop(0, rgba(band, 0.95));
      grad.addColorStop(0.14, rgba(band, 0.85));
      grad.addColorStop(0.32, rgba(band, 0));
      grad.addColorStop(1, rgba(band, 0));
    } else {
      grad.addColorStop(0, rgba(band, 0));
      grad.addColorStop(0.68, rgba(band, 0));
      grad.addColorStop(0.86, rgba(band, 0.85));
      grad.addColorStop(1, rgba(band, 0.95));
    }
    sg.fillStyle = grad;
    sg.beginPath();
    sg.moveTo(-4, ty + 20 * U);
    for (var x = -4; x <= V.W + 4; x += 30) {
      sg.lineTo(x, ty + Math.sin((x + V.OFF) * 0.004 + tr) * 8 * U);
    }
    sg.lineTo(V.W + 4, G + 4); sg.lineTo(-4, G + 4);
    sg.closePath(); sg.fill();
  }
  /* huts */
  for (var hN = 0; hN < layout().huts; hN++) {
    var vu = layout().mirror ? r() * 0.4 : 0.6 + r() * 0.38;
    var vx = V.VW * vu, u2 = vx / V.VW, x2 = vx - V.OFF;
    var wv = wVillage(u2);
    if (wv < 0.35 || x2 < -80 || x2 > V.W + 80) continue;
    var hw = (38 + r() * 22) * U, hh = hw * 0.62;
    var back = r() < 0.4;
    var lift = back ? (34 + r() * 40) * U : 0;         // some sit up the hill
    var hy = G - lift;
    var wall = mix(back ? '#6e5a40' : '#7d6748', '#191712', nite);
    var roof = mix(back ? '#4a3a28' : '#57432c', '#100e0a', nite);
    var sc = back ? 0.72 : 1;
    hw *= sc; hh *= sc;
    /* stilts */
    sg.strokeStyle = roof; sg.lineWidth = Math.max(1.5, 2.4 * U * sc);
    sg.beginPath();
    sg.moveTo(x2 - hw * 0.32, hy); sg.lineTo(x2 - hw * 0.32, hy - hh * 0.5);
    sg.moveTo(x2 + hw * 0.32, hy); sg.lineTo(x2 + hw * 0.32, hy - hh * 0.5);
    sg.stroke();
    /* body */
    sg.fillStyle = wall;
    sg.fillRect(x2 - hw / 2, hy - hh * 0.5 - hh * 0.66, hw, hh * 0.66);
    /* door and window, warm at night */
    sg.fillStyle = rgba('#ffc87a', 0.35 + nite * 0.62);
    sg.fillRect(x2 - hw * 0.3, hy - hh * 0.5 - hh * 0.52, hw * 0.16, hh * 0.3);
    sg.fillRect(x2 + hw * 0.1, hy - hh * 0.5 - hh * 0.56, hw * 0.2, hh * 0.34);
    /* porch rail */
    sg.strokeStyle = roof; sg.lineWidth = Math.max(1, 1.2 * U * sc);
    sg.beginPath();
    sg.moveTo(x2 - hw * 0.6, hy - hh * 0.5);
    sg.lineTo(x2 + hw * 0.6, hy - hh * 0.5);
    sg.stroke();
    /* roof: deep thatch triangle with overhang */
    sg.fillStyle = roof;
    sg.beginPath();
    sg.moveTo(x2 - hw * 0.72, hy - hh * 0.5 - hh * 0.6);
    sg.lineTo(x2, hy - hh * 0.5 - hh * 1.35);
    sg.lineTo(x2 + hw * 0.72, hy - hh * 0.5 - hh * 0.6);
    sg.closePath(); sg.fill();
  }
}

/* -------------------------------------------------------------- portal --
   The portal is a slowly turning pentagonal ring rendered by three.js into
   its own small transparent canvas, positioned where the sun or moon would
   hang. Gold and blazing by day, silver and cool by night. If WebGL is not
   available it falls back to a flat pentagon drawn on the same canvas.     */

var portalDom = null, P3 = null, portal2d = null;

function ensurePortal() {
  if (!marksEl) return;
  if (!cfg.portal) { if (portalDom) portalDom.style.display = 'none'; return; }
  if (!portalDom) {
    portalDom = document.createElement('div');
    portalDom.id = 'portal';
    portalDom.appendChild(document.createElement('canvas'));
    marksEl.appendChild(portalDom);
    initPortal3D(portalDom.firstChild);
  }
  portalDom.style.display = 'block';
  var sz = Math.round(V.sun.r * 3.2);
  portalDom.style.left = Math.round(V.sun.x - V.OFF - sz / 2) + 'px';
  portalDom.style.top = Math.round(V.sun.y - sz / 2) + 'px';
  portalDom.style.width = sz + 'px';
  portalDom.style.height = sz + 'px';
  if (P3 && P3.size !== sz) { P3.size = sz; P3.renderer.setSize(sz, sz, false); }
  if (!P3 && portal2d) { portal2d.width = sz; portal2d.height = sz; }
  portalTick(0, true);
}

function pentShape(r) {
  var sh = new THREE.Shape();
  for (var i = 0; i < 5; i++) {
    var a = Math.PI / 2 + i * Math.PI * 2 / 5;
    if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  sh.closePath();
  return sh;
}

function initPortal3D(canvas) {
  if (typeof THREE === 'undefined') { portal2d = canvas; return; }
  try {
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    var scene = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    cam.position.z = 8.2;

    var shape = pentShape(2.05);
    shape.holes.push(pentShape(1.5));
    var geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.55, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.13, bevelSegments: 2
    });
    geo.center();
    var ringMat = new THREE.MeshStandardMaterial({
      color: 0xffc457, emissive: 0xff9420, emissiveIntensity: 0.55,
      metalness: 0.55, roughness: 0.35
    });
    var ring = new THREE.Mesh(geo, ringMat);

    var discMat = new THREE.MeshBasicMaterial({ color: 0xfff2c9, transparent: true, opacity: 0.95 });
    var disc = new THREE.Mesh(new THREE.ShapeGeometry(pentShape(1.52)), discMat);
    disc.position.z = -0.1;

    var grp = new THREE.Group();
    grp.add(ring); grp.add(disc);
    scene.add(grp);
    scene.add(new THREE.AmbientLight(0x8899aa, 0.9));
    var key = new THREE.PointLight(0xffffff, 1.3); key.position.set(4, 6, 8); scene.add(key);

    P3 = { renderer: renderer, scene: scene, cam: cam, grp: grp,
           ring: ringMat, disc: discMat, t: 0, flare: 0, frame: 0, size: 0 };
  } catch (e) {
    P3 = null; portal2d = canvas;
    console.warn('[arena] WebGL unavailable, flat portal:', e.message);
  }
}

function portalFlare() { if (P3) P3.flare = 1.2; }

function portalTick(dt, force) {
  if (!cfg.portal || !portalDom) return;
  var day = V.sun.day;

  if (!P3) {                                    // 2D fallback
    if (!portal2d || (!force && (frameNo & 3))) return;
    var g2 = portal2d.getContext('2d'), S2 = portal2d.width;
    g2.clearRect(0, 0, S2, S2);
    g2.save();
    g2.translate(S2 / 2, S2 / 2);
    g2.rotate(Math.sin(clock * 0.25) * 0.18);
    var R2 = S2 * 0.31;
    g2.strokeStyle = day ? '#ffb347' : '#aabde0';
    g2.lineWidth = S2 * 0.07;
    g2.lineJoin = 'round';
    g2.fillStyle = day ? 'rgba(255,242,201,0.95)' : 'rgba(230,239,255,0.9)';
    g2.beginPath();
    for (var i = 0; i <= 5; i++) {
      var a = -Math.PI / 2 + i * Math.PI * 2 / 5;
      i ? g2.lineTo(Math.cos(a) * R2, Math.sin(a) * R2) : g2.moveTo(Math.cos(a) * R2, Math.sin(a) * R2);
    }
    g2.closePath(); g2.fill(); g2.stroke();
    g2.restore();
    return;
  }

  P3.t += dt;
  if (P3.flare > 0) P3.flare -= dt;
  /* On a machine without GPU acceleration each render costs real main-thread
     time. Measure the first renders; if they are slow, drop to a lazy mode
     that re-renders only twice a second — the spin is scenery, not gameplay. */
  var lazy = P3.slow && P3.flare <= 0;
  if (!force && (P3.frame++ & (lazy ? 63 : 1))) return;

  var g = P3.grp;
  g.rotation.z = Math.sin(P3.t * 0.25) * 0.18;
  g.rotation.y = Math.sin(P3.t * 0.4) * 0.38;
  g.rotation.x = 0.10 + Math.sin(P3.t * 0.17) * 0.08;

  P3.ring.color.setHex(day ? 0xffb347 : 0x9fb4de);
  P3.ring.emissive.setHex(day ? 0xff8a1e : 0x5f7fc0);
  P3.ring.emissiveIntensity = (day ? 0.55 : 0.42) +
    Math.max(0, P3.flare) * 1.3 + Math.sin(P3.t * 1.7) * 0.08;
  P3.disc.color.setHex(day ? 0xfff2c9 : 0xe6efff);
  P3.disc.opacity = day ? 0.96 : 0.88;
  var t0 = performance.now();
  P3.renderer.render(P3.scene, P3.cam);
  var cost = performance.now() - t0;
  P3.costs = P3.costs || [];
  if (P3.costs.length < 20) {
    P3.costs.push(cost);
    if (P3.costs.length === 20) {
      var avg = P3.costs.reduce(function (a, b) { return a + b; }) / 20;
      if (avg > 5) { P3.slow = true; console.warn('[arena] slow WebGL (' + avg.toFixed(1) + 'ms), portal goes lazy'); }
    }
  }
}

var frameNo = 0;

/* ---------------------------------------------------------------- sim --- */

var actors = [], projs = [], parts = [], duels = [], graves = [], portals = [];
var flyers = [], chests = [];
var motes = [];
var flyTimer = 40;
var levelups = [], shocks = [], fireworks = [];
var tally = { duel: 0, wrestle: 0, piggyback: 0, gang: 0, social: 0, ultimate: 0, deaths: 0,
              spar: 0, greet: 0, chase: 0 };

var GRAVE_LIFE = 30;     // seconds a marker stands before it fades
var GRAVE_MAX = 10;      // never let the strip fill up with headstones
var clock = 0, scanT = 0;

var ANIM_CYCLE_ART = 12;      // art px covered by one 8-frame run cycle
var BASE_SPEED = 52;          // art-px/second before per-fighter multiplier

/* Draw order is a shuffled bag rather than a coin flip: with only a handful
   on screen at a time, random picking would keep showing the same faces.
   This way all sixteen appear before any of them comes round again. */
var bag = [], lastDrawn = -1;

function refillBag() {
  bag = [];
  for (var i = 0; i < ROSTER.length; i++) {
    if (ROSTER[i].off) continue;
    bag.push(i);
    /* a fighter with a record shows up more often, so a run can actually
       build into an evolution rather than being spread thin across the cast */
    if ((ROSTER[i].lvl || 0) >= 2) bag.push(i);
    if ((ROSTER[i].lvl || 0) >= 4) bag.push(i);
  }
  if (!bag.length) { for (var z = 0; z < ROSTER.length; z++) bag.push(z); }
  for (var j = bag.length - 1; j > 0; j--) {          // Fisher-Yates
    var k = (RNG() * (j + 1)) | 0, t = bag[j]; bag[j] = bag[k]; bag[k] = t;
  }
  /* bag.pop() takes from the end — don't let it repeat the previous draw */
  if (bag[bag.length - 1] === lastDrawn && bag.length > 1) {
    var sw = bag[bag.length - 1]; bag[bag.length - 1] = bag[0]; bag[0] = sw;
  }
}

function drawFromBag() {
  var held = [];
  for (var pass = 0; pass <= ROSTER.length; pass++) {
    if (!bag.length) refillBag();
    var i = bag.pop(), onScreen = false;
    for (var n = 0; n < actors.length; n++) if (actors[n].i === i) { onScreen = true; break; }
    if (!onScreen) { bag = bag.concat(held); lastDrawn = i; return i; }
    held.push(i);                                     // already out there — skip
  }
  bag = bag.concat(held);
  return (RNG() * ROSTER.length) | 0;
}

/* Getting past someone coming the other way. Mostly a plain vault, but a
   fighter will occasionally sprout wings and glide over, or light a thruster
   and fly the gap, or simply blink past. */
function startPass(a) {
  var roll = RNG();
  var kind = 'vault';
  if (roll < 0.20) kind = 'glide';
  else if (roll < 0.36) kind = 'jet';
  else if (roll < 0.44) kind = 'blink';
  if (a.s.passPref && roll < 0.75) kind = a.s.passPref;   // signature exit

  a.pass = { kind: kind, t: 0 };
  a.y = -0.01;

  if (kind === 'vault') { a.vy = -215; a.grav = 900; }
  else if (kind === 'glide') { a.vy = -330; a.grav = 900; }
  else if (kind === 'jet') { a.vy = -150; a.grav = 900; }
  else { a.vy = 0; a.grav = 0; a.blinkFrom = a.x; }
}

function stepPass(a, dt) {
  var P = a.pass;
  P.t += dt;

  if (P.kind === 'glide') {
    /* wings snap out at the top of the arc and it floats across */
    a.grav = (a.vy > -40 && P.t > 0.25) ? 240 : 900;
    if (a.grav === 240) a.x += a.dir * a.speed * 0.9 * dt;
  } else if (P.kind === 'jet') {
    if (P.t < 0.42) {                          // thrust
      a.vy -= 900 * dt;
      a.grav = 0;
      if (parts.length < 220 && RNG() < dt * 55) {
        parts.push({ x: a.x - a.dir * 3 * V.S + rnd(-2, 2) * V.S,
                     y: V.groundY + a.y - 4 * V.S,
                     vx: -a.dir * rnd(20, 70), vy: rnd(40, 130),
                     life: 0.3, max: 0.3, c: RNG() < 0.5 ? '#ffd28a' : '#8fd8ff', sz: 1 });
      }
    } else { a.grav = 620; }
    a.x += a.dir * a.speed * 0.55 * dt;
  } else if (P.kind === 'blink') {
    if (P.t > 0.16 && !P.jumped) {              // gone, then back, past them
      P.jumped = 1;
      a.x += a.dir * V.cellW * 1.7;
      burst(a.blinkFrom, V.groundY - FEET * V.S * 0.5, 8, [a.s.c3, '#ffffff'], 0.5);
      burst(a.x, V.groundY - FEET * V.S * 0.5, 8, [a.s.c3, '#ffffff'], 0.5);
    }
    if (P.t > 0.34) { a.pass = null; a.grav = 900; a.y = 0; a.vy = 0; }
    return;
  }

  if (a.y >= 0) { a.pass = null; a.grav = 900; }
}

/* Every appearance rolls a personality — aggression, mischief, sociability,
   courage, showmanship — seeded from who they are plus when they arrived.
   Interactions are chosen by scoring, not by a fixed script, so the same two
   fighters can duel one day and play piggyback the next. */
var spawnSerial = 0;

function rollTraits(spec) {
  var h = 0, id = spec.id || 'x';
  for (var c = 0; c < id.length; c++) h = (h * 31 + id.charCodeAt(c)) >>> 0;
  var r = seeded(h + (++spawnSerial) * 7919);
  return {
    agg: 0.15 + r() * 0.7 + (spec.monster ? 0.3 : 0),
    mis: r(), soc: r(),
    cou: 0.2 + r() * 0.8 + (spec.heavy ? 0.15 : 0),
    show: r()
  };
}

function makeActor(dir, x) {
  var i = drawFromBag();
  var s = ROSTER[i];
  return {
    i: i, s: s, dir: dir, face: dir,
    x: x, y: 0, vy: 0,
    speed: BASE_SPEED * V.S * s.spd * rnd(0.88, 1.12),
    phase: RNG(), st: 'run', tr: rollTraits(s),
    atkT: 0, struck: false, flash: 0, hurt: 0,
    cool: rnd(2, 14), duel: null, exit: false
  };
}

function wantCount() { return cfg.count; }

function margin() { return V.cellW * 2 + 360; }

/* Only a couple of champions hold the field at once; any more and the strip
   stops being a parade. Extras leave the way everyone else does. */
function residentCount() {
  var n = 0;
  for (var i = 0; i < actors.length; i++) if (isFinal(actors[i].s)) n++;
  return n;
}

var lastDir = -1;
var raidTimer = 20;              // seconds until the forest stirs again

/* the creature bursts out — over a knocked-down hero, if the throw connected */
function popBall(a, x, victim) {
  a.st = 'run';
  a.x = x; a.y = 0; a.vy = 0; a.grav = 900;
  a.dir = RNG() < 0.5 ? 1 : -1; a.face = a.dir;
  a.phase = RNG(); a.cool = rnd(2, 6);
  a.holder = null; a.victim = null;
  burst(x, V.groundY - 10 * V.S, 26, ['#ffffff', '#f2f4f6', a.s.c3 || '#9fe4ff'], 1.2);
  if (victim) {
    victim.hurt = 1; victim.flash = 0.15;
    victim.vy = -260; victim.y = -0.01;
    victim.dir = x > victim.x ? -1 : 1;               // bowled over, away from it
    victim.face = -victim.dir;
    victim.cool = rnd(6, 12);
  }
}

function nearestChest(h) {
  var best = null, bd = V.cellW * 9;
  for (var i = 0; i < chests.length; i++) {
    if (chests[i].st !== 'wait') continue;
    var d = Math.abs(chests[i].x - h.x);
    if (d < bd) { bd = d; best = chests[i]; }
  }
  return best;
}

/* the chest opens: one of three finds, announced like a level-up */
function openChest(c, h) {
  window.__chestOpened = true;
  chests.splice(chests.indexOf(c), 1);
  burst(c.x, V.groundY - 10 * V.S, 26, ['#ffd24d', '#fff2c0', '#ffffff', h.s.c3], 1.2);
  var roll = RNG();
  if (roll < 0.38) {
    awardXP(h, 3);
    levelups.push({ x: h.x, t: 0, col: '#ffd24d', big: false, text: 'TREASURE  +3XP' });
  } else if (roll < 0.7) {
    h.buffSpeed = 18; h.speed *= 1.5;
    levelups.push({ x: h.x, t: 0, col: '#8ad8ff', big: false, text: 'SWIFT DRAUGHT' });
  } else {
    h.buffGrow = 18; h.bossScale = 1.28;
    levelups.push({ x: h.x, t: 0, col: '#b06bff', big: false, text: 'GIANT ELIXIR' });
  }
  h.victory = 0.9;
}

function nearestBall(h) {
  var best = null, bd = V.cellW * 9;
  for (var i = 0; i < actors.length; i++) {
    var B = actors[i];
    if (B.st !== 'ball') continue;
    var d = Math.abs(B.x - h.x);
    if (d < bd) { bd = d; best = B; }
  }
  return best;
}

/* A guest's element, judged from its own colours — coarse but convincing:
   embers, water, leaves, sparks, psychic motes, or plain grit. */
function guestElement(spec) {
  if (spec.elem) return spec.elem;
  var c = spec.c3 || '#9fe4ff';
  var n = parseInt(c.slice(1), 16);
  var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  var elem;
  if (mx - mn < 30) elem = { cols: ['#e8e8e8', '#bfc4cc'], n: 8 };                    // normal
  else if (r === mx && g > r * 0.6) elem = { cols: ['#ffe25e', '#fff6b0', '#ffffff'], n: 14 };  // electric
  else if (r === mx) elem = { cols: ['#ff7a2e', '#ffb056', '#ffe0a0'], n: 14 };       // fire
  else if (g === mx) elem = { cols: ['#6edb5e', '#b0f090', '#3f9e3f'], n: 12 };       // grass
  else if (b === mx && r > b * 0.7) elem = { cols: ['#c86bff', '#ff8ae0', '#ffffff'], n: 12 }; // psychic
  else elem = { cols: ['#4fa8ff', '#9fdcff', '#ffffff'], n: 14 };                     // water
  spec.elem = elem;
  return elem;
}

/* a ranged elemental hit: a streak of typed particles and an impact burst */
function elementalStrike(a, tgt) {
  var el = guestElement(a.s);
  var y0 = V.groundY - FEET * V.S * 0.55;
  var steps = 7, dx = (tgt.x - a.x) / steps;
  for (var i = 1; i <= steps && parts.length < 280; i++) {
    parts.push({ x: a.x + dx * i, y: y0 + Math.sin(i * 1.3) * 4 * V.S,
                 vx: dx * 1.6, vy: rnd(-25, 25),
                 life: 0.28, max: 0.28, c: pick(el.cols), sz: i % 2 ? 2 : 1 });
  }
  burst(tgt.x, y0, el.n, el.cols, 1);
}

/* Evolution. Every evolving guest jumps a whole level (wings-tier growth,
   banner, the works). A creature that came out of a ball goes further: its
   real next form is looked up and its sprite swapped in place. Every network
   failure falls back to the growth-only evolution, silently. */
function evolveGuest(a) {
  var spec = a.s;
  var lvl = spec.lvl || 0;
  if (lvl < MAX_LEVEL) {
    spec.xp = Math.max(spec.xp || 0, LEVEL_XP[lvl + 1]);
    awardXP(a, 0);                               // recompute, rebake, banner
  }
  if (!spec.ball || spec.evolving || cfg.guests === 'off') return;
  if (typeof fetch !== 'function') return;
  spec.evolving = true;

  var base = spec.name.toLowerCase();
  fetch('https://pokeapi.co/api/v2/pokemon-species/' + encodeURIComponent(base),
        { credentials: 'omit', mode: 'cors' })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(0); })
    .then(function (sp) {
      var url = sp.evolution_chain && sp.evolution_chain.url;
      if (!url || !/^https:\/\/pokeapi\.co\//.test(url)) return Promise.reject(0);
      return fetch(url, { credentials: 'omit', mode: 'cors' });
    })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(0); })
    .then(function (ch) {
      function findNext(node) {
        if (!node) return null;
        if (node.species && node.species.name === base) {
          return node.evolves_to && node.evolves_to[0] && node.evolves_to[0].species.name;
        }
        for (var i = 0; i < (node.evolves_to || []).length; i++) {
          var hit = findNext(node.evolves_to[i]);
          if (hit) return hit;
        }
        return null;
      }
      var next = findNext(ch.chain);
      if (!next) return Promise.reject(0);       // already the final form
      return fetch('https://pokeapi.co/api/v2/pokemon/' + encodeURIComponent(next),
                   { credentials: 'omit', mode: 'cors' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(0); })
        .then(function (j) {
          var sprite = j.sprites && j.sprites.front_default;
          if (!sprite || !spriteAllowed(sprite, [])) return Promise.reject(0);
          return loadImage(sprite).then(function (img) {
            var m = measureSprite(img);
            spec.img = img;
            spec.sx0 = m.sx0; spec.sy0 = m.sy0; spec.sw = m.sw; spec.sh = m.sh;
            var tallest = 27 * (spec.wanted || 1) * 1.12;   // its new form is bigger
            var ratio = m.sw / m.sh;
            spec.dh = tallest; spec.dw = tallest * ratio;
            if (spec.dw > GUEST_MAX_W) { spec.dw = GUEST_MAX_W; spec.dh = GUEST_MAX_W / ratio; }
            spec.name = cleanName(next);
            if (m.c3) { spec.c3 = m.c3; spec.elem = null; }
            if (bakedAt) sheets[a.i] = bakeGuestSheets(spec, bakedAt);
            levelups.push({ x: a.x, t: 0, col: spec.c3, big: true, text: 'EVOLVED  ' + spec.name });
            burst(a.x, V.groundY - FEET * V.S * 0.6, 30, ['#ffffff', spec.c3], 1.4);
          });
        });
    })
    .catch(function () { /* growth-only evolution stands */ })
    .then(function () { spec.evolving = false; });
}

function monstersAlive() {
  var n = 0;
  for (var i = 0; i < actors.length; i++) {
    if (actors[i].s.monster && actors[i].st !== 'down') n++;
  }
  return n;
}

/* Occasionally the pack is led by a boss: half again as big, three times the
   hp, its own title, and a heavier reward for the heroes who fell it. */
function spawnRaid() {
  var bench = [];
  for (var i = 0; i < ROSTER.length; i++) if (ROSTER[i].monster) bench.push(i);
  if (!bench.length) return;
  var n = 1 + ((RNG() * 3) | 0);
  var dir = RNG() < 0.5 ? 1 : -1;                      // they arrive as a pack
  var boss = RNG() < 0.22;
  for (var k = 0; k < n; k++) {
    var idx = bench[(RNG() * bench.length) | 0];
    var a = makeActor(dir, 0);
    a.i = idx; a.s = ROSTER[idx];
    a.speed = BASE_SPEED * V.S * a.s.spd * rnd(0.9, 1.1);
    a.x = dir > 0 ? -V.cellW - k * V.cellW * 0.8 : V.VW + V.cellW + k * V.cellW * 0.8;
    a.hp = a.s.hp;
    a.strike = rnd(0.8, 1.6);
    if (boss && k === 0) {
      a.boss = 1;
      a.hp = a.s.hp * 3;
      a.speed *= 0.85;
      a.bossScale = 1.5;
      a.title = a.s.name + ' KING';
    }
    actors.push(a);
  }
}

/* Guests arrive through the mark: it flares, a column of light opens, and
   they drop out of it onto the floor line. */
function portalSpawn(a) {
  if (!cfg.portal || !V.sun) return false;
  var mouthY = V.sun.y + V.sun.r * 0.9;
  a.st = 'portal';
  a.pt = 0;
  a.x = V.sun.x + rnd(-10, 10);
  a.y = (mouthY - V.groundY) + 6;           // at the portal's mouth, in the sky
  a.vy = 0;
  a.face = a.dir;
  portals.push({ m: { y: mouthY }, x: a.x, t: 0, life: 1.6 });
  portalFlare();
  return true;
}

function spawn(initial) {
  /* arrivals alternate, so the few on screen actually run into each other */
  var dir = initial ? (RNG() < 0.5 ? 1 : -1) : (lastDir = -lastDir);
  var x = initial
    ? rnd(0, V.VW)
    : (dir > 0 ? -V.cellW - rnd(0, 300) : V.VW + V.cellW + rnd(0, 300));
  var a = makeActor(dir, x);
  if (initial) a.cool = rnd(4, 20);
  /* guests and challengers step out of the mark; the core cast walks on */
  if (!initial && (a.s.guest || a.s.challenger)) portalSpawn(a);
  actors.push(a);
}

function burst(x, y, n, cols, power) {
  power = power || 1;
  for (var i = 0; i < n && parts.length < 300; i++) {
    var ang = RNG() * Math.PI * 2, sp = (18 + RNG() * 90) * power;
    parts.push({
      x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40,
      life: rnd(0.3, 0.75), max: 0.75, c: pick(cols), sz: RNG() < 0.3 ? 2 : 1
    });
  }
}

function impact(att, def, heavy) {
  var mx = (att.x + def.x) / 2, my = V.groundY - FEET * V.S * 0.55;
  burst(mx, my, heavy ? 18 : 11, [att.s.c3, att.s.c4, '#ffffff', def.s.c3], heavy ? 1.25 : 1);
  def.flash = 0.14; def.hurt = 0.34;
  def.x -= def.face * (heavy ? 5 : 3);
}

function tryDuel() {
  if (!cfg.duels) return;
  for (var i = 0; i < actors.length; i++) {
    var a = actors[i];
    if (a.st !== 'run' || a.cool > 0) continue;
    for (var j = i + 1; j < actors.length; j++) {
      var b = actors[j];
      if (b.st !== 'run' || b.cool > 0 || b.dir === a.dir) continue;
      var gap = Math.abs(a.x - b.x);
      if (gap > V.cellW * 1.6 || gap < V.cellW * 0.7) continue;
      var closing = (a.x < b.x && a.dir > 0) || (b.x < a.x && b.dir > 0);
      if (!closing) continue;

      /* A fighter in its final form is left alone or joined, never jumped. */
      if (isFinal(a.s) || isFinal(b.s)) { startSocial(a, b); return; }

      /* Is there a third close by, running the same way as one of them? */
      var ally = null, lead = null, mark = null;
      for (var k = 0; k < actors.length; k++) {
        var c = actors[k];
        if (c === a || c === b || c.st !== 'run') continue;
        if (c.dir === a.dir && Math.abs(c.x - a.x) < V.cellW * 5) { ally = c; lead = a; mark = b; break; }
        if (c.dir === b.dir && Math.abs(c.x - b.x) < V.cellW * 5) { ally = c; lead = b; mark = a; break; }
      }

      /* The director. Score every interaction from both personalities and
         the situation, add noise, take the best. */
      var ta = a.tr || (a.tr = rollTraits(a.s));
      var tb = b.tr || (b.tr = rollTraits(b.s));
      var la = a.s.lvl || 0, lb = b.s.lvl || 0;
      var nz = function () { return RNG() * 0.35; };
      var scores = {
        duel:   (ta.agg + tb.agg) * 0.45 + Math.abs(la - lb) * 0.05 + nz(),
        wrestle:(ta.agg + tb.agg) * 0.3 + ((a.s.grappler || b.s.grappler) ? 0.55 : 0) + nz(),
        gang:   ally ? (ta.agg + tb.agg) * 0.3 + 0.25 + nz() : -1,
        piggy:  (ta.soc + tb.soc) * 0.32 + (ta.mis + tb.mis) * 0.18 + nz(),
        spar:   (ta.soc + tb.soc) * 0.35 + (2 - ta.agg - tb.agg) * 0.18 + nz(),
        greet:  (ta.soc + tb.soc) * 0.4 - (ta.agg + tb.agg) * 0.15 + nz(),
        chase:  (Math.max(ta.mis, tb.mis)) * 0.6 + nz(),
        flee:   (lb - la >= 2 ? (1 - ta.cou) * 0.9 : (la - lb >= 2 ? (1 - tb.cou) * 0.9 : -1)) + nz() * 0.5
      };
      var best = 'duel', bs = -9;
      for (var key in scores) if (scores[key] > bs) { bs = scores[key]; best = key; }

      if (best === 'gang') { startGang(lead, ally, mark); return; }
      if (best === 'wrestle') { startBout('wrestle', a, b); return; }
      if (best === 'piggy') { startPiggyback(a, b); return; }
      if (best === 'spar') { startBout('duel', a, b, true); return; }
      if (best === 'greet') { startGreet(a, b); return; }
      if (best === 'chase') { startChase(ta.mis >= tb.mis ? a : b, ta.mis >= tb.mis ? b : a); return; }
      if (best === 'flee') {
        var runner = lb - la >= 2 ? a : b;
        runner.dir = -runner.dir; runner.face = runner.dir;
        runner.cool = rnd(8, 16); runner.spooked = 1.6;
        return;
      }
            startBout('duel', a, b);                                      // 0.60 - 1.00
      return;
    }
  }
}

function faceOff(a, b) {
  a.face = a.x < b.x ? 1 : -1;
  b.face = -a.face;
}

function startBout(kind, a, b, spar) {
  var agg = ((a.tr ? a.tr.agg : 0.5) + (b.tr ? b.tr.agg : 0.5)) / 2;
  var show = ((a.tr ? a.tr.show : 0.5) + (b.tr ? b.tr.show : 0.5)) / 2;
  var d = { kind: kind, a: a, b: b, t: 0, next: kind === 'wrestle' ? 0.4 : 0.35,
            k: 0, n: 2 + Math.round(agg * 3 + show * 2), over: 0, spar: !!spar,
            cadence: 0.34 + (1 - agg) * 0.4,
            lockA: a.x, lockB: b.x };
  tally[spar ? 'spar' : kind]++;
  a.duel = b.duel = d;
  a.st = b.st = (kind === 'wrestle' ? 'wrestle' : 'duel');
  faceOff(a, b);
  duels.push(d);
}

/* Two on one. The pair flank their mark and take turns. */
function startGang(lead, ally, mark) {
  var d = { kind: 'gang', a: lead, b: mark, c: ally, t: 0, next: 0.5, k: 0,
            n: 4 + ((RNG() * 3) | 0), over: 0, ult: 0 };
  tally.gang++;
  lead.duel = ally.duel = mark.duel = d;
  lead.st = ally.st = mark.st = 'duel';
  lead.face = lead.x < mark.x ? 1 : -1;
  ally.x = mark.x - lead.face * V.cellW * 1.0;
  ally.face = lead.face;
  mark.face = -lead.face;
  /* the outnumbered one may find something extra */
  var edge = 0.18 + (mark.s.lvl || 0) * 0.13;
  d.ultAt = RNG() < edge ? (1.1 + RNG() * 0.9) : 0;
  duels.push(d);
}

/* One climbs on the other and they travel together. Nobody gets hurt. */
function startPiggyback(a, b) {
  var rider = a.s.spd >= b.s.spd ? a : b, carrier = rider === a ? b : a;
  if (isFinal(rider.s) && !isFinal(carrier.s)) { var t2 = rider; rider = carrier; carrier = t2; }
  var d = { kind: 'piggyback', a: carrier, b: rider, t: 0, over: 4 + RNG() * 5, mount: 0 };
  tally.piggyback++;
  carrier.duel = rider.duel = d;
  carrier.st = 'carry'; rider.st = 'mounting';
  rider.dir = carrier.dir; rider.face = carrier.face = carrier.dir;
  duels.push(d);
}

/* Two sociable fighters stop, face each other, and hop a hello. */
function startGreet(a, b) {
  tally.greet = (tally.greet || 0) + 1;
  a.st = b.st = 'greet';
  a.greetT = b.greetT = 1.5;
  faceOff(a, b);
  a.vy = -150; a.y = -0.01;
  b.vy = -150; b.y = -0.01;
}

/* One darts off with a burst of mischief; the other gives chase for a while,
   then they both drop it and carry on. */
function startChase(imp, quarry) {
  tally.chase = (tally.chase || 0) + 1;
  imp.st = 'chasing'; quarry.st = 'chased';
  imp.chaseT = quarry.chaseT = rnd(2.6, 4.6);
  imp.other = quarry; quarry.other = imp;
  quarry.dir = quarry.x < imp.x ? -1 : 1;      // away
  quarry.face = quarry.dir;
  imp.dir = quarry.dir; imp.face = imp.dir;
  burst(imp.x, V.groundY - FEET * V.S * 0.8, 8, [imp.s.c3, '#ffffff'], 0.5);
}

/* Nobody picks a fight with a final form: they tag along or steer clear. */
function startSocial(a, b) {
  tally.social++;
  var boss = isFinal(a.s) ? a : b, other = boss === a ? b : a;
  if (RNG() < 0.45) {
    startPiggyback(boss, other);                    // befriended
  } else {
    other.dir = -other.dir;                         // give it a wide berth
    other.face = other.dir;
    other.cool = rnd(9, 18);
    other.spooked = 1.6;
  }
}

function releaseCast(d) {
  var cast = [d.a, d.b].concat(d.c ? [d.c] : []);
  for (var i = 0; i < cast.length; i++) {
    var f = cast[i];
    if (!f) continue;
    f.duel = null; f.atkT = 0;
    if (f.st !== 'down') { f.st = 'run'; f.y = f.y > 0 ? 0 : f.y; f.face = f.dir; }
    f.cool = rnd(5, 14);
  }
  var k = duels.indexOf(d); if (k >= 0) duels.splice(k, 1);
}

function endDuel(d, noKill) {
  if (d.spar && !noKill) {                     // a friendly bout: both bow out
    releaseCast(d);
    d.a.victory = 1.0; d.b.victory = 1.0;
    return;
  }
  if (d.kind && d.kind !== 'duel') { releaseCast(d); return; }
  /* a higher level wins more often, but never certainly */
  var la = (d.a.s.lvl || 0), lb = (d.b.s.lvl || 0);
  var pa = 0.5 + (la - lb) * 0.08;
  var loser = RNG() < Math.max(0.15, Math.min(0.85, pa)) ? d.b : d.a;
  var winner = loser === d.a ? d.b : d.a;
  [d.a, d.b].forEach(function (f) {
    f.duel = null; f.st = 'run'; f.face = f.dir;
    f.cool = rnd(5, 14); f.atkT = 0;
  });
  var k = duels.indexOf(d); if (k >= 0) duels.splice(k, 1);
  if (noKill) return;
  awardXP(winner, 1 + Math.floor((loser.s.lvl || 0) / 2));
  winner.victory = 1.1;

  /* the loser goes down: knocked back, topples, then leaves a marker */
  loser.st = 'down';
  loser.fall = 0;
  loser.flash = 0.14;
  loser.hurt = 1;
  loser.vy = -190; loser.y = -0.01;
  loser.knock = -loser.face * 46;
  burst(loser.x, V.groundY - FEET * V.S * 0.5, 22, [loser.s.c3, loser.s.c4, '#ffffff'], 1.2);
}

function bury(f) {
  tally.deaths++;
  graves.push({
    x: f.x, t: 0,
    kind: RNG() < 0.5 ? 0 : 1,          // headstone or cross
    col: f.s.c3, name: f.s.name,
    rise: 0
  });
  while (graves.length > GRAVE_MAX) graves.shift();
  burst(f.x, V.groundY - GRAVE_H * V.S * 0.4, 10, [f.s.c3, '#8fa3b8'], 0.55);
}

function fire(a) {
  var s = a.s;
  projs.push({
    x: a.x + a.face * V.cellW * 0.34, y: V.groundY - FEET * V.S * 0.58,
    vx: a.face * (330 + RNG() * 120), dir: a.face,
    col: s.c3, hot: s.c4, life: 4, t: 0
  });
  burst(a.x + a.face * V.cellW * 0.34, V.groundY - FEET * V.S * 0.58, 5, [s.c3, s.c4], 0.5);
}

function stepSim(dt) {
  clock += dt;
  var GY = V.groundY;

  /* population (raiders are extras, not part of the four) */
  var want = wantCount();
  var civilians = 0;
  for (var ci0 = 0; ci0 < actors.length; ci0++) if (!actors[ci0].s.monster) civilians++;
  if (civilians < want && RNG() < dt * 3) spawn(false);

  /* ambient motes: leaves over the forest, spray at the gorge, pollen and
     fireflies by the village — a dozen drifting points, nothing more */
  if (!cfg.still) {
    var wantMotes = Math.min(14, Math.round(V.VW / 300));
    if (motes.length < wantMotes && RNG() < dt * 2) {
      var mu = RNG(), kindRoll = bu(mu);
      var gorge = layout().mirror ? 1 - layout().gorgeU : layout().gorgeU;
      var mk2;
      if (Math.abs(mu - gorge) < 0.06) mk2 = { c: '#dff2f6', sway: 3, fall: 14, tw: 1 };
      else if (wForest(mu) > 0.5) mk2 = { c: RNG() < 0.5 ? '#7ec46a' : '#c8a94d', sway: 9, fall: 9, tw: 0 };
      else mk2 = { c: nightAmt(V.sun.hour) > 0.5 ? '#d8ff8a' : '#fff0b8', sway: 5, fall: 3, tw: 1 };
      motes.push({ x: mu * V.VW, y: V.stripTop + RNG() * (V.groundY - V.stripTop) * 0.5,
                   t: RNG() * 7, k: mk2, life: 12 + RNG() * 10 });
    }
    for (var mo = motes.length - 1; mo >= 0; mo--) {
      var MT = motes[mo];
      MT.t += dt; MT.life -= dt;
      MT.x += Math.sin(MT.t * 1.3) * MT.k.sway * dt * V.U;
      MT.y += MT.k.fall * dt * V.U;
      if (MT.life <= 0 || MT.y > V.groundY - 2) motes.splice(mo, 1);
    }
  }

  /* flyovers: something big crosses the sky and lets a chest go */
  if (!cfg.still) {
    flyTimer -= dt;
    if (flyTimer <= 0 && flyers.length === 0) {
      flyTimer = 55 + RNG() * 100;
      var fdir = RNG() < 0.5 ? 1 : -1;
      flyers.push({
        kind: pick(['eagle', 'dragon', 'insect']),
        x: fdir > 0 ? -300 : V.VW + 300,
        y: V.H * (0.10 + RNG() * 0.12),
        vx: fdir * (V.H * (0.14 + RNG() * 0.08)),
        t: 0, flap: RNG() * 7,
        dropX: V.VW * (0.2 + RNG() * 0.6),
        dropped: false
      });
    }
  }
  for (var fy = flyers.length - 1; fy >= 0; fy--) {
    var F = flyers[fy];
    F.t += dt; F.x += F.vx * dt; F.flap += dt * (F.kind === 'insect' ? 26 : (F.kind === 'dragon' ? 4.5 : 8));
    if (!F.dropped && ((F.vx > 0 && F.x >= F.dropX) || (F.vx < 0 && F.x <= F.dropX))) {
      F.dropped = true;
      chests.push({ x: F.x, y: F.y, vy: 0, st: 'fall', t: 0, spin: RNG() * 7 });
    }
    if (F.x < -400 || F.x > V.VW + 400) flyers.splice(fy, 1);
  }
  for (var ch2 = chests.length - 1; ch2 >= 0; ch2--) {
    var C = chests[ch2];
    C.t += dt;
    if (C.st === 'fall') {
      C.vy += 800 * dt; C.y += C.vy * dt; C.spin += dt * 5;
      if (C.y >= V.groundY - 6 * V.S) {
        C.y = V.groundY - 6 * V.S; C.st = 'wait'; C.t = 0;
        burst(C.x, V.groundY - 6 * V.S, 10, ['#c8a05e', '#8a6a3a', '#ffffff'], 0.7);
      }
    } else if (C.t > 45) {
      chests.splice(ch2, 1);                     // unclaimed, reclaimed by moss
    }
  }

  /* raids */
  var raiders = monstersAlive();
  if (cfg.raids && cfg.duels) {
    if (raiders === 0) {
      raidTimer -= dt;
      if (raidTimer <= 0) { spawnRaid(); raidTimer = 50 + RNG() * 90; }
    }
  }

  scanT -= dt;
  if (scanT <= 0) { scanT = 0.3; if (!raiders) tryDuel(); }

  for (var i = actors.length - 1; i >= 0; i--) {
    var a = actors[i], s = a.s;
    a.flash = Math.max(0, a.flash - dt);
    a.hurt = Math.max(0, a.hurt - dt);
    a.cool -= dt;
    if (a.spooked) a.spooked = Math.max(0, a.spooked - dt);
    if (a.buffSpeed) {
      a.buffSpeed -= dt;
      if (parts.length < 240 && RNG() < dt * 8) {
        parts.push({ x: a.x - a.face * 8 * V.S, y: V.groundY - rnd(2, 18) * V.S,
                     vx: -a.face * 40, vy: rnd(-30, 0), life: 0.4, max: 0.4, c: '#8ad8ff', sz: 1 });
      }
      if (a.buffSpeed <= 0) { a.buffSpeed = 0; a.speed /= 1.5; }
    }
    if (a.buffGrow) {
      a.buffGrow -= dt;
      if (a.buffGrow <= 0) { a.buffGrow = 0; a.bossScale = a.boss ? 1.5 : undefined; }
    }

    if (a.pass) stepPass(a, dt);
    if (a.y < 0 || a.vy < 0) {
      a.vy += (a.grav === undefined ? 900 : a.grav) * dt;
      a.y += a.vy * dt;
      if (a.y >= 0) { a.y = 0; a.vy = 0; a.grav = 900; if (a.pass) a.pass = null; }
    }

    if (a.st === 'run' && !a.s.monster && !a.duel && monstersAlive()) {
      /* a raid: every hero drops what it is doing and closes on the nearest
         monster; they gang it from both sides and cut it down together */
      var tgt = null, best = 1e9;
      for (var mi = 0; mi < actors.length; mi++) {
        var M = actors[mi];
        if (!M.s.monster || M.st === 'down') continue;
        var dd = Math.abs(M.x - a.x);
        if (dd < best) { best = dd; tgt = M; }
      }
      if (tgt) {
        a.rest = 0; a.victory = 0;
        var reach = (a.s.guest || a.s.elem) ? V.cellW * 1.9 : V.cellW * 0.72;
        if (best > reach) {
          a.dir = tgt.x > a.x ? 1 : -1; a.face = a.dir;
          var hdx = a.dir * a.speed * 1.15 * dt;
          a.x += hdx;
          a.phase = (a.phase + Math.abs(hdx) / (ANIM_CYCLE_ART * V.S)) % 1;
        } else {
          a.face = tgt.x > a.x ? 1 : -1;
          a.strike = (a.strike || 0) - dt;
          if (a.strike <= 0) {
            a.strike = 0.7 + RNG() * 0.5;
            a.atkT = 0.36;
            tgt.hp -= 1;
            tgt.flash = 0.12; tgt.hurt = 0.3;
            if (a.s.guest || a.s.elem) elementalStrike(a, tgt);
            else burst((a.x + tgt.x) / 2, V.groundY - FEET * V.S * 0.55, 10,
                  [a.s.c3, tgt.s.c3, '#ffffff'], 0.8);
            if (tgt.hp <= 0 && tgt.st !== 'down') {
              tgt.st = 'down'; tgt.fall = 0; tgt.hurt = 1; tgt.flash = 0.15;
              tgt.vy = -240; tgt.y = -0.01; tgt.knock = -tgt.face * 90;
              if (tgt.boss) shocks.push({ x: tgt.x, t: 0, col: tgt.s.c3, life: 0.9 });
              if (a.s.guest) evolveGuest(a);          // the killing blow evolves it
              /* everyone who joined the hunt shares the kill */
              for (var hx2 = 0; hx2 < actors.length; hx2++) {
                var H2 = actors[hx2];
                if (H2.s.monster || H2.st === 'down') continue;
                if (Math.abs(H2.x - tgt.x) < V.cellW * 4) {
                  awardXP(H2, tgt.boss ? 3 : 1);
                  H2.victory = 1.0;
                }
              }
            }
          }
        }
      }
    } else if (a.st === 'run' && a.s.monster) {
      /* the monster lumbers at the nearest hero and swings back */
      var prey = null, pb = 1e9;
      for (var pi2 = 0; pi2 < actors.length; pi2++) {
        var Hh = actors[pi2];
        if (Hh.s.monster || Hh.st === 'down' || Hh.st === 'portal') continue;
        var pd = Math.abs(Hh.x - a.x);
        if (pd < pb) { pb = pd; prey = Hh; }
      }
      if (prey) {
        if (pb > V.cellW * 0.6) {
          a.dir = prey.x > a.x ? 1 : -1; a.face = a.dir;
          var mdx = a.dir * a.speed * dt;
          a.x += mdx;
          a.phase = (a.phase + Math.abs(mdx) / (ANIM_CYCLE_ART * V.S)) % 1;
        } else {
          a.face = prey.x > a.x ? 1 : -1;
          a.strike = (a.strike || 1) - dt;
          if (a.strike <= 0) {
            a.strike = 1.1 + RNG() * 0.7;
            a.atkT = 0.36;
            prey.flash = 0.12; prey.hurt = 0.35;
            burst(prey.x, V.groundY - FEET * V.S * 0.5, 8, [a.s.c3, '#ffffff'], 0.7);
            if (RNG() < (a.boss ? 0.14 : 0.06) && prey.st === 'run') {
              prey.st = 'down'; prey.fall = 0; prey.hurt = 1;
              prey.vy = -220; prey.y = -0.01; prey.knock = -prey.face * 80;
            }
          }
        }
      } else if (a.x < -margin() || a.x > V.VW + margin()) {
        actors.splice(i, 1); continue;
      }
    } else if (a.st === 'run' && !a.s.monster && !a.duel && !a.pass && !(a.victory > 0) && (nearestBall(a) || nearestChest(a))) {
      var bb = nearestBall(a), cc = nearestChest(a);
      var goal = (bb && cc) ? (Math.abs(bb.x - a.x) < Math.abs(cc.x - a.x) ? bb : cc) : (bb || cc);
      if (Math.abs(goal.x - a.x) > V.cellW * 0.25) {
        a.dir = goal.x > a.x ? 1 : -1; a.face = a.dir;
        var bdx = a.dir * a.speed * dt;
        a.x += bdx;
        a.phase = (a.phase + Math.abs(bdx) / (ANIM_CYCLE_ART * V.S)) % 1;
      } else if (goal === bb) {                // scooped up the ball
        bb.st = 'held'; bb.holder = a; bb.throwT = 0.9;
      } else {
        openChest(goal, a);
      }
    } else if (a.st === 'run') {
      if (a.victory > 0) {                    // a beat to enjoy the win
        a.victory -= dt;
        a.phase = (a.phase + dt * 1.4) % 1;
        if (a.victory > 0.5 && RNG() < dt * 9 && parts.length < 240) {
          parts.push({ x: a.x + rnd(-8, 8) * V.S, y: V.groundY - rnd(4, FEET) * V.S,
                       vx: rnd(-25, 25), vy: rnd(-70, -20),
                       life: 0.5, max: 0.5, c: a.s.c3, sz: 1 });
        }
      } else if (a.pause > 0) {               // holding the ball, lining it up
        a.pause -= dt;
      } else if (a.rest > 0) {                // stopped for a breather
        a.rest -= dt;
        a.phase = (a.phase + dt * 0.55) % 1;
      } else {
        if (RNG() < dt * 0.028 && a.cool > 3 && !a.pass) a.rest = rnd(1.6, 3.4);
      var dx = a.dir * a.speed * dt * (a.hurt > 0 ? 0.55 : 1);
      a.x += dx;
      a.phase = (a.phase + Math.abs(dx) / (ANIM_CYCLE_ART * V.S)) % 1;
      }
      if (s.ranged && a.cool <= 0 && projs.length < 14 && RNG() < dt * 0.5) {
        var ahead = false;
        for (var q = 0; q < actors.length; q++) {
          var o = actors[q];
          if (o === a || o.dir === a.dir) continue;
          var rel = (o.x - a.x) * a.dir;
          if (rel > V.cellW && rel < 900) { ahead = true; break; }
        }
        if (ahead) { fire(a); a.atkT = 0.36; a.struck = true; a.cool = rnd(4, 11); }
      }
      if (a.dir > 0 && a.y === 0 && a.vy === 0 && !a.pass) {
        for (var v2 = 0; v2 < actors.length; v2++) {
          var ot = actors[v2];
          if (ot === a || ot.dir === a.dir || ot.st !== 'run') continue;
          if (Math.abs(ot.x - a.x) < V.cellW * 0.7) { startPass(a); break; }
        }
      }

    } else if (a.st === 'duel') {
      a.phase = (a.phase + dt * 1.1) % 1;
    } else if (a.st === 'ball') {
      a.ballT += dt; a.pt += dt;
      if (a.ballT > 22) popBall(a, a.x, null);       // nobody came; let it out
    } else if (a.st === 'held') {
      var hold = a.holder;
      if (!hold || hold.st !== 'run' || actors.indexOf(hold) < 0) {
        a.st = 'ball'; a.ballT = 0; a.holder = null;  // dropped
      } else {
        a.x = hold.x; hold.rest = 0; hold.victory = 0;
        hold.pause = 0.1;                             // holder stands still
        a.throwT -= dt;
        if (a.throwT <= 0) {
          var mark2 = null, mb = 1e9;
          for (var ti = 0; ti < actors.length; ti++) {
            var T = actors[ti];
            if (T === hold || T.s.monster || T.duel) continue;
            if (T.st !== 'run' && T.st !== 'carry') continue;
            var td = Math.abs(T.x - hold.x);
            if (td > V.cellW * 1.2 && td < mb) { mb = td; mark2 = T; }
          }
          if (mark2) {                                // let fly, leading the runner
            a.st = 'thrown';
            hold.atkT = 0.36;
            hold.face = mark2.x > hold.x ? 1 : -1;
            a.bx = hold.x + hold.face * 10 * V.S;
            a.by = -FEET * V.S * 0.9;
            var tof = 0.7;
            var lead = mark2.st === 'run' ? mark2.dir * mark2.speed * tof : 0;
            a.bvx = (mark2.x + lead - a.bx) / tof;
            a.bvy = -300;
            a.victim = mark2;
            a.holder = null;
          } else {
            a.st = 'ball'; a.ballT = 0; a.holder = null;
          }
        }
      }
    } else if (a.st === 'thrown') {
      a.bvy += 900 * dt;
      a.bx += a.bvx * dt; a.by += a.bvy * dt;
      a.pt += dt;
      a.x = a.bx;
      var vT = a.victim;
      var hitV = vT && actors.indexOf(vT) >= 0 && vT.st === 'run' &&
                 Math.abs(vT.x - a.bx) < V.cellW * 0.65 && a.by > -V.cellH * 0.95;
      if (hitV || a.by >= 0) {
        popBall(a, a.bx, hitV ? vT : null);
      }
    } else if (a.st === 'greet') {
      a.greetT -= dt;
      a.phase = (a.phase + dt * 0.8) % 1;
      if (a.greetT <= 0) { a.st = 'run'; a.face = a.dir; a.cool = rnd(6, 14); }
    } else if (a.st === 'chasing' || a.st === 'chased') {
      a.chaseT -= dt;
      var boost = a.st === 'chasing' ? 1.35 : 1.25;
      var cdx2 = a.dir * a.speed * boost * dt;
      a.x += cdx2;
      a.phase = (a.phase + Math.abs(cdx2) / (ANIM_CYCLE_ART * V.S)) % 1;
      if (a.st === 'chasing' && a.other) { a.dir = a.other.x > a.x ? 1 : -1; a.face = a.dir; }
      if (a.chaseT <= 0 || !a.other || actors.indexOf(a.other) < 0) {
        a.st = 'run'; a.other = null; a.cool = rnd(6, 14);
      }
    } else if (a.st === 'wrestle') {
      a.phase = (a.phase + dt * 1.6) % 1;
    } else if (a.st === 'carry') {
      var cdx = a.dir * a.speed * 0.8 * dt;
      a.x += cdx;
      a.phase = (a.phase + Math.abs(cdx) / (ANIM_CYCLE_ART * V.S)) % 1;
    } else if (a.st === 'ride') {
      var cr = a.duel && a.duel.a;
      if (cr) { a.x = cr.x - cr.face * 3; a.y = -(FEET - 6) * V.S * (cr.s.grow || 1); a.face = cr.face; }
      a.phase = (a.phase + dt * 0.6) % 1;
    } else if (a.st === 'mounting') {
      var cr2 = a.duel && a.duel.a;
      if (cr2) {
        a.x += (cr2.x - a.x) * Math.min(1, dt * 7);
        a.face = cr2.face;
      }
    } else if (a.st === 'portal') {
      a.pt += dt;
      if (a.pt > 0.32) {                      // hold in the light, then drop
        a.vy += 1500 * dt;
        a.y += a.vy * dt;
      }
      if (a.y >= 0) {
        a.y = 0; a.vy = 0;
        if (a.s.ball) {
          if (RNG() < 0.55) {                  // sits in the grass, waiting
            a.st = 'ball'; a.ballT = 0; a.pt = 0;
            burst(a.x, V.groundY - 6 * V.S, 8, ['#ffffff', a.s.c3 || '#9fe4ff'], 0.5);
          } else {
            popBall(a, a.x, null);
          }
        } else {
          a.st = 'run';
          a.phase = RNG();
          a.cool = rnd(2, 6);
          burst(a.x, V.groundY - 2, 16, [a.s.c3, '#ffffff', '#9fe4ff'], 0.8);
        }
      }
    } else if (a.st === 'down') {
      a.fall += dt;
      if (a.fall < 0.45) a.x += a.knock * dt;        // slide back from the blow
      if (a.fall >= 1.15) {                          // toppled, faded — mark the spot
        if (a.s.monster) {
          burst(a.x, V.groundY - 8 * V.S, 18, [a.s.c1, a.s.c3, '#ffffff'], 0.9);
        } else {
          bury(a);
        }
        actors.splice(i, 1);
        continue;
      }
    }

    /* Bounds. A final form has earned the field and turns instead of leaving;
       everyone else is culled once well clear. This has to sit outside the
       per-state branches — a carrier in a piggyback walks off just as easily
       as a runner does. */
    if (a.st !== 'down' && a.st !== 'portal' && a.st !== 'ball' && a.st !== 'held' && a.st !== 'thrown') {
      if (isFinal(a.s) && residentCount() <= 2) {
        if (a.x < V.cellW * 0.6) { a.dir = 1; if (a.st !== 'ride') a.face = 1; }
        else if (a.x > V.VW - V.cellW * 0.6) { a.dir = -1; if (a.st !== 'ride') a.face = -1; }
      } else if (a.x < -margin() || a.x > V.VW + margin()) {
        if (a.duel) endDuel(a.duel, true);
        actors.splice(i, 1);
        continue;
      }
    }

    if (a.atkT > 0) {
      var was = a.atkT; a.atkT -= dt;
      if (!a.struck && was > 0.18 && a.atkT <= 0.18 && a.duel) {
        a.struck = true;
        impact(a, a.duel.a === a ? a.duel.b : a.duel.a, s.heavy);
      }
      if (a.atkT <= 0) a.atkT = 0;
    }
  }

  /* encounters */
  for (var d2 = duels.length - 1; d2 >= 0; d2--) {
    var d = duels[d2];
    var cast = [d.a, d.b].concat(d.c ? [d.c] : []);
    var lost = false;
    for (var ci = 0; ci < cast.length; ci++) if (actors.indexOf(cast[ci]) < 0) lost = true;
    if (lost) { endDuel(d, true); continue; }
    d.t += dt;

    if (d.kind === 'piggyback') {
      if (!d.mount) {
        if (Math.abs(d.b.x - d.a.x) < V.cellW * 0.45) {
          d.mount = 1; d.b.st = 'ride'; d.b.vy = 0;
          burst(d.a.x, V.groundY - FEET * V.S * 0.6, 8, [d.b.s.c3, '#ffffff'], 0.5);
        } else if (d.t > 2.5) { endDuel(d, true); }
        continue;
      }
      if (d.t > d.over) {                       // hop down and part ways
        d.b.st = 'run'; d.b.y = 0; d.b.vy = -170;
        d.b.dir = -d.a.dir; d.b.face = d.b.dir;
        endDuel(d, true);
      }
      continue;
    }

    if (d.kind === 'wrestle') {
      var mid = (d.a.x + d.b.x) / 2;
      var push = Math.sin(d.t * 7) * 3 * V.S;
      d.a.x = mid - V.cellW * 0.30 + push;
      d.b.x = mid + V.cellW * 0.30 + push;
      if (d.t >= d.next) {
        d.next = d.t + 0.28;
        burst(mid, V.groundY - FEET * V.S * 0.55, 5,
              [d.a.s.c3, d.b.s.c3, '#ffffff'], 0.5);
        (RNG() < 0.5 ? d.a : d.b).atkT = 0.3;
      }
      if (!d.over && d.t > 2.4) d.over = d.t + 0.02;
      if (d.over && d.t > d.over) {
        var thrown = RNG() < 0.5 ? d.a : d.b;
        var holder = thrown === d.a ? d.b : d.a;
        endDuel(d, true);
        thrown.vy = -360; thrown.y = -0.01;
        thrown.knock = -thrown.face * 150;
        burst(thrown.x, V.groundY - FEET * V.S * 0.5, 20, [thrown.s.c3, '#ffffff'], 1.2);
        awardXP(holder, 1);                     // the throw itself is the win
        holder.victory = 1.1;
        if (RNG() < 0.62) {                     // and it is often the end of it
          thrown.st = 'down'; thrown.fall = 0; thrown.hurt = 1; thrown.flash = 0.14;
        } else {
          thrown.hurt = 0.8; thrown.cool = rnd(8, 16);
          thrown.dir = -thrown.face; thrown.face = thrown.dir;
        }
      }
      continue;
    }

    if (d.kind === 'gang') {
      /* the outnumbered fighter can turn it around */
      if (d.ultAt && !d.ult && d.t >= d.ultAt) {
        d.ult = 1; d.charge = 0;
        d.b.atkT = 0; d.b.hurt = 0;
      }
      if (d.ult) {
        d.charge += dt;
        if (d.charge < 0.85) {
          if (parts.length < 200 && RNG() < dt * 40) {
            var ang = RNG() * Math.PI * 2, rr = 60 * V.S;
            parts.push({ x: d.b.x + Math.cos(ang) * rr, y: V.groundY - 30 * V.S + Math.sin(ang) * rr * 0.4,
                         vx: -Math.cos(ang) * 140, vy: -Math.sin(ang) * 60 - 30,
                         life: 0.35, max: 0.35, c: d.b.s.c3, sz: 1 });
          }
        } else {
          tally.ultimate++;
          shocks.push({ x: d.b.x, t: 0, col: d.b.s.c3, life: 0.9 });
          burst(d.b.x, V.groundY - FEET * V.S * 0.5, 40, [d.b.s.c3, '#ffffff', d.b.s.c4], 1.8);
          var atkrs = [d.a, d.c];
          endDuel(d, true);
          for (var ai = 0; ai < atkrs.length; ai++) {
            var vic = atkrs[ai];
            if (!vic || actors.indexOf(vic) < 0) continue;
            vic.st = 'down'; vic.fall = 0; vic.hurt = 1; vic.flash = 0.16;
            vic.vy = -300; vic.y = -0.01;
            vic.knock = (vic.x < d.b.x ? -1 : 1) * 190;
          }
          awardXP(d.b, 2);
          d.b.victory = 1.4;
        }
        continue;
      }
      if (d.t >= d.next) {
        var att = (d.k % 2) ? d.c : d.a;
        if (att && actors.indexOf(att) >= 0) { att.atkT = 0.36; att.struck = false; }
        d.k++; d.next = d.t + 0.45;
        if (d.k >= d.n) d.over = d.t + 0.6;
      }
      if (d.over && d.t > d.over) {
        var mark = d.b, w1 = d.a, w2 = d.c;
        endDuel(d, true);
        mark.st = 'down'; mark.fall = 0; mark.hurt = 1; mark.flash = 0.14;
        mark.vy = -210; mark.y = -0.01; mark.knock = -mark.face * 60;
        burst(mark.x, V.groundY - FEET * V.S * 0.5, 22, [mark.s.c3, '#ffffff'], 1.2);
        awardXP(w1, 1); if (w2) awardXP(w2, 1);
        w1.victory = 1.1; if (w2) w2.victory = 1.1;
      }
      continue;
    }

    /* plain duel */
    if (d.over) { if (d.t > d.over) endDuel(d); continue; }
    if (d.t >= d.next) {
      var att2 = (d.k % 2) ? d.b : d.a;
      att2.atkT = 0.36; att2.struck = false;
      if (att2.s.ranged && RNG() < 0.4) fire(att2);
      d.k++; d.next = d.t + (d.cadence || 0.52);
      if (d.k >= d.n) d.over = d.t + 0.75;
    }
  }

  /* projectiles */
  for (var p = projs.length - 1; p >= 0; p--) {
    var pr = projs[p];
    pr.t += dt; pr.life -= dt;
    pr.x += pr.vx * dt;
    pr.y += Math.sin(pr.t * 14) * 0.5;
    var gone = pr.life <= 0 || pr.x < -80 || pr.x > V.VW + 80;
    for (var t2 = 0; t2 < actors.length && !gone; t2++) {
      var tg = actors[t2];
      if (tg.dir === pr.dir) continue;
      if (Math.abs(tg.x - pr.x) < V.cellW * 0.32) {
        tg.flash = 0.13; tg.hurt = 0.3;
        burst(pr.x, pr.y, 12, [pr.col, pr.hot, '#ffffff']);
        gone = true;
      }
    }
    if (gone) projs.splice(p, 1);
  }

  /* fireworks: a short volley over the new champion */
  for (var fw = fireworks.length - 1; fw >= 0; fw--) {
    var F = fireworks[fw];
    F.t += dt;
    if (F.t >= F.next && F.n > 0) {
      F.n--;
      F.next = F.t + 0.22 + RNG() * 0.2;
      var span2 = V.groundY - V.stripTop;
      burst(F.x + rnd(-130, 130) * V.S * 0.4,
            V.stripTop + rnd(0.15, 0.6) * span2,
            22, [F.col, '#ffffff', '#ffd28a', '#9fe0ff'], 1.15);
    }
    if (F.n <= 0) fireworks.splice(fw, 1);
  }

  /* shockwaves */
  for (var sk = shocks.length - 1; sk >= 0; sk--) {
    shocks[sk].t += dt;
    if (shocks[sk].t >= shocks[sk].life) shocks.splice(sk, 1);
  }

  /* level-up banners */
  for (var lu = levelups.length - 1; lu >= 0; lu--) {
    levelups[lu].t += dt;
    if (levelups[lu].t > (levelups[lu].big ? 2.6 : 1.8)) levelups.splice(lu, 1);
  }

  /* portals */
  for (var pi = portals.length - 1; pi >= 0; pi--) {
    var pv = portals[pi];
    pv.t += dt;
    if (pv.t >= pv.life) portals.splice(pi, 1);
  }

  /* graves */
  for (var gi = graves.length - 1; gi >= 0; gi--) {
    var gv = graves[gi];
    gv.t += dt;
    gv.rise = Math.min(1, gv.rise + dt * 3.2);
    if (gv.t >= GRAVE_LIFE) graves.splice(gi, 1);
  }

  /* particles */
  for (var k2 = parts.length - 1; k2 >= 0; k2--) {
    var pt = parts[k2];
    pt.life -= dt;
    if (pt.life <= 0) { parts.splice(k2, 1); continue; }
    pt.vy += 520 * dt;
    pt.x += pt.vx * dt; pt.y += pt.vy * dt;
    if (pt.y > GY) { pt.y = GY; pt.vy *= -0.35; pt.vx *= 0.7; }
  }
}

/* A still is not a random screenshot: fighters are spaced deliberately,
   given varied strides, and a duel is staged off-centre as a focal point. */
function composeStill(seed) {
  var prev = RNG;
  RNG = seeded(seed * 2654435761 + 12345);
  try {
    actors.length = 0; projs.length = 0; parts.length = 0; duels.length = 0;
    graves.length = 0; portals.length = 0; levelups.length = 0; shocks.length = 0;
    fireworks.length = 0; flyers.length = 0; chests.length = 0; motes.length = 0;

    var n = Math.max(2, cfg.count);
    var slot = V.VW / n;
    for (var i = 0; i < n; i++) {
      var a = makeActor(i % 2 ? -1 : 1, (i + 0.5) * slot + (RNG() - 0.5) * slot * 0.45);
      a.phase = RNG();
      a.face = a.dir;
      actors.push(a);
    }

    if (cfg.duels && actors.length >= 3) {
      var j = 1 + ((RNG() * (actors.length - 3)) | 0);
      var A = actors[j], B = actors[j + 1];
      var mid = (A.x + B.x) / 2;
      A.x = mid - V.cellW * 0.48; B.x = mid + V.cellW * 0.48;
      A.dir = 1; B.dir = -1; A.face = 1; B.face = -1;
      A.st = B.st = 'duel';
      A.phase = 0.2; B.phase = 0.6;
      A.atkT = 0.20;                       // caught at the moment of the strike
      B.hurt = 0.3;
      var d = { a: A, b: B, t: 0.9, next: 99, k: 1, n: 4, over: 0 };
      A.duel = B.duel = d; duels.push(d);
      burst(mid, V.groundY - FEET * V.S * 0.55, 16, [A.s.c3, A.s.c4, '#ffffff', B.s.c3], 1);
      for (var k2 = 0; k2 < parts.length; k2++) {   // let the sparks fly outward
        var pt = parts[k2];
        pt.x += pt.vx * 0.07; pt.y += pt.vy * 0.07; pt.life *= 0.8;
      }
    }

    /* a couple of shots in flight adds depth */
    for (var r = 0; r < actors.length; r++) {
      var f = actors[r];
      if (f.s.ranged && f.st === 'run' && projs.length < 2 && RNG() < 0.5) {
        fire(f); f.atkT = 0.2;
      }
    }
  } finally { RNG = prev; }
}

/* ------------------------------------------------------------- render --- */

function frameIndex(a) {
  if (a.flash > 0) return F_FLASH;
  if (a.st === 'down') return F_HIT;
  if (a.hurt > 0.12 && a.st !== 'duel') return F_HIT;
  if (a.atkT > 0) return F_ATK + Math.min(3, Math.floor((0.36 - a.atkT) / 0.09));
  if (a.victory > 0) return (a.victory * 5 | 0) % 2 ? F_ATK + 1 : F_IDLE + (Math.floor(a.phase * 4) % 4);
  if (a.rest > 0) return F_IDLE + (Math.floor(a.phase * 4) % 4);
  if (a.st === 'wrestle') return F_ATK + (Math.floor(a.phase * 4) % 2);
  if (a.st === 'greet') return F_IDLE + (Math.floor(a.phase * 4) % 4);
  if (a.st === 'chasing' || a.st === 'chased') return F_RUN + (Math.floor(a.phase * 8) % 8);
  if (a.st === 'ride' || a.st === 'mounting') return F_IDLE + (Math.floor(a.phase * 4) % 4);
  if (a.st === 'carry') return F_RUN + (Math.floor(a.phase * 8) % 8);
  if (a.st === 'duel') return F_IDLE + (Math.floor(a.phase * 4) % 4);
  return F_RUN + (Math.floor(a.phase * 8) % 8);
}

function draw() {
  var W = V.W, GY = V.groundY, top = V.stripTop, OFF = V.OFF;
  fg.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
  fg.clearRect(0, 0, W, V.stripH);
  fg.imageSmoothingEnabled = false;

  var gy = GY - top;                                    // ground line in strip space


  drawBeamLayer();
  drawSkyLayer();

  /* fighters, far-to-near by travel direction so crossings read cleanly */
  var vis = [];
  for (var n = 0; n < actors.length; n++) {
    var a = actors[n], sx = a.x - OFF;
    if (sx < -V.cellW || sx > W + V.cellW) continue;
    vis.push(a);
  }
  vis.sort(function (p, q) { return (p.dir - q.dir) || (p.x - q.x); });

  for (var v = 0; v < vis.length; v++) {
    var f = vis[v], sh = sheets[f.i];
    if (!sh) continue;
    var cx = f.x - OFF, cy = gy + f.y;

    /* a final form burns — a standing ring of light at its feet */
    if (f.s.aura) {
      var pulse = 0.72 + 0.28 * Math.sin(clock * 2.4 + f.x * 0.01);
      fg.globalCompositeOperation = 'lighter';
      fg.globalAlpha = 0.5 * pulse;
      fg.drawImage(glowBlob(f.s.c3), cx - V.cellW * 0.75, gy - V.cellH * 0.5,
                   V.cellW * 1.5, V.cellH * 0.62);
      fg.strokeStyle = f.s.c3;
      fg.lineWidth = Math.max(1, V.S * 0.6);
      fg.globalAlpha = 0.55 * pulse;
      fg.beginPath();
      fg.ellipse(cx, gy - 2, V.cellW * 0.42 * pulse, V.cellW * 0.13 * pulse, 0, 0, Math.PI * 2);
      fg.stroke();
      fg.globalCompositeOperation = 'source-over';
      fg.globalAlpha = 1;
    }

    /* contact shadow + neon pool */
    fg.globalAlpha = 0.5;
    fg.fillStyle = 'rgba(0,4,10,0.75)';
    var shW = V.cellW * (0.34 + 0.1 * (1 + f.y / 40));
    fg.fillRect(cx - shW / 2, gy - 1, shW, 3);
    fg.globalCompositeOperation = 'lighter';
    fg.globalAlpha = f.flash > 0 ? 0.75 : 0.4;
    fg.drawImage(glowBlob(f.s.c3), cx - V.cellW * 0.4, gy - 11, V.cellW * 0.8, 22);
    fg.globalCompositeOperation = 'source-over';
    fg.globalAlpha = 1;

    var fi = frameIndex(f);
    var sheet = f.face > 0 ? sh.right : sh.left;

    /* Gear that only exists for the length of a pass, so it is drawn live
       rather than baked into the sheet. */
    if (f.pass && f.pass.kind === 'glide') {
      var open = Math.min(1, Math.max(0, (f.pass.t - 0.12) / 0.18));
      var flap = Math.sin(f.pass.t * 9) * 0.35;
      var wy = cy - FEET * V.S * 0.62;
      fg.save();
      fg.translate(cx, wy);
      fg.scale(f.face, 1);
      fg.globalCompositeOperation = 'lighter';
      for (var wi = 0; wi < 3; wi++) {
        var len = (26 - wi * 6) * V.S * open;
        var lift = (-10 + wi * 7 + flap * 8) * V.S * open;
        fg.strokeStyle = wi % 2 ? f.s.c4 : '#ffffff';
        fg.globalAlpha = (0.85 - wi * 0.18) * open;
        fg.lineWidth = Math.max(1.5, (3 - wi * 0.6) * V.S);
        fg.beginPath();
        fg.moveTo(-2 * V.S, 0);
        fg.quadraticCurveTo(-len * 0.5, lift - 6 * V.S, -len, lift);
        fg.stroke();
      }
      fg.globalCompositeOperation = 'source-over';
      fg.restore();
      fg.globalAlpha = 1;
    } else if (f.pass && f.pass.kind === 'jet') {
      var thrust = f.pass.t < 0.42 ? 1 : Math.max(0, 1 - (f.pass.t - 0.42) / 0.25);
      var jx = cx - f.face * 4 * V.S, jy = cy - FEET * V.S * 0.42;
      fg.fillStyle = mix(f.s.c2, '#ffffff', 0.35);
      fg.fillRect(jx - 3 * V.S, jy - 5 * V.S, 6 * V.S, 10 * V.S);
      fg.fillStyle = f.s.c3;
      fg.fillRect(jx - 3 * V.S, jy - 5 * V.S, 6 * V.S, V.S);
      if (thrust > 0.02) {
        fg.globalCompositeOperation = 'lighter';
        fg.globalAlpha = thrust;
        var fl = (10 + 7 * Math.sin(clock * 40)) * V.S * thrust;
        fg.drawImage(glowBlob('#ffb648'), jx - 5 * V.S, jy + 4 * V.S, 10 * V.S, fl);
        fg.drawImage(glowBlob('#9fe0ff'), jx - 3 * V.S, jy + 4 * V.S, 6 * V.S, fl * 0.6);
        fg.globalCompositeOperation = 'source-over';
        fg.globalAlpha = 1;
      }
    } else if (f.pass && f.pass.kind === 'blink') {
      var bt = f.pass.t;
      fg.globalAlpha = bt < 0.16 ? Math.max(0, 1 - bt / 0.16)
                                 : Math.min(1, (bt - 0.16) / 0.14);
      for (var gi2 = 1; gi2 <= 2; gi2++) {       // ghost trail
        fg.globalAlpha *= 0.55;
        fg.drawImage(sheet, fi * sh.cw, 0, sh.cw, sh.ch,
                     Math.round(cx - MIDX * V.S - f.face * gi2 * 9 * V.S),
                     Math.round(cy - FEET * V.S), V.cellW, V.cellH);
      }
      fg.globalAlpha = bt < 0.16 ? Math.max(0, 1 - bt / 0.16)
                                 : Math.min(1, (bt - 0.16) / 0.14);
    }

    if (f.st === 'portal') {
      continue;                                 // drawn on the beam layer
    } else if (f.st === 'ball' || f.st === 'held' || f.st === 'thrown') {
      var br = 7 * V.S;
      var bxp, byp;
      if (f.st === 'ball') {
        bxp = cx; byp = gy - br - Math.abs(Math.sin(f.pt * 2.2)) * 2 * V.S;
        fg.globalAlpha = 0.4;
        fg.drawImage(glowBlob(f.s.c3 || '#9fe4ff'), cx - br * 2, gy - br * 1.6, br * 4, br * 2);
        fg.globalAlpha = 1;
      } else if (f.st === 'held' && f.holder) {
        bxp = f.holder.x - OFF; byp = gy - V.cellH * (f.holder.s.grow || 1) - br * 0.6;
      } else {
        bxp = f.bx - OFF; byp = gy + f.by;
      }
      drawBall(fg, bxp, byp, br, f.st === 'ball' ? 0 : f.pt * 9);
      continue;
    } else if (f.st === 'down') {
      /* topple onto the deck over ~0.55s, then fade out */
      var tp = Math.min(1, f.fall / 0.55);
      var ang = (1 - Math.pow(1 - tp, 3)) * Math.PI / 2 * -f.face;
      fg.save();
      fg.globalAlpha = Math.max(0, 1 - Math.max(0, f.fall - 0.7) / 0.45);
      fg.translate(Math.round(cx), Math.round(gy));
      fg.rotate(ang);
      fg.drawImage(sheet, fi * sh.cw, 0, sh.cw, sh.ch,
                   Math.round(-MIDX * V.S), Math.round(-FEET * V.S),
                   V.cellW, V.cellH);
      fg.restore();
      fg.globalAlpha = 1;
    } else if (f.bossScale) {
      var bs = f.bossScale;
      fg.drawImage(sheet, fi * sh.cw, 0, sh.cw, sh.ch,
                   Math.round(cx - MIDX * V.S * bs), Math.round(cy - FEET * V.S * bs),
                   V.cellW * bs, V.cellH * bs);
    } else {
      fg.drawImage(sheet, fi * sh.cw, 0, sh.cw, sh.ch,
                   Math.round(cx - MIDX * V.S), Math.round(cy - FEET * V.S),
                   V.cellW, V.cellH);
      fg.globalAlpha = 1;
    }
  }

  /* ambient motes */
  for (var am = 0; am < motes.length; am++) {
    var MT2 = motes[am], amx = MT2.x - OFF;
    if (amx < -6 || amx > W + 6) continue;
    var aal = Math.min(1, MT2.life / 2) * (MT2.k.tw ? 0.45 + 0.45 * Math.sin(MT2.t * 4) : 0.7);
    if (aal <= 0.03) continue;
    fg.globalAlpha = aal;
    fg.fillStyle = MT2.k.c;
    fg.fillRect(amx, MT2.y - top, 2, 2);
  }
  fg.globalAlpha = 1;

  /* waiting treasure chests */
  for (var tc = 0; tc < chests.length; tc++) {
    var TC = chests[tc];
    if (TC.st !== 'wait') continue;
    var tcx = TC.x - OFF;
    if (tcx < -40 || tcx > W + 40) continue;
    fg.globalAlpha = 0.45 + 0.25 * Math.sin(clock * 3 + TC.x);
    fg.drawImage(glowBlob('#ffd24d'), tcx - 16 * V.S, gy - 18 * V.S, 32 * V.S, 20 * V.S);
    fg.globalAlpha = 1;
    drawChestBox(fg, tcx, gy - 7 * V.S, V.S * 0.7, 0);
  }

  /* grave markers — they stand for GRAVE_LIFE seconds, then fade */
  if (graveSheets) {
    var gw = GRAVE_W * V.S, ghh = GRAVE_H * V.S;
    var nameFs = Math.max(6, Math.round(2.8 * V.S));
    for (var g2 = 0; g2 < graves.length; g2++) {
      var gv = graves[g2], gx = gv.x - OFF;
      if (gx < -gw || gx > W + gw) continue;

      var out = Math.max(0, Math.min(1, (GRAVE_LIFE - gv.t) / 2));   // fade at the end
      var up = 1 - Math.pow(1 - gv.rise, 3);                          // rise from the ground
      if (out <= 0.01) continue;

      fg.globalAlpha = out * 0.45;
      fg.fillStyle = 'rgba(0,4,10,0.8)';
      fg.fillRect(gx - gw * 0.4, gy - 1, gw * 0.8, 3);
      fg.globalCompositeOperation = 'lighter';
      fg.globalAlpha = out * 0.3;
      fg.drawImage(glowBlob(gv.col), gx - gw * 0.7, gy - ghh * 0.9, gw * 1.4, ghh * 1.1);
      fg.globalCompositeOperation = 'source-over';

      /* reveal the top of the marker first, so it reads as rising out of
         the ground; crop in the sheet's own pixels, not in art units */
      fg.globalAlpha = out;
      var sheetG = graveSheets[gv.kind];
      var srcH = Math.max(1, Math.round(sheetG.height * up));
      var dstH = Math.max(1, Math.round(ghh * up));
      fg.drawImage(sheetG, 0, 0, sheetG.width, srcH,
                   Math.round(gx - gw / 2), Math.round(gy - dstH), gw, dstH);

      if (gv.t < 4.5) {                                              // fallen fighter's name
        fg.globalAlpha = out * Math.min(1, gv.t / 0.4) * Math.max(0, 1 - (gv.t - 3.2) / 1.3) * 0.8;
        fg.font = '400 ' + nameFs + "px 'Press Start 2P',monospace";
        fg.textAlign = 'center';
        fg.fillStyle = gv.col;
        fg.fillText(gv.name, gx, gy - ghh - 4 * V.S);
      }
    }
    fg.globalAlpha = 1;
  }

  /* ultimate shockwaves */
  if (shocks.length) {
    fg.globalCompositeOperation = 'lighter';
    for (var sw = 0; sw < shocks.length; sw++) {
      var sc = shocks[sw], sx2 = sc.x - OFF;
      var kk = sc.t / sc.life;
      var rad = (1 - Math.pow(1 - kk, 2)) * 210 * V.S;
      fg.globalAlpha = Math.max(0, 1 - kk) * 0.85;
      fg.strokeStyle = sc.col;
      fg.lineWidth = Math.max(2, (1 - kk) * 5 * V.S);
      fg.beginPath();
      fg.ellipse(sx2, gy - 14 * V.S, rad, rad * 0.34, 0, 0, Math.PI * 2);
      fg.stroke();
      fg.globalAlpha = Math.max(0, 1 - kk) * 0.45;
      fg.strokeStyle = '#ffffff';
      fg.lineWidth = Math.max(1, (1 - kk) * 2 * V.S);
      fg.beginPath();
      fg.ellipse(sx2, gy - 14 * V.S, rad * 0.72, rad * 0.24, 0, 0, Math.PI * 2);
      fg.stroke();
    }
    fg.globalAlpha = 1;
    fg.globalCompositeOperation = 'source-over';
  }

  /* projectiles */
  fg.globalCompositeOperation = 'lighter';
  for (var p = 0; p < projs.length; p++) {
    var pr = projs[p], x = pr.x - OFF, y = pr.y - top;
    if (x < -60 || x > W + 60) continue;
    fg.globalAlpha = 0.85;
    fg.drawImage(glowBlob(pr.col), x - 16, y - 12, 32, 24);
    fg.fillStyle = pr.hot;
    fg.fillRect(x - 3 * V.S, y - V.S, 5 * V.S, 2 * V.S);
    fg.globalAlpha = 0.45;
    fg.fillStyle = pr.col;
    fg.fillRect(x - pr.dir * 12 * V.S, y - V.S * 0.5, 10 * V.S, V.S);
  }

  /* sparks */
  for (var k = 0; k < parts.length; k++) {
    var pt = parts[k], px2 = pt.x - OFF;
    if (px2 < -20 || px2 > W + 20) continue;
    fg.globalAlpha = Math.max(0, Math.min(1, pt.life / pt.max));
    fg.fillStyle = pt.c;
    var sz = pt.sz * V.S;
    fg.fillRect(px2, pt.y - top, sz, sz);
  }
  fg.globalAlpha = 1;
  fg.globalCompositeOperation = 'source-over';

  /* level-up and evolution banners */
  if (levelups.length) {
    for (var li = 0; li < levelups.length; li++) {
      var lv = levelups[li], lx = lv.x - OFF;
      if (lx < -160 || lx > W + 160) continue;
      var span = lv.big ? 2.6 : 1.8;
      var k2 = lv.t / span;
      var rise = (1 - Math.pow(1 - Math.min(1, lv.t / 0.5), 3)) * 26 * V.S;
      var al = Math.min(1, lv.t / 0.18) * Math.max(0, 1 - Math.max(0, k2 - 0.55) / 0.45);
      var fs2 = Math.max(7, Math.round((lv.big ? 4.6 : 3.2) * V.S));

      if (lv.big) {                                   // evolution shockwave
        var rr = (1 - Math.pow(1 - Math.min(1, lv.t / 0.6), 2)) * 90 * V.S;
        fg.globalCompositeOperation = 'lighter';
        fg.globalAlpha = al * 0.5;
        fg.strokeStyle = lv.col;
        fg.lineWidth = Math.max(2, 2.2 * V.S);
        fg.beginPath();
        fg.ellipse(lx, gy - 12 * V.S, rr, rr * 0.34, 0, 0, Math.PI * 2);
        fg.stroke();
        fg.globalCompositeOperation = 'source-over';
      }

      fg.globalAlpha = al;
      fg.font = '400 ' + fs2 + "px 'Press Start 2P',monospace";
      fg.textAlign = 'center';
      fg.fillStyle = lv.col;
      fg.fillText(lv.text, lx, gy - FEET * V.S - 14 * V.S - rise);
      fg.globalAlpha = 1;
    }
  }

  /* Name plates. Anyone in an encounter is labelled for as long as it lasts,
     on a backing chip so the text stays readable over any background. */
  var plated = [];
  for (var pl = 0; pl < actors.length; pl++) {
    if ((isFinal(actors[pl].s) || actors[pl].s.monster) && actors[pl].st !== 'down') plated.push(actors[pl]);
  }
  if (duels.length || plated.length) {
    var fs = Math.max(8, Math.round(3.6 * V.S));
    var pad = Math.round(fs * 0.5), chipH = fs + pad;
    fg.font = '400 ' + fs + "px 'Press Start 2P',monospace";
    fg.textAlign = 'center';
    fg.textBaseline = 'middle';

    /* everyone in a scrap, plus any champion, which is always announced */
    var groups = [];
    for (var d = 0; d < duels.length; d++) {
      var du = duels[d];
      if (du.kind === 'piggyback') continue;              // nobody is fighting
      groups.push({ fade: Math.min(1, du.t / 0.25),
                    cast: [du.a, du.b].concat(du.c ? [du.c] : []) });
    }
    if (plated.length) groups.push({ fade: 1, cast: plated });

    for (var d = 0; d < groups.length; d++) {
      var fade = groups[d].fade, cast = groups[d].cast;

      for (var ci = 0; ci < cast.length; ci++) {
        var f2 = cast[ci];
        if (cast !== plated && isFinal(f2.s)) continue;   // drawn once, below
        if (!f2 || f2.st === 'down') continue;
        var tx = f2.x - OFF;
        if (tx < -220 || tx > W + 220) continue;

        var lvl = f2.s.lvl || 0;
        var label = f2.title || (f2.s.monster ? f2.s.name : f2.s.name + (lvl ? '  L' + lvl : ''));
        var tw = fg.measureText(label).width;
        var ty = gy - FEET * V.S * (f2.s.grow || 1) * (f2.bossScale || 1) - 9 * V.S;

        fg.globalAlpha = fade * 0.72;                     // backing chip
        fg.fillStyle = 'rgba(3,9,18,0.9)';
        fg.fillRect(tx - tw / 2 - pad, ty - chipH / 2, tw + pad * 2, chipH);
        fg.globalAlpha = fade * 0.85;
        fg.fillStyle = f2.s.c3;
        fg.fillRect(tx - tw / 2 - pad, ty + chipH / 2 - Math.max(1, V.S * 0.5),
                    tw + pad * 2, Math.max(1, V.S * 0.5));

        fg.globalAlpha = fade;
        fg.fillStyle = '#eaf6ff';
        fg.fillText(label, tx, ty);
      }
    }
    fg.globalAlpha = 1;
    fg.textBaseline = 'alphabetic';
  }
}

/* A capture ball: white shell, coloured lid, dark band, pale button. Drawn
   from scratch — it reads as "creature container" without copying anyone. */
function drawBall(ctx, x, y, r, rot, lid) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot || 0);
  ctx.fillStyle = '#f2f4f6';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.fillStyle = lid || '#e03434';
  ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#20242c';
  ctx.fillRect(-r, -r * 0.16, r * 2, r * 0.32);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.34, 0, 7); ctx.fill();
  ctx.fillStyle = '#eef2f6';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.19, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
  ctx.restore();
}

var skyOn = false;

function drawFlyer(ctx, F) {
  var U = V.U, x = F.x - V.OFF, y = F.y + Math.sin(F.t * 1.7) * 6 * U;
  var d = F.vx > 0 ? 1 : -1;
  var nite = nightAmt(V.sun.hour);
  var body = mix('#2c3038', '#0a0c10', nite * 0.5);
  var wingA = Math.sin(F.flap);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(d, 1);
  ctx.fillStyle = body;
  ctx.strokeStyle = body;
  ctx.lineCap = 'round';
  if (F.kind === 'eagle') {
    ctx.lineWidth = 4 * U;
    ctx.beginPath(); ctx.ellipse(0, 0, 14 * U, 5 * U, 0, 0, 7); ctx.fill();     // body
    ctx.beginPath(); ctx.moveTo(10 * U, -2 * U); ctx.lineTo(17 * U, 0); ctx.lineTo(10 * U, 2 * U); ctx.fill();
    for (var w = -1; w <= 1; w += 2) {
      ctx.beginPath();
      ctx.moveTo(-2 * U, 0);
      ctx.quadraticCurveTo(-6 * U, w * (-16 - wingA * 12) * U * 0.5, -20 * U, w * (-22 - wingA * 16) * U * 0.5);
      ctx.stroke();
    }
  } else if (F.kind === 'dragon') {
    ctx.lineWidth = 6 * U;
    ctx.beginPath(); ctx.ellipse(0, 0, 22 * U, 8 * U, 0, 0, 7); ctx.fill();     // body
    ctx.beginPath(); ctx.moveTo(18 * U, -2 * U); ctx.quadraticCurveTo(30 * U, -8 * U, 36 * U, -4 * U); ctx.stroke();  // neck
    ctx.beginPath(); ctx.ellipse(38 * U, -5 * U, 6 * U, 4 * U, 0, 0, 7); ctx.fill();  // head
    ctx.beginPath(); ctx.moveTo(-18 * U, 0); ctx.quadraticCurveTo(-34 * U, 4 * U, -44 * U, -2 * U); ctx.stroke();     // tail
    for (var w2 = -1; w2 <= 1; w2 += 2) {
      ctx.beginPath();
      ctx.moveTo(0, -2 * U);
      ctx.quadraticCurveTo(-4 * U, (-26 - wingA * 18) * U, -26 * U, (-30 - wingA * 22) * U);
      ctx.lineTo(-18 * U, -6 * U);
      ctx.closePath(); ctx.fill();
      break;                                     // one big visible wing reads best
    }
    if (Math.sin(F.t * 0.9) > 0.7) {             // the occasional ember puff
      ctx.fillStyle = 'rgba(255,140,60,0.7)';
      ctx.beginPath(); ctx.arc(46 * U, -4 * U, (2 + Math.sin(F.t * 12)) * U, 0, 7); ctx.fill();
    }
  } else {                                       // giant insect
    ctx.beginPath(); ctx.ellipse(0, 0, 12 * U, 5 * U, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-11 * U, 1 * U, 7 * U, 4 * U, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 0.5;
    for (var w3 = -1; w3 <= 1; w3 += 2) {
      ctx.beginPath();
      ctx.ellipse(-2 * U, w3 * 8 * U * Math.abs(wingA), 10 * U, 4 * U, wingA * 0.6 * w3, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawChestBox(ctx, x, y, U, spin) {
  ctx.save();
  ctx.translate(x, y);
  if (spin) ctx.rotate(spin);
  ctx.fillStyle = '#131010';
  ctx.fillRect(-8 * U, -6.5 * U, 16 * U, 13 * U);
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(-7 * U, -5.5 * U, 14 * U, 11 * U);
  ctx.fillStyle = '#9a6a3e';
  ctx.fillRect(-7 * U, -5.5 * U, 14 * U, 4 * U);
  ctx.fillStyle = '#ffd24d';
  ctx.fillRect(-7 * U, -1.5 * U, 14 * U, 2 * U);
  ctx.fillRect(-1.5 * U, -2.5 * U, 3 * U, 4 * U);
  ctx.restore();
}

function drawSkyLayer() {
  var active = flyers.length > 0;
  if (!active) {
    for (var ci = 0; ci < chests.length; ci++) if (chests[ci].st === 'fall') { active = true; break; }
  }
  if (!active) {
    if (skyOn) { skyEl.style.display = 'none'; skyOn = false; }
    return;
  }
  if (!skyOn) { skyEl.style.display = 'block'; skyOn = true; }
  sy.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
  sy.clearRect(0, 0, V.W, V.groundY);
  for (var f = 0; f < flyers.length; f++) drawFlyer(sy, flyers[f]);
  for (var c = 0; c < chests.length; c++) {
    var C = chests[c];
    if (C.st !== 'fall') continue;
    drawChestBox(sy, C.x - V.OFF, C.y, V.S * 0.7, C.spin);
  }
}

var beamOn = false;

function drawBeamLayer() {
  var active = portals.length > 0;
  if (!active) {
    for (var i0 = 0; i0 < actors.length; i0++) {
      if (actors[i0].st === 'portal') { active = true; break; }
    }
  }
  if (!active) {
    if (beamOn) { beamEl.style.display = 'none'; beamOn = false; }
    return;
  }
  if (!beamOn) { beamEl.style.display = 'block'; beamOn = true; }

  var G = V.groundY, L = V.beamL, W2 = V.beamW;
  bg.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
  bg.clearRect(0, 0, W2, G);
  bg.imageSmoothingEnabled = false;
  bg.globalCompositeOperation = 'lighter';

  for (var pz = 0; pz < portals.length; pz++) {
    var pv = portals[pz], px = pv.x - V.OFF - L;
    var open = Math.min(1, pv.t / 0.22);
    var fade = Math.max(0, 1 - Math.max(0, pv.t - (pv.life - 0.5)) / 0.5);
    var my = pv.m.y;
    var colW = (16 + 44 * open) * V.S * 0.5;
    var bt = V.sun.day ? ['255,228,160', '255,190,90'] : ['200,220,255', '140,170,255'];
    var beam = bg.createLinearGradient(0, my, 0, G);
    beam.addColorStop(0, 'rgba(' + bt[0] + ',' + (0.55 * fade).toFixed(3) + ')');
    beam.addColorStop(0.55, 'rgba(' + bt[1] + ',' + (0.18 * fade).toFixed(3) + ')');
    beam.addColorStop(1, 'rgba(' + bt[1] + ',0)');
    bg.fillStyle = beam;
    bg.beginPath();
    bg.moveTo(px - colW * 0.5, my);
    bg.lineTo(px + colW * 0.5, my);
    bg.lineTo(px + colW * 1.25, G);
    bg.lineTo(px - colW * 1.25, G);
    bg.closePath(); bg.fill();

    bg.globalAlpha = fade;
    bg.drawImage(glowBlob(V.sun.day ? '#ffd27a' : '#a8c4ff'), px - colW * 1.6, my - colW * 0.7, colW * 3.2, colW * 1.4);
    var rw = colW * (1.35 + 0.5 * Math.sin(Math.min(1, pv.t / 0.3) * Math.PI));
    bg.strokeStyle = 'rgba(' + (V.sun.day ? '255,240,200' : '210,225,255') + ',' + (0.85 * fade * open).toFixed(3) + ')';
    bg.lineWidth = Math.max(1.5, 1.6 * V.S);
    bg.beginPath(); bg.ellipse(px, my, rw, rw * 0.3, 0, 0, Math.PI * 2); bg.stroke();
    bg.globalAlpha = 0.35 * fade;
    bg.drawImage(glowBlob(V.sun.day ? '#ffd27a' : '#a8c4ff'), px - colW * 1.8, G - 10 * V.S, colW * 3.6, 20 * V.S);
    bg.globalAlpha = 1;
  }
  bg.globalCompositeOperation = 'source-over';

  /* the falling arrival itself */
  for (var fi2 = 0; fi2 < actors.length; fi2++) {
    var f = actors[fi2];
    if (f.st !== 'portal') continue;
    var sh = sheets[f.i];
    var cx = f.x - V.OFF - L, cy = G + f.y;
    if (f.s.ball) {
      drawBall(bg, cx, cy - 8 * V.S, 7 * V.S, f.pt * 9);
    } else if (sh) {
      var drop = Math.min(1, Math.max(0, (f.pt - 0.32) / 0.35));
      bg.save();
      bg.globalAlpha = Math.min(1, f.pt / 0.18);
      bg.translate(Math.round(cx), Math.round(cy));
      bg.scale(1 - 0.12 * (1 - drop), 1 + 0.10 * (1 - drop));
      bg.drawImage(f.face > 0 ? sh.right : sh.left, F_IDLE * sh.cw, 0, sh.cw, sh.ch,
                   Math.round(-MIDX * V.S), Math.round(-FEET * V.S), V.cellW, V.cellH);
      bg.restore();
      bg.globalAlpha = 1;
    }
  }
}

/* ---------------------------------------------------------------- loop -- */

var running = false, lastT = 0, acc = 0, failures = 0;

function loop(ts) {
  if (!running) return;
  requestAnimationFrame(loop);
  if (document.hidden) { lastT = ts; return; }

  var dt = (ts - lastT) / 1000;
  lastT = ts;
  if (!(dt > 0)) return;
  if (dt > 0.1) dt = 0.1;                       // never fast-forward after a stall

  var minStep = 1 / cfg.fps - 0.002;
  acc += dt;
  if (acc < minStep) return;
  var step = acc; acc = 0;

  try {
    frameNo++;
    stepSim(step);
    draw();
    portalTick(step);
    if ((frameNo & 255) === 0) ensurePortal();     // the sun moves with the clock
    failures = 0;
  } catch (e) {
    console.error('[arena] frame', e);
    if (++failures > 12) { running = false; console.error('[arena] halted; background left in place'); }
  }
}

function start() {
  if (running) return;
  running = true; lastT = performance.now(); acc = 0;
  requestAnimationFrame(loop);
}

/* --------------------------------------------------- guest endpoint ----- */
/* Manifest contract (see README):
     { "hosts": ["cdn.example.com"],            // optional extra sprite hosts
       "characters": [
         { "name":"SENTINEL", "sprite":"https://.../sentinel.png",
           "color":"#00e5ff", "scale":1, "speed":1, "ranged":false } ] }

   Everything here fails silently. No endpoint, no network, bad JSON, a dead
   host, a broken image — the wallpaper just runs the built-in sixteen.     */

var guestState = { loaded: {}, tries: 0 };

function endpointHost() {
  try { return new URL(GUEST_ENDPOINT).host; } catch (e) { return ''; }
}

function isLocal(host) { return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'; }

function spriteAllowed(url, extraHosts) {
  if (/^data:image\//i.test(url)) return true;
  var u, base;
  try { u = new URL(url, GUEST_ENDPOINT || location.href); } catch (e) { return false; }
  try { base = new URL(GUEST_ENDPOINT); } catch (e) { base = { hostname: '' }; }
  /* plain http only for a local dev endpoint pointing at itself — a remote
     endpoint can never aim sprite loads at the viewer's own machine */
  var devLocal = u.protocol === 'http:' && isLocal(u.hostname) && isLocal(base.hostname);
  if (u.protocol !== 'https:' && !devLocal) return false;
  if (u.host === endpointHost()) return true;
  var src = SOURCES[cfg.guests];
  if (src) for (var k = 0; k < src.hosts.length; k++) if (u.host === src.hosts[k]) return true;
  for (var i = 0; i < extraHosts.length; i++) if (u.host === extraHosts[i]) return true;
  return false;
}

function cleanName(v) {
  return String(v == null ? '' : v)
    .replace(/[^\x20-\x7e]/g, '')                          // drawn with fillText
    .replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 14);
}

function normaliseGuest(raw, extraHosts) {
  if (!raw || typeof raw !== 'object') return null;
  var name = cleanName(raw.name);
  var sprite = typeof raw.sprite === 'string' ? raw.sprite : '';
  if (!name || !sprite || !spriteAllowed(sprite, extraHosts)) return null;
  var col = /^#[0-9a-f]{6}$/i.test(raw.color || '') ? raw.color : null;
  var num = function (v, lo, hi, d) {
    v = parseFloat(v);
    return (v === v && v >= lo && v <= hi) ? v : d;
  };
  return {
    guest: true, id: 'guest:' + name, name: name,
    url: new URL(sprite, GUEST_ENDPOINT || location.href).href,
    c3: col, wanted: num(raw.scale, 0.5, 1.6, 1),
    spd: num(raw.speed, 0.4, 2, 1), ranged: !!raw.ranged, ball: !!raw.ball
  };
}

function loadImage(url) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.crossOrigin = 'anonymous';               // needed to sample its colour
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, 15000);
    img.onload = function () { if (!done) { done = true; clearTimeout(timer); resolve(img); } };
    img.onerror = function () { if (!done) { done = true; clearTimeout(timer); reject(new Error('load')); } };
    img.src = url;
  });
}

/* Trim transparent margin so the sprite's feet land on the floor line, and
   pick an accent colour from its own pixels. Both need a readable canvas —
   if the host omitted CORS headers the readback throws and we fall back. */
function measureSprite(img) {
  var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  var box = { sx0: 0, sy0: 0, sw: w, sh: h, c3: null };
  if (!w || !h) return box;
  try {
    var c = mkCanvas(w, h), g = ctx2d(c);
    g.drawImage(img, 0, 0);
    var d = g.getImageData(0, 0, w, h).data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    var rs = 0, gs = 0, bs = 0, n = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var o = (y * w + x) * 4;
        if (d[o + 3] < 24) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        var r = d[o], gg = d[o + 1], bb = d[o + 2];
        var mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
        if (mx - mn > 40 && mx > 70) { rs += r; gs += gg; bs += bb; n++; }
      }
    }
    if (maxX >= minX && maxY >= minY) {
      box.sx0 = minX; box.sy0 = minY;
      box.sw = maxX - minX + 1; box.sh = maxY - minY + 1;
    }
    if (n > 12) {
      var f = 1.5, mxc = Math.max(rs, gs, bs) / n;         // push it toward neon
      var lift = mxc > 0 ? Math.min(f, 235 / mxc) : 1;
      box.c3 = '#' + [rs, gs, bs].map(function (v) {
        var q = Math.round(Math.min(255, (v / n) * lift));
        return (q < 16 ? '0' : '') + q.toString(16);
      }).join('');
    }
  } catch (e) { /* tainted canvas — keep the full frame and the given colour */ }
  return box;
}

function adoptGuest(spec) {
  if (guestState.loaded[spec.id]) return Promise.resolve(false);
  if (ROSTER.length >= 16 + GUEST_MAX) return Promise.resolve(false);
  guestState.loaded[spec.id] = true;
  return loadImage(spec.url).then(function (img) {
    var m = measureSprite(img);
    var tallest = 27 * spec.wanted;
    var ratio = m.sw / m.sh;
    spec.img = img;
    spec.sx0 = m.sx0; spec.sy0 = m.sy0; spec.sw = m.sw; spec.sh = m.sh;

    /* Height is the invariant — every fighter stands the same height on the
       floor line. Width follows from the trimmed aspect, and only a sprite
       wider than GUEST_MAX_W relative to its height gets scaled down, which
       needs a ratio above ~1.5 and did not occur in any source tested. */
    spec.dh = tallest;
    spec.dw = tallest * ratio;
    if (spec.dw > GUEST_MAX_W) {
      spec.dw = GUEST_MAX_W;
      spec.dh = GUEST_MAX_W / ratio;
    }
    spec.c3 = spec.c3 || m.c3 || '#7fe8ff';
    spec.c1 = spec.c3; spec.c2 = '#0a1420'; spec.c4 = '#ffffff';
    spec.kind = 'guest';

    ROSTER.push(spec);
    if (bakedAt) sheets[ROSTER.length - 1] = bakeGuestSheets(spec, bakedAt);
    refillBag();
    return true;
  }, function () {
    delete guestState.loaded[spec.id];
    return false;
  });
}

function readGuestCache() {
  try {
    var raw = JSON.parse(localStorage.getItem(GUEST_CACHE) || 'null');
    if (raw && raw.url === GUEST_ENDPOINT && Array.isArray(raw.characters)) return raw;
    return null;
  } catch (e) {}
  return null;
}

function writeGuestCache(hosts, characters) {
  try {
    localStorage.setItem(GUEST_CACHE, JSON.stringify({
      url: GUEST_ENDPOINT, at: Date.now(), hosts: hosts, characters: characters
    }));
  } catch (e) { /* quota or private mode — the cache is only a nicety */ }
}

function ingestManifest(m, cache) {
  var hosts = [];
  if (m && Array.isArray(m.hosts)) {
    for (var h = 0; h < m.hosts.length && h < 8; h++) {
      if (typeof m.hosts[h] === 'string') hosts.push(m.hosts[h]);
    }
  }
  var raw = (m && Array.isArray(m.characters)) ? m.characters.slice(0, GUEST_MAX) : [];
  var specs = [], keep = [];
  for (var i = 0; i < raw.length; i++) {
    var spec = normaliseGuest(raw[i], hosts);
    if (spec) { specs.push(spec); keep.push(raw[i]); }
  }
  if (cache !== false && specs.length) writeGuestCache(hosts, keep);
  var chain = Promise.resolve();
  specs.forEach(function (sp) { chain = chain.then(function () { return adoptGuest(sp); }); });
  return chain;
}

/* ── source: robohash.org ────────────────────────────────────────────────
   No listing API — every seed string is a distinct character, so the roster
   is generated client-side and is effectively endless. Sprites are 128x128
   RGBA with the background left transparent, which is what lets them be
   trimmed to a common height. Images are CC-BY; credit is in the README. */
/* Seeds, not a fixed cast: RoboHash renders a distinct character for any
   string, so the pool is words x numbers x sets — effectively unbounded. */
var ROBO_WORDS = [
  'nova','rift','onyx','vex','kilo','pyre','helix','drift','apex','quill',
  'zenith','flux','orbit','ember','cinder','vault','lumen','strider','harrow','koda',
  'atlas','borea','cobalt','delta','ecko','fable','gambit','hydra','ion','jinx',
  'krait','lyric','mantis','nadir','osprey','prism','quasar','rogue','sable','talon',
  'umbra','vector','wraith','xenon','yarrow','zephyr','basalt','cairn','dusk','ferrum'];
var ROBO_SETS = ['set1', 'set2', 'set3', 'set5'];

function robohashRoster(n) {
  var out = [], used = {};
  for (var i = 0; i < n * 3 && out.length < n; i++) {
    var w = ROBO_WORDS[(RNG() * ROBO_WORDS.length) | 0];
    var seed = w + '-' + (100 + ((RNG() * 9900) | 0));
    if (used[seed]) continue;
    used[seed] = 1;
    out.push({
      name: seed.replace('-', ' '),
      sprite: 'https://robohash.org/' + encodeURIComponent(seed) +
              '?set=' + ROBO_SETS[(RNG() * ROBO_SETS.length) | 0] + '&size=160x160',
      scale: 1, speed: 0.85 + RNG() * 0.5, ranged: RNG() < 0.35
    });
  }
  return Promise.resolve({ characters: out });
}

/* ── source: pokeapi.co ──────────────────────────────────────────────────
   96x96 palette PNGs with transparency. Large and varied, but the artwork is
   Nintendo's — fine on a personal desktop, a real consideration on anything
   company-branded. Opt-in only, and flagged in the README. */
function pokeapiRoster(n) {
  var ids = [], seen = {};
  while (ids.length < n) {
    var id = 1 + ((RNG() * 1017) | 0);      // every id with a front sprite
    if (!seen[id]) { seen[id] = 1; ids.push(id); }
  }
  return Promise.all(ids.map(function (id) {
    return fetch('https://pokeapi.co/api/v2/pokemon/' + id, { credentials: 'omit', mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var sp = j && j.sprites && j.sprites.front_default;
        return sp ? { name: j.name, sprite: sp, scale: 1, ball: true,
                      speed: 0.8 + RNG() * 0.5, ranged: RNG() < 0.3 } : null;
      })
      .catch(function () { return null; });
  })).then(function (list) {
    return { characters: list.filter(Boolean) };
  });
}

function fetchRoster() {
  var want = Math.min(GUEST_MAX, Math.max(4, cfg.count * 2));
  if (cfg.guests === 'robohash') return robohashRoster(want);
  if (cfg.guests === 'pokeapi') return pokeapiRoster(want);
  if (cfg.guests === 'mix') {
    /* half and half; if one source is down the other still delivers */
    var ha = Math.max(2, want >> 1);
    return Promise.all([
      robohashRoster(ha).catch(function () { return { characters: [] }; }),
      pokeapiRoster(ha).catch(function () { return { characters: [] }; })
    ]).then(function (rs) {
      return { characters: rs[0].characters.concat(rs[1].characters) };
    });
  }
  return fetch(GUEST_ENDPOINT, { cache: 'no-cache', credentials: 'omit', mode: 'cors' })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(r.status)); });
}

function guestsEnabled() {
  if (cfg.still || cfg.guests === 'off') return false;
  if (typeof fetch !== 'function') return false;
  if (cfg.guests === 'endpoint') return !!GUEST_ENDPOINT;
  return !!SOURCES[cfg.guests];
}

function pollGuests() {
  if (!guestsEnabled()) return;
  fetchRoster()
    .then(function (m) { return ingestManifest(m, cfg.guests === 'endpoint'); })
    .catch(function (e) {
      guestState.tries++;
      if (console && console.warn) console.warn('[arena] guest roster unavailable:', e.message || e);
    });
}

function startGuests() {
  if (!guestsEnabled()) return;
  if (cfg.guests === 'endpoint') {
    var cached = readGuestCache();               // show last known cast offline
    if (cached) ingestManifest({ hosts: cached.hosts, characters: cached.characters }, false);
  }
  pollGuests();
  setInterval(function () {
    if (!document.hidden) pollGuests();
  }, Math.max(300, GUEST_REFRESH) * 1000);
}

/* ---------------------------------------------------------------- boot -- */

var relayoutT = null;

function relayout(rebake) {
  measure();
  paintScene();
  ensurePortal();
  gradeEl.className = cfg.grain ? '' : 'nogr';

  var K = cfg.scale * V.dprInt;
  if (rebake || K !== bakedAt) bakeAll(K, ready);
  else ready();
}

function ready() {
  if (!guestState.xpLoaded) { guestState.xpLoaded = true; if (cfg.levels) loadXP(); }
  if (cfg.still) {
    running = false;
    document.body.classList.add('still');
    composeStill(cfg.still);
    draw();
    portalTick(0.016, true);
    dismissBoot();
    document.body.classList.add('idle');
    window.__arenaStill = true;          // export tooling waits on this
    return;
  }
  seed();
  start();
  if (!guestState.started) { guestState.started = true; startGuests(); }
}

function dismissBoot() {
  if (bootEl && !bootEl.classList.contains('gone')) {
    bootEl.classList.add('gone');
    setTimeout(function () { if (bootEl.parentNode) bootEl.parentNode.removeChild(bootEl); }, 600);
  }
}

function seed() {
  /* keep existing fighters, top up or trim to the new width */
  for (var i = actors.length - 1; i >= 0; i--) {
    var a = actors[i];
    a.speed = BASE_SPEED * V.S * a.s.spd;
    if (a.x < -margin() || a.x > V.VW + margin()) actors.splice(i, 1);
  }
  var want = wantCount();
  while (actors.length > want + 4) actors.pop();
  while (actors.length < want) spawn(true);
  dismissBoot();
}

setInterval(function () {
  if (!document.hidden && !cfg.still && cfg.ambient && running) paintScene();
}, 600000);

window.addEventListener('resize', function () {
  clearTimeout(relayoutT);
  relayoutT = setTimeout(function () { relayout(false); }, 180);
});
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) { lastT = performance.now(); acc = 0; }
});

/* The webfonts are declared font-display:block and are only fetched once
   something uses them — so document.fonts.ready can resolve before the
   wordmark's face has loaded, and the logo then reflows after first paint.
   Request both faces explicitly up front instead. */
var booted = false;
function boot() {
  if (booted) return;
  booted = true;
  relayout(true);
}

if (document.fonts && document.fonts.load) {
  Promise.all([
    document.fonts.load("700 40px Rajdhani"),
    document.fonts.load("400 12px 'Press Start 2P'")
  ]).then(boot, boot);
  setTimeout(boot, 2500);                       // safety net: never block on fonts
} else {
  boot();
}

/* --------------------------------------------------------- leaderboard -- */

function renderBoard() {
  var board = document.getElementById('board');
  if (!board || !board.classList.contains('on')) return;
  var rows = document.getElementById('board-rows');
  var ranked = [];
  for (var i = 0; i < ROSTER.length; i++) if (ROSTER[i].xp) ranked.push(ROSTER[i]);
  ranked.sort(function (a, b) { return (b.xp - a.xp) || ((b.lvl || 0) - (a.lvl || 0)); });
  ranked = ranked.slice(0, 8);

  if (!ranked.length) {
    rows.innerHTML = '<div class="empty">No wins yet — the first duel is coming.</div>';
    return;
  }
  var html = '';
  for (var r = 0; r < ranked.length; r++) {
    var sp = ranked[r], lvl = sp.lvl || 0;
    var floor = LEVEL_XP[lvl] || 0;
    var ceil = lvl >= MAX_LEVEL ? floor : LEVEL_XP[lvl + 1];
    var frac = lvl >= MAX_LEVEL ? 1 : Math.min(1, (sp.xp - floor) / Math.max(1, ceil - floor));
    var tag = lvl >= MAX_LEVEL ? 'FINAL' : 'L' + lvl;
    /* every value below is produced by this file, never by a manifest —
       names were reduced to plain ASCII long before they got here */
    html += '<div class="row2"><span>' + (r + 1) + '</span>' +
      '<span class="nm" style="color:' + sp.c3 + '">' + sp.name + '</span>' +
      '<span>' + tag + '</span><span>' + sp.xp + ' xp</span></div>' +
      '<div class="bar"><i style="width:' + Math.round(frac * 100) + '%;background:' + sp.c3 + '"></i></div>';
  }
  rows.innerHTML = html;
}

/* --------------------------------------------------------------- panel -- */

(function panelUI() {
  var el = document.getElementById('panel');
  if (!el) return;
  var fields = ['screens', 'scale', 'taskbar', 'count', 'fps'];
  var flags = ['duels', 'raids', 'levels', 'portal', 'ambient', 'grain'];

  function sync() {
    fields.forEach(function (k) {
      var inp = document.getElementById('p-' + k), out = document.getElementById('o-' + k);
      inp.value = cfg[k];
      out.textContent = cfg[k];
    });
    flags.forEach(function (k) { document.getElementById('p-' + k).checked = !!cfg[k]; });
    if (sel) sel.value = cfg.guests;
  }

  fields.forEach(function (k) {
    document.getElementById('p-' + k).addEventListener('input', function () {
      cfg[k] = parseFloat(this.value);
      clampCfg(cfg); saveCfg(); sync();
      relayout(k === 'scale');
    });
  });
  flags.forEach(function (k) {
    document.getElementById('p-' + k).addEventListener('change', function () {
      cfg[k] = this.checked ? 1 : 0; saveCfg(); sync();
      if (k === 'duels' && !cfg.duels) while (duels.length) endDuel(duels[0], true);
      relayout(false);
    });
  });

  var sel = document.getElementById('p-guests');
  if (sel) {
    sel.addEventListener('change', function () {
      cfg.guests = this.value;
      saveCfg();
      pollGuests();                     // new source takes effect immediately
    });
  }

  var wipe = document.getElementById('p-wipe');
  if (wipe) {
    wipe.addEventListener('click', function () {
      try { localStorage.removeItem(XP_STORE); } catch (e) {}
      for (var i = 0; i < ROSTER.length; i++) {
        var sp = ROSTER[i];
        if (!sp.xp && !sp.lvl) continue;
        sp.xp = 0; sp.lvl = 0; applyProgression(sp);
        if (bakedAt) sheets[i] = sp.guest ? bakeGuestSheets(sp, bakedAt) : bakeSheets(sp, bakedAt);
      }
      levelups.length = 0; fireworks.length = 0;
      renderBoard();
      var btn = this;
      btn.textContent = 'Progress cleared';
      setTimeout(function () { btn.textContent = 'Reset progress'; }, 1400);
    });
  }

  document.getElementById('p-copy').addEventListener('click', function () {
    var q = [];
    for (var k in DEFAULTS) if (cfg[k] !== DEFAULTS[k]) q.push(k + '=' + cfg[k]);
    var url = location.origin + location.pathname + (q.length ? '?' + q.join('&') : '');
    var btn = this;
    function ok() { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy URL'; }, 1400); }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(ok, function () { prompt('URL', url); });
    else prompt('URL', url);
  });

  document.getElementById('p-reset').addEventListener('click', function () {
    for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
    saveCfg(); sync(); relayout(true);
  });

  var board = document.getElementById('board');
  window.addEventListener('keydown', function (e) {
    if (e.key === 'h' || e.key === 'H') { el.classList.toggle('on'); sync(); }
    if (e.key === 'l' || e.key === 'L') { board.classList.toggle('on'); renderBoard(); }
    if (e.key === 'Escape') { el.classList.remove('on'); board.classList.remove('on'); }
  });

  /* hide the pointer when nothing is happening — it is a wallpaper */
  var idleT;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(function () { document.body.classList.add('idle'); }, 2500);
  }
  window.addEventListener('mousemove', wake);
  wake(); sync();
})();

/* ?debug=1 exposes the baked sheets so the art can be contact-sheeted */
try {
  if (/[?&]debug=1/.test(location.search)) {
    window.__arena = {
      roster: ROSTER, cells: CELLS, art: { w: ART_W, h: ART_H, feet: FEET, midx: MIDX },
      sheets: function () { return sheets; },
      graves: function () { return graves; },
      duels: function () { return duels; },
      tally: function () { return tally; },
      sources: SOURCES,
      award: awardXP,
      forceRaid: function () { spawnRaid(); },
      spawnFlyer: function (kind) {
        flyers.push({ kind: kind, x: -200, y: V.H * 0.15, vx: V.H * 0.35,
                      t: 0, flap: 0, dropX: V.VW * 0.45, dropped: false });
      },
      flyState: function () {
        return { flying: flyers.length > 0,
                 chestAny: chests.length > 0,
                 chestWaiting: chests.some(function (c) { return c.st === 'wait'; }),
                 opened: window.__chestOpened || false };
      },
      portalTest: function () {                 // force a guest through the mark
        var gi = [];
        for (var i = 0; i < ROSTER.length; i++) if (ROSTER[i].guest) gi.push(i);
        if (!gi.length) return false;
        var a = makeActor(RNG() < 0.5 ? 1 : -1, 0);
        a.i = gi[(RNG() * gi.length) | 0]; a.s = ROSTER[a.i];
        a.speed = BASE_SPEED * V.S * a.s.spd;
        if (!portalSpawn(a)) return false;
        actors.push(a);
        return true;
      },
      probeSource: function (n) {                 // adapter output, without adopting
        var was = cfg.guests; cfg.guests = n;
        return (n === 'robohash' ? robohashRoster(6) : Promise.resolve({ characters: [] }))
          .then(function (m) {
            var out = (m.characters || []).map(function (c) { return normaliseGuest(c, []); });
            cfg.guests = was;
            return out;
          });
      },
      view: function () { return V; },
      actors: function () { return actors; }
    };
  }
} catch (e) {}

})();
