import { AbstractSystem } from '../core/AbstractSystem.ts';
import { Extent, Tiler } from '@rapid-sdk/math';
import { Graph, RapidDataset } from '../lib/index.ts';
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
 * Internal cache structure for tracking seen data and loaded pages
 */
interface EsriDataCache {
  /** Set of feature IDs already parsed, to avoid duplicates across tiles */
  seenIDs: Set<string>;
  /** Next page of data to load for a given tile */
  nextPage: Map<TileID, number>;
}

/**
 * Internal structure for a single Esri dataset, including its metadata
 * from ArcGIS, the local Graph, and tile cache.
 */
interface EsriDataset {
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
  /** Last viewport version number, used to skip redundant tile loads */
  lastv: number | null;
  /** Layer schema info (fields, tagmap) loaded from the feature server */
  layers: EsriLayer[] | null;
  /** Inflight promise for loading layer schema info */
  _layersPromise: Promise<void> | null;
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
  maxRecordCount: number;
  /** Name of the field that holds a display value */
  displayField: string;
  /** Name of the field holds the object identifier */
  objectIdField: string;
  /** Our internal mapping from Esri field names to OSM tag keys */
  _tagmap: Record<string, string>;
  /** Our internal cache of state for this layer */
  _cache: EsriDataCache;
}

/**
 * Field data from an Esri layer `fields` property.
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
  protected _datasets: Map<DatasetID, EsriDataset>;
  /** Cached promise for the initial dataset catalog load, to avoid duplicate fetches */
  protected _datasetsPromise: Promise<Map<DatasetID, EsriDataset>> | null;


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
    this._datasets = new Map<DatasetID, EsriDataset>();
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
    const spatial = this.context.systems.spatial!;

    network.clearMatching(id => id.startsWith('esri-'));
    spatial.clearMatching(id => id.startsWith('esri-'));

    for (const ds of this._datasets.values()) {
      ds.graph = new Graph(this.context);
      ds.lastv = null;

      // clear layer caches
      for (const layer of ds.layers || []) {
        const cache = layer._cache;
        cache.seenIDs.clear();
        cache.nextPage.clear();
      }
    }

    return Promise.resolve();
  }


  /**
   * Called by `RapidSystem` to get the datasets that this service provides.
   * @return The datasets this service provides
   */
  public getAvailableDatasets(): RapidDataset[] {
    // Convert the internal `EsriDataset` objects into `RapidDataset`s for the catalog.
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

//      // experiment: process building layers through MapWithAI conflation service
//      if (categories.has('buildings')) {
//        dataset.conflated = true;
//        dataset.serviceID = 'mapwithai';
//      }

      return dataset;
    });
  }


  /**
   * Get already loaded data that appears in the current map view.
   * @param datasetID - datasetID to get data for
   * @return Array of data (OSM Entities)
   */
  public getData(datasetID: DatasetID): OsmEntity[] {
    const ds = this._datasets.get(datasetID);
    if (!ds) return [];

    const spatial = this.context.systems.spatial!;
    const spatialID = `esri-${ds.id}-data`;
    return spatial.getVisibleItems(spatialID).map(hit => hit.contents as OsmEntity);
 }


  /**
   * Returns the graph for the given datasetID.
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
   * Schedule any data requests needed to cover the current map view.
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
    if (!Array.isArray(ds.layers)) {
      this._loadDatasetLayersAsync(ds)
        .then(() => {
          if (Array.isArray(ds.layers)) {
            this.loadTiles(datasetID);
          }
        })
        .catch(e => {
          if (e.name === 'AbortError') return;
          console.error(e);  // eslint-disable-line
        });
      return;
    }

    const context = this.context;
    const network = context.systems.network!;
    const viewport = context.viewport;

    if (ds.lastv === viewport.v) return;  // exit early if the view is unchanged
    ds.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.getTiles(viewport).tiles;

    // Process each dataset layer..
    for (const layer of ds.layers) {
      // Abort inflight requests that are no longer needed..
      const prefix = `esri-${ds.id}-${layer.id}-tile`;
      const neededIDs = new Set<RequestID>(tiles.map(tile => `${prefix}-${tile.id}`));
      network.abortMatching(id => {
        const key = id.slice(0, id.lastIndexOf(','));  // requestID without page number
        return key.startsWith(prefix) && !neededIDs.has(key);
      });

      for (const tile of tiles) {
        this._loadTileNextPage(ds, layer, tile);
      }
    }
  }


  /**
   * Get available data for a given dataset, layer, and tile.
   * Data is fetched in pages, and fetches will continue recursively if needed, until
   * all pages have been fetched. (We assume that the number of pages is reasonable).
   * @param ds - the dataset to fetch data for
   * @param layer - the layer within the dataset to fetch data for
   * @param tile - the tile to fetch the data for
   */
  protected _loadTileNextPage(ds: EsriDataset, layer: EsriLayer, tile: Tile): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const locations = context.systems.locations;
    const network = context.systems.network!;

    const cache = layer._cache;
    const page = cache.nextPage.get(tile.id) ?? 0;
    if (page === Infinity) return;  // no more pages

    const prefix = `esri-${ds.id}-${layer.id}-tile`;
    const requestID = `${prefix}-${tile.id},${page}`;
    if (network.isCompleted(requestID) || network.isInflight(requestID)) return;

    if (locations) {
      // Skip if this tile covers a blocked region (all corners are blocked)
      const corners = tile.wgs84Extent.polygon().slice(0, 4);
      const isBlocked = corners.every(loc => locations.isBlockedAt(loc));
      if (isBlocked) {
        network.markCompleted(requestID);  // don't try again (blocked region)
        return;
      }
    }

    const url = this._tileURL(ds, layer, tile, page);
    network.fetch<any>(url, { requestID })
      .then(geojson => {
        if (!geojson) throw new Error('no geojson');

        this._gotTile(ds, layer, geojson);

        // Recursively fetch more pages of data, if needed (assumption: it's a small number)
        const hasMorePages = geojson.properties?.exceededTransferLimit;
        if (hasMorePages) {
          cache.nextPage.set(tile.id, page + 1);
          this._loadTileNextPage(ds, layer, tile);
        } else {  // all pages loaded
          cache.nextPage.set(tile.id, Infinity);
          gfx?.deferredRedraw();
        }
      })
      .catch(e => {
        if (e.name === 'AbortError') return;   // ok
        console.error(e);  // eslint-disable-line
      });
  }


  /**
   * Process the results of a fetched tile.
   * @param ds - the dataset we fetched
   * @param layer - the layer within the dataset we fetched
   * @param geojson - a GeoJSON.FeatureCollection containing the data for this tile
   */
  protected _gotTile(ds: EsriDataset, layer: EsriLayer, geojson: GeoJSON.FeatureCollection): void {
    const spatial = this.context.systems.spatial!;
    const spatialID = `esri-${ds.id}-data`;

    const results: OsmEntity[] = [];
    for (const feature of geojson.features ?? []) {
      const entities = this._parseFeature(ds, layer, feature);
      if (entities) {
        results.push(...entities);
      }
    }

    if (results.length) {
      ds.graph.rebase(results);   // important: `graph.rebase` will call `.updateGeometry()`
      spatial.addData(spatialID, results);
    }
  }


  /**
   * Parse a single GeoJSON feature.
   * @param ds - the dataset we fetched
   * @param layer - the layer within the dataset we fetched
   * @param feature - the GeoJSON feature that we fetched
   * @return An array of OSMEntities for that feature, or `null` if we skipped it
   */
  protected _parseFeature( ds: EsriDataset, layer: EsriLayer, feature: GeoJSON.Feature): OsmEntity[] | null {
    const context = this.context;
    const geom = feature.geometry;
    const properties = feature.properties ?? {};
    if (!geom) return null;

    // Try to determine an identifier for the feature
    const datasetID = ds.id;
    const layerID = layer.id;
    const featureID = properties[layer.objectIdField] ?? properties.OBJECTID ?? properties.FID ?? properties.id;
    if (featureID === null || featureID === undefined) return null;
    const featureIDString = String(featureID);

    // Skip if we've seen this feature already on another tile
    const cache = layer._cache;
    if (cache.seenIDs.has(featureIDString)) return null;
    cache.seenIDs.add(featureIDString);

    const dataID = `esri-${datasetID}-${layerID}-${featureIDString}`;
    const metadata = { __fbid__: dataID, __service__: 'esri', __datasetid__: datasetID };
    const entities: OsmEntity[] = [];
    const nodemap = new Map<string, OsmNode>();

    // NOTE:  No Multitypes for now (maybe not needed)

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


    /**
     * Parse GeoJSON coordinate data into OSM Nodes.
     * Accepts a LineString coordinates or single Polygon coordinate ring
     * @param coords
     */
    function parseCoordinates(coords: GeoJSON.Position[]): EntityID[] {
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
     * Convert the properties into OSM tags.
     * Only keys present in the `_tagmap` will be accepted as OSM tags.
     * @param properties
     */
    function parseTags(properties: GeoJSON.GeoJsonProperties): OsmTags {
      properties ??= {};
      const tags: Record<string, string> = {};
      for (const [k, v] of Object.entries(properties)) {
        const tagk = clean(layer._tagmap[k]);
        const tagv = clean(v);
        if (tagk && tagv) {
          tags[tagk] = tagv;
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
     * Coerce values into strings and trim whitespace
     * @param val
     */
    function clean(val: any): string | null {
      return val ? val.toString().trim() : null;
    }
  }


  /**
   * Loads all the available datasets from the Esri server.
   * This is called by `initAsync`.
   * @return Promise resolved when all pages of datasets have been loaded
   */
  protected _loadDatasetsAsync(): Promise<Map<DatasetID, EsriDataset>> {
    if (this._datasetsPromise) return this._datasetsPromise;

    const network = this.context.systems.network!;
    return this._datasetsPromise = new Promise((resolve, reject) => {
      // recursively fetch all pages of data (assumption: it's a small number, maybe 2?)
      const fetchMore = (page: number): void => {
        network.fetch<any>(this._searchURL(page))
          .then(json => {
            for (const ds of json.results ?? []) {
              this._prepareDataset(ds);
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
  protected _prepareDataset(ds: EsriDataset): void {
    if (this._datasets.has(ds.id)) return;  // we've seen it already

    this._datasets.set(ds.id, ds);
    ds.graph = new Graph(this.context);
    ds.lastv = null;
    ds.layers = null;   // the schema info will live here
    ds._layersPromise = null;

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
   * Each dataset will make its data available in one or more layers.
   * The layer contains the data dictionary (in `fields`) and various other useful metadata.
   * Before we can use the dataset we need to load this information.
   * @param ds - the dataset to load the schema information
   * @return Promise resolved when the layer data has been loaded
   */
  protected _loadDatasetLayersAsync(ds: EsriDataset): Promise<void> {
    if (!ds || !ds.url) {
      return Promise.reject(`No dataset`);

    } else if (Array.isArray(ds.layers)) {  // done already
      return Promise.resolve();

    } else if (ds._layersPromise) {
      return ds._layersPromise;

    } else {
      const network = this.context.systems.network!;
      ds._layersPromise = network.fetch<any>(this._layersURL(ds.url))
        .then(json => {
          if (!json.layers || !json.layers.length) {
            throw new Error(`Missing layer info for datasetID: ${ds.id}`);
          }

          ds.layers = json.layers;

          // For each layer, setup:
          for (const layer of json.layers as EsriLayer[]) {
            // `_tagmap`: mapping of Esri field -> OSM Tag.
            const tagmap: Record<string, string> = {};
            for (const f of layer.fields) {
              if (!f.editable) continue;   // 1. keep "editable" fields only
              tagmap[f.name] = f.alias;    // 2. field `name` -> OSM tag (stored in `alias`)
            }
            layer._tagmap = tagmap;

            // `_cache`: cache of seen data and loaded pages
            layer._cache = {
              seenIDs: new Set<string>(),
              nextPage: new Map<TileID, number>()
            };
          }
        })
        .finally(() => {
          ds._layersPromise = null;
        });

      return ds._layersPromise;
    }
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
  }


  /**
   * Returns the URL used to get available layers from a ArcGIS feature server.
   * @param featureServerURL - The feature server URL
   * @return The url to fetch the layers
   */
  protected _layersURL(featureServerURL: string): string {
    return `${featureServerURL}/layers?f=json`;
  }


  /**
   * Returns the URL used to get available data for a given dataset, layer, and tile.
   * @param ds - the dataset to fetch data for
   * @param layer - the layer within the dataset to fetch data for
   * @param tile - the tile to fetch the data for
   * @param page - what page of data to fetch (zero-based)
   * @return The url to fetch the data
   */
  protected _tileURL(ds: EsriDataset, layer: EsriLayer, tile: Tile, page: number = 0): string {
    const maxRecordCount = layer.maxRecordCount || 2000;
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
    return `${ds.url}/${layer.id}/query?` + utilQsString(params, false);
  }

}
