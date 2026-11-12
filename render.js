#!/usr/bin/env node
/* Renders the ROBN4 Kindle dashboard to a 1072x1448 grayscale PNG.
 *
 *   node render.js                        fetch live, write out/dashboard.png
 *   node render.js --fixture f.json       render from a saved payload (offline)
 *   node render.js --out path.png         choose the output path
 *   node render.js --keep-html            leave the populated HTML for debugging
 *   node render.js --save-fixture f.json  stash the live payload for later
 *
 * Failure policy: if anything upstream breaks we exit non-zero WITHOUT touching
 * the existing PNG. A stale dashboard that says so beats a blank or broken one.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { derive } from './src/derive.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src');
const WIDTH = 1072, HEIGHT = 1448;
const DEFAULT_SOURCE = 'https://robn4-dashboard.chenrisius.workers.dev';
const DATA_SOURCE = process.env.ROBN4_URL || 'https://robn4-weather.chenrisius.workers.dev/';

/* ---------- args ---------- */
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt  = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i+1] ? argv[i+1] : dflt; };
const OUT = resolve(opt('--out', join(HERE, 'out', 'dashboard.png')));

/* ---------- chrome ---------- */
function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('No Chrome/Chromium found. Set CHROME_BIN to a browser binary.');
}

/* ---------- fetch ---------- */
async function loadPayload() {
  const fixture = opt('--fixture', null);
  if (fixture) {
    console.log(`source: fixture ${fixture}`);
    return JSON.parse(readFileSync(resolve(fixture), 'utf8'));
  }
  console.log(`source: ${DATA_SOURCE}`);
  const ctl = AbortSignal.timeout(30_000);
  const res = await fetch(DATA_SOURCE, { signal: ctl, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`worker returned HTTP ${res.status}`);
  const json = await res.json();
  if (json.ok === false) throw new Error(`worker reported ok:false (${json.error ?? 'no detail'})`);
  const save = opt('--save-fixture', null);
  if (save) { mkdirSync(dirname(resolve(save)), { recursive: true }); writeFileSync(resolve(save), JSON.stringify(json, null, 2)); console.log(`fixture saved: ${save}`); }
  return json;
}

/* ---------- render ---------- */
async function main() {
  const t0 = Date.now();
  const payload = await loadPayload();
  const view = derive(payload, new Date());

  // Sanity: refuse to publish a page whose headline data is all missing.
  const vital = [view.air?.temp, view.wind?.kt, view.tide?.level].filter(v => v && v !== '—');
  if (vital.length === 0) throw new Error('no vital data derived (air/wind/tide all empty) — refusing to render');

  const template = readFileSync(join(SRC, 'template.html'), 'utf8');
  const marker = 'window.__DATA__ = null;';
  if (!template.includes(marker)) throw new Error('template is missing the __DATA__ injection marker');
  const html = template
    .replace(marker, 'window.__DATA__ = ' + JSON.stringify(view) + ';')
    .replace('<body>', '<body class="shot">');

  // Written into src/ so the relative font URLs resolve.
  const tmpHtml = join(SRC, '_render.html');
  writeFileSync(tmpHtml, html);

  mkdirSync(dirname(OUT), { recursive: true });
  const tmpPng = OUT + '.tmp.png';

  let dom = '';
  try {
    // --dump-dom rides along with --screenshot, so one Chrome run gives us both
    // the image and the page's self-reported status.
    dom = execFileSync(findChrome(), [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
      '--force-device-scale-factor=1',
      '--user-data-dir=' + join(process.env.TMPDIR || '/tmp', 'robn4-chrome'),
      '--default-background-color=FFFFFFFF',
      '--virtual-time-budget=5000',
      `--window-size=${WIDTH},${HEIGHT}`,
      `--screenshot=${tmpPng}`,
      '--dump-dom',
      'file://' + tmpHtml,
    ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 }).toString();
  } catch (e) {
    throw new Error('chrome screenshot failed: ' + (e.stderr?.toString().trim().split('\n').pop() || e.message));
  }
  if (!existsSync(tmpPng)) throw new Error('chrome produced no file');

  // The template sets data-render once its script completes. Without this check
  // a mid-script exception yields a half-populated page that screenshots fine.
  if (dom.includes('data-render="error"')) {
    const m = dom.match(/RENDER ERROR: ([^<]+)/);
    throw new Error('template script threw: ' + (m ? m[1].trim() : 'unknown'));
  }
  if (!dom.includes('data-render="ok"'))
    throw new Error('template script did not complete (no data-render marker)');

  const raw = sharp(tmpPng);
  const meta = await raw.metadata();
  if (meta.width !== WIDTH || meta.height !== HEIGHT)
    throw new Error(`wrong canvas: got ${meta.width}x${meta.height}, want ${WIDTH}x${HEIGHT}`);

  // 16 grey levels == the panel's actual depth. No dithering: the page is almost
  // entirely pure black and white, and dithering would fuzz the type.
  const rgbBytes = statSync(tmpPng).size;
  await sharp(tmpPng)
    .grayscale()
    .png({ compressionLevel: 9, palette: true, colors: 16, dither: 0 })
    .toFile(tmpPng + '.gray');

  renameSync(tmpPng + '.gray', OUT);
  unlinkSync(tmpPng);
  if (!flag('--keep-html')) unlinkSync(tmpHtml);

  const outBytes = statSync(OUT).size;

  // Sidecar manifest. The Kindle fetches this (~200 bytes) first: it says whether
  // the PNG changed, so an unchanged dashboard costs no image download, and it
  // carries the render time so the device can judge staleness without trusting
  // its own clock against an HTTP header.
  const manifest = {
    rendered_at: Math.floor(Date.now() / 1000),
    rendered_iso: new Date().toISOString(),
    width: WIDTH, height: HEIGHT, bytes: outBytes,
    image: OUT.split('/').pop(),
    worker_version: payload?.version ?? null,
    feed_level: payload?.feed_status?.level ?? null,
    summary: `${view.air.temp}F ${view.wind.kt}kt tide ${view.tide.level}ft`,
  };
  const manifestPath = OUT.replace(/\.png$/, '') + '.json';
  writeFileSync(manifestPath, JSON.stringify(manifest));

  console.log(`rendered: ${OUT}`);
  console.log(`  manifest: ${manifestPath} (${statSync(manifestPath).size} B)`);
  console.log(`  ${WIDTH}x${HEIGHT} · ${(rgbBytes/1024).toFixed(0)} KB rgb -> ${(outBytes/1024).toFixed(0)} KB gray16 ` +
              `(-${Math.round((1 - outBytes/rgbBytes) * 100)}%)`);
  console.log(`  ${view.meta.weekday} ${view.meta.dateFull} ${view.meta.clock} · ` +
              `${view.air.temp}°F · ${view.wind.kt} kt · tide ${view.tide.level} ft · ${view.station.chip}`);
  console.log(`  ${Date.now() - t0} ms`);
}

main().catch(err => {
  console.error('RENDER FAILED: ' + err.message);
  console.error('previous output left untouched');
  process.exit(1);
});
