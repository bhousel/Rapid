import * as Polyclip from 'polyclip-ts';
import { AbstractSystem } from '../core/AbstractSystem.ts';
import { Extent, Tiler, projWorldToWgs84, vecEqual, WORLD_SIZE } from '@rapid-sdk/math';
import { GeoJSONData } from '../data/GeoJSONData.ts';
import { PMTiles } from 'pmtiles';
import { PbfReader } from 'pbf';
import { utilHashcode } from '@rapid-sdk/util';
import { VectorTile } from '@mapbox/vector-tile';

import type { BBox } from 'rbush';
import type { Context } from '../Context.ts';
import type { GeoJSONProps } from '../data/GeoJSONData.ts';
import type { MVTFeatureResult } from '../core/NetworkSystem.worker.ts';
import type { Tile, Vec2 } from '@rapid-sdk/math';


// The maximum tries we will merge across a given edge
// This gives features an opportunity to re-enter the merge queue
// as more parts of the map load.
// const MAX_MERGE_ATTEMPTS = 4;

/** Convenience type for string identifiers for tile edges (`lowID:highID`) */
type EdgeID = string;
/** Convenience type for string property hashes */
type HashString = string;
/** Convenience type for string identifiers for tile edges (`tileID:[n,e,s,w]`) */
// type SearchID = string;


/** Per-zoom cache for vector tile features */
interface VTZoomCache {
  /** SpatialSystem cache id for this zoomcache, will look like: `vt-${source.id}-z${zoom}` */
  spatialID: SpatialID;
  /** Merge candidates - when data that touches a tile edge, search additional boxes for merge candidates */
  toMerge: Map<DataID, BBox[]>;
  /** Record the number of merge attempts - we will cap it */
  mergeCount: Map<EdgeID, number>;
}

/** Source for vector tile data */
interface VTSource {
  /** Unique identifier for this source - will either use the caller-provided datasetID or a generated id */
  id: string;
  /** Optional caller-provided identifier for the source */
  datasetID?: DatasetID;
  /** Human-readable name for this source (hostname or filename) */
  displayName: string;
  /** URL template for fetching vector tiles (contains {x}, {y}, {z} placeholders) */
  template: string;
  /** Per-source tiler for computing tile coverage (kept per-source so a pmtiles zoom range can't leak across sources) */
  tiler: Tiler;
  /**
   * Map of in-flight PMTiles archive requests keyed by tile ID, with their AbortControllers.
   * TODO: PMTiles owns its own fetch via `Source.getBytes()` — these requests bypass NetworkSystem.
   * A custom PMTiles `Source` adapter delegating to `network.fetchRaw()` with Range headers could
   * unify this under NetworkSystem, eliminating this separate inflight map.
   */
  inflightPMTiles: Map<string, AbortController>;
  /** Map of loaded tile IDs to their tile metadata */
  loaded: Map<TileID, Tile>;
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
 * `VectorTileService` can connect to sources of vector tile data.
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
  protected _sources: Map<string, VTSource>;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'vectortile';
    this.requiredDependencies = new Set<SystemID>(['network', 'spatial']);
    this.optionalDependencies = new Set<SystemID>(['gfx']);

    // Sources are identified by their URL template..
    this._sources = new Map<string, VTSource>();
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    return super.initAsync();
  }


  /**
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return  Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    const network = this.context.systems.network!;
    const spatial = this.context.systems.spatial!;
    network.clearMatching(id => id.startsWith('vt-'));
    spatial.clearMatching(id => id.startsWith('vt-'));

    for (const source of this._sources.values()) {
      for (const controller of source.inflightPMTiles.values()) {
        controller.abort();
      }

      // free memory
      source.inflightPMTiles.clear();
      source.loaded.clear();
      source.readyPromise = undefined;
      source.zoomCache.clear();
      source.lastv = null;
    }
    this._sources.clear();

    return Promise.resolve();
  }


  /**
   * Get already loaded data that appears in the current map view
   * @param  template - template to get data for
   * @return Array of data
   */
  public getData(template: string): GeoJSONData[] {
    const source = this._sources.get(template);
    if (!source) return [];

    const context = this.context;
    const spatial = context.systems.spatial!;
    const viewport = context.viewport;

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
        return spatial.getVisibleItems(cache.spatialID).map(hit => hit.contents as GeoJSONData);
      }
      cache = source.zoomCache.get(zoom - diff);
      if (cache) {
        return spatial.getVisibleItems(cache.spatialID).map(hit => hit.contents as GeoJSONData);
      }
    }
    return [];
  }


  /**
   * Schedule any data requests needed to cover the current map view
   * @param  template - template to load tiles for
   * @param  datasetID - optional datasetID to identify this source by
   */
  public loadTiles(template: string, datasetID?: DatasetID): void {
    this._getSourceAsync(template, datasetID)
      .then(source => {
        const context = this.context;
        const network = context.systems.network!;
        const viewport = context.viewport;

        const header = source.header;
        if (header) {  // pmtiles - set up allowable zoom range
          source.tiler.zoomRange(header.minZoom, header.maxZoom);
          if (header.tileType !== 1) {
            throw new Error(`Unsupported tileType ${header.tileType}. Only Type 1 (MVT) is supported`);
          }
        }

        if (source.lastv === viewport.v) return;  // exit early if the view is unchanged
        source.lastv = viewport.v;

        // Determine the tiles needed to cover the view..
        const tiles = source.tiler.getTiles(viewport).tiles;

        // Abort inflight requests that are no longer needed..
        if (source.pmtiles) {
          for (const [tileID, controller] of source.inflightPMTiles) {
            if (!tiles.find(tile => tile.id === tileID)) {
              controller.abort();
            }
          }
        } else {
          const neededIDs = new Set<RequestID>(tiles.map(tile => `vt-${source.id}-${tile.id}`));
          network.abortMatching(id => id.startsWith(`vt-${source.id}-`) && !neededIDs.has(id));
        }

        // Issue new requests..
        const fetches = tiles.map(tile => this._loadTileAsync(source, tile));
        return Promise.all(fetches)
          .then(() => this._performMerges(source));
      });
  }


  /**
   * Create a new cache to hold data for the given template
   * @param  template - A url template for fetching data (e.g. a z/x/y tileserver or .pmtiles)
   * @param  datasetID - optional datasetID to identify this source by
   * @return Promise resolved to the source object once it is ready to use
   */
  protected _getSourceAsync(template: string, datasetID?: DatasetID): Promise<VTSource> {
    if (!template) return Promise.reject(new Error('No template'));

    let source = this._sources.get(template);

    if (!source) {  // create it
      const url = new URL(template);
      const hostname = url.hostname;
      const filename = url.pathname.split('/').at(-1);

      source = {
        id:                datasetID ?? utilHashcode(template).toString(),
        datasetID:         datasetID,
        displayName:       hostname,
        template:          template,
        tiler:             (new Tiler().tileSize(512) as Tiler).margin(1) as Tiler,
        inflightPMTiles:   new Map<TileID, AbortController>(),   // for PMTile sources only
        loaded:            new Map<TileID, Tile>(),
        zoomCache:         new Map<number, VTZoomCache>(),
        lastv:             null         // viewport version last time we fetched data
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
   * Because vector tiled data can be different at different zooms,
   * the caches and indexes need to be setup "per-zoom".
   * This function will return the existing zoom cache, or create one if needed.
   * @param  source  - The vector tile source
   * @param  zoom    - The zoom level we are interested in
   * @return the cache for the given zoom level
   */
  protected _getZoomCache(source: VTSource, zoom: number): VTZoomCache {
    let cache = source.zoomCache.get(zoom);

    if (!cache) {
      cache = {
        spatialID: `vt-${source.id}-z${zoom}`,
        toMerge: new Map<DataID, BBox[]>(),
        mergeCount: new Map<EdgeID, number>()
      };

      source.zoomCache.set(zoom, cache);
    }

    return cache;
  }


  /**
   * Fetches and parses a single vector tile.
   * @param  source  - The vector tile source to load
   * @param  tile    - The tile to load
   * @return the fetch promise
   */
  protected _loadTileAsync(source: VTSource, tile: Tile): Promise<void> | undefined {
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
      const requestID = `vt-${source.id}-${tileID}`;
      if (network.isInflight(requestID)) return;

      const url = source.template
        .replace('{x}', x.toString())
        .replace('{y}', y.toString())
        .replace(/\{[t-]y\}/, (2 ** z - y - 1).toString())  // TMS-flipped y coordinate
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
   * Decode a raw MVT protobuf buffer into features and process them.
   * Used by the PMTiles path (standard MVT tiles are parsed on the worker).
   * @param  source  - the vector tile source
   * @param  tile    - the Tile that was fetched
   * @param  buffer  - the raw protobuf buffer
   */
  protected _parseTileBuffer(source: VTSource, tile: Tile, buffer: ArrayBuffer | undefined): void {
    if (!buffer) return;  // 'no data' is ok

    const [x, y, z] = tile.xyz;
    const vt = new VectorTile(new PbfReader(buffer));
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
   * Process pre-parsed vector tile features.
   * Both the MVT path and the PMTiles path converge here.
   * @param  source  - the vector tile source
   * @param  tile    - the Tile that was fetched
   * @param  results - array of parsed MVT features
   */
  protected _processVTResults(source: VTSource, tile: Tile, results: MVTFeatureResult[]): void {
    if (!results || !results.length) return;

    const context = this.context;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial!;

    const z = tile.xyz[2];
    const cache = this._getZoomCache(source, z);

    const newFeatures = [];
    for (const { layerID, origID, feature: orig } of results) {
      // Force all props to strings, then sort alphabetically, so prophash is deterministic.
      const stringified: Record<string, string> = {};
      for (const [k, v] of Object.entries(orig.properties ?? {})) {
        stringified[k] = String(v);
      }
      const keys = Object.keys(stringified).sort((a, b) => a.localeCompare(b));
      const sorted: Record<string, string> = {};
      for (const k of keys) {
        sorted[k] = stringified[k];
      }

      orig.properties = sorted;

      // When neighbor features have the same properties, we'll consider them mergeable.
      const prophash = utilHashcode(JSON.stringify(sorted)).toString();

      // It's common for a vector tile to return 'Multi' GeoJSON features..
      // e.g. All the roads together in one `MultiLineString`.
      // For our purposes, we really want to work with them as single part features..
      for (const part of this._toSingleFeatures(orig)) {
        const extent = this._calcExtent(part);   // sanity check
        if (!isFinite(extent.min[0])) continue;  // invalid - no coordinates?

        // If it already has an ID, remove it.  We'll generate a unique one.
        delete part.id;
        delete part.properties?.id;

        const props: GeoJSONProps = {
          prophash:   prophash,
          layerID:    layerID,
          origID:     origID,
          tileID:     tile.id,
          serviceID:  this.id,
          datasetID:  source.datasetID,
          geojson:    part
        };

        const d = new GeoJSONData(context, props);
        newFeatures.push(d);
        this._considerForMerge(cache, d, tile.worldExtent);
      }
    }

    if (newFeatures.length) {
      spatial.addData(cache.spatialID, newFeatures);
      gfx?.deferredRedraw();
    }
  }


  /**
   * Record a feature as a merge candidate if it touches the edges of the given "bounds" extent.
   * (The "bounds" starts out being a Tile, but can grow with successive merge steps)
   *
   * Note that we assume the features in here to be single-part features
   * generated by `_toSingleFeatures()`: 'Point', 'LineString', or 'Polygon'.
   *
   * @param  cache    - the per-zoom cache
   * @param  d        - the GeoJSONData feature
   * @param  bounds   - the Extent bounds we are testing
   */
  protected _considerForMerge(cache: VTZoomCache, d: GeoJSONData, bounds: Extent): void {
    const part = d.geoms.parts[0]!;      // Expect a single part
    if (part.type === 'Point') return;   // Merge LineString and Polygon only

    const coords = part.orig?.coords;
    const extent = part.world?.extent;
    if (!extent || !coords) return;   // invalid geometry

    const search = this._checkEdges(extent, bounds);
    if (search) {
      let toSearch = cache.toMerge.get(d.id);
      if (!toSearch) {
        toSearch = [];
        cache.toMerge.set(d.id, toSearch);
      }
      toSearch.push(search);
    }
  }


  /**
   * Compare the extent of the data to the extent of the bounds.
   * If the data touches any of the edges of the bounds, return a search region that
   * extends into the neighbor tile(s) where we should look for merge candidates.
   * @param   data    - the Extent of the data (in world coordinates)
   * @param   bounds  - the Extent of the bounds (in world coordinates)
   * @return  extended search region or null if no bounds edges were touched
   */
  protected _checkEdges(data: Extent, bounds: Extent): BBox  | null {
    const search = new Extent(data);
    const pad = 1;  // world pixels of padding (search done in world coords)
    let didTouch = false;

    if (data.min[0] <= bounds.min[0]) {   // touches west edge
      search.min[0] = data.min[0] - pad;
      didTouch = true;
    }
    if (data.max[0] >= bounds.max[0]) {   // touches east edge
      search.max[0] = data.max[0] + pad;
      didTouch = true;
    }
    if (data.min[1] <= bounds.min[1]) {   // touches south edge
      search.min[1] = data.min[1] - pad;
      didTouch = true;
    }
    if (data.max[1] >= bounds.max[1]) {   // touches north edge
      search.min[1] = data.max[1] + pad;
      didTouch = true;
    }

    return didTouch ? search.bbox() : null;
  }


  /**
   * Gather the tile edges that the given extent touches.
   * EdgeID are formatted like `lowID:highID` with the lower x/y tile first.
   * @param   extent - the Extent to test
   * @param   tile   - the Tile to test
   * @return  Set of touched edgeIDs
   */
  protected _touchedEdges(extent: Extent, tile: Tile): Set<EdgeID> {
    const [x, y, z] = tile.xyz;
    const te = tile.wgs84Extent;
    const edges = new Set<EdgeID>();

    if (extent.min[0] <= te.min[0]) edges.add(`${x - 1},${y},${z}:${x},${y},${z}`);   // west
    if (extent.max[0] >= te.max[0]) edges.add(`${x},${y},${z}:${x + 1},${y},${z}`);   // east
    if (extent.min[1] <= te.min[1]) edges.add(`${x},${y},${z}:${x},${y + 1},${z}`);   // south
    if (extent.max[1] >= te.max[1]) edges.add(`${x},${y - 1},${z}:${x},${y},${z}`);   // north

    return edges;
  }


  /**
   * Call this sometimes to reassemble features that are split across tile edges.
   * Candidate features are added to the `toMerge` queue either at tile load time
   *  or as a result of subsequent merging.
   * @param  source - the vector tile source to process
   */
  protected _performMerges(source: VTSource): void {
    for (const cache of source.zoomCache.values()) {

      for (const dataID of cache.toMerge.keys()) {
        this._mergeNeighbors(source, cache, dataID);
      }
    }

    const gfx = this.context.systems.gfx;
    gfx?.deferredRedraw();
  }


  /**
   * Check a candidate feature that touches one or more neighbor tiles.
   * @param  source - the vector tile source
   * @param  cache  - the per-zoom cache
   * @param  dataID - the feature to check
   * @return `true` if anything was merged
   */
  protected _mergeNeighbors(source: VTSource, cache: VTZoomCache, dataID: DataID): boolean {
    const spatial = this.context.systems.spatial!;

    const searches = cache.toMerge.get(dataID) ?? [];
    cache.toMerge.delete(dataID);  // remove from queue

    if (!searches.length) {  // nothing to do?
      return false;
    }

    const d = spatial.getItem<GeoJSONData>(cache.spatialID, dataID);
    if (!d) {   // data is gone?
      return false;
    }

    const type = d.geoms.parts[0]!.type;
    const prophash = d.props.prophash as HashString;

    // Gather candidates for merging - the search should include dataID too
    const candidates = new Map<DataID, GeoJSONData>();
    for (const search of searches) {
      const hits = spatial.getItemsAtBox(cache.spatialID, search);
      for (const hit of hits) {
        const other = hit.contents as GeoJSONData;
        if (other.geoms.parts[0]?.type !== type) continue;  // type doesn't match
        if (other.props.prophash !== prophash) continue;   // prophash doesn't match

        candidates.set(other.id, other);
      }
    }

    if (candidates.size < 2) {
      return false;
    }

    if (type === 'Polygon') {
      return this._mergePolygons(cache, candidates);
    } else if (type === 'LineString') {
      // return = this._stitchLines(cache, group, edgeID);
    }

    return false;
  }



//  /**
//   * Merge candidate features that cross the given tile edge.
//   * Note that we don't do anything until both tiles have been loaded.
//   * @param  source - the vector tile source
//   * @param  cache  - the per-zoom cache
//   * @param  edgeID - the edge to process
//   * @return `true` if anything was merged
//   */
//  protected _mergeAcrossEdgeOLD(source: VTSource, cache: VTZoomCache, edgeID: EdgeID): boolean {
//    const spatial = this.context.systems.spatial!;
//
//    const dataIDs = cache.toMerge.get(edgeID);
//    if (!dataIDs || !dataIDs.size) {
//      cache.toMerge.delete(edgeID);
//      return false;
//    }
//
//    const [lowID, highID] = edgeID.split(':');
//    const lowTile = source.loaded.get(lowID);
//    const highTile = source.loaded.get(highID);
//    if (!lowTile || !highTile) return false;   // do nothing until both tiles are loaded
//
//    // Remove this edge from the queue and increment the merge counter.
//    cache.toMerge.delete(edgeID);
//    const mergeCount = cache.mergeCount.get(edgeID) ?? 0;
//    cache.mergeCount.set(edgeID, mergeCount + 1);
//
//    // Gather merge candidates
//    const polys: GeoJSONData[] = [];
//    const lines: GeoJSONData[] = [];
//    for (const dataID of dataIDs) {
//      const d = spatial.getItem<GeoJSONData>(cache.spatialID, dataID);
//      if (!d) continue;
//      const type = d.geoms.parts[0]?.type;
//      if (type === 'Polygon') {
//        polys.push(d);
//      } else if (type === 'LineString') {
//        lines.push(d);
//      }
//    }
//
//    let didMerge = false;
//    // merge polygons that share the same prophash
//    const polygonGroups = utilArrayGroupBy(polys, (d => d.props.prophash as HashString));
//    for (const candidates of Object.values(polygonGroups)) {
//      if (candidates.length < 2) continue;
//      if (this._mergePolygons(cache, candidates, lowTile, highTile, edgeID)) {
//        didMerge = true;
//      }
//    }
//
//    // stitch lines that share the same prophash
//    const lineGroups = utilArrayGroupBy(lines, (d => d.props.prophash as HashString));
//    for (const group of Object.values(lineGroups)) {
//      if (group.length < 2) continue;
//      if (this._stitchLines(cache, group, edgeID)) {
//        didMerge = true;
//      }
//    }
//
//    return didMerge;
//  }


//  /**
//   * Update any old ids in the merge caches to point to newly merged features.
//   * Remove any pending merges that are no longer needed.
//   * @param  cache     - the per-zoom cache
//   * @param  oldIDs    - ids of the consumed features
//   * @param  newIDs    - ids of the replacement features
//   * @param  exceptID  - optional edge to skip (if we are currently merging that edge, don't add it again)
//   */
//  protected _updateMergeCaches(cache: VTZoomCache, oldIDs: DataID[], newIDs: DataID[], exceptID?: EdgeID): void {
//    for (const [edgeID, set] of cache.toMerge) {
//      let hasOld = false;
//      for (const oldID of oldIDs) {
//        if (set.has(oldID)) {
//          hasOld = true;
//          set.delete(oldID);
//        }
//      }
//      if (hasOld && edgeID !== exceptID) {
//        for (const newID of newIDs) {
//          set.add(newID);
//        }
//      }
//      if (!set.size) {
//        cache.toMerge.delete(edgeID);
//      }
//    }
//  }


  /**
   * Merge polygon features that cross an edge and share the same properties.
   * We'll choose the largest-area source feature as the "survivor".
   * Then union all source coordinates together using `Polyclip.union`.
   * If the merge results in a single merged polygon, the survivor gains that area.
   * If the merge results in multiple new polygons, we replace all old polygons with the new ones.
   * @param   cache    - the per-zoom cache holding the features
   * @param   candidates - source features to merge
   * @param   tileID   - the tile being processed
   * @return  `true` if a merge was performed
   * @throws  Error if the union unexpectedly produces no geometry
   */
  protected _mergePolygons(
    cache: VTZoomCache,
    candidates: Map<DataID, GeoJSONData>
  ): boolean {
    if (candidates.size < 2) return false;  // nothing to do

    const context = this.context;
    const spatial = context.systems.spatial!;

    // Note that we assume the features in here to be single-part 'Polygon' features
    // generated by `_toSingleFeatures()`, with valid extent and coords confirmed
    // by `_considerForMerge()`.
    // We will try to retain the largest feature as the survivor.
    const sourceCoords: Polyclip.Geom[] = [];
    const sourceIDs: DataID[] = [];

    let survivor: GeoJSONData | undefined;
    let maxArea = -Infinity;
    let oldArea = 0;

    for (const d of candidates.values()) {
      const part = d.geoms.parts[0]!;
      const coords = part.orig!.coords as Polyclip.Geom;
      const area = part.world!.area as number;
      sourceCoords.push(coords);
      sourceIDs.push(d.id);
      oldArea += area;

      if (area > maxArea) {
        survivor = d;
        maxArea = area;
      }
    }
    if (!survivor) {
      throw new Error(`Failed to merge: no valid source features`);  // shouldn't happen
    }

    // Union all coordinates together..
    // (We pass 2 args because the TypeScript expects `union(geom, ...moreGeoms)`)
    const mergedCoords = Polyclip.union(sourceCoords[0], ...sourceCoords.slice(1));
    if (!mergedCoords || !mergedCoords.length) {
      throw new Error(`Failed to merge: no output coords`);  // shouldn't happen
    }

    // `Polyclip.union` always returns a MultiPolygon.
    const merged: GeoJSON.Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: mergedCoords
      },
      properties: { ...survivor.properties }   // shallow copy
    };

    // Break the MultiPolygon to single Polygon parts.
    const parts = this._toSingleFeatures(merged)
      .filter(part => {
        const extent = this._calcExtent(part);       // sanity check
        if (!isFinite(extent.min[0])) return false;  // invalid - no coordinates?

        this._dedupePoints(part);  // remove coincident points caused by the union operation

        // It shouldn't have an id at this point, but we will take no chances.
        delete part.id;
        delete part.properties?.id;

        return true;
      });


    let toRemoveIDs: DataID[] = [];
    let toReplace: GeoJSONData[] = [];

    if (parts.length === 0) {
      throw new Error(`Failed to merge: no output parts`);  // shouldn't happen

    } else if (parts.length === 1) {   // a single new part
      // In this case, the merge clearly succeeded.
      // Update survivor in place with the new merged geometry.
      survivor.props.geojson = parts[0];
      survivor.updateGeometry().touch();

      toRemoveIDs = sourceIDs.filter(id => id !== survivor.id);
      toReplace.push(survivor);

    } else {    // multiple new parts
      // In this case, we're not sure whether anything happened.
      // If area has changed or number of parts has changed assume something happened.
      // Otherwise assume we have disjoint parts and leave them alone.
      const newData: GeoJSONData[] = [];
      let newArea = 0;

      for (const part of parts) {
        const props: GeoJSONProps = {
          prophash:    survivor.props.prophash,
          layerID:     survivor.props.layerID,
          origID:      survivor.props.origID,
          serviceID:   this.id,
          datasetID:   survivor.props.datasetID,
          geojson:     part
        };
        const d = new GeoJSONData(context, props);
        newData.push(d);

        const area = d.geoms.parts[0].world!.area as number;
        newArea += area;
      }

      const areaChanged = Math.abs(newArea - oldArea) > 1e-6;
      if (areaChanged || parts.length !== sourceIDs.length) {
        toRemoveIDs = sourceIDs;
        toReplace = newData;
      }
    }

    // Remove old items from spatial caches and the merge queue.
    if (toRemoveIDs.length) {
      spatial.removeItems(cache.spatialID, toRemoveIDs);
      for (const toRemoveID of toRemoveIDs) {
        cache.toMerge.delete(toRemoveID);
      }
    }

    // Add/replace new items.
    if (toReplace.length) {
      spatial.replaceData(cache.spatialID, toReplace);

      // New geometry should re-enter the merge queue so that it has a chance to merge more.
      // We don't have tile bounds here, so we will just test the geomety against its own extent.
      // This has the effect of extending 1px in each direction looking for things to merge to.
      for (const d of toReplace) {
        const extent = d.geoms.world?.extent;
        if (!extent) continue;
        this._considerForMerge(cache, d, extent);
      }
    }

    return toReplace.length > 0;
  }


//  /**
//   * Merge polygon features that cross an edge and share the same properties.
//   * We'll choose the largest-area source feature as the "survivor".
//   * Then union all source coordinates together using `Polyclip.union`.
//   * If the merge results in a single merged polygon, the survivor gains that area.
//   * If the merge results in multiple new polygons, we replace all old polygons with the new ones.
//   * @param   cache    - the per-zoom cache holding the features
//   * @param   features - source features to merge
//   * @param   lowTile  - the low tile
//   * @param   highTile - the high tile
//   * @param   edgeID   - the edge being processed
//   * @return  `true` if a merge was performed
//   * @throws  Error if the union unexpectedly produces no geometry
//   */
//  protected _mergePolygonsOLD(
//    cache: VTZoomCache,
//    features: GeoJSONData[],
//    lowTile:  Tile,
//    highTile: Tile,
//    edgeID: EdgeID
//  ): boolean {
//    if (features.length < 2) return false;  // nothing to do
//
//    const context = this.context;
//    const spatial = context.systems.spatial!;
//
//    // Pre-check: if no pair of features' world bboxes overlaps in area, the features are
//    // geometrically separate and won't union.  They just happen to touch the same tile edge
//    // because of the liberal <=/>= boundary test in `_touchedEdges`.  Features that genuinely
//    // need merging (tile-split pieces that carry buffer overlap) will always have overlapping
//    // bboxes, so this correctly separates the two cases without calling the expensive polyclip.
//    // const bboxes = features.map(d => d.geoms.world!.extent.bbox());
//    // let anyOverlap = false;
//    // for (let i = 0; i < bboxes.length && !anyOverlap; i++) {
//    //   for (let j = i + 1; j < bboxes.length; j++) {
//    //     const a = bboxes[i], b = bboxes[j];
//    //     if (a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY) {
//    //       anyOverlap = true;
//    //       break;
//    //     }
//    //   }
//    // }
//    // if (!anyOverlap) return false;
//
//    // Note that we assume the features in here to be single-part 'Polygon' features
//    // generated by `_toSingleFeatures()`, with valid extent and coords confirmed
//    // by `_considerForMerge()`.
//    // We will try to retain the largest feature as the survivor.
//    const sourceCoords: Polyclip.Geom[] = [];
//    const sourceIDs: DataID[] = [];
//
//    let survivor: GeoJSONData | undefined;
//    let maxArea = -Infinity;
//
//    for (const d of features) {
//      const part = d.geoms.parts[0]!;
//      const coords = part.orig!.coords as Polyclip.Geom;
//      const area = part.world!.area as number;
//      sourceCoords.push(coords);
//      sourceIDs.push(d.id);
//
//      if (area > maxArea) {
//        survivor = d;
//        maxArea = area;
//      }
//    }
//    if (!survivor) {
//      throw new Error(`Failed to merge: no valid source features`);  // shouldn't happen
//    }
//
//    // Union all coordinates together..
//    // (We pass 2 args because the TypeScript expects `union(geom, ...moreGeoms)`)
//    const mergedCoords = Polyclip.union(sourceCoords[0], ...sourceCoords.slice(1));
//    if (!mergedCoords || !mergedCoords.length) {
//      throw new Error(`Failed to merge: no output coords`);  // shouldn't happen
//    }
//
//    // `Polyclip.union` always returns a MultiPolygon.
//    const merged: GeoJSON.Feature = {
//      type: 'Feature',
//      geometry: {
//        type: 'MultiPolygon',
//        coordinates: mergedCoords
//      },
//      properties: { ...survivor.properties }   // shallow copy
//    };
//
//    // Break the MultiPolygon to single Polygon parts.
//    const parts = this._toSingleFeatures(merged)
//      .filter(part => {
//        const extent = this._calcExtent(part);       // sanity check
//        if (!isFinite(extent.min[0])) return false;  // invalid - no coordinates?
//
//        this._dedupePoints(part);  // remove coincident points caused by the union operation
//
//        // It shouldn't have an id at this point, but we will take no chances.
//        delete part.id;
//        delete part.properties?.id;
//
//        return true;
//      });
//
//
//    const toReplace: GeoJSONData[] = [];
//    let newIDs: DataID[] = [];
//    let oldIDs: DataID[];
//
//    if (parts.length === 0) {
//      throw new Error(`Failed to merge: no output parts`);  // shouldn't happen
//
//    } else if (parts.length === 1) {   // a single new part
//      // Update survivor in place with the new merged geometry.
//      survivor.props.geojson = parts[0];
//      survivor.updateGeometry().touch();
//      toReplace.push(survivor);
//      newIDs = [survivor.id];
//      oldIDs = sourceIDs.filter(id => id !== survivor.id);
//
//    } else {    // multiple new parts
//      // Some merges may have happened, we'll just replace all sources
//      oldIDs = sourceIDs;
//      for (const part of parts) {
//        const props: GeoJSONProps = {
//          prophash:   survivor.props.prophash,
//          layerID:    survivor.props.layerID,
//          origID:     survivor.props.origID,
//          serviceID:  this.id,
//          datasetID:  survivor.props.datasetID,
//          geojson:    part
//        };
//        const d = new GeoJSONData(context, props);
//        toReplace.push(d);
//        newIDs.push(d.id);
//      }
//    }
//
//    spatial.removeItems(cache.spatialID, oldIDs);
//    spatial.replaceData(cache.spatialID, toReplace);
//    this._updateMergeCaches(cache, oldIDs, newIDs, edgeID);
//
//    // The new geometry may need to re-enter the merge queue (but not for the current edgeID)
//    for (const d of toReplace) {
//      this._considerForMerge(cache, d, lowTile, edgeID);
//      this._considerForMerge(cache, d, highTile, edgeID);
//    }
//
//    return true;
//  }


//  /**
//   * Stitch a property-hash group of LineStrings: cluster pieces that share a coincident segment,
//   * then rebuild each cluster from its deduplicated segments (trimming tile-buffer stubs).
//   * @param  cache  - the per-zoom cache holding the lines
//   * @param  group  - same-property LineString features
//   * @param  edgeID - the edge being processed (excluded when re-pointing candidacy)
//   * @return `true` if the feature count dropped
//   */
//  protected _stitchLines(cache: VTZoomCache, group: GeoJSONData[], edgeID: EdgeID): boolean {
//    const context = this.context;
//    const spatial = context.systems.spatial!;
//    const SNAP = 1e9;   // ~0.1mm grid; matches identical source vertices across tiles
//
//    const keyOf = (p: number[]): string => `${Math.round(p[0] * SNAP)},${Math.round(p[1] * SNAP)}`;
//    const segKey = (a: string, b: string): string => (a < b ? `${a}\t${b}` : `${b}\t${a}`);
//
//    const coordOf = new Map<string, number[]>();
//    const lineSegs: string[][] = [];          // per line: its segment keys
//    const segCount = new Map<string, number>();
//
//    for (const d of group) {
//      const coords = d.geoms.parts[0]?.orig?.coords as number[][] | undefined;
//      if (!coords || coords.length < 2) { lineSegs.push([]); continue; }
//      const keys = coords.map(p => {
//        const k = keyOf(p);
//        if (!coordOf.has(k)) coordOf.set(k, p);
//        return k;
//      });
//      const segs: string[] = [];
//      for (let i = 0; i < keys.length - 1; i++) {
//        if (keys[i] === keys[i + 1]) continue;   // skip zero-length
//        const s = segKey(keys[i], keys[i + 1]);
//        segs.push(s);
//        segCount.set(s, (segCount.get(s) ?? 0) + 1);
//      }
//      lineSegs.push(segs);
//    }
//
//    // Union-find: connect lines that share a coincident (duplicated) segment.
//    const n = group.length;
//    const parent = Array.from({ length: n }, (_, i) => i);
//    const find = (i: number): number => {
//      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
//      return i;
//    };
//    const segOwner = new Map<string, number>();
//    for (let i = 0; i < n; i++) {
//      for (const s of lineSegs[i]) {
//        if ((segCount.get(s) ?? 0) < 2) continue;   // only shared segments connect pieces
//        const j = segOwner.get(s);
//        if (j === undefined) segOwner.set(s, i);
//        else parent[find(i)] = find(j);
//      }
//    }
//
//    const clusters = new Map<number, number[]>();
//    for (let i = 0; i < n; i++) {
//      const root = find(i);
//      let arr = clusters.get(root);
//      if (!arr) { arr = []; clusters.set(root, arr); }
//      arr.push(i);
//    }
//
//    let didMerge = false;
//    for (const idxs of clusters.values()) {
//      if (idxs.length < 2) continue;
//
//      // Build a deduplicated undirected graph of all segments in the cluster.
//      const adj = new Map<string, Set<string>>();
//      const link = (a: string, b: string): void => {
//        let sa = adj.get(a);
//        if (!sa) { sa = new Set(); adj.set(a, sa); }
//        let sb = adj.get(b);
//        if (!sb) { sb = new Set(); adj.set(b, sb); }
//        sa.add(b);
//        sb.add(a);
//      };
//      const usedSeg = new Set<string>();
//      for (const li of idxs) {
//        for (const s of lineSegs[li]) {
//          if (usedSeg.has(s)) continue;
//          usedSeg.add(s);
//          const [a, b] = s.split('\t');
//          link(a, b);
//        }
//      }
//
//      // Prune tile-buffer stubs: a leaf (degree-1) vertex whose neighbor is a junction (degree>=3).
//      let pruned = true;
//      while (pruned) {
//        pruned = false;
//        for (const [v, nbrs] of adj) {
//          if (nbrs.size !== 1) continue;
//          const u = nbrs.values().next().value as string;
//          if ((adj.get(u)?.size ?? 0) >= 3) {
//            adj.get(u)!.delete(v);
//            adj.delete(v);
//            pruned = true;
//          }
//        }
//      }
//
//      const polylines = this._walkPolylines(adj, coordOf);
//      if (!polylines.length || polylines.length >= idxs.length) continue;   // no real reduction
//
//      // Replace the cluster's lines with the stitched result.
//      const oldIDs = idxs.map(i => group[i].id);
//      spatial.removeItems(cache.spatialID, oldIDs);
//
//      const source = group[idxs[0]];
//      const newFeatures: GeoJSONData[] = [];
//      for (const coords of polylines) {
//        const props: GeoJSONProps = {
//          prophash:   source.props.prophash,
//          layerID:    source.props.layerID,
//          origID:     source.props.origID,
//          datasetID:  source.props,datasetID,
//          serviceID:  this.id,
//          geojson: {
//            type: 'Feature',
//            properties: { ...source.properties },
//            geometry: { type: 'LineString', coordinates: coords }
//          } as GeoJSON.Feature
//        };
//        newFeatures.push(new GeoJSONData(context, props));
//      }
//      if (newFeatures.length) {
//        spatial.replaceData(cache.spatialID, newFeatures);
//        this._updateMergeCaches(cache, oldIDs, newFeatures.map(d => d.id), edgeID);
//        didMerge = true;
//      }
//    }
//    return didMerge;
//  }


  /**
   * Extract maximal polylines from an undirected vertex graph by consuming edges.
   * Junctions split into separate trails; an isolated cycle is walked once.
   * @param  adj     - vertex key -> set of neighbor keys
   * @param  coordOf - vertex key -> [x,y]
   * @return array of coordinate arrays (each a LineString)
   */
  protected _walkPolylines(adj: Map<string, Set<string>>, coordOf: Map<string, number[]>): number[][][] {
    // Work on a mutable copy of the edge sets.
    const edges = new Map<string, Set<string>>();
    for (const [v, nbrs] of adj) edges.set(v, new Set(nbrs));

    const nextStart = (): string | undefined => {
      let any: string | undefined;
      for (const [v, nbrs] of edges) {
        if (nbrs.size === 1) return v;       // prefer a real endpoint
        if (nbrs.size > 0) any = v;
      }
      return any;                            // else any vertex on a cycle
    };

    const result: number[][][] = [];
    let start: string | undefined;
    while ((start = nextStart()) !== undefined) {
      const path = [start];
      let cur = start;
      while (true) {
        const nbrs = edges.get(cur);
        if (!nbrs || nbrs.size === 0) break;
        const next = nbrs.values().next().value as string;
        nbrs.delete(next);
        edges.get(next)?.delete(cur);
        path.push(next);
        cur = next;
      }
      if (path.length >= 2) {
        result.push(path.map(k => coordOf.get(k)!));
      }
    }
    return result;
  }


  /**
   * Computes the geographic extent covering a GeoJSON feature's geometry.
   * @param  geojson - a GeoJSON Feature
   * @return the extent
   */
  protected _calcExtent(geojson: GeoJSON.Feature): Extent {
    const extent = new Extent();
    const geometry = geojson?.geometry;
    if (!geojson || !geometry) return extent;

    const type = geometry.type;
    if (type === 'GeometryCollection') return extent;  // pacify TypeScript

    const coords = geometry.coordinates;

    // Treat single types as multi types to keep the code simple
    const parts = /^Multi/.test(type) ? coords : [coords];

    if (/Polygon$/.test(type)) {
      for (const polygon of parts as Vec2[][][]) {
        const outer = polygon[0];  // No need to iterate over inners
        for (const point of outer) {
          extent.extendSelf(point);
        }
      }
    } else if (/LineString$/.test(type)) {
      for (const line of parts as Vec2[][]) {
        for (const point of line) {
          extent.extendSelf(point);
        }
      }
    } else if (/Point$/.test(type)) {
      for (const point of parts as Vec2[]) {
        extent.extendSelf(point);
      }
    }

    return extent;
  }


  /**
   * The union operation often leaves points which are essentially coincident.
   * This will remove them in-place.
   * @param  geojson - a GeoJSON Polygon Feature
   */
  protected _dedupePoints(geojson: GeoJSON.Feature): void {
    const geometry = geojson?.geometry;
    if (!geojson || !geometry) return;
    if (geometry.type !== 'Polygon') return;

    const EPSILON = 5e-6;
    const coords = geometry.coordinates;

    for (let i = 0; i < coords.length; i++) {
      const ring = coords[i] as Vec2[];
      const cleaned = [];
      let prevPoint = null;
      for (let j = 0; j < ring.length; j++) {
        const point = ring[j];
        if (j === 0 || j === ring.length - 1) {   // leave first/last points alone
          cleaned.push(point);
        } else if (prevPoint && !vecEqual(point, prevPoint, EPSILON)) {
          cleaned.push(point);
        }
        prevPoint = point;
      }
      coords[i] = cleaned;  // replace ring
    }
  }


  /**
   * Call this to convert a multi feature to an array of single features
   * (e.g. convert MultiPolygon to array of Polygons)
   * (If passed a single feature, this will just return the single feature in an array)
   * @param  geojson - any GeoJSON Feature
   * @return array of single GeoJSON Features
   */
  protected _toSingleFeatures(geojson: GeoJSON.Feature): GeoJSON.Feature[] {
    const result: GeoJSON.Feature[] = [];
    const geometry = geojson?.geometry;
    if (!geojson || !geometry) return result;
    if (geometry.type === 'GeometryCollection') return result;  // pacify TypeScript

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
      } as GeoJSON.Feature);
    }
    return result;
  }



  /**
   * Return a tile for the given tileID.
   * @param   tileID - the tileID
   * @return  Tile object
   */
  public getTile(tileID: TileID): Tile {
    // I _think_ we can use the `z` value here normally..
    // When the Tiler is set to make "512px" tiles,
    // it compensates by generating 256px tiles at `z-1`.

    const [x, y, z] = tileID.split(',').map(Number);
    const pow2z = 2 ** z;
    const tileScale = WORLD_SIZE / pow2z;

    // The tile bounds in world coordinates
    const worldMin: Vec2 = [x * tileScale, y * tileScale];
    const worldMax: Vec2 = [(x + 1) * tileScale, (y + 1) * tileScale];
    const worldExtent = new Extent(worldMin, worldMax);

    // back to lon/lat
    const wgs84Min = projWorldToWgs84([worldMin[0], worldMax[1]]);  // bottom left
    const wgs84Max = projWorldToWgs84([worldMax[0], worldMin[1]]);  // top right
    const wgs84Extent = new Extent(wgs84Min, wgs84Max);

    const tile: Tile = {
      id: tileID,
      xyz: [x, y, z],
      wgs84Extent: wgs84Extent,
      worldExtent: worldExtent,
      isVisible: false
    };

    return tile;
  }


}
