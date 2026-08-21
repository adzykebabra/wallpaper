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
  density: 1,     // crowd multiplier
  fps: 60,        // frame cap
  duels: 1,
  logo: 1,
  grain: 1,
  maxDpr: 2
};
var NUM = { screens: 1, panel: 1, scale: 1, taskbar: 1, density: 1, fps: 1, maxDpr: 1 };
var LIMITS = {
  screens: [1, 6], panel: [-1, 5], scale: [1, 5], taskbar: [0, 400],
  density: [0.2, 4], fps: [10, 144], maxDpr: [1, 3]
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
  if (c.panel >= c.screens) c.panel = -1;
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
function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

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
    head:'skull',  wep:'hammer', ranged:0, spd:0.72, heavy:1, bulk:1 }
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
  var c = mix(s.c2, s.c1, 0.35), e = rgba(s.c3, 0.55);
  var x1 = sx - 3, y1 = sy + 7;
  var x2 = sx - 6 - wave * 0.7, y2 = sy + 13 - wave * 0.5;
  var x3 = sx - 9 - wave, y3 = sy + 16 - wave;
  pline(g, sx + 1, sy - 1, x1, y1, 5, c);
  pline(g, x1, y1, x2, y2, 4, c);
  pline(g, x2, y2, x3, y3, 3, c);
  pline(g, x2 + 1, y2 + 1, x3 + 1, y3 + 1, 1, e);
  dot(g, sx - 1, sy - 2, 4, 2, s.c3);              // clasp
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
    drawBody(hg, flood, P);
    g.save();
    g.filter = 'blur(' + (1.1 * K).toFixed(2) + 'px)';
    g.globalAlpha = 0.42; g.drawImage(halo, 0, 0);
    g.globalAlpha = 0.24; g.drawImage(halo, 0, 0);
    g.restore();
  }

  g.setTransform(K, 0, 0, K, 0, 0);
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

var sheets = [];            // parallel to ROSTER
var bakedAt = 0;            // scale the current sheets were baked at

function bakeAll(K, onDone) {
  bakedAt = K; sheets = new Array(ROSTER.length);
  blobCache = {};
  var i = 0;
  (function chunk() {
    var t0 = (window.performance || Date).now();
    while (i < ROSTER.length && (window.performance || Date).now() - t0 < 12) {
      sheets[i] = bakeSheets(ROSTER[i], K); i++;
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

  V = {
    W: W, H: H, dpr: dpr, S: S,
    VW: solo ? W * cfg.screens : W,                // virtual span width
    OFF: solo ? cfg.panel * W : 0,                 // virtual x of this window's left edge
    panelW: panelW, panels: cfg.screens,
    groundY: groundY, stripTop: stripTop, stripH: H - stripTop,
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
  var W = V.W, H = V.H, G = V.groundY;
  sg.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
  sg.clearRect(0, 0, W, H);

  /* sky */
  var sky = sg.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#02060f'); sky.addColorStop(0.45, '#061426');
  sky.addColorStop(0.78, '#07203a'); sky.addColorStop(1, '#020814');
  sg.fillStyle = sky; sg.fillRect(0, 0, W, H);

  /* horizon bloom, one per monitor so both screens feel composed */
  for (var p = 0; p < V.panels; p++) {
    var cx = (p + 0.5) * V.panelW - V.OFF;
    if (cx < -V.panelW || cx > W + V.panelW) continue;
    var gl = sg.createRadialGradient(cx, G - 30, 0, cx, G - 30, V.panelW * 0.62);
    gl.addColorStop(0, 'rgba(0,140,255,0.20)');
    gl.addColorStop(0.55, 'rgba(0,90,200,0.07)');
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = gl; sg.fillRect(cx - V.panelW * 0.7, 0, V.panelW * 1.4, H);
  }

  dotPattern(sg, 30, 1.0, 'rgba(70,150,255,0.13)', -V.OFF % 30, 0);
  dotPattern(sg, 96, 1.6, 'rgba(0,229,255,0.10)', (-V.OFF % 96) + 40, 20);

  /* faint hex furniture */
  var r1 = seeded(7);
  sg.lineWidth = 1;
  for (var i = 0; i < 10; i++) {
    var hx = r1() * V.VW - V.OFF, hy = 90 + r1() * (G - 260), hr = 55 + r1() * 110;
    if (hx < -hr * 2 || hx > W + hr * 2) continue;
    sg.strokeStyle = 'rgba(77,184,255,' + (0.05 + r1() * 0.05).toFixed(3) + ')';
    hexPath(sg, hx, hy, hr); sg.stroke();
  }

  /* two parallax skyline bands — dark enough to stay behind desktop icons */
  paintSkyline(11, G - 4, 0.30, 210, '#04101f', 'rgba(90,200,255,0.30)');
  paintSkyline(29, G - 2, 0.62, 130, '#061a30', 'rgba(120,220,255,0.42)');

  /* the arena floor the fighters run on = the top edge of the taskbar */
  var fl = sg.createLinearGradient(0, G - 26, 0, G + 6);
  fl.addColorStop(0, 'rgba(0,150,255,0)');
  fl.addColorStop(0.75, 'rgba(0,170,255,0.13)');
  fl.addColorStop(1, 'rgba(120,230,255,0.34)');
  sg.fillStyle = fl; sg.fillRect(0, G - 26, W, 32);

  sg.fillStyle = 'rgba(0,10,22,0.85)'; sg.fillRect(0, G + 2, W, H - G);
  sg.fillStyle = 'rgba(150,235,255,0.90)'; sg.fillRect(0, G, W, 2);
  sg.fillStyle = 'rgba(0,200,255,0.30)'; sg.fillRect(0, G + 2, W, 1);

  /* tick marks + a seam pip at every monitor boundary */
  sg.fillStyle = 'rgba(90,200,255,0.16)';
  for (var x = -(V.OFF % 64); x < W; x += 64) sg.fillRect(x, G + 5, 24, 1);
  for (var s2 = 1; s2 < V.panels; s2++) {
    var sx = s2 * V.panelW - V.OFF;
    if (sx < -4 || sx > W + 4) continue;
    var sm = sg.createLinearGradient(0, G - 150, 0, G);
    sm.addColorStop(0, 'rgba(0,190,255,0)'); sm.addColorStop(1, 'rgba(0,190,255,0.22)');
    sg.fillStyle = sm; sg.fillRect(sx - 1, G - 150, 2, 150);
  }
}

function paintSkyline(seed, baseY, scale, maxH, fill, lit) {
  var r = seeded(seed), x = -((V.OFF * scale) % 400) - 400;
  var span = V.W + 800;
  sg.save();
  while (x < span) {
    var w = 26 + r() * 92, h = (28 + r() * maxH) * (0.6 + scale * 0.6);
    var y = baseY - h;
    sg.fillStyle = fill; sg.fillRect(x, y, w, h);
    sg.fillStyle = 'rgba(0,0,0,0.35)'; sg.fillRect(x + w - 3, y, 3, h);
    if (r() > 0.55) { sg.fillStyle = lit; sg.fillRect(x + w / 2 - 1, y - 9, 2, 9); sg.fillRect(x + w / 2 - 2, y - 12, 4, 3); }
    var cols = Math.max(1, (w / 11) | 0), rows = Math.max(1, (h / 14) | 0);
    for (var cx = 0; cx < cols; cx++) for (var cy = 0; cy < rows; cy++) {
      if (r() > 0.86) {
        sg.fillStyle = r() > 0.7 ? lit : 'rgba(255,196,120,0.28)';
        sg.fillRect(x + 4 + cx * 11, y + 5 + cy * 14, 3, 4);
      }
    }
    x += w + 10 + r() * 30;
  }
  sg.restore();
}

/* --------------------------------------------------------------- logo --- */
/* Rendered as DOM/SVG rather than into the canvas: it stays perfectly crisp
   at any DPI and costs nothing per frame.                                   */

function logoSVG(id, w) {
  var h = Math.round(w * 48 / 44);
  return '<svg class="hexwrap" width="' + w + '" height="' + h + '" viewBox="0 0 44 48" aria-hidden="true">' +
    '<defs>' +
      '<linearGradient id="bg' + id + '" x1="0" y1="0" x2="0.35" y2="1">' +
        '<stop offset="0" stop-color="#7fe8ff"/><stop offset="0.5" stop-color="#0aa2ff"/>' +
        '<stop offset="1" stop-color="#0b4bd6"/></linearGradient>' +
      '<linearGradient id="rg' + id + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#bff2ff"/><stop offset="1" stop-color="#1f8fff"/></linearGradient>' +
    '</defs>' +
    '<polygon points="22,1.5 42.5,13 42.5,35 22,46.5 1.5,35 1.5,13" fill="rgba(6,20,40,0.55)" ' +
      'stroke="url(#bg' + id + ')" stroke-width="2.2" stroke-linejoin="round"/>' +
    '<polygon points="22,6 38,15 38,33 22,42 6,33 6,15" fill="none" ' +
      'stroke="rgba(127,232,255,0.28)" stroke-width="0.8"/>' +
    '<circle cx="30.5" cy="14.5" r="2.1" fill="#bff2ff"/>' +
    '<path d="M8 33 L17 20.5 L21.5 26.5 L28 15 L36 33 Z" fill="rgba(20,120,220,0.35)"/>' +
    '<polyline points="8,33 17,20.5 21.5,26.5 28,15 36,33" fill="none" stroke="url(#rg' + id + ')" ' +
      'stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<polyline points="17,20.5 19,23 21,20.8" fill="none" stroke="rgba(191,242,255,0.65)" stroke-width="1"/>' +
  '</svg>';
}

function buildMarks() {
  marksEl.innerHTML = '';
  if (!cfg.logo) return;
  for (var p = 0; p < V.panels; p++) {
    var cx = (p + 0.5) * V.panelW - V.OFF;
    if (cx < -V.panelW * 0.5 || cx > V.W + V.panelW * 0.5) continue;

    var pw = Math.min(V.panelW, V.W * 1.6);
    var hexW = Math.max(58, Math.min(170, pw * 0.085));
    var word = Math.max(20, Math.min(62, pw * 0.031));
    var sub  = Math.max(7, Math.min(15, pw * 0.0072));

    var d = document.createElement('div');
    d.className = 'mark';
    d.style.left = Math.round(cx) + 'px';
    d.style.top = Math.round(Math.min(V.stripTop * 0.62, V.H * 0.42)) + 'px';
    d.style.animationDelay = (p * 0.9) + 's';
    d.innerHTML =
      logoSVG(p, Math.round(hexW)) +
      '<div class="word" style="font-size:' + word.toFixed(1) + 'px;letter-spacing:' +
        (word * 0.30).toFixed(1) + 'px;margin:' + (word * 0.38).toFixed(0) + 'px 0 0 ' +
        (word * 0.30).toFixed(0) + 'px">BLUERYDGE</div>' +
      '<div class="rule" style="width:' + Math.round(word * 9.2) + 'px;margin:' +
        (word * 0.34).toFixed(0) + 'px 0"></div>' +
      '<div class="sub" style="font-size:' + sub.toFixed(1) + 'px;letter-spacing:' +
        (sub * 0.42).toFixed(1) + 'px">ARENA</div>';
    marksEl.appendChild(d);
  }
}

/* ---------------------------------------------------------------- sim --- */

var actors = [], projs = [], parts = [], duels = [];
var clock = 0, scanT = 0;

var ANIM_CYCLE_ART = 12;      // art px covered by one 8-frame run cycle
var BASE_SPEED = 52;          // art-px/second before per-fighter multiplier

function makeActor(dir, x) {
  var i = (Math.random() * ROSTER.length) | 0;
  for (var tries = 0; tries < 10; tries++) {          // avoid twins on screen
    var clash = false;
    for (var n = 0; n < actors.length; n++) if (actors[n].i === i) { clash = true; break; }
    if (!clash) break;
    i = (Math.random() * ROSTER.length) | 0;
  }
  var s = ROSTER[i];
  return {
    i: i, s: s, dir: dir, face: dir,
    x: x, y: 0, vy: 0,
    speed: BASE_SPEED * V.S * s.spd * rnd(0.88, 1.12),
    phase: Math.random(), st: 'run',
    atkT: 0, struck: false, flash: 0, hurt: 0,
    cool: rnd(2, 14), duel: null, exit: false
  };
}

function wantCount() {
  var n = Math.round((V.VW / 230) * cfg.density);
  return Math.max(3, Math.min(30, n));
}

function margin() { return V.cellW * 2 + 360; }

function spawn(initial) {
  var dir = Math.random() < 0.5 ? 1 : -1;
  var x = initial
    ? rnd(0, V.VW)
    : (dir > 0 ? -V.cellW - rnd(0, 300) : V.VW + V.cellW + rnd(0, 300));
  var a = makeActor(dir, x);
  if (initial) a.cool = rnd(4, 20);
  actors.push(a);
}

function burst(x, y, n, cols, power) {
  power = power || 1;
  for (var i = 0; i < n && parts.length < 300; i++) {
    var ang = Math.random() * Math.PI * 2, sp = (18 + Math.random() * 90) * power;
    parts.push({
      x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40,
      life: rnd(0.3, 0.75), max: 0.75, c: pick(cols), sz: Math.random() < 0.3 ? 2 : 1
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
      var d = { a: a, b: b, t: 0, next: 0.35, k: 0, n: 3 + ((Math.random() * 3) | 0), over: 0 };
      a.duel = b.duel = d; a.st = b.st = 'duel';
      a.face = a.x < b.x ? 1 : -1; b.face = -a.face;
      duels.push(d);
      return;                        // at most one new duel per scan
    }
  }
}

function endDuel(d) {
  var loser = Math.random() < 0.5 ? d.a : d.b;
  [d.a, d.b].forEach(function (f) {
    f.duel = null; f.st = 'run'; f.face = f.dir;
    f.cool = rnd(7, 20); f.atkT = 0;
  });
  loser.hurt = 0.5; loser.flash = 0.12;
  loser.vy = -140; loser.y = -0.01;                 // knocked into a short hop
  burst(loser.x, V.groundY - FEET * V.S * 0.5, 16, [loser.s.c3, '#ffffff'], 1.1);
  var k = duels.indexOf(d); if (k >= 0) duels.splice(k, 1);
}

function fire(a) {
  var s = a.s;
  projs.push({
    x: a.x + a.face * V.cellW * 0.34, y: V.groundY - FEET * V.S * 0.58,
    vx: a.face * (330 + Math.random() * 120), dir: a.face,
    col: s.c3, hot: s.c4, life: 4, t: 0
  });
  burst(a.x + a.face * V.cellW * 0.34, V.groundY - FEET * V.S * 0.58, 5, [s.c3, s.c4], 0.5);
}

function stepSim(dt) {
  clock += dt;
  var GY = V.groundY;

  /* population */
  var want = wantCount();
  if (actors.length < want && Math.random() < dt * 3) spawn(false);

  scanT -= dt;
  if (scanT <= 0) { scanT = 0.3; tryDuel(); }

  for (var i = actors.length - 1; i >= 0; i--) {
    var a = actors[i], s = a.s;
    a.flash = Math.max(0, a.flash - dt);
    a.hurt = Math.max(0, a.hurt - dt);
    a.cool -= dt;

    if (a.y < 0 || a.vy < 0) { a.vy += 900 * dt; a.y += a.vy * dt; if (a.y >= 0) { a.y = 0; a.vy = 0; } }

    if (a.st === 'run') {
      var dx = a.dir * a.speed * dt * (a.hurt > 0 ? 0.55 : 1);
      a.x += dx;
      a.phase = (a.phase + Math.abs(dx) / (ANIM_CYCLE_ART * V.S)) % 1;
      if (s.ranged && a.cool <= 0 && projs.length < 14 && Math.random() < dt * 0.5) {
        var ahead = false;
        for (var q = 0; q < actors.length; q++) {
          var o = actors[q];
          if (o === a || o.dir === a.dir) continue;
          var rel = (o.x - a.x) * a.dir;
          if (rel > V.cellW && rel < 900) { ahead = true; break; }
        }
        if (ahead) { fire(a); a.atkT = 0.36; a.struck = true; a.cool = rnd(4, 11); }
      }
      if (a.dir > 0 && a.y === 0 && a.vy === 0) {
        for (var v2 = 0; v2 < actors.length; v2++) {
          var ot = actors[v2];
          if (ot === a || ot.dir === a.dir || ot.st !== 'run') continue;
          if (Math.abs(ot.x - a.x) < V.cellW * 0.5) { a.vy = -215; a.y = -0.01; break; }
        }
      }
      if (a.x < -margin() || a.x > V.VW + margin()) { actors.splice(i, 1); continue; }
    } else if (a.st === 'duel') {
      a.phase = (a.phase + dt * 1.1) % 1;
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

  /* duels */
  for (var d2 = duels.length - 1; d2 >= 0; d2--) {
    var d = duels[d2];
    if (actors.indexOf(d.a) < 0 || actors.indexOf(d.b) < 0) { endDuel(d); continue; }
    d.t += dt;
    if (d.over) { if (d.t > d.over) endDuel(d); continue; }
    if (d.t >= d.next) {
      var att = (d.k % 2) ? d.b : d.a;
      att.atkT = 0.36; att.struck = false;
      if (att.s.ranged && Math.random() < 0.4) fire(att);
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

/* ------------------------------------------------------------- render --- */

function frameIndex(a) {
  if (a.flash > 0) return F_FLASH;
  if (a.hurt > 0.12 && a.st !== 'duel') return F_HIT;
  if (a.atkT > 0) return F_ATK + Math.min(3, Math.floor((0.36 - a.atkT) / 0.09));
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
    fg.drawImage(sheet, fi * sh.cw, 0, sh.cw, sh.ch,
                 Math.round(cx - MIDX * V.S), Math.round(cy - FEET * V.S),
                 V.cellW, V.cellH);
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

  /* duel name plates */
  if (duels.length) {
    var fs = Math.max(6, Math.round(3.4 * V.S));
    fg.font = '400 ' + fs + "px 'Press Start 2P',monospace";
    fg.textAlign = 'center'; fg.textBaseline = 'alphabetic';
    for (var d = 0; d < duels.length; d++) {
      var du = duels[d], fade = Math.min(1, du.t / 0.3) * (du.over ? Math.max(0, 1 - (du.t - du.over + 0.75) / 0.75) : 1);
      if (fade <= 0.02) continue;
      [du.a, du.b].forEach(function (f2) {
        var tx = f2.x - OFF;
        if (tx < -100 || tx > W + 100) return;
        fg.globalAlpha = fade * 0.9;
        fg.fillStyle = f2.s.c3;
        fg.fillText(f2.s.name, tx, gy - FEET * V.S - 6 * V.S);
        fg.globalAlpha = fade * 0.35;
        fg.fillRect(tx - fs * 3, gy - FEET * V.S - 4.4 * V.S, fs * 6, 1);
      });
    }
    fg.globalAlpha = 1;
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

/* ---------------------------------------------------------------- boot -- */

var relayoutT = null;

function relayout(rebake) {
  measure();
  paintScene();
  buildMarks();
  gradeEl.className = cfg.grain ? '' : 'nogr';

  var K = cfg.scale * V.dprInt;
  if (rebake || K !== bakedAt) {
    bakeAll(K, function () { seed(); start(); });
  } else {
    seed(); start();
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
  if (bootEl && !bootEl.classList.contains('gone')) {
    bootEl.classList.add('gone');
    setTimeout(function () { if (bootEl.parentNode) bootEl.parentNode.removeChild(bootEl); }, 600);
  }
}

window.addEventListener('resize', function () {
  clearTimeout(relayoutT);
  relayoutT = setTimeout(function () { relayout(false); }, 180);
});
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) { lastT = performance.now(); acc = 0; }
});

/* fonts must be loaded before the first scene paint or the logo reflows */
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(function () { relayout(true); }, function () { relayout(true); });
  setTimeout(function () { if (!running) relayout(true); }, 2500);   // safety net
} else {
  relayout(true);
}

/* --------------------------------------------------------------- panel -- */

(function panelUI() {
  var el = document.getElementById('panel');
  if (!el) return;
  var fields = ['screens', 'scale', 'taskbar', 'density', 'fps'];
  var flags = ['duels', 'logo', 'grain'];

  function sync() {
    fields.forEach(function (k) {
      var inp = document.getElementById('p-' + k), out = document.getElementById('o-' + k);
      inp.value = cfg[k];
      out.textContent = k === 'density' ? cfg[k].toFixed(1) : cfg[k];
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
      if (k === 'duels' && !cfg.duels) while (duels.length) endDuel(duels[0]);
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
      view: function () { return V; },
      actors: function () { return actors; }
    };
  }
} catch (e) {}

})();
