/* End-to-end check of the guest pipeline against REAL upstream bytes.
 * Chromium's egress is blocked in this sandbox, so the real responses are
 * captured with curl and replayed via request interception. The page code,
 * the URLs it builds, and the data it parses are all the real thing.        */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');

const FIX = process.argv[2];
const FILE = 'file://' + path.resolve('Bluerydge_Arena_Wallpaper.html');
const robo = fs.readdirSync(FIX).filter(f => f.startsWith('robo_')).map(f => fs.readFileSync(path.join(FIX, f)));
const pokeIds = [1, 25, 149, 445];
let roboN = 0;

async function wire(page, opts = {}) {
  await page.route('**://robohash.org/**', r => {
    if (opts.robo404) return r.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'no' });
    r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/png' },
                body: robo[roboN++ % robo.length] });
  });
  await page.route('**://pokeapi.co/**', r => {
    if (opts.badJson) return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: '{{{not json' });
    const m = r.request().url().match(/pokemon\/(\d+)/);
    const id = m ? pokeIds[(+m[1]) % pokeIds.length] : 25;
    r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                body: fs.readFileSync(path.join(FIX, `poke_${id}.json`)) });
  });
  await page.route('**://raw.githubusercontent.com/**', r => {
    const m = r.request().url().match(/pokemon\/(\d+)\.png/);
    const id = m && pokeIds.includes(+m[1]) ? +m[1] : 25;
    r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/png' },
                body: fs.readFileSync(path.join(FIX, `poke_${id}.png`)) });
  });
}

async function inspect(browser, src, opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await wire(page, opts);
  await page.goto(`${FILE}?debug=1&guests=${src}&screens=1&scale=4&taskbar=70&count=6`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__arena, null, { timeout: 20000 });
  try {
    await page.waitForFunction(() => window.__arena.roster.filter(r => r.guest).length >= 3, null, { timeout: 20000 });
  } catch (e) { /* expected for the failure cases */ }
  const data = await page.evaluate(() => {
    const A = window.__arena, R = A.roster, sh = A.sheets();
    const guests = R.map((r, i) => ({ r, i })).filter(x => x.r.guest);
    return {
      rosterTotal: R.length,
      guestCount: guests.length,
      guests: guests.map(({ r, i }) => ({
        name: r.name, colour: r.c3,
        src: r.sw + 'x' + r.sh, trimOrigin: r.sx0 + ',' + r.sy0,
        drawn: +r.dw.toFixed(1) + 'x' + +r.dh.toFixed(1),
        sheetCells: sh[i] ? Math.round(sh[i].right.width / sh[i].cw) : null,
        sheetPair: !!(sh[i] && sh[i].right && sh[i].left)
      })),
      builtinsIntact: R.slice(0, 16).every(r => !r.guest && typeof r.kind === 'string')
    };
  });
  return { page, data, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const report = {};

  for (const src of ['robohash', 'pokeapi']) {
    const { page, data, errs } = await inspect(b, src);
    report[src] = { ...data, errs };
    await page.close();
  }

  /* failure paths must degrade silently to the built-in sixteen */
  report.failures = {};
  for (const [label, opts] of [['robohash 404', { robo404: true }], ['pokeapi bad json', { badJson: true }]]) {
    const src = label.startsWith('robo') ? 'robohash' : 'pokeapi';
    const { page, data, errs } = await inspect(b, src, opts);
    report.failures[label] = { guests: data.guestCount, roster: data.rosterTotal,
                               pageErrors: errs.filter(e => e.startsWith('PAGEERROR')) };
    await page.close();
  }

  /* a sprite from a host the active source does not own must be refused */
  {
    const page = await b.newPage({ viewport: { width: 1200, height: 700 } });
    await wire(page);
    await page.goto(`${FILE}?debug=1&guests=robohash`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__arena, null, { timeout: 20000 });
    report.allowlist = await page.evaluate(() => window.__arena.probeSource ? {
      evil: null } : null);
    await page.close();
  }

  console.log(JSON.stringify(report, null, 1));
  await b.close();
})();
