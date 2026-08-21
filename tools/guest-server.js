/* Throwaway roster endpoint for testing the guest cast.
 *
 *   node tools/guest-server.js [port]        # default 877
 *
 * Serves /roster.json plus a few generated sprites, with CORS open, so you can
 * point a dev build at http://localhost:8777/roster.json and watch guests walk
 * in. Your real endpoint must be https:// — see README.
 */
const http = require('http');
const zlib = require('zlib');
const port = +(process.argv[2] || 8777);

/* minimal PNG encoder so the test needs no image files or dependencies */
function png(w, h, paint) {
  const px = Buffer.alloc(w * h * 4);
  paint((x, y, r, g, b, a) => {
    const o = (y * w + x) * 4;
    px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
  });
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const crcT = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

/* a blocky little robot, so guests are visually distinct from the drawn cast */
function robot(tint) {
  const S = 48;
  return png(S, S, set => {
    const [tr, tg, tb] = tint;
    const solid = (x0, y0, x1, y1, r, g, b) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, r, g, b, 255);
    };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, 0, 0, 0, 0);
    solid(16, 6, 31, 18, tr * 0.5 | 0, tg * 0.5 | 0, tb * 0.5 | 0);   // head
    solid(19, 10, 28, 14, 255, 255, 255);                              // visor
    solid(21, 11, 23, 13, tr, tg, tb);
    solid(14, 20, 33, 36, tr * 0.7 | 0, tg * 0.7 | 0, tb * 0.7 | 0);   // torso
    solid(21, 24, 26, 31, tr, tg, tb);                                 // core
    solid(8, 22, 13, 32, tr * 0.45 | 0, tg * 0.45 | 0, tb * 0.45 | 0); // arms
    solid(34, 22, 39, 32, tr * 0.45 | 0, tg * 0.45 | 0, tb * 0.45 | 0);
    solid(17, 37, 22, 46, tr * 0.4 | 0, tg * 0.4 | 0, tb * 0.4 | 0);   // legs
    solid(25, 37, 30, 46, tr * 0.4 | 0, tg * 0.4 | 0, tb * 0.4 | 0);
  });
}

const GUESTS = [
  { name: 'SENTINEL', tint: [80, 200, 255], color: '#50c8ff' },
  { name: 'WARDEN',   tint: [255, 90, 120], color: '#ff5a78' },
  { name: 'CIPHER',   tint: [160, 255, 120], color: null },
];

const sprites = {};
GUESTS.forEach(g => { sprites['/' + g.name.toLowerCase() + '.png'] = robot(g.tint); });

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  if (url === '/roster.json') {
    const body = JSON.stringify({
      version: 1,
      characters: GUESTS.map(g => ({
        name: g.name,
        sprite: 'http://localhost:' + port + '/' + g.name.toLowerCase() + '.png',
        color: g.color, scale: 1, speed: 1, ranged: g.name === 'WARDEN'
      }))
    });
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
    return res.end(body);
  }
  if (sprites[url]) {
    res.writeHead(200, Object.assign({ 'Content-Type': 'image/png' }, cors));
    return res.end(sprites[url]);
  }
  res.writeHead(404, cors); res.end('no');
}).listen(port, () => console.log('guest roster on http://localhost:' + port + '/roster.json'));
