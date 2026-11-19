import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { parseArgs, styleText } from 'node:util';

//
// Measures frame stats on a set of difficult places (see `design/graphics-system.md`, plan step 2).
// It attaches to a Chrome started with `bun run start:chrome`, like `bun run cdp`, so it measures the
// developer's real GPU. It moves the map, so it changes what the developer is looking at.
//
//   bun run measure                         Measure every place
//   bun run measure seattle bochum          Measure only these places
//   bun run measure --runs 15               Frames per mode (default 9; the median is reported)
//   bun run measure --out stats.json        Also save every number as JSON
//   bun run measure --fresh                 Reload the tab before each place (slower, but comparable)
//   bun run measure --list                  List the places
//
// Without `--fresh`, everything loaded at earlier places stays in memory and in the scene, so the
// numbers depend on the order. Use `--fresh` to compare one build with another, but not in a loop:
// it downloads every place again from the OSM API. A place that shows 0 visible features didn't load.
//
// At each place it waits for the data to load, then measures two kinds of frame:
// - redraw:  nothing changed, the scene is drawn again (what panning costs)
// - restyle: every feature is restyled (what a zoom change costs)
//
// OSM changes, so a place can stop being difficult. Add new ones here, and to the table in the design doc.
//

interface Place {
  id: string;
  name: string;
  map: string;      // the `map=` value: zoom/lat/lon
  stresses: string;
}

const PLACES: Place[] = [
  { id: 'seattle',       name: 'Downtown Seattle',               map: '17.50/47.61040/-122.33450', stresses: 'paths, dashes, buildings (the baseline)' },
  { id: 'nuevo-leon',    name: 'Nuevo León, Mexico',             map: '17.00/21.14900/-101.66980', stresses: 'address points' },
  { id: 'miami-dade',    name: 'Miami-Dade, Florida',            map: '19.00/25.53485/-80.37714',  stresses: 'lots of detail, fences' },
  { id: 'uzice',         name: 'Užice, Serbia',                  map: '16.00/43.8535/19.8433',     stresses: 'so much detail' },
  { id: 'bochum',        name: 'Bochum Hauptbahnhof, Germany',   map: '18.00/51.47836/7.22315',    stresses: 'very dense mapping, light directions' },
  { id: 'smith-point',   name: 'Smith Point Beach, New York',    map: '15.95/40.7335/-72.8624',    stresses: 'submarine cables' },
  { id: 'dekalb',        name: 'Market Square Plaza, DeKalb',    map: '17.50/41.94892/-88.72369',  stresses: 'every parking space mapped' },
  { id: 'staten-island', name: 'Staten Island Mall',             map: '16.50/40.58201/-74.16480',  stresses: 'every parking space mapped' },
  { id: 'grant-park',    name: 'Grant Park, Chicago',            map: '17.86/41.87606/-87.61865',  stresses: 'micromapping' },
  { id: 'golmud',        name: 'Golmud Solar Park, Qinghai',     map: '16.00/36.0677/100.2792',    stresses: 'solar panels, each one an area' },
  { id: 'jiangsu',       name: 'Factories, Jiangsu, China',      map: '15.00/34.54897/119.58936',  stresses: 'building detail' },
  { id: 'heybridge',     name: 'Heybridge, England',             map: '18.00/51.72229/0.67766',    stresses: 'fences' }
];

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    runs:  { type: 'string', default: '9' },
    out:   { type: 'string' },
    fresh: { type: 'boolean', default: false },
    list:  { type: 'boolean', default: false }
  }
});

if (values.list) {
  for (const p of PLACES) {
    console.log(`${p.id.padEnd(14)} map=${p.map.padEnd(26)} ${p.name}: ${p.stresses}`);
  }
  process.exit(0);
}

const unknown = positionals.filter(id => !PLACES.some(p => p.id === id));
if (unknown.length) {
  console.error(styleText('redBright', `Unknown place: ${unknown.join(', ')}. See \`bun run measure --list\`.`));
  process.exit(1);
}
const places = positionals.length ? PLACES.filter(p => positionals.includes(p.id)) : PLACES;
const runs = Math.max(1, parseInt(values.runs, 10) || 9);


const cdpURL = 'http://127.0.0.1:9222';
const browser = await chromium.connectOverCDP(cdpURL).catch(() => {
  console.error(styleText('redBright', `No Chrome at ${cdpURL}. Start one with \`bun run start:chrome\`.`));
  process.exit(1);
});

const pages = browser.contexts().flatMap(c => c.pages());
const page = pages.find(p => p.url().includes('index-dev.html') || p.url().includes('index.html')) ?? pages[0];
if (!page) {
  console.error(styleText('redBright', 'No open tab found.'));
  process.exit(1);
}
await page.waitForFunction(() => (globalThis as any).rapidContext?.systems?.editor?.started, null, { timeout: 120000 });


// What machine, window and settings the numbers come from.
// Hidden feature filters matter: with any hidden, every frame checks every entity against them.
const env = await page.evaluate(() => {
  const context = (globalThis as any).rapidContext;
  const filters = context.systems.filters;
  const gfx = context.systems.gfx;
  const gl = gfx.pixi?.renderer?.gl;
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
    window: `${globalThis.innerWidth}×${globalThis.innerHeight} @${globalThis.devicePixelRatio}x`,
    hiddenFilters: [...(filters?.hidden ?? [])],
    layers: [...gfx.scene.layers.values()].filter((layer: any) => layer.enabled).map((layer: any) => layer.id),
    userAgent: navigator.userAgent
  };
});
console.log(`${env.gpu ?? 'unknown GPU'}, window ${env.window}, ${runs} frames per mode (median)`);
console.log(`Layers: ${env.layers.join(', ')}. Hidden features: ${env.hiddenFilters.join(', ') || 'none'}\n`);


// Runs in the page: moves the map to the place, waits for its data, then measures both kinds of frame.
// It's sent to the page as source, so it can't use anything from this file.
async function measurePlace(args: { loc: [number, number], zoom: number, runs: number }) {
  const context = (globalThis as any).rapidContext;
  const gfx = context.systems.gfx;
  const map = context.systems.map;
  const network = context.systems.network;
  const scheduler = context.systems.scheduler;

  const sleep = (ms: number) => new Promise(resolve => { setTimeout(resolve, ms); });
  const nextFrame = () => new Promise(resolve => { requestAnimationFrame(resolve); });
  const isIdle = () => !network.numInflight && !network.numQueued && !scheduler.numPending;
  const median = (vals: (number | undefined)[]) => {
    const sorted = vals.filter(v => v !== undefined).sort((a, b) => a! - b!) as number[];
    return sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(2) : null;
  };

  // Go there, and wait until nothing has been loading for a full second (up to a minute).
  const loadStart = performance.now();
  await map.setMapParamsAsync(args.loc, args.zoom, 0, 0);
  let idleSince: number | null = null;
  let loaded = false;
  while (performance.now() - loadStart < 60000) {
    await sleep(100);
    if (!isIdle()) {
      idleSince = null;
    } else {
      idleSince ??= performance.now();
      if (performance.now() - idleSince > 1000) {
        loaded = true;
        break;
      }
    }
  }
  const loadMs = Math.round(performance.now() - loadStart);

  gfx.enableDetailedStats(true);

  const measure = async (restyle: boolean) => {
    const startID = gfx.lastRenderFrame?.id ?? -1;
    for (let i = 0; i < args.runs; i++) {
      const before = gfx.lastRenderFrame?.id ?? -1;
      if (restyle) gfx.scene.dirtyScene();
      gfx.immediateRedraw();
      while ((gfx.lastRenderFrame?.id ?? -1) <= before) await nextFrame();
    }
    for (let i = 0; i < 10; i++) await nextFrame();   // GPU times arrive a few frames later

    const frames = gfx.renderFrames.filter((f: any) => f.id > startID && f.draw);
    const last = frames.at(-1);

    const layers: Record<string, any> = {};
    for (const [layerID, s] of last.layers) {
      if (!s.features && s.renderMs < 0.05) continue;
      layers[layerID] = {
        renderMs: median(frames.map((f: any) => f.layers.get(layerID)?.renderMs)),
        cullMs: median(frames.map((f: any) => f.layers.get(layerID)?.cullMs)),
        features: s.features,
        visible: s.visible
      };
    }

    return {
      frames: frames.length,
      appMs: median(frames.map((f: any) => f.appMs)),
      drawMs: median(frames.map((f: any) => f.draw.ms)),
      gpuMs: median(frames.map((f: any) => f.draw.gpuMs)),
      gl: last.draw.gl,
      instructions: last.draw.instructions,
      batchTextures: last.draw.batchTextures,
      unbatched: last.draw.unbatched.length,
      unbatchedTop: last.draw.unbatched.slice(0, 5),
      layers
    };
  };

  const redraw = await measure(false);
  const restyle = await measure(true);
  gfx.enableDetailedStats(false);

  return { loadMs, loaded, zoom: gfx.lastRenderFrame?.zoom, redraw, restyle };
}


const results = [];
const cols = [
  ['place', 14], ['load', 6], ['visible', 8],
  ['APP', 7], ['DRAW', 6], ['GPU', 6], ['draws', 6], ['masks', 6], ['unbat', 6],
  ['| restyle APP', 14], ['DRAW', 6], ['GPU', 6]
] as const;
const row = (vals: (string | number | null | undefined)[]) =>
  vals.map((v, i) => String(v ?? '-')[i === 0 ? 'padEnd' : 'padStart'](cols[i][1])).join(' ');
console.log(styleText('bold', row(cols.map(c => c[0]))));

for (const place of places) {
  const [zoom, lat, lon] = place.map.split('/').map(Number);
  const loc: [number, number] = [lon, lat];
  try {
    if (values.fresh) {
      await page.evaluate(map => {
        const params = new URLSearchParams(location.hash.slice(1));
        params.set('map', map);
        location.hash = params.toString().replaceAll('%2F', '/');
      }, place.map);
      await page.reload();
      await page.waitForFunction(() => (globalThis as any).rapidContext?.systems?.ui?.started, null, { timeout: 120000 });
      // Close whatever the UI opened at startup. Nothing loads while the restore prompt is open, and
      // Escape doesn't close it. "Skip for now" keeps the saved sessions.
      const skipRestore = page.locator('.restore-skip');
      if (await skipRestore.count()) {
        await skipRestore.click();
      } else {
        await page.keyboard.press('Escape');   // the welcome screen
      }
    }
    const r = await page.evaluate(measurePlace, { loc, zoom, runs });
    const visible = Object.values(r.redraw.layers).reduce((sum: number, l: any) => sum + l.visible, 0);
    console.log(row([
      place.id, `${(r.loadMs / 1000).toFixed(1)}s${r.loaded ? '' : '!'}`, visible,
      r.redraw.appMs, r.redraw.drawMs, r.redraw.gpuMs, r.redraw.gl?.draws,
      r.redraw.instructions.stencilMask ?? 0, r.redraw.unbatched,
      r.restyle.appMs, r.restyle.drawMs, r.restyle.gpuMs
    ]));
    results.push({ ...place, ...r });
  } catch (err) {
    console.log(row([place.id, styleText('redBright', `failed: ${(err as Error).message.split('\n')[0]}`)]));
    results.push({ ...place, error: (err as Error).message });
  }
}

console.log('\nTimes in ms. load ends with ! if the data was still loading after a minute.');
console.log('masks = stencil mask instructions (partial fills), unbat = graphics drawn outside a batch.');

if (values.out) {
  writeFileSync(values.out, JSON.stringify({ date: new Date().toISOString(), runs, env, places: results }, null, 2));
  console.log(`Saved ${values.out}`);
}

// Disconnect, without closing the developer's browser.
await browser.close().catch(() => {});
