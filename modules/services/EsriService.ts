import { AbstractSystem } from '../core/AbstractSystem.ts';
import { Extent, Tiler } from '@rapid-sdk/math';
import { Graph, RapidDataset, Tree } from '../lib/index.ts';
import { OsmNode, OsmRelation, OsmWay } from '../data/index.ts';
import { utilQsString } from '@rapid-sdk/util';

import type { Context } from '../Context.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { OsmNodeProps, OsmRelationProps, OsmWayProps, OsmTags } from '../data/types.ts';
import type { Tile, Vec2 } from '@rapid-sdk/math';


/** ArcGIS group ID for the OpenStreetMap community datasets */
const GROUPID = 'bdf6c800b3ae453b9db239e03d7c1727';
/** Base URL for the ArcGIS REST content API */
const APIROOT = 'https://openstreetmap.maps.arcgis.com/sharing/rest/content';
/** Base URL for the ArcGIS home web UI */
const HOMEROOT = 'https://openstreetmap.maps.arcgis.com/home';
/** Zoom level used by the tiler for fetching Esri data tiles */
const TILEZOOM = 14;


/**
 * Internal cache structure for tracking tile fetching state per dataset.
 */
interface EsriTileCache {
  /** Tiles that have been fully loaded, keyed by tileID */
  loaded: Map<string, Tile>;
  /** Set of feature IDs already parsed, to avoid duplicates across tiles */
  seen: Set<string>;
}

/**
 * Internal structure for a single Esri dataset, including its metadata
 * from ArcGIS, the local Graph/Tree, and tile cache.
 */
interface EsriDatasetEntry {
  /** Unique dataset identifier from ArcGIS */
  id: DatasetID;
  /** Human-readable title of the dataset */
  title: string;
  /** Short description/summary of the dataset */
  snippet: string;
  /** Filename of the dataset's thumbnail image */
  thumbnail: string;
  /** Feature server URL for querying data */
  url: string;
  /** Internal name of the dataset (used in source tags) */
  name: string;
  /** Geographic bounding extent as [min, max] coordinates, or null if not set */
  extent: Vec2[] | null;
  /** ArcGIS group category paths for this dataset */
  groupCategories: string[];
  /** License/attribution information HTML from ArcGIS */
  licenseInfo: string;
  /** Local graph holding the parsed OSM entities for this dataset */
  graph: Graph;
  /** Spatial index tree for efficient extent-based lookups */
  tree: Tree;
  /** Tile fetch state tracking for this dataset */
  cache: EsriTileCache;
  /** Last viewport version number, used to skip redundant tile loads */
  lastv: number | null;
  /** Layer schema info (fields, tagmap) loaded from the feature server */
  layer: EsriLayer | null;
  /** Allow additional ArcGIS metadata fields */
  [key: string]: any;
}

/**
 * Layer schema information from the ArcGIS feature server.
 */
interface EsriLayer {
  /** Numeric layer ID on the feature server */
  id: number;
  /** Array of field metadata describing the layer's schema */
  fields: EsriField[];
  /** Maximum number of records the server returns per request */
  maxRecordCount?: number;
  /** Mapping from Esri field names to OSM tag keys */
  tagmap: Record<string, string>;
  /** Name of the field used as the unique object identifier */
  idfield: string;
  /** Allow additional layer metadata fields */
  [key: string]: any;
}

/**
 * Field metadata from an Esri layer.
 */
interface EsriField {
  /** Internal field name in the Esri layer */
  name: string;
  /** Display alias, used as the OSM tag key */
  alias: string;
  /** Esri field type (e.g. 'esriFieldTypeOID', 'esriFieldTypeString') */
  type: string;
  /** Whether this field is editable; non-editable fields are skipped in the tagmap */
  editable: boolean;
}


/**
 * `EsriService` connects to Esri's ArcGIS API to fetch data about Esri-hosted datasets.
 *
 * @see https://openstreetmap.maps.arcgis.com/home/index.html
 * @see https://developers.arcgis.com/rest/
 */
export class EsriService extends AbstractSystem {

  /** Tiler instance configured for the Esri tile zoom level */
  protected _tiler: Tiler;
  /** Map of all known Esri datasets, keyed by DatasetID */
  protected _datasets: Map<DatasetID, EsriDatasetEntry>;
  /** Cached promise for the initial dataset catalog load, to avoid duplicate fetches */
  protected _datasetsPromise: Promise<Map<DatasetID, EsriDatasetEntry>> | null;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'esri';
    this.requiredDependencies = new Set<SystemID>(['network', 'spatial']);
    this.optionalDependencies = new Set<SystemID>(['gfx', 'locations']);

    this._tiler = new Tiler().zoomRange(TILEZOOM) as Tiler;
    this._datasets = new Map<DatasetID, EsriDatasetEntry>();

    this._datasetsPromise = null;
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = super.initAsync()
      .then(() => this.resetAsync())
      .then(() => this._loadDatasetsAsync())
      .then(() => {});  // discard _loadDatasetsAsync result to return Promise<void>
  }


  /**
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    const network = this.context.systems.network!;

    network.abortMatching(id => /^esri-/.test(id));

    for (const [datasetID, ds] of this._datasets) {
      ds.graph = new Graph(this.context);
      ds.tree = new Tree(ds.graph, datasetID);
      ds.cache = {
        loaded: new Map<TileID, Tile>(),
        seen:   new Set<string>()
      };
      ds.lastv = null;
    }

    return Promise.resolve();
  }


  /**
   * Called by `RapidSystem` to get the datasets that this service provides.
   * @return The datasets this service provides
   */
  public getAvailableDatasets(): RapidDataset[] {
    // Convert the internal dataset objects into "Rapid" datasets for the catalog.
    // We expect them to be all loaded now because `_loadDatasetsAsync` is called by `initAsync`
    //  and `getAvailableDatasets` is called by RapidSystem's `startAsync`.
    return [...this._datasets.values()].map(d => {
      // gather categories
      const categories = new Set<string>(['esri']);
      for (const c of d.groupCategories) {
        categories.add(c.toLowerCase().replace('/categories/', ''));
      }

      const dataset = new RapidDataset(this.context, {
        id: d.id,
        conflated: false,
        serviceID: 'esri',
        categories: categories,
        dataUsed: ['esri', this.getDataUsed(d.title)],
        label: d.title,
        description: d.snippet,
        itemUrl: `${HOMEROOT}/item.html?id=${d.id}`,
        licenseUrl: 'https://wiki.openstreetmap.org/wiki/Esri/ArcGIS_Datasets#License',
        thumbnailUrl: `${APIROOT}/items/${d.id}/info/${d.thumbnail}?w=400`
      });

      if (d.extent) {
        dataset.extent = new Extent(d.extent[0], d.extent[1]);
      }

//      // Test running building layers through MapWithAI conflation service
//      if (categories.has('buildings')) {
//        dataset.conflated = true;
//        dataset.serviceID = 'mapwithai';
//      }

      return dataset;
    });
  }


  /**
   * Get already loaded data that appears in the current map view
   * @param datasetID - datasetID to get data for
   * @return Array of data (OSM Entities)
   */
  public getData(datasetID: DatasetID): OsmEntity[] {
    const ds = this._datasets.get(datasetID);
    if (!ds || !ds.tree || !ds.graph) return [];

    const extent = this.context.viewport.visibleExtent();
    return ds.tree.intersects(extent, ds.graph);
  }


  /**
   * Returns the graph for the given datasetID
   * @param datasetID - datasetID to get data for
   * @return The graph holding the data, or `undefined` if not found
   */
  public graph(datasetID: DatasetID): Graph | undefined {
    const ds = this._datasets.get(datasetID);
    return ds?.graph;
  }


  /**
   * This returns the string to use for the changeset `data_used` tag.
   * For Rapid#1309 we need to change the "data used" string from
   * 'Google Buildings for <Country>' to 'Google Open Buildings'.
   * All other titles are returned unmodified.
   * @param title - the title to consider
   * @return The same title in most cases, or the proper google buildings title if applicable.
   */
  public getDataUsed(title: string): string {
    if (title.startsWith('Google Buildings for')) {
      return 'Google Open Buildings';
    } else {
      return title;
    }
  }


  /**
   * Schedule any data requests needed to cover the current map view
   * @param datasetID - datasetID to load tiles for
   * @throws Will throw if the datasetID is not found
   */
  public loadTiles(datasetID: DatasetID): void {
    if (this._paused) return;

    const ds = this._datasets.get(datasetID);
    if (!ds)  {
      throw new Error(`Unknown datasetID: ${datasetID}`);
    }

    // If we haven't loaded this dataset's schema information, do that first, then retry.
    if (!ds.layer) {
      this._loadDatasetLayerAsync(ds)
        .then(() => this.loadTiles(datasetID));
      return;
    }

    const cache = ds.cache;
    const context = this.context;
    const network = context.systems.network!;
    const locations = context.systems.locations;
    const viewport = context.viewport;

    if (ds.lastv === viewport.v) return;  // exit early if the view is unchanged
    ds.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    const neededIDs = new Set<RequestID>(tiles.map(tile => `esri-${ds.id}-${tile.id}`));
    network.abortMatching(id => /^esri-/.test(id) && !neededIDs.has(id));

    for (const tile of tiles) {
      const tileID = tile.id;
      const requestID = `esri-${ds.id}-${tileID}` as RequestID;
      if (cache.loaded.has(tileID) || network.isInflight(requestID)) continue;

      if (locations) {
        // Skip if this tile covers a blocked region (all corners are blocked)
        const corners = tile.wgs84Extent.polygon().slice(0, 4);
        const isBlocked = corners.every(loc => locations.isBlockedAt(loc));
        if (isBlocked) {
          cache.loaded.set(tileID, tile);  // don't try again
          continue;
        }
      }

      this._loadTilePage(ds, tile, 0);
    }
  }


  /**
   * Loads all the available datasets from the Esri server
   * @return Promise resolved when all pages of datasets have been loaded
   */
  protected _loadDatasetsAsync(): Promise<Map<DatasetID, EsriDatasetEntry>> {
    if (this._datasetsPromise) return this._datasetsPromise;

    const network = this.context.systems.network!;
    return this._datasetsPromise = new Promise((resolve, reject) => {
      // recursively fetch all pages of data
      const fetchMore = (page: number): void => {
        network.fetch<any>(this._searchURL(page))
          .then(json => {
            for (const ds of json.results ?? []) {
              this._parseDataset(ds);
            }

            if (json.nextStart > 0) {
              fetchMore(json.nextStart);  // fetch next page
            } else {
              resolve(this._datasets);
            }
          })
          .catch(e => {
            reject(e);
          });
      };

      fetchMore(1);
    });
  }


  /**
   * Add this dataset to the list of available datasets
   * @param ds - the dataset metadata from ArcGIS
   */
  protected _parseDataset(ds: any): void {
    if (this._datasets.has(ds.id)) return;  // unless we've seen it already

    this._datasets.set(ds.id, ds);
    ds.graph = new Graph(this.context);
    ds.tree = new Tree(ds.graph, ds.id);
    ds.cache = {
      loaded: new Map<TileID, Tile>(),
      seen:   new Set<string>()
    };
    ds.lastv = null;
    ds.layer = null;   // the schema info will live here

    // Experiment: cleanup the `licenseInfo` field by removing styles. (not used currently)
    // We had considered showing these to the user, but they could instead click "more info"
    // and see all of this information and more on the ArcGIS page.
    //  const license = select(document.createElement('div'));
    //  license.html(ds.licenseInfo);       // set innerHtml
    //  license.selectAll('*')
    //    .attr('style', null)
    //    .attr('size', null);
    //  ds.license_html = license.html();   // get innerHtml
  }


  /**
   * Each dataset has a schema (aka "tagmap") which is available behind the "layerUrl".
   * Before we can use the dataset we need to load this information.
   * @param ds - the dataset to load the schema information
   * @return Promise resolved with the layer data when the dataset schema has been loaded
   */
  protected _loadDatasetLayerAsync(ds: EsriDatasetEntry): Promise<EsriLayer | void> {
    if (!ds || !ds.url) {
      return Promise.reject(`No dataset`);
    } else if (ds.layer) {    // done already
      return Promise.resolve(ds.layer);
    }

    const network = this.context.systems.network!;
    return network.fetch<any>(this._layerURL(ds.url))
      .then(json => {
        if (!json.layers || !json.layers.length) {
          throw new Error(`Missing layer info for datasetID: ${ds.id}`);
        }

        const layer: EsriLayer = json.layers[0];  // should return a single layer
        ds.layer = layer;

        // Use the field metadata to map to OSM tags
        const tagmap: Record<string, string> = {};
        for (const f of layer.fields) {
          if (f.type === 'esriFieldTypeOID') {  // this is an id field, remember it
            layer.idfield = f.name;
          }
          if (!f.editable) continue;   // 1. keep "editable" fields only
          tagmap[f.name] = f.alias;    // 2. field `name` -> OSM tag (stored in `alias`)
        }
        layer.tagmap = tagmap;
        return layer;
      })
      .catch(e => {
        if (e.name === 'AbortError') return;
        console.error(e);  // eslint-disable-line
      });
  }


  /**
   * Returns the URL used to search ArcGIS for datasets.
   * @see https://developers.arcgis.com/rest/users-groups-and-items/search.htm
   * @param start - the starting page
   * @return the url to fetch the datasets
   */
  protected _searchURL(start: number): string {
    const params = {
      f: 'json',
      sortField: 'title',
      sortOrder: 'asc',
      num: 100,
      start: start
    };
    return `${APIROOT}/groups/${GROUPID}/search?` + utilQsString(params, false);
    // use to get
    // .results[]
    //   .extent
    //   .id
    //   .thumbnail
    //   .title
    //   .snippet
    //   .url (featureServer)
  }

  /**
   * Returns the URL used to get available layers from a ArcGIS feature server.
   * @param featureServerURL - The feature server URL
   * @return The url to fetch the layers
   */
  protected _layerURL(featureServerURL: string): string {
    return `${featureServerURL}/layers?f=json`;
    // should return single layer(?)
    // .layers[0]
    //   .copyrightText
    //   .fields
    //   .geometryType   "esriGeometryPoint" or "esriGeometryPolygon" ?
  }

  /**
   * Returns the URL used to get available data on a given dataset and tile.
   * @param ds - the dataset to fetch data for
   * @param tile - the tile to fetch the data for
   * @param page - what page of data to fetch (zero-based)
   * @return The url to fetch the data
   */
  protected _tileURL(ds: EsriDatasetEntry, tile: Tile, page: number = 0): string {
    const layerID = ds.layer!.id;
    const maxRecordCount = ds.layer!.maxRecordCount || 2000;
    const extent = tile.wgs84Extent;
    const resultOffset = maxRecordCount * page;

    const params = {
      f: 'geojson',
      outfields: '*',
      outSR: 4326,
      geometryType: 'esriGeometryEnvelope',
      geometry: extent.toParam(),
      resultOffset: resultOffset,
      resultRecordCount: maxRecordCount
    };
    return `${ds.url}/${layerID}/query?` + utilQsString(params, false);
  }


  /**
   * Get available data for a given dataset from its feature server
   * @param ds - the dataset to fetch data for
   * @param tile - the tile to fetch the data for
   * @param page - what page of data to fetch (zero-based)
   */
  protected _loadTilePage(ds: EsriDatasetEntry, tile: Tile, page: number): void {
    const cache = ds.cache;
    const tileID = tile.id;
    if (cache.loaded.has(tileID)) return;

    const network = this.context.systems.network!;
    const requestID = `esri-${ds.id}-${tileID}` as RequestID;
    const url = this._tileURL(ds, tile, page);

    network.fetch<any>(url, { requestID })
      .then(geojson => {
        if (!geojson) throw new Error('no geojson');

        this._parseTile(ds, tile, geojson, (err, results) => {
          if (err) throw new Error(err);
          if (results) {
            ds.graph.rebase(results);
            ds.tree.rebase(results);
          }
        });
        return geojson.properties?.exceededTransferLimit;
      })
      .then(hasMorePages => {
        if (hasMorePages) {
          // Assumption: It's unusual to see multiple pages per z14 tile,
          // (2000 features/page) so the recursion here should be ok.
          this._loadTilePage(ds, tile, ++page);

        } else {
          // Only consider it loaded when all pages are loaded.
          cache.loaded.set(tileID, tile);

          const gfx = this.context.systems.gfx;
          gfx?.deferredRedraw();
        }
      })
      .catch(e => {
        if (e.name === 'AbortError') return;
        console.error(e);  // eslint-disable-line
      });
  }


  /**
   * Parse the results from a tiled data fetch.
   * @param ds - the dataset we fetched
   * @param tile - the tile we fetched
   * @param geojson - the result GeoJSON data
   * @param callback - errback-style callback function to call with results
   */
  protected _parseTile(ds: EsriDatasetEntry, tile: Tile, geojson: GeoJSON.FeatureCollection, callback: (err: any, results?: OsmEntity[]) => void): void {
    if (!geojson) return callback({ message: 'No GeoJSON', status: -1 });

    // Expect a FeatureCollection with `features` array
    const results: OsmEntity[] = [];
    for (const f of geojson.features ?? []) {
      const entities = this._parseFeature(ds, f);
      if (entities) {
        results.push(...entities);
      }
    }

    callback(null, results);
  }


  /**
   * Parse a single GeoJSON feature
   * @param ds - the dataset we fetched
   * @param feature - the GeoJSON feature that we fetched
   * @return An array of OSMEntities for that feature, or `null` if we skipped it
   */
  protected _parseFeature(ds: EsriDatasetEntry, feature: GeoJSON.Feature): OsmEntity[] | null {
    const context = this.context;
    const geom = feature.geometry;
    const properties = feature.properties;
    if (!geom || !properties) return null;

    const featureID = properties[ds.layer!.idfield] || properties.OBJECTID || properties.FID || properties.id;
    if (!featureID) return null;

    // skip if we've seen this feature already on another tile
    if (ds.cache.seen.has(featureID)) return null;
    ds.cache.seen.add(featureID);

    const id = `${ds.id}-${featureID}`;
    const metadata = { __fbid__: id, __service__: 'esri', __datasetid__: ds.id };
    const entities: OsmEntity[] = [];
    const nodemap = new Map<string, OsmNode>();

    // Point:  make a single node
    if (geom.type === 'Point') {
      const props = Object.assign({ loc: geom.coordinates as Vec2, tags: parseTags(properties) }, metadata) as OsmNodeProps;
      return [ new OsmNode(context, props) ];

    // LineString:  make nodes, single way
    } else if (geom.type === 'LineString') {
      const nodelist = parseCoordinates(geom.coordinates);
      if (nodelist.length < 2) return null;

      const props = Object.assign({ nodes: nodelist, tags: parseTags(properties) }, metadata) as OsmWayProps;
      const w = new OsmWay(context, props);
      entities.push(w);
      return entities;

    // Polygon:  make nodes, way(s), possibly a relation
    } else if (geom.type === 'Polygon') {
      const ways: OsmWay[] = [];
      for (const ring of geom.coordinates ?? []) {
        const nodelist = parseCoordinates(ring);
        if (nodelist.length < 3) continue;

        const first = nodelist.at(0)!;
        const last = nodelist.at(-1)!;
        if (first !== last) nodelist.push(first);   // sanity check, ensure rings are closed

        const w = new OsmWay(context, { nodes: nodelist });
        ways.push(w);
      }

      if (ways.length === 1) {  // single ring, assign tags and return
        const w = ways[0];
        Object.assign(w.props, { tags: parseTags(properties) }, metadata);
        entities.push(w);
      } else {  // multiple rings, make a multipolygon relation with inner/outer members
        const members = ways.map((w, i) => {
          entities.push(w);
          return {
            id: w.id,
            role: (i === 0 ? 'outer' : 'inner'),
            type: 'way'
          };
        });
        const tags = Object.assign(parseTags(properties), { type: 'multipolygon' }) as OsmTags;
        const props = Object.assign({ members: members, tags: tags }, metadata) as OsmRelationProps;
        const r = new OsmRelation(context, props);
        entities.push(r);
      }

      return entities;
    }

    return null;

    // no Multitypes for now (maybe not needed)
    /**
     *
     * @param coords
     */
    function parseCoordinates(coords: number[][]): EntityID[] {
      const nodelist: EntityID[] = [];
      for (const coord of coords) {
        const key = coord.toString();
        let n = nodemap.get(key);
        if (!n) {
          n = new OsmNode(context, { loc: coord as Vec2 });
          entities.push(n);
          nodemap.set(key, n);
        }
        nodelist.push(n.id);
      }
      return nodelist;
    }

    /**
     *
     * @param properties
     */
    function parseTags(properties: Record<string, any>): OsmTags {
      const tags: Record<string, string> = {};
      for (const prop of Object.keys(properties)) {
        const k = clean(ds.layer!.tagmap[prop]);
        const v = clean(properties[prop]);
        if (k && v) {
          tags[k] = v;
        }
      }

      // Since ESRI had to split the massive google open buildings dataset into multiple countries,
      // They asked us to aggregate them all under the same 'Google Open Buildings' dataset - Rapid#1300
      let name = `${ds.name}`;
      if (name.startsWith('Google_Buildings_for')) {
        name = 'Google_Open_Buildings';
      }

      tags.source = `esri/${name}`;
      return tags;
    }

    /**
     *
     * @param val
     */
    function clean(val: any): string | null {
      return val ? val.toString().trim() : null;
    }
  }

}
