/* Render still frames of the wallpaper to PNG — for the Windows lock screen,
 * which only accepts a static image.
 *
 *   npm install --no-save playwright
 *   node tools/export.js                       # the default lock-screen set
 *   node tools/export.js 3440x1440 2560x1080   # specific resolutions
 *
 * Options: SEED=7 LOGOY=0.6 TASKBAR=0 SCALE=2 OUT=lockscreen node tools/export.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DEFAULT_SIZES = ['1920x1080', '2560x1440', '3440x1440', '3840x2160'];
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';

(async () => {
  const sizes = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SIZES)
    .map(s => s.split('x').map(Number))
    .filter(([w, h]) => w > 0 && h > 0);

  const seed = process.env.SEED || '7';
  const outDir = path.resolve(process.env.OUT || 'lockscreen');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME });
  const file = 'file://' + path.resolve(__dirname, '..', 'Portal_Valley_Wallpaper.html');

  for (const [w, h] of sizes) {
    const q = new URLSearchParams({
      still: seed,
      screens: '1',                                   // a lock screen is one display
      hour: process.env.HOUR || '10',                 // fix the light for the export
      taskbar: process.env.TASKBAR || String(Math.round(h * 0.075)),
      scale: process.env.SCALE || String(Math.max(2, Math.min(5, Math.round(h / 500)))),
      count: process.env.COUNT || '4',                // COUNT=10 for a full lineup
      grain: '0'                                      // scanlines alias when scaled
    });
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(file + '?' + q, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__arenaStill === true, null, { timeout: 30000 });
    await page.waitForTimeout(250);
    const out = path.join(outDir, `portal_valley_${w}x${h}.png`);
    await page.screenshot({ path: out });
    await page.close();
    console.log(`${errs.length ? 'ERRORS ' + errs.join('; ') + ' ' : ''}${out}`);
  }
  await browser.close();
})();
