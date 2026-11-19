import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { Page, Request } from '@playwright/test';

//
// A "tape" keeps the OSM API's answers to map requests in a file, and answers from it the next time.
//
// Measuring a dense place means downloading it: 36 map tiles for Užice, again on every reload.
// The API allows each address a certain number of bytes, and answers 429 once they're used up
// (for everyone at that address). With a tape, a place is downloaded once:
//
//   const tape = await useTape(page, 'uzice.tape.json');
//   …open the page, pan around…
//   tape.save();
//
// - A request that's on the tape is answered from it, after the time the real answer took.
// - A request that isn't goes to the API, and its answer is added to the tape.
//
// So the first run records and later runs replay, and panning somewhere new adds to the tape.
// What comes off a tape is what the API said when it was recorded: delete the file to record again.
//
// A tape holds OSM data and can be large (tens of megabytes). Keep it out of the repository.
//

/** The OSM API's map requests (`/api/0.6/map?bbox=…` or `map.json?bbox=…`), on any server */
export const MAP_REQUEST = /openstreetmap\.org\/api\/0\.6\/map/;

/** One recorded answer */
interface TapedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** How long the real request took, from sending it until the whole answer had arrived (ms) */
  ms: number;
}

/** A tape in use on a page */
export interface Tape {
  /** The file the tape is kept in */
  file: string;
  /** How many requests were answered from the tape */
  replayed: number;
  /** How many answers were added to the tape */
  recorded: number;
  /** Writes the tape to its file, if anything was added to it. */
  save: () => void;
}

// Headers that describe the bytes as they were sent, not the decoded text that's on the tape
const SKIP_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding']);


/**
 * Answers the page's map requests from a tape, and records the ones that aren't on it.
 * Call this before the page loads anything.
 * @param page - The Playwright page
 * @param file - The file the tape is kept in (made by `save()` if it doesn't exist)
 * @return The tape
 */
export async function useTape(page: Page, file: string): Promise<Tape> {
  const responses = new Map<string, TapedResponse>();
  if (existsSync(file)) {
    for (const [url, response] of Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, TapedResponse>)) {
      responses.set(url, response);
    }
  }

  const tape: Tape = {
    file: file,
    replayed: 0,
    recorded: 0,
    save: () => {
      if (!tape.recorded) return;
      writeFileSync(file, JSON.stringify(Object.fromEntries(responses)));
    }
  };

  // Requests that this tape answered: their "responses" aren't new, so they aren't recorded again.
  const answered = new WeakSet<Request>();

  await page.route(MAP_REQUEST, async route => {
    const request = route.request();
    const taped = responses.get(request.url());
    if (!taped || request.method() !== 'GET') {
      await route.continue();
      return;
    }
    answered.add(request);
    tape.replayed++;
    await new Promise(resolve => { setTimeout(resolve, taped.ms); });
    await route.fulfill({ status: taped.status, headers: taped.headers, body: taped.body }).catch(() => { /* the page went away */ });
  });

  page.on('requestfinished', async request => {
    const url = request.url();
    if (!MAP_REQUEST.test(url) || request.method() !== 'GET' || answered.has(request) || responses.has(url)) return;
    try {
      const response = await request.response();
      if (response?.status() !== 200) return;   // not an error, and not a 429
      const body = (await response.body()).toString('utf8');
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(response.headers())) {
        if (!SKIP_HEADERS.has(name)) headers[name] = value;
      }
      const timing = request.timing();
      responses.set(url, { status: 200, headers: headers, body: body, ms: Math.max(0, Math.round(timing.responseEnd)) });
      tape.recorded++;
    } catch {
      // the page closed before the body could be read
    }
  });

  return tape;
}
