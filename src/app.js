/* ============================================================================
   BLUERYDGE ARENA — dual-monitor animated wallpaper
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
  logo: 1,
  card: 0,        // 1 shows the full placemat card instead of the lockup
  portal: 1,      // guests arrive through the logo instead of walking on
  levels: 1,      // fighters gain experience, kit and evolutions from wins
  seedxp: 0,      // preview switch: start every fighter with this much record
  grain: 1,
  maxDpr: 2,
  guests: 'mix',        // 'mix' | 'robohash' | 'pokeapi' | 'endpoint' | 'off'
  still: 0,       // >0 freezes a composed frame, using this value as the seed
  logoy: 0,       // logo height as a fraction of the screen; 0 = automatic
  drift: 0        // slowly drift the logo — OLED burn-in insurance
};
var NUM = { screens: 1, panel: 1, scale: 1, taskbar: 1, count: 1, fps: 1,
            maxDpr: 1, still: 1, logoy: 1, seedxp: 1 };
var LIMITS = {
  screens: [1, 6], panel: [-1, 5], scale: [1, 5], taskbar: [0, 400],
  count: [1, 16], fps: [10, 144], maxDpr: [1, 3], seedxp: [0, 400],
  still: [0, 999999], logoy: [0, 0.95]
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
    var saved = JSON.parse(localStorage.getItem('bluerydge.arena') || '{}');
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
  return clampCfg(c);
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
  try { localStorage.setItem('bluerydge.arena', JSON.stringify(cfg)); } catch (e) {}
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
var GUEST_CACHE = 'bluerydge.arena.guests';
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
    head:'hood',   wep:'dagger', cape:1, ranged:0, spd:1.42, challenger:1 }
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
var XP_STORE = 'bluerydge.arena.xp';

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
  if (!cfg.levels) return 0;
  spec.xp = (spec.xp || 0) + (n || 1);
  var was = spec.lvl || 0, now = levelFor(spec.xp);
  if (now === was) { saveXP(); return 0; }

  spec.lvl = now;
  applyProgression(spec);
  if (bakedAt) {
    sheets[actor.i] = spec.guest ? bakeGuestSheets(spec, bakedAt) : bakeSheets(spec, bakedAt);
  }
  saveXP();

  var big = (now === 3 || now === MAX_LEVEL);
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
    fxEl    = document.getElementById('fx'),
    marksEl = document.getElementById('marks'),
    gradeEl = document.getElementById('grade'),
    bootEl  = document.getElementById('boot');
var sg = ctx2d(sceneEl, false), fg = ctx2d(fxEl, true);

var V = {};   // live view metrics

function measure() {
  var W = Math.max(320, window.innerWidth), H = Math.max(240, window.innerHeight);
  var dpr = Math.min(cfg.maxDpr, window.devicePixelRatio || 1);
  var solo = cfg.panel >= 0;                       // one instance per monitor
  var panelW = solo ? W : W / cfg.screens;
  var S = cfg.scale;
  var groundY = Math.max(40, H - cfg.taskbar);
  var stripTop = Math.max(0, Math.round(groundY - (FEET * S + 52)));
  /* Fix the mark's position from the unadjusted strip first. Deriving it from
     the adjusted value would be circular: lowering the strip for the portal
     would move the mark, which would move the strip again. */
  var markY = Math.round(cfg.logoy > 0 ? H * cfg.logoy
                                       : Math.min(stripTop * 0.62, H * 0.42));
  /* The animated layer has to reach the mark, or there is nothing to fall from. */
  if (cfg.portal && cfg.logo) stripTop = Math.max(0, Math.min(stripTop, markY - 60));

  V = {
    W: W, H: H, dpr: dpr, S: S,
    U: Math.min(2.4, Math.max(0.7, H / 1080)),     // scene scale vs. a 1080p screen
    VW: solo ? W * cfg.screens : W,                // virtual span width
    OFF: solo ? cfg.panel * W : 0,                 // virtual x of this window's left edge
    panelW: panelW, panels: cfg.screens,
    groundY: groundY, stripTop: stripTop, stripH: H - stripTop, markY: markY,
    cellW: ART_W * S, cellH: ART_H * S,
    dprInt: Math.max(1, Math.min(3, Math.round(dpr)))
  };

  sceneEl.width = Math.round(W * dpr); sceneEl.height = Math.round(H * dpr);
  sceneEl.style.width = W + 'px'; sceneEl.style.height = H + 'px';
  fxEl.width = Math.round(W * dpr); fxEl.height = Math.round(V.stripH * dpr);
  fxEl.style.width = W + 'px'; fxEl.style.height = V.stripH + 'px';
  fxEl.style.top = V.stripTop + 'px';
  sg = ctx2d(sceneEl, false); fg = ctx2d(fxEl, true);
}

/* deterministic PRNG so the skyline is stable across repaints */
function seeded(seed) {
  var s = seed >>> 0;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function dotPattern(g, spacing, radius, color, offx, offy) {
  var t = mkCanvas(spacing, spacing), tg = ctx2d(t);
  tg.fillStyle = color;
  tg.beginPath(); tg.arc(spacing / 2, spacing / 2, radius, 0, 7); tg.fill();
  var p = g.createPattern(t, 'repeat');
  g.save(); g.translate(offx, offy); g.fillStyle = p;
  g.fillRect(-offx, -offy, V.W + spacing, V.H + spacing); g.restore();
}

function hexPath(g, cx, cy, r) {
  g.beginPath();
  for (var i = 0; i < 6; i++) {
    var a = Math.PI / 3 * i - Math.PI / 2, x = cx + r * Math.cos(a), y = cy + r * 1.09 * Math.sin(a);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

function paintScene() {
  var W = V.W, H = V.H, G = V.groundY, U = V.U;
  sg.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
  sg.clearRect(0, 0, W, H);

  /* Base: the placemat's near-black navy, lifting slightly toward the floor */
  var sky = sg.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#01040a');
  sky.addColorStop(0.42, '#030c18');
  sky.addColorStop(0.80, '#05172c');
  sky.addColorStop(1, '#01060e');
  sg.fillStyle = sky; sg.fillRect(0, 0, W, H);

  /* One bloom per monitor, so each screen is composed around its own mark */
  for (var p = 0; p < V.panels; p++) {
    var cx = (p + 0.5) * V.panelW - V.OFF;
    if (cx < -V.panelW || cx > W + V.panelW) continue;
    var bl = sg.createRadialGradient(cx, H * 0.46, 0, cx, H * 0.46, V.panelW * 0.6);
    bl.addColorStop(0, 'rgba(10,120,225,0.20)');
    bl.addColorStop(0.45, 'rgba(8,80,180,0.09)');
    bl.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = bl; sg.fillRect(cx - V.panelW * 0.7, 0, V.panelW * 1.4, H);
  }

  hexLattice(G, U);
  halftoneField(G, U);

  /* fine circuit texture */
  var d1 = Math.round(34 * U);
  dotPattern(sg, d1, 0.9 * U, 'rgba(60,140,240,0.10)', -V.OFF % d1, 0);

  nodeWeb(G, U);

  /* The arena floor the fighters run on = the top edge of the taskbar */
  var band = 30 * U;
  var fl = sg.createLinearGradient(0, G - band, 0, G + 6);
  fl.addColorStop(0, 'rgba(0,150,255,0)');
  fl.addColorStop(0.7, 'rgba(0,170,255,0.12)');
  fl.addColorStop(1, 'rgba(120,230,255,0.34)');
  sg.fillStyle = fl; sg.fillRect(0, G - band, W, band + 6);

  sg.fillStyle = 'rgba(0,7,16,0.9)'; sg.fillRect(0, G + 2, W, H - G);
  sg.fillStyle = 'rgba(170,240,255,0.95)'; sg.fillRect(0, G, W, Math.max(2, Math.round(2 * U)));
  sg.fillStyle = 'rgba(0,200,255,0.28)'; sg.fillRect(0, G + 2 * U, W, Math.max(1, Math.round(U)));

  sg.fillStyle = 'rgba(90,200,255,0.14)';
  var tick = Math.round(64 * U);
  for (var x = -(V.OFF % tick); x < W; x += tick) {
    sg.fillRect(x, G + 5 * U, 24 * U, Math.max(1, U | 0));
  }

  /* a seam pip at every monitor boundary */
  for (var s2 = 1; s2 < V.panels; s2++) {
    var sx = s2 * V.panelW - V.OFF;
    if (sx < -4 || sx > W + 4) continue;
    var beam = 170 * U;
    var sm = sg.createLinearGradient(0, G - beam, 0, G);
    sm.addColorStop(0, 'rgba(0,190,255,0)'); sm.addColorStop(1, 'rgba(0,190,255,0.20)');
    sg.fillStyle = sm; sg.fillRect(sx - 1, G - beam, Math.max(2, U | 0), beam);
  }
}

/* Loose honeycomb of hex outlines — the placemat's signature motif. */
function hexLattice(G, U) {
  var R = 92 * U, dx = R * 1.5, dy = R * Math.sqrt(3);
  var r = seeded(4711);
  var x0 = -((V.OFF % dx) + dx), cols = Math.ceil((V.W + dx * 2) / dx);
  sg.lineWidth = Math.max(1, U * 0.9);
  for (var c = 0; c <= cols; c++) {
    for (var row = -1; row * dy < V.H + dy; row++) {
      var hx = x0 + c * dx;
      var hy = row * dy + (c % 2 ? dy / 2 : 0);
      var n = r();
      if (n < 0.55) continue;                       // a lattice, not a grid
      var fade = Math.max(0, 1 - Math.max(0, hy - G + 120 * U) / (200 * U));
      var a = (0.07 + n * 0.13) * fade;
      if (a < 0.012) continue;
      sg.strokeStyle = 'rgba(58,150,255,' + a.toFixed(3) + ')';
      hexPath(sg, hx, hy, R * 0.94);
      sg.stroke();
      if (n > 0.92) {                               // occasional lit cell
        sg.fillStyle = 'rgba(0,150,255,' + (0.05 * fade).toFixed(3) + ')';
        hexPath(sg, hx, hy, R * 0.9); sg.fill();
      }
    }
  }
}

/* Halftone gradients: dot grids whose radius falls off from a focus. */
function halftoneField(G, U) {
  var r = seeded(90210);
  var spacing = 11 * U;
  /* biased to the panel edges, the way the placemat frames its artwork —
     the middle of each screen stays clear for desktop icons */
  var spots = [];
  for (var p = 0; p < V.panels; p++) {
    var base = (p + 0.5) * V.panelW - V.OFF;
    spots.push([base - V.panelW * 0.50, V.H * 0.30, V.panelW * 0.20]);
    spots.push([base + V.panelW * 0.50, V.H * 0.62, V.panelW * 0.20]);
    spots.push([base - V.panelW * 0.30, V.H * 0.88, V.panelW * 0.15]);
    spots.push([base + V.panelW * 0.32, V.H * 0.10, V.panelW * 0.15]);
  }
  sg.fillStyle = 'rgba(70,165,255,0.20)';
  for (var i = 0; i < spots.length; i++) {
    var cx = spots[i][0], cy = spots[i][1], rad = spots[i][2];
    if (cx < -rad || cx > V.W + rad) continue;
    for (var y = cy - rad; y <= cy + rad; y += spacing * 0.87) {
      var stagger = ((((y - cy) / (spacing * 0.87)) | 0) % 2) * spacing * 0.5;
      for (var x = cx - rad + stagger; x <= cx + rad; x += spacing) {
        var ddx = (x - cx) / rad, ddy = (y - cy) / rad;
        var d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d > 1) continue;
        var rr = (1 - d) * (1 - d) * spacing * 0.32;
        if (rr < 0.28) continue;
        if (y > G - 8 * U) continue;                // keep the floor clean
        sg.beginPath(); sg.arc(x, y, rr, 0, 7); sg.fill();
      }
    }
    void r;
  }
}

/* Scattered nodes with short connectors, as on the placemat. */
function nodeWeb(G, U) {
  var r = seeded(1337), pts = [];
  var n = Math.round(V.W / (170 / U));
  for (var i = 0; i < n; i++) {
    pts.push([r() * (V.W + 200) - 100, r() * (G - 60 * U)]);
  }
  sg.lineWidth = Math.max(1, U * 0.8);
  for (var a = 0; a < pts.length; a++) {
    for (var b = a + 1; b < pts.length; b++) {
      var ddx = pts[a][0] - pts[b][0], ddy = pts[a][1] - pts[b][1];
      var d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d > 190 * U) continue;
      sg.strokeStyle = 'rgba(60,160,255,' + (0.10 * (1 - d / (190 * U))).toFixed(3) + ')';
      sg.beginPath(); sg.moveTo(pts[a][0], pts[a][1]); sg.lineTo(pts[b][0], pts[b][1]); sg.stroke();
    }
  }
  for (var k = 0; k < pts.length; k++) {
    sg.fillStyle = 'rgba(120,205,255,0.30)';
    sg.beginPath(); sg.arc(pts[k][0], pts[k][1], 1.5 * U, 0, 7); sg.fill();
  }
}

/* --------------------------------------------------------------- logo --- */

/* If assets/placemat.(png|jpg|webp|svg) exists at build time it is inlined
   here as a data URI and used verbatim, centred on each monitor, in place of
   the drawn lockup. See tools/build.py. Empty otherwise. */
var PLACEMAT_SRC = '__PLACEMAT_SRC__';

/* Likewise assets/logo.(svg|png|webp|jpg): the exact lockup, used in place of
   the drawn one. Prefer .svg — it stays sharp at every size. Takes precedence
   over the drawn mark; a placemat, being the larger artwork, wins over both. */
var LOGO_SRC = '__LOGO_SRC__';
/* Rendered as DOM/SVG rather than into the canvas: it stays perfectly crisp
   at any DPI and costs nothing per frame.                                   */

function logoSVG(id, w) {
  var h = Math.round(w * 48 / 44);
  return '<svg class="hexwrap" width="' + w + '" height="' + h + '" viewBox="0 0 44 48" aria-hidden="true">' +
    '<defs>' +
      '<linearGradient id="ring' + id + '" x1="0.15" y1="0" x2="0.85" y2="1">' +
        '<stop offset="0" stop-color="#ff5b74"/><stop offset="0.5" stop-color="#e11d40"/>' +
        '<stop offset="1" stop-color="#a10f2b"/></linearGradient>' +
      '<linearGradient id="core' + id + '" x1="0.1" y1="0" x2="0.9" y2="1">' +
        '<stop offset="0" stop-color="#8df4ff"/><stop offset="1" stop-color="#159fd6"/></linearGradient>' +
    '</defs>' +
    /* crimson outer ring */
    '<polygon points="22,1.8 40.4,12.5 40.4,33.9 22,44.6 3.6,33.9 3.6,12.5" fill="rgba(4,12,24,0.6)" ' +
      'stroke="url(#ring' + id + ')" stroke-width="3" stroke-linejoin="round"/>' +
    /* cyan inner ring */
    '<polygon points="22,8.4 34.8,15.8 34.8,30.6 22,38 9.2,30.6 9.2,15.8" fill="none" ' +
      'stroke="url(#core' + id + ')" stroke-width="2.1" stroke-linejoin="round"/>' +
    /* the "rydge" — a white chevron rising inside the mark */
    '<polyline points="14.2,28.2 22,18.2 29.8,28.2" fill="none" stroke="#ffffff" ' +
      'stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<polyline points="18.1,29.2 22,24.2 25.9,29.2" fill="none" stroke="rgba(141,244,255,0.75)" ' +
      'stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
  '</svg>';
}

/* A reconstruction of the Bluerydge placemat from the brand's own parts.
   The photography in the original cannot be recreated, so the right-hand
   strips are rendered as branded panels with silhouettes. Drop the real file
   in at assets/placemat.* and this is bypassed entirely. */
function placematCard(id, cw) {
  var arrow = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="11" fill="#22d3ee"/>' +
    '<path d="M10 7l5 5-5 5" fill="none" stroke="#062033" stroke-width="2.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var bullets = [
    'Secure Mission Capability', 'Cyber &amp; Technology',
    'AI &amp; Robotic Integration', 'Research &amp; Development'
  ].map(function (t) { return '<span><i></i>' + t + '</span>'; }).join('');

  /* stand-ins for the original's photography, in the brand's palette */
  var strips =
    '<figure><svg viewBox="0 0 40 120" preserveAspectRatio="xMidYMid slice">' +
      '<defs><linearGradient id="s1' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#0f2c4c"/><stop offset="1" stop-color="#061424"/></linearGradient></defs>' +
      '<rect width="40" height="120" fill="url(#s1' + id + ')"/>' +
      '<g fill="none" stroke="rgba(120,200,255,0.16)" stroke-width="0.7">' +
      '<path d="M0 30h40M0 60h40M0 90h40"/></g></svg></figure>' +

    '<figure><svg viewBox="0 0 60 120" preserveAspectRatio="xMidYMid slice">' +
      '<defs><linearGradient id="s2' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#f0b478"/><stop offset="0.45" stop-color="#8a6f6a"/>' +
      '<stop offset="1" stop-color="#20222e"/></linearGradient></defs>' +
      '<rect width="60" height="120" fill="url(#s2' + id + ')"/>' +
      '<g fill="#181a22">' +                                    /* helicopter */
      '<rect x="20" y="40" width="17" height="6" rx="3"/>' +
      '<rect x="35" y="41" width="14" height="2"/>' +
      '<rect x="46" y="37" width="2" height="7"/>' +
      '<rect x="12" y="36" width="30" height="1.4"/>' +
      '<rect x="26" y="37" width="2" height="3"/>' +
      '<rect x="24" y="46" width="9" height="1.2"/></g>' +
      '<rect y="104" width="60" height="16" fill="#14161e"/></svg></figure>' +

    '<figure><svg viewBox="0 0 70 120" preserveAspectRatio="xMidYMid slice">' +
      '<defs><linearGradient id="s3' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#caa079"/><stop offset="0.55" stop-color="#7d5f45"/>' +
      '<stop offset="1" stop-color="#2b2018"/></linearGradient></defs>' +
      '<rect width="70" height="120" fill="url(#s3' + id + ')"/>' +
      '<g fill="#241a13">' +                                    /* figure, walking */
      '<circle cx="35" cy="52" r="5"/>' +
      '<rect x="30" y="57" width="10" height="20" rx="3"/>' +
      '<rect x="26" y="59" width="4" height="14" rx="2"/>' +
      '<rect x="40" y="59" width="4" height="14" rx="2"/>' +
      '<rect x="30" y="76" width="4" height="18"/>' +
      '<rect x="36" y="76" width="4" height="18"/></g>' +
      '<rect y="92" width="70" height="28" fill="#2a1f16"/></svg></figure>' +

    '<figure><svg viewBox="0 0 64 120" preserveAspectRatio="xMidYMid slice">' +
      '<defs><linearGradient id="s4' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#0e5f78"/><stop offset="0.5" stop-color="#0a3d55"/>' +
      '<stop offset="1" stop-color="#04202f"/></linearGradient></defs>' +
      '<rect width="64" height="120" fill="url(#s4' + id + ')"/>' +
      '<g fill="#08222f">' +                                    /* android */
      '<rect x="26" y="34" width="12" height="14" rx="5"/>' +
      '<rect x="24" y="50" width="16" height="26" rx="5"/>' +
      '<rect x="18" y="52" width="5" height="22" rx="2.5"/>' +
      '<rect x="41" y="52" width="5" height="22" rx="2.5"/>' +
      '<rect x="26" y="77" width="5" height="26" rx="2"/>' +
      '<rect x="33" y="77" width="5" height="26" rx="2"/></g>' +
      '<rect x="29" y="38" width="6" height="2" fill="rgba(140,240,255,0.7)"/></svg></figure>';

  return '<div class="card" style="width:' + Math.round(cw) + 'px;height:' +
      Math.round(cw / 3.07) + 'px;font-size:' + (cw / 100).toFixed(3) + 'px">' +
    '<div class="cLogo">' + logoSVG('c' + id, Math.round(cw * 0.052)) +
      '<div class="cWord">BLUERYDGE</div></div>' +
    '<div class="cCopy">' +
      '<div class="cTag1">Protect the Mission,</div>' +
      '<div class="cTag2">Secure Your Vision</div>' +
      '<div class="cBul">' + bullets + '</div>' +
      '<div class="cFoot"><span>' + arrow + 'www.bluerydge.com</span>' +
        '<span>' + arrow + '1800 CYBERS</span></div>' +
    '</div>' +
    '<div class="cStrips">' + strips + '<div class="cBR">BR</div></div>' +
  '</div>';
}

function buildMarks() {
  marksEl.innerHTML = '';
  V.marks = [];
  if (!cfg.logo) return;
  for (var p = 0; p < V.panels; p++) {
    var cx = (p + 0.5) * V.panelW - V.OFF;
    if (cx < -V.panelW * 0.5 || cx > V.W + V.panelW * 0.5) continue;

    var pw = Math.min(V.panelW, V.W * 1.6);
    /* Size the whole horizontal lockup, then derive its parts from that:
       hex ~1.62x the cap height, gap ~0.42x, wordmark the rest. */
    var lock = Math.max(240, Math.min(1400, Math.min(pw * 0.40, V.H * 0.75)));
    var word = lock / 8.4;
    var hexW = word * 1.62;
    var gap  = word * 0.42;

    var d = document.createElement('div');
    d.className = 'mark' + (cfg.drift ? ' drift' : '');
    d.style.left = Math.round(cx) + 'px';
    d.style.top = V.markY + 'px';
    d.style.animationDelay = (p * 0.9) + 's';

    if (PLACEMAT_SRC) {                       // the full placemat, if embedded
      var maxW = Math.min(pw * 0.78, V.W * 0.9);
      var maxH = V.stripTop * 0.82;
      d.innerHTML = '<img class="pm" src="' + PLACEMAT_SRC + '" alt="Bluerydge" ' +
        'style="max-width:' + Math.round(maxW) + 'px;max-height:' + Math.round(maxH) + 'px">';
      marksEl.appendChild(d);
      continue;
    }

    if (cfg.card) {                           // reconstructed placemat card
      var cardW = Math.min(pw * 0.72, V.W * 0.9, V.stripTop * 0.72 * 3.07);
      d.className += ' nopulse';
      d.innerHTML = placematCard(p, cardW);
      marksEl.appendChild(d);
      continue;
    }

    if (LOGO_SRC) {                           // the supplied lockup, if embedded
      d.innerHTML = '<img class="pm" src="' + LOGO_SRC + '" alt="Bluerydge" ' +
        'style="width:' + Math.round(lock) + 'px;max-width:' +
        Math.round(V.W * 0.9) + 'px;max-height:' + Math.round(V.stripTop * 0.7) + 'px">';
      marksEl.appendChild(d);
      continue;
    }

    d.innerHTML =
      logoSVG(p, Math.round(hexW)) +
      '<div class="word" style="font-size:' + word.toFixed(1) + 'px;letter-spacing:' +
        (word * 0.07).toFixed(2) + 'px;margin-left:' + gap.toFixed(0) + 'px">BLUERYDGE</div>';
    marksEl.appendChild(d);
  }
  recordMarks();
}

/* Anchor points for the portal: the foot of each mark, in virtual coords. */
function recordMarks() {
  V.marks = [];
  for (var i = 0; i < marksEl.children.length; i++) {
    var el = marksEl.children[i], r = el.getBoundingClientRect();
    var hex = el.querySelector('.hexwrap');
    var hr = hex ? hex.getBoundingClientRect() : r;
    V.marks.push({ el: el,
      x: hr.left + hr.width / 2 + V.OFF,     // the mark itself is the doorway
      y: hr.bottom - hr.height * 0.18 });
  }
}

/* Flare the mark itself while a portal is open. */
function flareMark(m, on) {
  if (!m || !m.el) return;
  if (on) m.el.classList.add('flare');
  else m.el.classList.remove('flare');
}

/* ---------------------------------------------------------------- sim --- */

var actors = [], projs = [], parts = [], duels = [], graves = [], portals = [];
var levelups = [], shocks = [];
var tally = { duel: 0, wrestle: 0, piggyback: 0, gang: 0, social: 0, ultimate: 0, deaths: 0 };

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

function makeActor(dir, x) {
  var i = drawFromBag();
  var s = ROSTER[i];
  return {
    i: i, s: s, dir: dir, face: dir,
    x: x, y: 0, vy: 0,
    speed: BASE_SPEED * V.S * s.spd * rnd(0.88, 1.12),
    phase: RNG(), st: 'run',
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

/* Guests arrive through the mark: it flares, a column of light opens, and
   they drop out of it onto the floor line. */
function portalSpawn(a) {
  if (!cfg.portal || !V.marks || !V.marks.length) return false;
  var m = V.marks[(RNG() * V.marks.length) | 0];
  if (!m) return false;
  a.st = 'portal';
  a.pt = 0;
  a.x = m.x + rnd(-14, 14);
  a.y = (m.y - V.groundY) + 6;              // above the floor line, at the mark
  a.vy = 0;
  a.mark = m;
  a.face = a.dir;
  portals.push({ m: m, x: a.x, t: 0, life: 1.5 });
  flareMark(m, true);
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

      var roll = RNG();
      if (a.s.grappler || b.s.grappler) {          // a grappler grapples
        if (roll < 0.62) { startBout('wrestle', a, b); return; }
      }
      if (roll < 0.22) {                           // 0.00 - 0.22
        if (ally) startGang(lead, ally, mark); else startBout('wrestle', a, b);
        return;
      }
      if (roll < 0.44) { startBout('wrestle', a, b); return; }      // 0.22 - 0.44
      if (roll < 0.60) { startPiggyback(a, b); return; }            // 0.44 - 0.60
      startBout('duel', a, b);                                      // 0.60 - 1.00
      return;
    }
  }
}

function faceOff(a, b) {
  a.face = a.x < b.x ? 1 : -1;
  b.face = -a.face;
}

function startBout(kind, a, b) {
  var d = { kind: kind, a: a, b: b, t: 0, next: kind === 'wrestle' ? 0.4 : 0.35,
            k: 0, n: 3 + ((RNG() * 3) | 0), over: 0,
            lockA: a.x, lockB: b.x };
  tally[kind]++;
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

  /* population */
  var want = wantCount();
  if (actors.length < want && RNG() < dt * 3) spawn(false);

  scanT -= dt;
  if (scanT <= 0) { scanT = 0.3; tryDuel(); }

  for (var i = actors.length - 1; i >= 0; i--) {
    var a = actors[i], s = a.s;
    a.flash = Math.max(0, a.flash - dt);
    a.hurt = Math.max(0, a.hurt - dt);
    a.cool -= dt;
    if (a.spooked) a.spooked = Math.max(0, a.spooked - dt);

    if (a.pass) stepPass(a, dt);
    if (a.y < 0 || a.vy < 0) {
      a.vy += (a.grav === undefined ? 900 : a.grav) * dt;
      a.y += a.vy * dt;
      if (a.y >= 0) { a.y = 0; a.vy = 0; a.grav = 900; if (a.pass) a.pass = null; }
    }

    if (a.st === 'run') {
      var dx = a.dir * a.speed * dt * (a.hurt > 0 ? 0.55 : 1);
      a.x += dx;
      a.phase = (a.phase + Math.abs(dx) / (ANIM_CYCLE_ART * V.S)) % 1;
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
        a.y = 0; a.vy = 0; a.st = 'run';
        a.phase = RNG();
        a.cool = rnd(2, 6);
        burst(a.x, V.groundY - 2, 16, [a.s.c3, '#ffffff', '#9fe4ff'], 0.8);
        flareMark(a.mark, false);
        a.mark = null;
      }
    } else if (a.st === 'down') {
      a.fall += dt;
      if (a.fall < 0.45) a.x += a.knock * dt;        // slide back from the blow
      if (a.fall >= 1.15) {                          // toppled, faded — mark the spot
        bury(a);
        actors.splice(i, 1);
        continue;
      }
    }

    /* Bounds. A final form has earned the field and turns instead of leaving;
       everyone else is culled once well clear. This has to sit outside the
       per-state branches — a carrier in a piggyback walks off just as easily
       as a runner does. */
    if (a.st !== 'down' && a.st !== 'portal') {
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
      }
      continue;
    }

    /* plain duel */
    if (d.over) { if (d.t > d.over) endDuel(d); continue; }
    if (d.t >= d.next) {
      var att2 = (d.k % 2) ? d.b : d.a;
      att2.atkT = 0.36; att2.struck = false;
      if (att2.s.ranged && RNG() < 0.4) fire(att2);
      d.k++; d.next = d.t + 0.52;
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
    if (pv.t >= pv.life) { flareMark(pv.m, false); portals.splice(pi, 1); }
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
  if (a.st === 'wrestle') return F_ATK + (Math.floor(a.phase * 4) % 2);
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

  /* light pulses sliding along the arena floor */
  fg.globalCompositeOperation = 'lighter';
  for (var i = 0; i < 3; i++) {
    var span = V.VW + 400;
    var px = ((clock * (90 + i * 55) + i * 900) % span) - 200 - OFF;
    var gwidth = 130 + i * 40;
    fg.globalAlpha = 0.16;
    fg.drawImage(glowBlob(i === 1 ? '#00e5ff' : '#3aa0ff'), px - gwidth / 2, gy - 9, gwidth, 18);
  }
  fg.globalAlpha = 1;
  fg.globalCompositeOperation = 'source-over';

  /* portal light: a column from the mark down to the floor, with a ring at
     the mouth. Drawn before the fighters so a guest falls through it. */
  if (portals.length) {
    fg.globalCompositeOperation = 'lighter';
    for (var pz = 0; pz < portals.length; pz++) {
      var pv = portals[pz], px = pv.x - OFF;
      if (px < -200 || px > W + 200) continue;
      var open = Math.min(1, pv.t / 0.22);
      var fade = Math.max(0, 1 - Math.max(0, pv.t - (pv.life - 0.5)) / 0.5);
      var my = (pv.m.y - top);
      var colW = (16 + 44 * open) * V.S * 0.5;

      var beam = fg.createLinearGradient(0, my, 0, gy);
      beam.addColorStop(0, 'rgba(150,235,255,' + (0.5 * fade).toFixed(3) + ')');
      beam.addColorStop(0.55, 'rgba(60,170,255,' + (0.18 * fade).toFixed(3) + ')');
      beam.addColorStop(1, 'rgba(40,140,255,0)');
      fg.fillStyle = beam;
      fg.beginPath();
      fg.moveTo(px - colW * 0.5, my);
      fg.lineTo(px + colW * 0.5, my);
      fg.lineTo(px + colW * 1.25, gy);
      fg.lineTo(px - colW * 1.25, gy);
      fg.closePath();
      fg.fill();

      fg.globalAlpha = fade;
      fg.drawImage(glowBlob('#7fe8ff'), px - colW * 1.6, my - colW * 0.7, colW * 3.2, colW * 1.4);
      fg.globalAlpha = 1;

      /* mouth ring, snapping open then settling */
      var rw = colW * (1.35 + 0.5 * Math.sin(Math.min(1, pv.t / 0.3) * Math.PI));
      fg.strokeStyle = 'rgba(190,245,255,' + (0.85 * fade * open).toFixed(3) + ')';
      fg.lineWidth = Math.max(1.5, 1.6 * V.S);
      fg.beginPath();
      fg.ellipse(px, my, rw, rw * 0.3, 0, 0, Math.PI * 2);
      fg.stroke();

      /* landing pool */
      fg.globalAlpha = 0.35 * fade;
      fg.drawImage(glowBlob('#7fe8ff'), px - colW * 1.8, gy - 10 * V.S, colW * 3.6, 20 * V.S);
      fg.globalAlpha = 1;
    }
    fg.globalCompositeOperation = 'source-over';
  }

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
      var drop = Math.min(1, Math.max(0, (f.pt - 0.32) / 0.35));
      fg.save();
      fg.globalAlpha = Math.min(1, f.pt / 0.18);
      fg.translate(Math.round(cx), Math.round(cy));
      fg.scale(1 - 0.12 * (1 - drop), 1 + 0.10 * (1 - drop));
      fg.drawImage(sheet, F_IDLE * sh.cw, 0, sh.cw, sh.ch,
                   Math.round(-MIDX * V.S), Math.round(-FEET * V.S),
                   V.cellW, V.cellH);
      fg.restore();
      fg.globalAlpha = 1;
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
    } else {
      fg.drawImage(sheet, fi * sh.cw, 0, sh.cw, sh.ch,
                   Math.round(cx - MIDX * V.S), Math.round(cy - FEET * V.S),
                   V.cellW, V.cellH);
      fg.globalAlpha = 1;
    }
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
    if (isFinal(actors[pl].s) && actors[pl].st !== 'down') plated.push(actors[pl]);
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
        var label = f2.s.name + (lvl ? '  L' + lvl : '');
        var tw = fg.measureText(label).width;
        var ty = gy - FEET * V.S * (f2.s.grow || 1) - 9 * V.S;

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
    stepSim(step);
    draw();
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
    spd: num(raw.speed, 0.4, 2, 1), ranged: !!raw.ranged
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
        return sp ? { name: j.name, sprite: sp, scale: 1,
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
  buildMarks();
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

/* --------------------------------------------------------------- panel -- */

(function panelUI() {
  var el = document.getElementById('panel');
  if (!el) return;
  var fields = ['screens', 'scale', 'taskbar', 'count', 'fps'];
  var flags = ['duels', 'logo', 'grain'];

  function sync() {
    fields.forEach(function (k) {
      var inp = document.getElementById('p-' + k), out = document.getElementById('o-' + k);
      inp.value = cfg[k];
      out.textContent = cfg[k];
    });
    flags.forEach(function (k) { document.getElementById('p-' + k).checked = !!cfg[k]; });
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

  window.addEventListener('keydown', function (e) {
    if (e.key === 'h' || e.key === 'H') { el.classList.toggle('on'); sync(); }
    if (e.key === 'Escape') el.classList.remove('on');
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
