import { chromium } from '@playwright/test';
import { PLACES } from './places.ts';
import { useTape } from './tape.ts';
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
//   bun run measure --tape ../osm.tape.json Keep the OSM API's answers in a file, and answer from it
//   bun run measure --list                  List the places
//
// Without `--fresh`, everything loaded at earlier places stays in memory and in the scene, so the
// numbers depend on the order. Use `--fresh` to compare one build with another, but not in a loop:
// it downloads every place again from the OSM API. A place that shows 0 visible features didn't load.
// With `--tape`, a place is downloaded the first time only (see `scripts/tape.ts`): then `--fresh`
// costs the API nothing, and every run sees the same data.
//
// At each place it waits for the data to load, then measures three kinds of frame:
// - redraw:  nothing changed, the scene is drawn again
// - pan:     the view moved 100 px since the last frame, over an area it has shown before
//            (so it measures moving the view, not making new features or loading data).
//            Most pan frames only move the view; about one in three leaves the cull box, and the
//            OSM layer follows it to a new one ("cull" in the table: it looks at what the box
//            moved over and left behind, where it used to do its whole pass). No redraw is requested:
//            a frame that only moves the view is drawn on the next tick, and a pass waits for the
//            gap after the last one (`FramePacer`), with held frames in between, as in a real drag.
// - glide:   the view moves a little on every animation frame, along the same path. It reports how
//            many frames a second were drawn and how many animation frames ran long.
// - restyle: every feature is marked to be drawn again, as a change of zoom does. The first frame
//            draws what it has time for, and the frames after it the rest: the table has the first
//            frame's times, how many frames it took in all, and how long until they were done.
//
// The places are in `scripts/places.ts`. To compare with other versions of Rapid, or with iD, which
// have no frame stats, use `bun run compare`.
//

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    runs:  { type: 'string', default: '9' },
    out:   { type: 'string' },
    fresh: { type: 'boolean', default: false },
    tape:  { type: 'string' },
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
const tape = values.tape ? await useTape(page, values.tape) : null;
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


// Runs in the page: moves the map to the place, waits for its data, then measures each kind of frame.
// It's sent to the page as source, so it can't use anything from this file.
async function measurePlace(args: { loc: [number, number], zoom: number, runs: number }) {
  const context = (globalThis as any).rapidContext;
  const gfx = context.systems.gfx;
  const map = context.systems.map;
  const network = context.systems.network;
  const scheduler = context.systems.scheduler;

  const sleep = (ms: number) => new Promise(resolve => { setTimeout(resolve, ms); });
  const nextFrame = () => new Promise(resolve => { requestAnimationFrame(resolve); });
  // (While the OSM API has us rate limited, nothing is in flight, but the data hasn't loaded.)
  const osm = context.services.osm;
  // (..and features are drawn over a few frames after they arrive: `gfx.pending` says more are coming.)
  const isIdle = () => !network.numInflight && !network.numQueued && !scheduler.numPending && !osm?.getRateLimit() && !gfx.pending;
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

  // Draws one frame after `change()`, and waits until it's done.
  // (A frame that began before the change doesn't count: both of its passes must come after.)
  // A redraw request says that something changed, so every layer does its work. A pan doesn't make
  // one: moving the view is enough to get a frame, and layers that already have what the view needs
  // can keep their features as they are. If the view needs a pass that has to wait its turn, the
  // frames until then are held (they only move the view); this waits for the one after them.
  const drawFrame = async (change?: () => void, request = true) => {
    const since = performance.now();
    change?.();
    if (request) gfx.immediateRedraw();
    const isDone = () => { const last = gfx.lastRenderFrame; return last?.time >= since && !last.held; };
    while (!isDone()) await nextFrame();
  };

  // Panning: the view moves by this much between frames, a few steps one way, then back, and so on.
  const PAN_STEP = [100, 50];   // pixels
  const PAN_LEG = 3;            // steps before turning around
  const panStep = (i: number) => {
    const sign = (Math.floor(i / PAN_LEG) % 2 === 0) ? 1 : -1;
    map.pan([PAN_STEP[0] * sign, PAN_STEP[1] * sign]);
  };

  // Walk the pan path once before measuring, so everything along it is loaded and has its features.
  // Then the pan frames measure moving the view, not making features or the network.
  const walkPanPath = async () => {
    for (let i = 0; i < PAN_LEG * 2; i++) {
      await drawFrame(() => panStep(i), false);
      const waitStart = performance.now();
      while (!isIdle() && performance.now() - waitStart < 30000) await sleep(100);
    }
    await drawFrame();
  };

  const measure = async (kind: 'redraw' | 'restyle' | 'pan') => {
    if (kind === 'pan') await walkPanPath();

    // After a restyle, the features that the first frame had no time for are drawn in the frames
    // after it. How many frames until they're all done, and how long is that?
    const settleFrames: number[] = [];
    const settleMs: number[] = [];

    const startID = gfx.lastRenderFrame?.id ?? -1;
    for (let i = 0; i < args.runs; i++) {
      const since = performance.now();
      const sinceID = gfx.lastRenderFrame?.id ?? -1;
      await drawFrame(() => {
        if (kind === 'restyle') gfx.scene.dirtyTransform();   // as a change of zoom does
        if (kind === 'pan') panStep(i);
      }, kind !== 'pan');

      if (kind === 'restyle') {
        while (gfx.pending) await nextFrame();
        settleFrames.push(gfx.lastRenderFrame.id - sinceID);
        settleMs.push(performance.now() - since);
      }
    }
    for (let i = 0; i < 10; i++) await nextFrame();   // GPU times arrive a few frames later

    // (While panning, other frames can come in between, e.g. when an imagery tile arrives.)
    const frames = gfx.renderFrames.filter((f: any) => f.id > startID && f.draw);
    const last = frames.at(-1);

    const layers: Record<string, any> = {};
    for (const [layerID, s] of last.layers) {
      if (!s.features && s.renderMs < 0.05) continue;
      const stepNames = new Set<string>(frames.flatMap((f: any) => Object.keys(f.layers.get(layerID)?.steps ?? {})));
      const steps: Record<string, number | null> = {};
      for (const name of stepNames) {
        steps[name] = median(frames.map((f: any) => f.layers.get(layerID)?.steps[name]));
      }
      layers[layerID] = {
        renderMs: median(frames.map((f: any) => f.layers.get(layerID)?.renderMs)),
        cullMs: median(frames.map((f: any) => f.layers.get(layerID)?.cullMs)),
        steps: steps,   // of the frames where the layer did its pass
        features: s.features,
        visible: s.visible
      };
    }

    // The frames where the OSM layer kept its features as they were (only the view had moved, inside
    // its cull box), and the ones where the view left the box: the layer followed it to a new one
    // (`steps.box`), or did its whole pass. See "A CULL pass" in the design doc.
    const times = (subset: any[]) => ({
      frames: subset.length,
      appMs: median(subset.map((f: any) => f.appMs)),
      drawMs: median(subset.map((f: any) => f.draw.ms)),
      gpuMs: median(subset.map((f: any) => f.draw.gpuMs)),
      rebuiltGroups: median(subset.map((f: any) => f.draw.rebuiltGroups))
    });
    const isKept = (f: any) => !!f.layers.get('osm')?.kept && f.layers.get('osm')?.steps?.box === undefined;

    return {
      ...times(frames),
      kept: times(frames.filter(isKept)),
      pass: times(frames.filter((f: any) => !isKept(f))),
      settleFrames: median(settleFrames),
      settleMs: median(settleMs),
      renderGroups: last.draw.renderGroups,
      gl: last.draw.gl,
      instructions: last.draw.instructions,
      batchTextures: last.draw.batchTextures,
      unbatched: last.draw.unbatched.length,
      unbatchedTop: last.draw.unbatched.slice(0, 5),
      layers
    };
  };

  // Glide: the view moves a little on every animation frame, along the pan path and back, twice, as
  // a smooth drag does. How many frames a second get drawn, and how many animation frames ran long
  // (stutter the user would see)? It keeps the page busy, so its pass frames show what a pass costs
  // in the middle of a drag (see "Frame pacing" in the design doc).
  const measureGlide = async () => {
    const GLIDE_TICKS = 240;
    const LEG = GLIDE_TICKS / 4;
    const step = [PAN_STEP[0] * PAN_LEG / LEG, PAN_STEP[1] * PAN_LEG / LEG];   // pixels per animation frame
    const startID = gfx.lastRenderFrame?.id ?? -1;
    const stamps: number[] = [];
    const start = performance.now();
    for (let i = 0; i < GLIDE_TICKS; i++) {
      const sign = (Math.floor(i / LEG) % 2 === 0) ? 1 : -1;
      map.pan([step[0] * sign, step[1] * sign]);
      stamps.push(await nextFrame() as number);
    }
    const ms = performance.now() - start;
    const drawn = gfx.renderFrames.filter((f: any) => f.id > startID);   // the most recent of them
    const passes = drawn.filter((f: any) => !f.layers.get('osm')?.kept || f.layers.get('osm')?.steps?.box !== undefined);
    const frames = (gfx.lastRenderFrame?.id ?? -1) - startID;
    return {
      ticks: GLIDE_TICKS,
      ms: Math.round(ms),
      frames: frames,
      fps: +(frames / (ms / 1000)).toFixed(1),
      longFrames: stamps.filter((stamp, i) => i > 0 && stamp - stamps[i - 1] > 25).length,
      passMs: median(passes.map((f: any) => f.appMs + f.draw.ms))
    };
  };

  gfx.enableDetailedStats(true);
  const redraw = await measure('redraw');
  const restyle = await measure('restyle');
  const pan = await measure('pan');   // last: it brings more features into the scene
  gfx.enableDetailedStats(false);
  const glide = await measureGlide();

  await map.setMapParamsAsync(args.loc, args.zoom, 0, 0);   // back to where the place is

  return { loadMs, loaded, zoom: gfx.lastRenderFrame?.zoom, redraw, pan, glide, restyle };
}


const results = [];
const cols = [
  ['place', 14], ['load', 6], ['visible', 8],
  ['APP', 7], ['DRAW', 6], ['GPU', 6], ['draws', 6], ['masks', 6], ['unbat', 6],
  ['| pan APP', 10], ['DRAW', 6], ['GPU', 6],
  ['| cull APP', 11], ['DRAW', 6], ['of', 5],
  ['| glide fps', 11], ['long', 5], ['pass', 6],
  ['| restyle APP', 14], ['DRAW', 6], ['frames', 7], ['done', 6]
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
      r.pan.kept.appMs, r.pan.kept.drawMs, r.pan.kept.gpuMs,
      r.pan.pass.appMs, r.pan.pass.drawMs, `${r.pan.pass.frames}/${r.pan.frames}`,
      r.glide.fps, r.glide.longFrames, r.glide.passMs,
      r.restyle.pass.appMs, r.restyle.pass.drawMs, r.restyle.settleFrames, Math.round(r.restyle.settleMs ?? 0)
    ]));
    results.push({ ...place, ...r });
  } catch (err) {
    console.log(row([place.id, styleText('redBright', `failed: ${(err as Error).message.split('\n')[0]}`)]));
    results.push({ ...place, error: (err as Error).message });
  }
}

console.log('\nTimes in ms. The first group is a frame where nothing changed. load ends with ! if the data was');
console.log('still loading after a minute. visible = features shown, also those in the padding around the view.');
console.log('masks = stencil mask instructions (partial fills), unbat = graphics drawn outside a batch.');
console.log('pan = pan frames where the OSM layer kept its features as they were (also while a pass was held');
console.log('back). cull = pan frames where the view left the cull box, and the layer followed it to a new one');
console.log('(or did its whole pass); of = how many. glide = the view moving on every animation frame for');
console.log('240 of them: frames drawn a second, animation frames longer than 25 ms, and what a frame with');
console.log('a new cull box cost (APP + DRAW) in the middle of that. restyle = every feature drawn again, as after');
console.log('a zoom: the first frame, then how many frames and how many ms until all of them were done.');

if (values.out) {
  writeFileSync(values.out, JSON.stringify({ date: new Date().toISOString(), runs, env, places: results }, null, 2));
  console.log(`Saved ${values.out}`);
}

if (tape) {
  tape.save();
  console.log(`Tape ${values.tape}: ${tape.replayed} map requests answered from it, ${tape.recorded} added to it.`);
}

// Disconnect, without closing the developer's browser.
await browser.close().catch(() => {});
