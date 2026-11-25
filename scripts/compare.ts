import { chromium } from '@playwright/test';
import { MAP_REQUEST, useTape } from './tape.ts';
import { PLACES } from './places.ts';
import { writeFileSync } from 'node:fs';
import { parseArgs, styleText } from 'node:util';

//
// Compares how any map editor keeps up with panning and zooming at the difficult places: this
// build, another version of Rapid, or iD. (See "Against other versions, and iD" in
// `design/graphics-system-log.md`.)
//
// `bun run measure` reads Rapid's own frame stats, which older versions and iD don't have. This
// measures from outside: it opens the page in a new tab of the Chrome started with
// `bun run start:chrome` (so, on the real GPU), waits for the OSM data to be drawn, then pans and
// zooms with real wheel and key events and watches the page's ticks.
//
//   bun run compare <label> <url> <place> [place…]
//   bun run compare branch http://127.0.0.1:8080/dist/index.html seattle staten-island
//   bun run compare iD https://ideditor-release.netlify.app/ seattle --out id.json
//
// Give the places by name (`bun run measure --list`). There is no "all": each place asks the OSM
// API for 6 to 36 map tiles for each build, and after enough of them the API answers 429 for a while.
//
// To download a place only once, give a tape (see `scripts/tape.ts`): the first run records the
// API's answers in the file, and later runs are answered from it, each after the time it really took.
//
//   bun run compare branch http://127.0.0.1:8080/dist/index.html uzice --tape ../uzice.tape.json
//
// For each gesture it reports:
// - fps:      ticks a second while the gesture's events were being sent
// - longest:  the longest gap between two ticks, in ms, until 2.5 s after the gesture
// - >100ms:   how many such gaps were longer than 100 ms
// - took:     how long the gesture's events took to send. Each event waits for the page to take
//             it, so a page that can't keep up takes longer. (About 35 ms an event at best.)
// - redraws:  how often the map's content was drawn again. Rapid says so itself (`gfx`'s `draw`
//             event). For iD, it's the ticks in which the OSM layer's elements changed.
// - main:     main-thread time during the gesture and the 2.5 s after it, in ms
//
// Feature filters: only boundaries are hidden, in every editor. (The other filters don't mean the
// same in older versions: there, hiding landuse hides most areas.)
//

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    tape: { type: 'string' }
  }
});

const [label, baseURL, ...placeIDs] = positionals;
const places = PLACES.filter(p => placeIDs.includes(p.id));
const unknown = placeIDs.filter(id => !PLACES.some(p => p.id === id));
if (!label || !baseURL || !places.length || unknown.length) {
  if (unknown.length) {
    console.error(styleText('redBright', `Unknown place: ${unknown.join(', ')}. See \`bun run measure --list\`.`));
  }
  console.error('Usage: bun run compare <label> <url> <place> [place…] [--out results.json] [--tape file.json]');
  process.exit(1);
}

const HIDDEN_FEATURES = 'boundaries';
const GESTURES = ['panOut', 'panBack', 'pinchIn', 'pinchOut', 'zoomIn', 'zoomOut'];
const SETTLE_MS = 2500;         // how long after a gesture the page is watched
const GESTURE_LIMIT_MS = 45000; // give up on a gesture after this long: a page that far behind is unusable


const cdpURL = 'http://127.0.0.1:9222';
const browser = await chromium.connectOverCDP(cdpURL).catch(() => {
  console.error(styleText('redBright', `No Chrome at ${cdpURL}. Start one with \`bun run start:chrome\`.`));
  process.exit(1);
});
const context = browser.contexts()[0];


// Runs in the page: says what's on the map, and starts recording ticks, long tasks and redraws.
function startRecording() {
  const g = globalThis as any;
  const rapid = g.rapidContext;
  const scene: any = {
    window: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
    version: rapid?.version ?? null,
    svgElements: document.querySelectorAll('.main-map svg *').length,
    canvases: document.querySelectorAll('.main-map canvas').length
  };
  try {
    const layer = rapid.systems.gfx.scene.layers.get('osm');
    let visible = 0;
    for (const feature of layer.features.values()) {
      if (feature.visible) visible++;
    }
    scene.features = layer.features.size;
    scene.visible = visible;
  } catch {
    // not Rapid, or a version that keeps its features somewhere else
  }

  const rec: any = g.__compare = { frames: [], longTasks: [], redraws: 0 };
  const tick = () => {
    rec.frames.push(performance.now());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        rec.longTasks.push([entry.startTime, entry.duration]);
      }
    });
    observer.observe({ type: 'longtask' });
  } catch {
    // no long task timing in this browser
  }

  const gfx = rapid?.systems?.gfx;
  if (gfx?.on) {
    gfx.on('draw', () => rec.redraws++);
    scene.redrawsBy = 'draw event';
  } else {
    // iD: count the ticks in which the OSM layer's elements changed
    const target = document.querySelector('.data-layer.osm') ?? document.querySelector('.main-map');
    let counted = false;
    const observer = new MutationObserver(() => {
      if (counted) return;
      counted = true;
      rec.redraws++;
      requestAnimationFrame(() => { counted = false; });
    });
    observer.observe(target!, { subtree: true, childList: true, attributes: true, attributeFilter: ['d', 'transform', 'class'] });
    scene.redrawsBy = 'changed elements';
  }
  return scene;
}


// Runs in the page: how the page kept up from `start` (when a gesture began) until now.
function readRecording(args: { start: number, inputMs: number }) {
  const rec = (globalThis as any).__compare;
  const end = args.start + args.inputMs;
  const frames: number[] = rec.frames.filter((t: number) => t >= args.start);
  const during = frames.filter(t => t <= end);
  const gaps = frames.slice(1).map((t, i) => t - frames[i]);
  const longTasks: number[][] = rec.longTasks.filter((task: number[]) => task[0] >= args.start - 50);
  return {
    // (For a key press there's no "during": count the frames of the first second instead)
    fps: (during.length > 5) ? (during.length - 1) / ((during.at(-1)! - during[0]) / 1000) : frames.filter(t => t <= args.start + 1000).length,
    longestMs: Math.max(0, ...gaps),
    over100: gaps.filter(gap => gap > 100).length,
    longTaskMs: longTasks.reduce((sum, task) => sum + task[1], 0),
    redraws: rec.redraws
  };
}


const results = [];
for (const place of places) {
  const page = await context.newPage();
  const tape = values.tape ? await useTape(page, values.tape) : null;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const taskSeconds = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find(metric => metric.name === 'TaskDuration')?.value ?? 0;
  };

  // Watch the OSM API's map requests: how many, how they were answered, and when the last one finished.
  // (`requestfinished` is when the whole body has arrived; a big tile's headers come seconds earlier.)
  const api = { requested: 0, finished: 0, lastFinished: 0, statuses: {} as Record<string, number> };
  page.on('request', request => {
    if (MAP_REQUEST.test(request.url())) api.requested++;
  });
  page.on('response', response => {
    if (!MAP_REQUEST.test(response.url())) return;
    const status = String(response.status());
    api.statuses[status] = (api.statuses[status] ?? 0) + 1;
  });
  const onFinished = (url: string): void => {
    if (!MAP_REQUEST.test(url)) return;
    api.finished++;
    api.lastFinished = Date.now();
  };
  page.on('requestfinished', request => onFinished(request.url()));
  page.on('requestfailed', request => onFinished(request.url()));

  const result: any = { label: label, place: place.id, map: place.map, date: new Date().toISOString() };
  const opened = Date.now();
  try {
    await page.goto(`${baseURL}#map=${place.map}&disable_features=${HIDDEN_FEATURES}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.bringToFront();   // a tab in the background gets few ticks

    // Close whatever opens at startup: a restore prompt ("Skip" keeps the saved session), a welcome screen.
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500);
      const state = await page.evaluate(() => {
        for (const selector of ['.restore-skip', '.modal .start-editing', '.modal-splash .close', '.modal .close']) {
          const button = document.querySelector<HTMLElement>(selector);
          if (button) {
            button.click();
            return 'closing';
          }
        }
        if (document.querySelector('.modal, .shaded')) return 'closing';
        return document.querySelector('.main-map') ? 'ready' : 'loading';
      });
      if (state === 'ready' && i > 3) break;
    }

    // Wait for the data: map requests were made, and all had finished 4 seconds ago (up to 2 minutes)..
    while (Date.now() - opened < 120000) {
      await page.waitForTimeout(500);
      if (api.requested > 0 && api.finished >= api.requested && Date.now() - api.lastFinished > 4000) break;
      if (api.requested === 0 && Date.now() - opened > 30000) break;
    }
    result.tiles = api.requested;
    result.statuses = api.statuses;
    result.dataMs = api.lastFinished ? api.lastFinished - opened : null;

    // ..and for the editor to draw it: until what's on the map hasn't changed for 5 seconds
    // (Rapid's features, or the map's SVG elements), up to 3 minutes after the page opened.
    const sceneSize = (): Promise<number> => page.evaluate(() => {
      try {
        return (globalThis as any).rapidContext.systems.gfx.scene.layers.get('osm').features.size;
      } catch {
        return document.querySelectorAll('.main-map svg *').length;
      }
    });
    let size = await sceneSize();
    let changed = Date.now();
    while (Date.now() - opened < 180000 && Date.now() - changed < 5000) {
      await page.waitForTimeout(250);
      const now = await sceneSize();
      if (now !== size) {
        size = now;
        changed = Date.now();
      }
    }
    result.drawnMs = changed - opened;

    result.scene = await page.evaluate(startRecording);

    const box = (await page.locator('.main-map').first().boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

    // Sends evenly timed events, as a trackpad does: 60 a second if the page keeps up.
    let sent = 0;
    const send = async (count: number, event: () => Promise<unknown>): Promise<void> => {
      const begin = Date.now();
      for (let i = 0; i < count; i++) {
        if (Date.now() - begin > GESTURE_LIMIT_MS) break;
        await event();
        sent++;
        const wait = begin + ((i + 1) * 16) - Date.now();
        if (wait > 0) await page.waitForTimeout(wait);
      }
    };

    // Performs a gesture, and records how the page kept up during it and for a while after.
    const measure = async (name: string, gesture: () => Promise<void>): Promise<void> => {
      sent = 0;
      const tasksBefore = await taskSeconds();
      const start = await page.evaluate(() => {
        (globalThis as any).__compare.redraws = 0;
        return performance.now();
      });
      const began = Date.now();
      await gesture();
      const inputMs = Date.now() - began;
      await page.waitForTimeout(SETTLE_MS);

      const stats = await page.evaluate(readRecording, { start, inputMs });
      const hash = await page.evaluate(() => location.hash);
      result[name] = {
        ...stats,
        inputMs: inputMs,
        sent: sent,
        mainThreadMs: ((await taskSeconds()) - tasksBefore) * 1000,
        mapAfter: (hash.match(/map=([^&]*)/) ?? [])[1]
      };
    };

    // Pan: a two-finger scroll, 600 px one way, then back.
    await measure('panOut', () => send(60, () => page.mouse.wheel(10, 3)));
    await measure('panBack', () => send(60, () => page.mouse.wheel(-10, -3)));

    // Zoom: a trackpad pinch in, then back out. The browser sends a pinch as wheel events with
    // `ctrlKey` set and fractional deltas, without the Control key being pressed.
    const pinch = (deltaY: number) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: x, y: y, deltaX: 0, deltaY: deltaY, modifiers: 2 });
    await measure('pinchIn', () => send(40, () => pinch(-2.5)));
    await measure('pinchOut', () => send(40, () => pinch(2.5)));

    // Zoom by a whole level with the keyboard, in and back out. (One level in first, not measured,
    // so that zooming back out doesn't show more of the world than the place started with.)
    await page.keyboard.press('Equal');
    await page.waitForTimeout(4000);
    await measure('zoomIn', () => page.keyboard.press('Equal'));
    await measure('zoomOut', () => page.keyboard.press('Minus'));

  } catch (err) {
    result.error = (err as Error).message.split('\n')[0];
  }

  if (tape) {
    result.tape = { replayed: tape.replayed, recorded: tape.recorded };
    tape.save();
  }
  results.push(result);
  await page.close();

  const seconds = (ms: number | null | undefined): string => (ms === null || ms === undefined) ? '-' : `${(ms / 1000).toFixed(1)}s`;
  const scene = result.scene ?? {};
  const drawn = (scene.features !== undefined) ? `${scene.visible} of ${scene.features} features shown` : `${scene.svgElements} SVG elements`;
  console.log(styleText('bold', `${label} ${scene.version ?? ''} at ${place.id}`) +
    `: ${result.tiles} tiles (${JSON.stringify(result.statuses)}) in ${seconds(result.dataMs)}, drawn after ${seconds(result.drawnMs)}, ${drawn}`);
  if (result.error) {
    console.log(styleText('redBright', `  failed: ${result.error}`));
  }
  if (result.tape) {
    console.log(`  tape: ${result.tape.replayed} requests answered from ${values.tape}, ${result.tape.recorded} added to it`);
  }
  for (const name of GESTURES) {
    const r = result[name];
    if (!r) continue;
    console.log(
      `  ${name.padEnd(9)}` +
      `${r.fps.toFixed(1).padStart(6)} fps` +
      `  longest ${String(Math.round(r.longestMs)).padStart(6)} ms` +
      `  >100ms ${String(r.over100).padStart(3)}` +
      `  took ${seconds(r.inputMs).padStart(6)}` + ((r.sent && r.inputMs > GESTURE_LIMIT_MS) ? ` (${r.sent} events)` : '') +
      `  redraws ${String(r.redraws).padStart(4)}` +
      `  main ${String(Math.round(r.mainThreadMs)).padStart(6)} ms`
    );
  }
}

if (values.out) {
  writeFileSync(values.out, JSON.stringify(results, null, 2));
  console.log(`Saved ${values.out}`);
}

// Disconnect, without closing the developer's browser.
await browser.close().catch(() => {});
