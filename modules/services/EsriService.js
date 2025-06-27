import { select } from 'd3-selection';
import { Extent, Tiler } from '@rapid-sdk/math';
import { utilQsString } from '@rapid-sdk/util';

import { AbstractSystem } from '../core/AbstractSystem.js';
import { Graph, Tree, RapidDataset } from '../core/lib/index.js';
import { OsmNode, OsmRelation, OsmWay } from '../models/index.js';
import { utilFetchResponse } from '../util/index.js';


const GROUPID = 'bdf6c800b3ae453b9db239e03d7c1727';
const APIROOT = 'https://openstreetmap.maps.arcgis.com/sharing/rest/content';
const HOMEROOT = 'https://openstreetmap.maps.arcgis.com/home';
const TILEZOOM = 14;


/**
 * `EsriService`
 * This service connects to Esri's ArcGIS API to fetch data about Esri-hosted datasets.
 *
 * @see https://openstreetmap.maps.arcgis.com/home/index.html
 * @see https://developers.arcgis.com/rest/
 *
 * Events available:
 *   `loadedData`
 */
export class EsriService extends AbstractSystem {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'esri';
    this.context = context;

    this._tiler = new Tiler().zoomRange(TILEZOOM);
    this._datasets = {};

    this._initPromise = null;
    this._datasetsPromise = null;
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  {Promise}  Promise resolved when this component has completed initialization
   */
  initAsync() {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = this.resetAsync()
      .then(() => this._loadDatasetsAsync());
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return  {Promise}  Promise resolved when this component has completed startup
   */
  startAsync() {
    this._started = true;
    return Promise.resolve();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  {Promise}  Promise resolved when this component has completed resetting
   */
  resetAsync() {
    for (const ds of Object.values(this._datasets)) {
      for (const controller of ds.cache.inflight.values()) {
        controller.abort();
      }

      ds.graph = new Graph();
      ds.tree = new Tree(ds.graph);
      ds.cache = {
        inflight:  new Map(),   // Map<tileID, AbortController>
        loaded:    new Map(),   // Map<tileID, Tile>
        seen:      new Set()    // Set<featureID>
      };
      ds.lastv = null;
    }

    return Promise.resolve();
  }


  /**
   * getAvailableDatasets
   * Called by `RapidSystem` to get the datasets that this service provides.
   * @return  {Array<RapidDataset>}  The datasets this service provides
   */
  getAvailableDatasets() {
    // Convert the internal datasets into "Rapid" datasets for the catalog.
    // We expect them to be all loaded now because `_loadDatasetsAsync` is called by `initAsync`
    //  and `getAvailableDatasets` is called by RapidSystem's `startAsync`.
    return Object.values(this._datasets).map(d => {
      // gather categories
      const categories = new Set(['esri']);
      for (const c of d.groupCategories) {
        categories.add(c.toLowerCase().replace('/categories/', ''));
      }

      const dataset = new RapidDataset(this.context, {
        id: d.id,
        conflated: false,
        service: 'esri',
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

      // Test running building layers through MapWithAI conflation service
      if (categories.has('buildings')) {
        dataset.conflated = true;
        dataset.service = 'mapwithai';
      }

      return dataset;
    });
  }


  /**
   * getData
   * Get already loaded data that appears in the current map view
   * @param   {string}  datasetID - datasetID to get data for
   * @return  {Array}   Array of data (OSM Entities)
   */
  getData(datasetID) {
    const ds = this._datasets[datasetID];
    if (!ds || !ds.tree || !ds.graph) return [];

    const extent = this.context.viewport.visibleExtent();
    return ds.tree.intersects(extent, ds.graph);
  }


  /**
   * graph
   * Returns the graph for the given datasetID
   * @param   {string}  datasetID - datasetID to get data for
   * @return  {Graph?}  The graph holding the data, or `undefined` if not found
   */
  graph(datasetID)  {
    const ds = this._datasets[datasetID];
    return ds?.graph;
  }


  /**
   * getDataUsed
   * This returns the string to use for the changeset `data_used` tag.
   * For Rapid#1309 we need to change the "data used" string from
   * 'Google Buildings for <Country>' to 'Google Open Buildings'.
   * All other titles are returned unmodified.
   * @param   {string}  title - the title to consider
   * @return  {string}  The same title in most cases, or the proper google buildings title if applicable.
   */
  getDataUsed(title) {
    if (title.startsWith('Google Buildings for')) {
      return 'Google Open Buildings';
    } else {
      return title;
    }
  }


  /**
   * loadTiles
   * Schedule any data requests needed to cover the current map view
   * @param   {string}  datasetID - datasetID to load tiles for
   * @throws  Will throw if the datasetID is not found
   */
  loadTiles(datasetID) {
    if (this._paused) return;

    const ds = this._datasets[datasetID];
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
    const locations = this.context.systems.locations;

    const viewport = this.context.viewport;
    if (ds.lastv === viewport.v) return;  // exit early if the view is unchanged
    ds.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    for (const [tileID, controller] of cache.inflight) {
      const isNeeded = tiles.some(tile => tile.id === tileID);
      if (!isNeeded) {
        controller.abort();
        cache.inflight.delete(tileID);
      }
    }

    for (const tile of tiles) {
      const tileID = tile.id;
      if (cache.loaded.has(tileID) || cache.inflight.has(tileID)) continue;

      // Exit if this tile covers a blocked region (all corners are blocked)
      const corners = tile.wgs84Extent.polygon().slice(0, 4);
      const isBlocked = corners.every(loc => locations.isBlockedAt(loc));
      if (isBlocked) {
        cache.loaded.set(tileID, tile);  // don't try again
        continue;
      }

      this._loadTilePage(ds, tile, 0);
    }
  }


  /**
   * _loadDatasetsAsync
   * Loads all the available datasets from the Esri server
   * @return  {Promise}  Promise resolved when all pages of data have been loaded
   */
  _loadDatasetsAsync() {
    if (this._datasetsPromise) return this._datasetsPromise;

    return this._datasetsPromise = new Promise((resolve, reject) => {
      // recursively fetch all pages of data
      const fetchMore = (page) => {
        fetch(this._searchURL(page))
          .then(utilFetchResponse)
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
   * _parseDataset
   * Add this dataset to the list of available datasets
   * @param  {Object}  ds - the dataset metadata
   */
  _parseDataset(ds) {
    if (this._datasets[ds.id]) return;  // unless we've seen it already

    this._datasets[ds.id] = ds;
    ds.graph = new Graph();
    ds.tree = new Tree(ds.graph);
    ds.cache = {
      inflight:  new Map(),   // Map<tileID, AbortController>
      loaded:    new Map(),   // Map<tileID, Tile>
      seen:      new Set()    // Set<featureID>
    };
    ds.lastv = null;
    ds.layer = null;   // the schema info will live here

    // Cleanup the `licenseInfo` field by removing styles  (not used currently)
    const license = select(document.createElement('div'));
    license.html(ds.licenseInfo);       // set innerHtml
    license.selectAll('*')
      .attr('style', null)
      .attr('size', null);
    ds.license_html = license.html();   // get innerHtml
  }


  /**
   * _loadDatasetLayerAsync
   * Each dataset has a schema (aka "tagmap") which is available behind the "layerUrl".
   * Before we can use the dataset we need to load this information.
   * @param   {Object}   ds - the dataset to load the schema informarion
   * @return  {Promise}  Promise resolved with the layer data when the dataset schema has been loaded
   */
  _loadDatasetLayerAsync(ds) {
    if (!ds || !ds.url) {
      return Promise.reject(`No dataset`);
    } else if (ds.layer) {    // done already
      return Promise.resolve(ds.layer);
    }

    return fetch(this._layerURL(ds.url))
      .then(utilFetchResponse)
      .then(json => {
        if (!json.layers || !json.layers.length) {
          throw new Error(`Missing layer info for datasetID: ${ds.id}`);
        }

        ds.layer = json.layers[0];  // should return a single layer

        // Use the field metadata to map to OSM tags
        let tagmap = {};
        for (const f of ds.layer.fields) {
          if (f.type === 'esriFieldTypeOID') {  // this is an id field, remember it
            ds.layer.idfield = f.name;
          }
          if (!f.editable) continue;   // 1. keep "editable" fields only
          tagmap[f.name] = f.alias;    // 2. field `name` -> OSM tag (stored in `alias`)
        }
        ds.layer.tagmap = tagmap;
        return ds.layer;
      })
      .catch(e => {
        if (e.name === 'AbortError') return;
        console.error(e);  // eslint-disable-line
      });
  }


  /**
   * _searchURL
   * Returns the URL used to search ArcGIS for datasets.
   * @see https://developers.arcgis.com/rest/users-groups-and-items/search.htm
   * @param   {number}  start - the starting page
   * @return  {string}  the url to fetch the datasets
   */
  _searchURL(start) {
    const params = {
      f: 'json',
      sortField: 'title',
      sortOrder: 'asc',
      num: 100,
      start: start
    };
    return `${APIROOT}/groups/${GROUPID}/search?` + utilQsString(params);
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
   * _layerURL
   * Returns the URL used to get available layers from a ArcGIS feature server.
   * @param   {string}  featureServerURL - The feature server URL
   * @return  {string}  The url to fetch the layers
   */
  _layerURL(featureServerURL) {
    return `${featureServerURL}/layers?f=json`;
    // should return single layer(?)
    // .layers[0]
    //   .copyrightText
    //   .fields
    //   .geometryType   "esriGeometryPoint" or "esriGeometryPolygon" ?
  }

  /**
   * _tileURL
   * Returns the URL used to get available data on a given dataset and tile.
   * @param   {Object}  ds - the dataset to fetch data for
   * @param   {Object}  tile - the tile to fetch the data for
   * @param   {number}  page - what page of data to fetch (zero-based)
   * @return  {string}  The url to fetch the data
   */
  _tileURL(ds, tile, page = 0) {
    const layerID = ds.layer.id;
    const maxRecordCount = ds.layer.maxRecordCount || 2000;
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
    return `${ds.url}/${layerID}/query?` + utilQsString(params);
  }


  /**
   * _loadTilePage
   * Get available data for a given dataset from it's feature server
   * @param   {Object}  ds - the dataset to fetch data for
   * @param   {Object}  tile - the tile to fetch the data for
   * @param   {number}  page - what page of data to fetch (zero-based)
   * @return  {string}  The url to fetch data from
   */
  _loadTilePage(ds, tile, page) {
    const cache = ds.cache;
    const tileID = tile.id;
    if (cache.loaded.has(tileID)) return;

    const controller = new AbortController();
    cache.inflight.set(tileID, controller);
    const url = this._tileURL(ds, tile, page);

    fetch(url, { signal: controller.signal })
      .then(utilFetchResponse)
      .then(geojson => {
        if (!geojson) throw new Error('no geojson');

        this._parseTile(ds, tile, geojson, (err, results) => {
          if (err) throw new Error(err);
          ds.graph.rebase(results, [ds.graph], true);
          ds.tree.rebase(results, true);
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
          gfx.deferredRedraw();
          this.emit('loadedData');
        }
      })
      .catch(e => {
        if (e.name === 'AbortError') return;
        console.error(e);  // eslint-disable-line
      })
      .finally(() => {
        cache.inflight.delete(tileID);
      });
  }


  /**
   * _parseTile
   * Parse the results from a tiled data fetch.
   * @param  {Object}    ds - the dataset we fetched
   * @param  {Object}    tile - the tile we fetched
   * @param  {Object}    geojson - the result GeoJSON data
   * @param  {function}  callback - errback-style callback function to call with results
   */
  _parseTile(ds, tile, geojson, callback) {
    if (!geojson) return callback({ message: 'No GeoJSON', status: -1 });

    // Expect a FeatureCollection with `features` array
    let results = [];
    for (const f of geojson.features ?? []) {
      const entities = this._parseFeature(ds, f);
      if (entities) {
        results.push.apply(results, entities);
      }
    }

    callback(null, results);
  }


  /**
   * _parseFeature
   * Parse a single GeoJSON feature
   * @param   {Object}  ds - the dataset we fetched
   * @param   {Object}  feature - the GeoJSON feature that we fetched
   * @return  {Array<OsmEntity>?}  An array of OSMEntities for that feature, or `null` if we skipped it
   */
  _parseFeature(ds, feature) {
    const context = this.context;
    const geom = feature.geometry;
    const properties = feature.properties;
    if (!geom || !properties) return null;

    const featureID = properties[ds.layer.idfield] || properties.OBJECTID || properties.FID || properties.id;
    if (!featureID) return null;

    // skip if we've seen this feature already on another tile
    if (ds.cache.seen.has(featureID)) return null;
    ds.cache.seen.add(featureID);

    const id = `${ds.id}-${featureID}`;
    const metadata = { __fbid__: id, __service__: 'esri', __datasetid__: ds.id };
    let entities = [];
    let nodemap = new Map();

    // Point:  make a single node
    if (geom.type === 'Point') {
      const props = Object.assign({ loc: geom.coordinates, tags: parseTags(properties) }, metadata);
      return [ new OsmNode(context, props) ];

    // LineString:  make nodes, single way
    } else if (geom.type === 'LineString') {
      const nodelist = parseCoordinates(geom.coordinates);
      if (nodelist.length < 2) return null;

      const props = Object.assign({ nodes: nodelist, tags: parseTags(properties) }, metadata);
      const w = new OsmWay(context, props);
      entities.push(w);
      return entities;

    // Polygon:  make nodes, way(s), possibly a relation
    } else if (geom.type === 'Polygon') {
      let ways = [];
      for (const ring of geom.coordinates ?? []) {
        const nodelist = parseCoordinates(ring);
        if (nodelist.length < 3) continue;

        const first = nodelist.at(0);
        const last = nodelist.at(-1);
        if (first !== last) nodelist.push(first);   // sanity check, ensure rings are closed

        const w = new OsmWay(context, { nodes: nodelist });
        ways.push(w);
      }

      if (ways.length === 1) {  // single ring, assign tags and return
        const props = Object.assign({ tags: parseTags(properties) }, metadata);
        entities.push(ways[0].updateSelf(props));
      } else {  // multiple rings, make a multipolygon relation with inner/outer members
        const members = ways.map((w, i) => {
          entities.push(w);
          return { id: w.id, role: (i === 0 ? 'outer' : 'inner'), type: 'way' };
        });
        const tags = Object.assign(parseTags(properties), { type: 'multipolygon' });
        const props = Object.assign({ members: members, tags: tags }, metadata);
        const r = new OsmRelation(context, props);
        entities.push(r);
      }

      return entities;
    }

    // no Multitypes for now (maybe not needed)
    function parseCoordinates(coords) {
      let nodelist = [];
      for (const coord of coords) {
        const key = coord.toString();
        let n = nodemap.get(key);
        if (!n) {
          n = new OsmNode(this.context, { loc: coord });
          entities.push(n);
          nodemap.set(key, n);
        }
        nodelist.push(n.id);
      }
      return nodelist;
    }

    function parseTags(properties) {
      let tags = {};
      for (const prop of Object.keys(properties)) {
        const k = clean(ds.layer.tagmap[prop]);
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

    function clean(val) {
      return val ? val.toString().trim() : null;
    }
  }

}
