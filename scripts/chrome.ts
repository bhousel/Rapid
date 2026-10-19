import { launch } from 'chrome-launcher';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { styleText } from 'node:util';

//
// Launches Chrome with the remote debugging protocol enabled, opened to the local dev build.
// Tools (and coding agents) can then attach with Playwright's `connectOverCDP('http://127.0.0.1:9222')`
// to take screenshots and inspect `rapidContext` in this browser session.
//
// - It uses its own profile in `.chrome-debug/` (gitignored), never your everyday Chrome profile.
//   Settings and extensions you add to it (e.g. Pixi devtools) are kept between runs.
// - Start the local server first (`bun run start`), so the page has something to load.
// - Close the browser window, or press Ctrl-C here, to stop.
//
const port = 9222;
const startingUrl = 'http://127.0.0.1:8080/dist/index-dev.html';
const userDataDir = resolve(import.meta.dir, '../.chrome-debug');

mkdirSync(userDataDir, { recursive: true });

// If a Chrome is already listening on this port, chrome-launcher reuses it instead of starting another.
const chrome = await launch({
  port: port,
  startingUrl: startingUrl,
  userDataDir: userDataDir,
  ignoreDefaultFlags: true,  // chrome-launcher's defaults disable extensions, which we want to keep
  chromeFlags: [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-backgrounding-occluded-windows',   // keep rendering the map when the window is hidden
    '--disable-renderer-backgrounding'
  ]
});

console.log(styleText('greenBright', `Chrome is listening for remote debugging on http://127.0.0.1:${chrome.port}`));
console.log(styleText('green', `Profile:  ${userDataDir}`));
console.log(styleText('green', `Opened:   ${startingUrl}`));
console.log('Close the browser window, or press Ctrl-C here, to stop.');

chrome.process.on('exit', () => process.exit(0));
