const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[2] || 'sheet.png';
  const K = +(process.argv[3] || 4);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + path.resolve('Bluerydge_Arena_Wallpaper.html') + '?debug=1&scale=' + K + '&logo=0', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__arena && window.__arena.sheets().filter(Boolean).length === window.__arena.roster.length, null, { timeout: 15000 });
  const png = await p.evaluate(() => {
    const A = window.__arena, sh = A.sheets(), R = A.roster;
    const cols = A.cells, cw = sh[0].cw, ch = sh[0].ch, lab = 26;
    const c = document.createElement('canvas');
    c.width = cw * cols + 150; c.height = (ch + lab) * R.length;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.fillStyle = '#0a1220'; g.fillRect(0, 0, c.width, c.height);
    R.forEach((r, i) => {
      const y = i * (ch + lab);
      g.fillStyle = i % 2 ? '#0d1828' : '#0a1220'; g.fillRect(0, y, c.width, ch + lab);
      g.fillStyle = r.c3; g.font = '13px monospace'; g.fillText(r.name, 6, y + ch / 2);
      g.drawImage(sh[i].right, 150, y + lab / 2);
    });
    return c.toDataURL('image/png');
  });
  require('fs').writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log('wrote', out);
  await b.close();
})();
