import { OsmXMLParser } from '../data/parsers/OsmXMLParser.ts';
import { utilFetchResponse } from '../util/fetch_response.ts';

import type { ParserOptions, ParserResult } from '../data/parsers/types.ts';
import type { WorkerListener } from '../core/types.ts';


// Long-lived parser instance — persists for the lifetime of the execution context.
// In a worker, this lives at module scope for the worker's lifetime.
// On the main thread (fallback), the same module is imported and gets its own instance.
// MapWithAI always uses `skipSeen: false`, so `_seen` accumulation is harmless.
const xmlParser = new OsmXMLParser();


/** Data payload for `mapwithai:fetchAndParse` */
interface FetchAndParseData {
  url: string;
  parserOptions?: Partial<ParserOptions>;
}


/**
 * mapwithai:fetchAndParse
 * Fetches a MapWithAI tile URL, parses the XML response with OsmXMLParser,
 * and returns the ParserResult (plain objects, arrays, Sets — all structured-clone safe).
 */
export const fetchAndParse: WorkerListener = async (data: unknown, signal: AbortSignal): Promise<ParserResult> => {
  const { url, parserOptions } = data as FetchAndParseData;
  const response = await fetch(url, { signal });

  // utilFetchResponse handles content-type detection and returns a string for XML
  // (xmldom DOMParser runs here in the worker — the Document never crosses postMessage)
  const xml = await utilFetchResponse(response);
  return xmlParser.parse(xml, parserOptions);
};


/**
 * mapwithai:reset
 * Clears the long-lived parser's seen cache.
 * Called when the main thread resets its session.
 */
export const reset: WorkerListener = (): void => {
  xmlParser.reset();
};


/** Worker handlers provided by this file — keyed by listenerID */
export const workerListeners: Record<ListenerID, WorkerListener> = {
  'mapwithai:fetchAndParse': fetchAndParse,
  'mapwithai:reset': reset,
};
