const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const args = process.argv.slice(2);
  const url = 'file://' + path.resolve(args[0]) + (args[1] || '');
  const W = parseInt(args[2] || '3840'), H = parseInt(args[3] || '1080');
  const out = args[4] || 'shot.png';
  const wait = parseInt(args[5] || '3500');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type().toUpperCase() + ': ' + m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(wait);
  const stats = await page.evaluate(async () => {
    // measure real frame cost over ~1.2s
    let n = 0, t0 = performance.now();
    await new Promise(r => { const f = () => { n++; if (performance.now() - t0 < 1200) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); });
    return { fps: Math.round(n / ((performance.now() - t0) / 1000)),
             actors: (window.__dbg && window.__dbg()) || null,
             boot: !!document.getElementById('boot') };
  });
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ stats, errs }, null, 1));
  await browser.close();
})();
