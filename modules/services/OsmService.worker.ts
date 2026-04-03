import { OsmJSONParser, OsmXMLParser } from '../data/parsers/index.ts';
import { utilFetchResponse } from '../util/fetch_response.ts';

import type { ParserOptions, ParserResult } from '../data/parsers/types.ts';


/**
 * Result type for osmService:fetchAndParse.
 *
 * On success the listener returns `{ ok: true, results }`.
 * On HTTP error it reads the response body and returns the status
 * details so the main thread can branch on status codes without
 * needing a full Response object.
 */
export type OsmFetchResult =
  | { ok: true; results: ParserResult }
  | { ok: false; status: number; statusText: string; message: string; responseText: string };


/** Options passed via listenerData */
export interface OsmFetchOptions {
  url: string;
  init?: RequestInit;
  format: 'json' | 'xml';
  parserOptions?: Partial<ParserOptions>;
}


// Long-lived parser instances — separate from the ones in NetworkSystem.worker.ts.
// OsmService has its own "seen" state that is reset independently.
const osmJsonParser = new OsmJSONParser();
const osmXmlParser = new OsmXMLParser();


/**
 * osmService:fetchAndParse
 * Fetches OSM data and parses it on the worker.
 *
 * Unlike the generic network listeners, this one never throws for
 * HTTP errors.  Instead it returns a discriminated result type so the
 * main-thread `loadFromAPI` can inspect status codes (400/401/403
 * for auth issues, 429/509 for rate limits, etc.) without needing
 * a full Response object — which can't cross the worker boundary.
 *
 * AbortErrors still propagate as thrown errors so the existing
 * cancellation logic works unchanged.
 */
export async function fetchAndParse(data: unknown, signal: AbortSignal): Promise<OsmFetchResult> {
  const { url, init, format, parserOptions } = data as OsmFetchOptions;

  const response = await fetch(url, { ...init, signal });

  if (!response.ok) {
    // Read the body so the caller can extract rate-limit details etc.
    let responseText = '';
    try {
      responseText = await response.text();
    } catch {
      // Ignore — body may already be consumed or unreadable
    }

    return {
      ok: false,
      status: response.status,
      statusText: response.statusText,
      message: `${response.status} ${response.statusText}`,
      responseText,
    };
  }

  // Parse the body according to content-type (utilFetchResponse handles
  // JSON vs XML vs text based on the Content-Type header)
  const content = await utilFetchResponse(response);

  const parser = format === 'json' ? osmJsonParser : osmXmlParser;
  const results = parser.parse(content, parserOptions);

  return { ok: true, results };
}


/**
 * osmService:reset
 * Resets the long-lived parser instances.
 */
export function reset(_data: unknown, _signal: AbortSignal): void {
  osmJsonParser.reset();
  osmXmlParser.reset();
}


/** Listeners provided by this file */
export const osmServiceListeners: ListenerRegistry = {
  'osmService:fetchAndParse': fetchAndParse,
  'osmService:reset':         reset,
};
