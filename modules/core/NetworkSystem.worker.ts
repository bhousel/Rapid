import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';

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

/** Options for fetchAndParseMVT */
export interface FetchAndParseMVTOptions extends FetchAndParseOptions {
  tileXYZ: [number, number, number];
}

/** A single feature extracted from a Mapbox Vector Tile */
export interface MVTFeatureResult {
  /** Which layer this feature came from */
  layerID: string;
  /** Original feature ID from the vector tile (may not be unique across layers) */
  origID?: number;
  /** GeoJSON Feature with geometry projected to WGS84 */
  feature: GeoJSON.Feature;
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
 * network:fetchAndParseMVT
 * Fetches a Mapbox Vector Tile from a URL, decodes the protobuf, and converts
 * each feature to GeoJSON.
 * @param  data    Message data - expects the url, optional RequestInit, and tileXYZ coordinates
 * @param  signal  Abort signal
 * @return  Promise resolved with an array of MVTFeatureResult
 */
export async function fetchAndParseMVT(data: unknown, signal: AbortSignal): Promise<MVTFeatureResult[]> {
  const { tileXYZ } = data as FetchAndParseMVTOptions;
  const [x, y, z] = tileXYZ;

  const buffer = await fetchAndParse(data, signal);
  if (!buffer) return [];

  const vt = new VectorTile(new Protobuf(buffer));
  const results: MVTFeatureResult[] = [];

  for (const [layerID, vtLayer] of Object.entries(vt.layers)) {
    if (!vtLayer) continue;

    // Tile coordinate space bounds — features wholly outside are on neighbor tiles
    const min = 0;
    const max = vtLayer.extent;  // default 4096

    for (let i = 0; i < vtLayer.length; i++) {
      const vtFeature = vtLayer.feature(i);
      const [left, top, right, bottom] = vtFeature.bbox();

      // Skip features wholly on a neighbor tile (they spill into the buffer)
      if (left > max || top > max || right < min || bottom < min) continue;

      const feature = vtFeature.toGeoJSON(x, y, z);
      if (!feature) continue;

      results.push({ layerID, origID: vtFeature.id, feature });
    }
  }

  return results;
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
  'network:fetchAndParseMVT':      fetchAndParseMVT,
  'network:fetchAndParseOsmJson':  fetchAndParseOsmJson,
  'network:fetchAndParseOsmXml':   fetchAndParseOsmXml,
  'network:reset':                 reset
};
