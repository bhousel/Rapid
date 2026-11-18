import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** `E2E_RECORD=1 bun run test:e2e` fetches the recorded hosts live and saves their responses. */
export const RECORD = !!process.env.E2E_RECORD;

/** The recording that tests replay */
export const HAR_PATH = fileURLToPath(new URL('./data/recorded.har', import.meta.url));

/** Where each test saves its part while recording (gitignored) */
export const RECORDING_DIR = fileURLToPath(new URL('./.recording', import.meta.url));


/**
 * Playwright's global setup. When recording, it starts with no parts, and returns the global teardown,
 * which merges the parts into one recording when all the tests are done.
 * @return The global teardown, or `undefined` when not recording
 */
export default async function globalSetup() {
  if (!RECORD) return;
  await rm(RECORDING_DIR, { recursive: true, force: true });
  await mkdir(RECORDING_DIR, { recursive: true });
  return finishRecording;
}


/**
 * Merges the parts that the tests saved into one recording.
 * A request that several tests made is kept once. The entries are sorted by URL, and the file is
 * indented, so a new recording's diff shows what changed.
 */
export async function finishRecording() {
  if (!RECORD) return;

  const files = (await readdir(RECORDING_DIR)).filter(file => file.endsWith('.har'));
  if (!files.length) return;

  let log = null;
  const entries = new Map();
  for (const file of files.sort()) {
    const har = JSON.parse(await readFile(join(RECORDING_DIR, file), 'utf8'));
    log ??= har.log;
    for (const entry of har.log.entries) {
      const key = `${entry.request.method} ${entry.request.url} ${entry.request.postData?.text ?? ''}`;
      if (!entries.has(key)) entries.set(key, entry);
    }
  }

  log.entries = [...entries.values()].sort((a, b) => a.request.url.localeCompare(b.request.url));
  log.pages = [];
  await writeFile(HAR_PATH, JSON.stringify({ log }, null, 2) + '\n');
  await rm(RECORDING_DIR, { recursive: true, force: true });
  console.log(`Saved ${log.entries.length} recorded responses to ${HAR_PATH}`);  // eslint-disable-line no-console
}
