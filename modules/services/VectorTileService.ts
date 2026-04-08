import { Extent, Tiler, vecEqual } from '@rapid-sdk/math';
import { utilHashcode } from '@rapid-sdk/util';
import { VectorTile } from '@mapbox/vector-tile';
// import geojsonRewind from '@mapbox/geojson-rewind';
import { PMTiles } from 'pmtiles';
import stringify from 'fast-json-stable-stringify';
import * as Polyclip from 'polyclip-ts';
import Protobuf from 'pbf';
import RBush from 'rbush';

import { AbstractSystem } from '../core/AbstractSystem.ts';
import { GeoJSONData } from '../data/GeoJSONData.ts';

import type { Tile } from '@rapid-sdk/math';
import type { Context } from '../Context.ts';
import type { MVTFeatureResult } from '../core/NetworkSystem.worker.ts';


/** RBush box with associated data */
interface RBushBox {
  /** Minimum X coordinate (longitude) of the bounding box */
  minX: number;
  /** Minimum Y coordinate (latitude) of the bounding box */
  minY: number;
  /** Maximum X coordinate (longitude) of the bounding box */
  maxX: number;
  /** Maximum Y coordinate (latitude) of the bounding box */
  maxY: number;
  /** The GeoJSONData feature contained within this bounding box */
  data: GeoJSONData;
}

/** Per-zoom cache for vector tile features */
interface VTZoomCache {
  /** Map of GeoJSONData features keyed by feature ID */
  features: Map<string, GeoJSONData>;
  /** Map of RBush bounding boxes keyed by feature ID */
  boxes: Map<string, RBushBox>;
  /** Queue of pending merge operations: edge ID → property hash → set of feature IDs */
  toMerge: Map<string, Map<string, Set<string>>>;
  /** Set of edge IDs that have already been merged */
  didMerge: Set<string>;
  /** RBush spatial index for efficient geographic querying of features at this zoom */
  rbush: RBush<RBushBox>;
}

/** Source for vector tile data */
interface VTSource {
  /** Unique identifier derived from the URL template hash */
  id: string;
  /** Human-readable name for this source (hostname or filename) */
  displayName: string;
  /** URL template for fetching vector tiles (contains {x}, {y}, {z} placeholders) */
  template: string;
  /**
   * Map of in-flight PMTiles archive requests keyed by tile ID, with their AbortControllers.
   * TODO: PMTiles owns its own fetch via `Source.getBytes()` — these requests bypass NetworkSystem.
   * A custom PMTiles `Source` adapter delegating to `network.fetchRaw()` with Range headers could
   * unify this under NetworkSystem, eliminating this separate inflight map.
   */
  inflightPMTiles: Map<string, AbortController>;
  /** Map of loaded tile IDs to their tile metadata */
  loaded: Map<string, Tile>;
  /** Map of zoom levels to their per-zoom feature caches */
  zoomCache: Map<number, VTZoomCache>;
  /** Viewport version from the last data fetch, used to skip redundant loads */
  lastv: number | null;
  /** PMTiles header metadata, if this source is a PMTiles archive */
  header?: any;
  /** PMTiles instance for reading .pmtiles archives */
  pmtiles?: PMTiles;
  /** Promise that resolves when this source is ready to use */
  readyPromise?: Promise<VTSource>;
}


/**
 * `VectorTileService`
 * This service can connect to sources of vector tile data.
 *
 * - Mapbox Vector Tiles (MVT) made available from a z/x/y tileserver
 *     https://github.com/mapbox/vector-tile-spec
 *     https://github.com/mapbox/vector-tile-js/tree/master
 *
 * - Protomaps .pmtiles single-file archive containing MVT
 *    https://protomaps.com/docs/pmtiles
 *    https://github.com/protomaps/PMTiles
 */
export class VectorTileService extends AbstractSystem {

  /** Map of URL templates to their VTSource objects */
  _sources: Map<string, VTSource>;
  /** Tiler instance used to compute tile coverage for the current viewport */
  _tiler: Tiler;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'vectortile';
    this.requiredDependencies = new Set<SystemID>(['network']);
    this.optionalDependencies = new Set<SystemID>(['gfx']);

    // Sources are identified by their URL template..
    this._sources = new Map();
    this._tiler = (new Tiler().tileSize(512) as Tiler).margin(1) as Tiler;
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    return super.initAsync();
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    const network = this.context.systems.network!;
    network.abortMatching(id => id.startsWith('vt-'));

    for (const source of this._sources.values()) {
      for (const controller of source.inflightPMTiles.values()) {
        controller.abort();
      }

      // free memory
      source.inflightPMTiles.clear();
      source.loaded.clear();
      source.readyPromise = undefined;
      for (const cache of source.zoomCache.values()) {
        cache.features.clear();
        cache.boxes.clear();
        cache.toMerge.clear();
        cache.didMerge.clear();
        cache.rbush.clear();
      }
      source.zoomCache.clear();
      source.lastv = null;
    }
    this._sources.clear();

    return Promise.resolve();
  }


  /**
   * getData
   * Get already loaded data that appears in the current map view
   * @param  template - template to get data for
   * @return Array of data
   */
  getData(template: string): GeoJSONData[] {
    const source = this._sources.get(template);
    if (!source) return [];

    const context = this.context;
    const viewport = context.viewport;
    const bbox = viewport.visibleExtent().bbox();

    // Note that because vector tiles are 512px, they are offset by -1 zoom level
    // from the main map zoom, which follows 256px and OSM convention.
    const z = viewport.transform.zoom - 1;
    const zoom = Math.round(Math.max(z, 0));

    // Because vector tiled data can be different at different zooms,
    // the caches and indexes need to be setup "per-zoom".
    // Look for a cache at the zoom we are at first, then try other zooms.
    let cache;
    for (let diff = 0; diff < 12; diff++) {
      cache = source.zoomCache.get(zoom + diff);
      if (cache) {
        return cache.rbush.search(bbox).map(d => d.data);
      }
      cache = source.zoomCache.get(zoom - diff);
      if (cache) {
        return cache.rbush.search(bbox).map(d => d.data);
      }
    }
    return [];
  }


  /**
   * loadTiles
   * Schedule any data requests needed to cover the current map view
   * @param  template - template to load tiles for
   */
  loadTiles(template: string): void {
    this._getSourceAsync(template)
      .then(source => {
        const context = this.context;
        const network = context.systems.network!;
        const viewport = context.viewport;

        const header = source.header;
        if (header) {  // pmtiles - set up allowable zoom range
          this._tiler.zoomRange(header.minZoom, header.maxZoom);
          if (header.tileType !== 1) {
            throw new Error(`Unsupported tileType ${header.tileType}. Only Type 1 (MVT) is supported`);
          }
        }

        if (source.lastv === viewport.v) return;  // exit early if the view is unchanged
        source.lastv = viewport.v;

        // Determine the tiles needed to cover the view..
        const tiles = this._tiler.getTiles(viewport).tiles;

        // Abort inflight requests that are no longer needed..
        if (source.pmtiles) {
          for (const [tileID, controller] of source.inflightPMTiles) {
            if (!tiles.find(tile => tile.id === tileID)) {
              controller.abort();
            }
          }
        } else {
          const neededIDs = new Set<RequestID>(tiles.map(t => `vt-${source.id}-${t.id}`));
          network.abortMatching(id => id.startsWith(`vt-${source.id}-`) && !neededIDs.has(id));
        }

        // Issue new requests..
        const fetches = tiles.map(tile => this._loadTileAsync(source, tile));
        return Promise.all(fetches)
          .then(() => this._processMergeQueue(source));
      });
  }


  /**
   * _getSourceAsync
   * Create a new cache to hold data for the given template
   * @param  template - A url template for fetching data (e.g. a z/x/y tileserver or .pmtiles)
   * @return Promise resolved to the source object once it is ready to use
   */
  _getSourceAsync(template: string): Promise<VTSource> {
    if (!template) return Promise.reject(new Error('No template'));

    let source = this._sources.get(template);

    if (!source) {  // create it
      const url = new URL(template);
      const hostname = url.hostname;
      const filename = url.pathname.split('/').at(-1);

      source = {
        id:                 utilHashcode(template).toString(),
        displayName:        hostname,
        template:           template,
        inflightPMTiles:    new Map(),   // Map<tileID, AbortController> (PMTiles only)
        loaded:             new Map(),   // Map<tileID, Tile>
        zoomCache:          new Map(),   // Map<zoom, Object zoomCache>
        lastv:              null         // viewport version last time we fetched data
      };

      this._sources.set(template, source);

      // Special handling for PMTiles sources
      // Create a PMTiles instance and fetch the header so we know more about the source.
      if (filename && /\.pmtiles$/.test(filename)) {
        source.displayName = filename;
        source.pmtiles = new PMTiles(template);
        source.readyPromise = source.pmtiles.getHeader()
          .then(header => source!.header = header)
          .then(() => Promise.resolve(source!));

      } else {
        source.readyPromise = Promise.resolve(source);
      }
    }

    return source.readyPromise!;
  }


  /**
   * _getZoomCache
   * Because vector tiled data can be different at different zooms,
   * the caches and indexes need to be setup "per-zoom".
   * This function will return the existing zoom cache, or create one if needed.
   * @param  source
   * @param  zoom
   * @return the cache for the given zoom
   */
  _getZoomCache(source: VTSource, zoom: number): VTZoomCache {
    let cache = source.zoomCache.get(zoom);

    if (!cache) {
      cache = {
        features: new Map(),   // Map<featureID, Object>
        boxes:    new Map(),   // Map<featureID, RBush box>
        toMerge:  new Map(),   // Map<edgeID, Map<prophash, Set<featureIDs>>>
        didMerge: new Set(),   // Set<edgeID>
        rbush:    new RBush()
      };

      source.zoomCache.set(zoom, cache);
    }

    return cache;
  }


  /**
   * _loadTileAsync
   * @param  source
   * @param  tile
   * @return the fetch promise
   */
  _loadTileAsync(source: VTSource, tile: Tile): Promise<void> | undefined {
    const tileID = tile.id;
    if (source.loaded.has(tileID)) return;

    const [x, y, z] = tile.xyz;

    if (source.pmtiles) {
      if (source.inflightPMTiles.has(tileID)) return;

      const controller = new AbortController();
      source.inflightPMTiles.set(tileID, controller);

      return source.pmtiles
        .getZxy(z, x, y, controller.signal)
        .then(response => response?.data)
        .finally(() => source.inflightPMTiles.delete(tileID))
        .then(buffer => {
          source.loaded.set(tileID, tile);
          this._parseTileBuffer(source, tile, buffer);
        })
        .catch(err => {
          if (err.name === 'AbortError') return;          // ok
          if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
        });

    } else {
      const network = this.context.systems.network!;
      const requestID = `vt-${source.id}-${tileID}` as RequestID;
      if (network.isInflight(requestID)) return;

      const url = source.template
        .replace('{x}', x.toString())
        .replace('{y}', y.toString())
        .replace(/\{[t-]y\}/, (Math.pow(2, z) - y - 1).toString())  // TMS-flipped y coordinate
        .replace(/\{z(oom)?\}/, z.toString())
        .replace(/\{switch:([^}]+)\}/, function(s: string, r: string) {
          const subdomains = r.split(',');
          return subdomains[(x + y) % subdomains.length];
        });

      return network.fetch<MVTFeatureResult[]>(url, {
        requestID,
        listenerID: 'network:fetchAndParseMVT',
        listenerData: { tileXYZ: [x, y, z] }
      })
        .then(results => {
          source.loaded.set(tileID, tile);
          this._processVTResults(source, tile, results);
        })
        .catch(err => {
          if (err.name === 'AbortError') return;          // ok
          if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
        });
    }
  }


  /**
   * _parseTileBuffer
   * Decode a raw MVT protobuf buffer into features and process them.
   * Used by the PMTiles path (standard MVT tiles are parsed on the worker).
   * @param  source
   * @param  tile
   * @param  buffer
   */
  _parseTileBuffer(source: VTSource, tile: Tile, buffer: ArrayBuffer | undefined): void {
    if (!buffer) return;  // 'no data' is ok

    const [x, y, z] = tile.xyz;
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

        // This feature is wholly on a neighbor tile - it just spills onto this tile in the buffer..
        if (left > max || top > max || right < min || bottom < min) continue;

        const feature = vtFeature.toGeoJSON(x, y, z);
        if (!feature) continue;

        results.push({ layerID, origID: vtFeature.id, feature });
      }
    }

    this._processVTResults(source, tile, results);
  }


  /**
   * _processVTResults
   * Process pre-parsed MVT features: stringify properties, compute prophash,
   * split multi-geometries, create GeoJSONData, and cache/queue merges.
   * Both the worker-parsed path and the PMTiles path converge here.
   * @param  source
   * @param  tile
   * @param  results - array of parsed MVT features
   */
  _processVTResults(source: VTSource, tile: Tile, results: MVTFeatureResult[]): void {
    if (!results || !results.length) return;

    // Get some info about this tile and its neighbors
    const [x, y, z] = tile.xyz;
    const tileID = tile.id;
    const tileExtent = tile.wgs84Extent;

    //       -y
    //     +----+
    //  -x |    | +x
    //     +----+
    //       +y

    // Define tile edges (lower x,y,z - higher x,y,z)
    const leftEdge = `${x-1},${y},${z}-${tileID}`;
    const rightEdge = `${tileID}-${x+1},${y},${z}`;
    const topEdge = `${x},${y-1},${z}-${tileID}`;
    const bottomEdge = `${tileID}-${x},${y+1},${z}`;

    const cache = this._getZoomCache(source, z);

    const newFeatures = [];
    for (const { layerID, origID, feature: orig } of results) {
      // Force all properties to strings
      for (const [k, v] of Object.entries(orig.properties ?? {})) {
        orig.properties![k] = String(v);
      }

      // When features have the same properties, we'll consider them mergeable.
      const prophash = utilHashcode(stringify(orig.properties)).toString();

      // It's common for a vector tile to return 'Multi' GeoJSON features..
      // e.g. All the roads together in one `MultiLineString`.
      // For our purposes, we really want to work with them as single part features..
      for (const part of this._toSingleFeatures(orig)) {
        const extent = this._calcExtent(part);
        if (!isFinite(extent.min[0])) continue;  // invalid - no coordinates?

        // If it has an ID, remove it.  We'll generate a unique one.
        delete part.id;

        part._prophash = prophash;
        part._layerID = layerID;
        part._origID = origID;

        const feat = new GeoJSONData(this.context, { geojson: part });
        const featureID = feat.id;  // the generated ID
        // rewind?  really something that `GeometryPart` should handle now

        // For Polygons only, determine if this feature clips to a tile edge.
        // If so, we'll try to merge it with similar features on the neighboring tile
        if (part.geometry.type === 'Polygon') {
          if (extent.min[0] < tileExtent.min[0]) { this._queueMerge(cache, featureID, prophash, leftEdge); }
          if (extent.max[0] > tileExtent.max[0]) { this._queueMerge(cache, featureID, prophash, rightEdge); }
          if (extent.min[1] < tileExtent.min[1]) { this._queueMerge(cache, featureID, prophash, bottomEdge); }
          if (extent.max[1] > tileExtent.max[1]) { this._queueMerge(cache, featureID, prophash, topEdge); }
        }

        newFeatures.push(feat);
      }
    }

    if (newFeatures.length) {
      this._cacheFeatures(cache, newFeatures);
      const gfx = this.context.systems.gfx;
      gfx?.deferredRedraw();
    }
  }


  /**
   * _queueMerge
   * Mark this data as eligible for merging across given tile edge
   * @param  cache
   * @param  featureID
   * @param  prophash
   * @param  edgeID
   */
  _queueMerge(cache: VTZoomCache, featureID: string, prophash: string, edgeID: string): void {
    if (cache.didMerge.has(edgeID)) return;  // we merged this edge already

    let mergemap = cache.toMerge.get(edgeID);
    if (!mergemap) {
      mergemap = new Map();    // Map<prophash, Set<featureIDs>>
      cache.toMerge.set(edgeID, mergemap);
    }
    let featureIDs = mergemap.get(prophash);
    if (!featureIDs) {
      featureIDs = new Set();
      mergemap.set(prophash, featureIDs);
    }
    featureIDs.add(featureID);
  }


  /**
   * _processMergeQueue
   * Call this sometimes to merge polygons across tile edges
   */
  _processMergeQueue(source: VTSource): void {
    for (const cache of source.zoomCache.values()) {
      for (const [edgeID, mergemap] of cache.toMerge) {  // for each edge

        // Are both tiles loaded?
        const [lowID, highID] = edgeID.split('-');
        const lowTile = source.loaded.get(lowID);
        const highTile = source.loaded.get(highID);
        if (!lowTile || !highTile) continue;

        cache.didMerge.add(edgeID);

        // All the features that share this prophash along this edge can be merged
        for (const [prophash, featureIDs] of mergemap) {
          this._mergePolygons(cache, prophash, featureIDs, lowTile, highTile);
          mergemap.delete(prophash);  // done this prophash
        }
        cache.toMerge.delete(edgeID);
      }
    }
  }


  /**
   * _cacheFeatures
   * @param  cache
   * @param  features
   */
  _cacheFeatures(cache: VTZoomCache, features: GeoJSONData[]): void {
    const boxes = [];
    for (const feature of features) {
      cache.features.set(feature.id, feature);  // cache feature

      const extent = feature.extent();
      if (!extent) continue;

      const box: RBushBox = { ...extent.bbox(), data: feature };
      cache.boxes.set(feature.id, box);   // cache box
      boxes.push(box);
    }

    cache.rbush.load(boxes);  // bulk load
  }


  /**
   * _uncacheFeatureIDs
   * @param  cache
   * @param  featureIDs
   */
  _uncacheFeatureIDs(cache: VTZoomCache, featureIDs: Set<string>): void {
    for (const featureID of featureIDs) {
      const box = cache.boxes.get(featureID);
      if (box) {
        cache.boxes.delete(featureID);  // uncache box
        cache.rbush.remove(box);
      }
      cache.features.delete(featureID);  // uncache feature
    }
  }


  /**
   * _mergePolygons
   * Merge the given features across the given edge (defined by lowTile/highTile)
   * @param  cache
   * @param  prophash
   * @param  featureIDs - featureIDs to merge
   * @param  lowTile
   * @param  highTile
   */
  _mergePolygons(cache: VTZoomCache, prophash: string, featureIDs: Set<string>, lowTile: Tile, highTile: Tile): void {
    const features = Array.from(featureIDs).map(featureID => cache.features.get(featureID)).filter((f): f is GeoJSONData => !!f);
    if (!features.length) return;

    // We have more edges to keep track of now..
    // The tiles involved in this merge will be in one of these orientations:
    //
    //                          +------+
    //  +-----+------+          | low  |
    //  | low | high |    or    +------+
    //  +-----+------+          | high |
    //                          +------+
    //
    // Important to ignore the edge between low-high, as this is the one we are currently merging!
    // Edges to ignore will either be "lowRight,highLeft" or "lowBottom,highTop"

    // Define tile edges (lower x,y,z - higher x,y,z)
    const [lx, ly, lz] = lowTile.xyz;
    const [hx, hy, hz] = highTile.xyz;
    const lowTileID = lowTile.id;
    const highTileID = highTile.id;
    const lowTileExtent = lowTile.wgs84Extent;
    const highTileExtent = highTile.wgs84Extent;
    const isVertical = (hy === ly + 1);
    const isHorizontal = (hx === lx + 1);
    const lowLeftEdge = `${lx-1},${ly},${lz}-${lowTileID}`;
    const lowRightEdge = `${lowTileID}-${lx+1},${ly},${lz}`;
    const lowTopEdge = `${lx},${ly-1},${lz}-${lowTileID}`;
    const lowBottomEdge = `${lowTileID}-${lx},${ly+1},${lz}`;
    const highLeftEdge = `${hx-1},${hy},${hz}-${highTileID}`;
    const highRightEdge = `${highTileID}-${hx+1},${hy},${hz}`;
    const highTopEdge = `${hx},${hy-1},${hz}-${highTileID}`;
    const highBottomEdge = `${highTileID}-${hx},${hy+1},${hz}`;

    // The merged feature(s) can copy some properties from the first one
    const source = features[0]!;

    this._uncacheFeatureIDs(cache, featureIDs);

    // Union the coordinates together
    // (I believe these should all be single part Polygons)
    const sourceCoords = features.map(feature => feature.geoms.parts[0].orig!.coords as Polyclip.Geom);
    const mergedCoords = Polyclip.union(sourceCoords[0], ...sourceCoords.slice(1));
    if (!mergedCoords || !mergedCoords.length) {
      throw new Error(`Failed to merge`);  // shouldn't happen
    }

    // `Polyclip.union` always returns a MultiPolygon
    const merged = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: mergedCoords
      },
      properties: { ...source.properties }   // shallow copy
    };

    // Convert whatever we got into new single part Polygons
    const newFeatures = [];
    for (const part of this._toSingleFeatures(merged)) {
      const extent = this._calcExtent(part);
      if (!isFinite(extent.min[0])) continue;  // invalid - no coordinates?

      this._dedupePoints(part);  // remove coincident points caused by union operation

      // It shouldn't have an id at this point, but we will take no chances.
      delete part.id;

      part._prophash = source.props._prophash;
      part._layerID = source.props._layerID;
      part._origID = source.props._origID;

      const feat = new GeoJSONData(this.context, { geojson: part });
      const featureID = feat.id;  // the generated ID
      // rewind?  really something that `GeometryPart` should handle now

      // More merging may be necessary
      if (extent.min[0] < lowTileExtent.min[0])                   { this._queueMerge(cache, featureID, prophash, lowLeftEdge); }
      if (isVertical && extent.max[0] > lowTileExtent.max[0])     { this._queueMerge(cache, featureID, prophash, lowRightEdge); }
      if (isHorizontal && extent.min[1] < lowTileExtent.min[1])   { this._queueMerge(cache, featureID, prophash, lowBottomEdge); }
      if (extent.max[1] > lowTileExtent.max[1])                   { this._queueMerge(cache, featureID, prophash, lowTopEdge); }
      if (isVertical && extent.min[0] < highTileExtent.min[0])    { this._queueMerge(cache, featureID, prophash, highLeftEdge); }
      if (extent.max[0] > highTileExtent.max[0])                  { this._queueMerge(cache, featureID, prophash, highRightEdge); }
      if (extent.min[1] < highTileExtent.min[1])                  { this._queueMerge(cache, featureID, prophash, highBottomEdge); }
      if (isHorizontal && extent.max[1] > highTileExtent.max[1])  { this._queueMerge(cache, featureID, prophash, highTopEdge); }

      newFeatures.push(feat);
    }

    if (newFeatures.length) {
      this._cacheFeatures(cache, newFeatures);
      const gfx = this.context.systems.gfx;
      gfx?.deferredRedraw();
    }
  }


  /**
   * _calcExtent
   * @param  geojson - a GeoJSONData Feature
   * @return the extent
   */
  _calcExtent(geojson: any): Extent {
    const extent = new Extent();
    const geometry = geojson?.geometry;
    if (!geojson || !geometry) return extent;

    const type = geometry.type;
    const coords = geometry.coordinates;

    // Treat single types as multi types to keep the code simple
    const parts = /^Multi/.test(type) ? coords : [coords];

    if (/Polygon$/.test(type)) {
      for (const polygon of parts) {
        const outer = polygon[0];  // No need to iterate over inners
        for (const point of outer) {
          extent.extendSelf(point);
        }
      }
    } else if (/LineString$/.test(type)) {
      for (const line of parts) {
        for (const point of line) {
          extent.extendSelf(point);
        }
      }
    } else if (/Point$/.test(type)) {
      for (const point of parts) {
        extent.extendSelf(point);
      }
    }

    return extent;
  }


  /**
   * _dedupePoints
   * The union operation often leaves points which are essentially coincident
   * This will remove them in-place
   * @param  geojson - a GeoJSONData Feature
   */
  _dedupePoints(geojson: any): void {
    const geometry = geojson?.geometry;
    if (!geojson || !geometry) return;
    if (geometry.type !== 'Polygon') return;

    const EPSILON = 5e-6;
    const coords = geometry.coordinates;

    for (let i = 0; i < coords.length; i++) {
      const ring = coords[i];
      const cleaned = [];
      let prevPoint = null;
      for (let j = 0; j < ring.length; j++) {
        const point = ring[j];
        if (j === 0 || j === ring.length - 1) {   // leave first/last points alone
          cleaned.push(point);
        } else if (!vecEqual(point, prevPoint, EPSILON)) {
          cleaned.push(point);
        }
        prevPoint = point;
      }
      coords[i] = cleaned;  // replace ring
    }
  }


  /**
   * _toSingleFeatures
   * Call this to convert a multi feature to an array of single features
   * (e.g. convert MultiPolygon to array of Polygons)
   * (If passed a single feature, this will just return the single feature in an array)
   * @param  geojson - any GeoJSONData Feature
   * @return array of single GeoJSONData features
   */
  _toSingleFeatures(geojson: any): any[] {
    const result: any[] = [];
    const geometry = geojson?.geometry;
    if (!geojson || !geometry) return result;

    const type = geometry.type;
    const coords = geometry.coordinates;

    // Treat single types as multi types to keep the code simple
    const parts = /^Multi/.test(type) ? coords : [coords];

    for (const part of parts) {
      result.push({
        type: 'Feature',
        geometry: {
          type: type.replace('Multi', ''),
          coordinates: part
        },
        properties: { ...geojson.properties }   // shallow copy
      });
    }
    return result;
  }
}
