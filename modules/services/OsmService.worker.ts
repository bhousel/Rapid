import { OsmJSONParser, OsmXMLParser } from '../data/parsers/index.ts';
import { fetchEnvelope, utilFetchResponse } from '../util/fetch_response.ts';

import type { FetchEnvelope } from '../util/fetch_response.ts';
import type { ParserOptions, ParserResult } from '../data/parsers/types.ts';


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
 * Fetches OSM data and parses it on the worker, wrapping the outcome in a
 * `FetchEnvelope`.
 *
 * The envelope lets the main-thread `loadFromAPI` inspect HTTP status codes
 * (400/401/403 for auth issues, 429/509 for rate limits, etc.) and the response
 * body without needing a full `Response` object — which can't cross the worker
 * boundary.  `AbortError` and transport failures still reject so the existing
 * cancellation logic works unchanged.
 *
 * @listens `osmService:fetchAndParse`
 * @param  data    Message data - expects the url, optional RequestInit, format, and additional parser options
 * @param  signal  Abort signal
 * @return  Promise resolved with a FetchEnvelope (rejected only on abort/transport error)
 */
export async function fetchAndParse(data: unknown, signal: AbortSignal): Promise<FetchEnvelope<ParserResult>> {
  const { url, init, format, parserOptions } = data as OsmFetchOptions;
  const parser = format === 'json' ? osmJsonParser : osmXmlParser;
  return fetchEnvelope(fetch, url, { ...init, signal },
    async response => parser.parse(await utilFetchResponse(response), parserOptions));
}


/**
 * Resets the long-lived parser instances.
 * @param _data
 * @param _signal
 * @listens `osmService:reset`
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
