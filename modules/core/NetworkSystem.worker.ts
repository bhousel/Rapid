import { OsmJSONParser, OsmXMLParser } from '../data/parsers/index.ts';
import { utilFetchResponse } from '../util/fetch_response.ts';

import type { ParserOptions, ParserResult } from '../data/parsers/types.ts';

// Long-lived parser instances - These persist for the lifetime of the execution context.
// In a worker, these live at module scope for the worker's lifetime.
// On the main thread (fallback), the same module is imported and gets its own instance.
const osmJsonParser = new OsmJSONParser();
const osmXmlParser = new OsmXMLParser();


/** Options for fetchAndParse */
export interface FetchAndParseOptions {
  url: string;
  init?: RequestInit;
}

/** Options for fetchAndParseOsm */
export interface FetchAndParseOsmOptions extends FetchAndParseOptions {
  parserOptions?: Partial<ParserOptions>;
}


/**
 * network:fetchAndParse
 * Fetches generic data from a URL and parses the response via utilFetchResponse.
 * @param  data    Message data - expects the url and optional RequestInit passed to `fetch`
 * @param  signal  Abort signal
 * @return  Promise resolved with the data, or rejected if error
 */
export async function fetchAndParse(data: unknown, signal: AbortSignal): Promise<any> {
  const { url, init } = data as FetchAndParseOptions;
  const response = await fetch(url, { ...init, signal });
  return utilFetchResponse(response);
};

/**
 * network:fetchAndParseOsmJSON
 * Fetches OSM JSON data from a URL and parses the response via utilFetchResponse.
 * @param  data    Message data - expects the url, optional RequestInit passed to `fetch`, and optional parser options
 * @param  signal  Abort signal
 * @return  Promise resolved with the data, or rejected if error
 */
export async function fetchAndParseOsmJson(data: unknown, signal: AbortSignal): Promise<ParserResult> {
  const { parserOptions } = data as FetchAndParseOsmOptions;
  const json = await fetchAndParse(data, signal);
  return osmJsonParser.parse(json, parserOptions);
};

/**
 * network:fetchAndParseOsmXML
 * Fetches OSM XML data from a URL and parses the response via utilFetchResponse.
 * @param  data    Message data - expects the url, optional RequestInit passed to `fetch`, and optional parser options
 * @param  signal  Abort signal
 * @return  Promise resolved with the data, or rejected if error
 */
export async function fetchAndParseOsmXml(data: unknown, signal: AbortSignal): Promise<ParserResult> {
  const { parserOptions } = data as FetchAndParseOsmOptions;
  const xml = await fetchAndParse(data, signal);
  return osmXmlParser.parse(xml, parserOptions);
};

/**
 * network:reset
 * Resets the long-lived parsers.
 * (They have internal "seen" state).
 * Called when the main thread resets its session.
 */
export function reset(_data: unknown, _signal: AbortSignal): void {
  osmJsonParser.reset();
  osmXmlParser.reset();
};


/** Listeners provided by this file */
export const networkListeners: ListenerRegistry = {
  'network:fetchAndParse':         fetchAndParse,
  'network:fetchAndParseOsmJson':  fetchAndParseOsmJson,
  'network:fetchAndParseOsmXml':   fetchAndParseOsmXml,
  'network:reset':                 reset
};
