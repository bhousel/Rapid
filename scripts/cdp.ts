import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { styleText } from 'node:util';

//
// Drives the Rapid tab in a Chrome that was started with remote debugging (`bun run start:chrome`).
// It attaches to the running browser, so it sees exactly what the developer sees.
//
//   bun run cdp shot <out.png>        Screenshot the Rapid tab
//   bun run cdp eval <file.js>        Run a snippet in the page and print what it returns (as JSON)
//   bun run cdp eval -e "<code>"      Same, with the snippet inline
//   bun run cdp reload [setup.js]     Reload the tab, wait for Rapid to start, then run an optional setup snippet
//   bun run cdp press <key>           Press a key in the tab (e.g. Escape)
//
// Snippets are function bodies: use `return` to send a value back. Rapid's context is `globalThis.rapidContext`.
// Disconnecting leaves the browser running.
//
const cdpURL = 'http://127.0.0.1:9222';
const [cmd, ...args] = process.argv.slice(2);

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

// The snippet is sent to the page as a string and runs there, wrapped as an async function body
// (so it can `await`, and `return` a value or a promise).
const run = async (body: string): Promise<void> => {
  const result = await page.evaluate(`(async () => {\n${body}\n})()`);
  console.log(JSON.stringify(result, null, 2));
};

if (cmd === 'shot' && args[0]) {
  await page.screenshot({ path: args[0] });
  console.log(`Saved ${args[0]} from ${page.url()}`);

} else if (cmd === 'eval' && args[0] === '-e' && args[1]) {
  await run(args[1]);

} else if (cmd === 'eval' && args[0]) {
  await run(readFileSync(args[0], 'utf8'));

} else if (cmd === 'reload') {
  await page.reload();
  await page.waitForFunction(() => (globalThis as any).rapidContext?.systems?.editor?.started, null, { timeout: 120000 });
  console.log(`Reloaded ${page.url()}`);
  if (args[0]) {
    await run(readFileSync(args[0], 'utf8'));
  }

} else if (cmd === 'press' && args[0]) {
  await page.keyboard.press(args[0]);
  console.log(`Pressed ${args[0]}`);

} else {
  console.log('Usage: bun run cdp shot <out.png> | eval <file.js> | eval -e "<code>" | reload [setup.js] | press <key>');
}

// Disconnect, without closing the developer's browser.
await browser.close().catch(() => {});
