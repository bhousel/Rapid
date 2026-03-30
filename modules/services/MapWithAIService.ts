import { Tiler } from '@rapid-sdk/math';

import { AbstractSystem } from '../core/AbstractSystem.ts';
import { Graph, RapidDataset, Tree } from '../lib/index.ts';
import { OsmNode, OsmWay } from '../data/index.ts';
import { OsmXMLParser } from '../data/parsers/OsmXMLParser.ts';

import type { Context } from '../Context.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { ParsedWay } from '../data/parsers/types.ts';
import type { Extent, Tile } from '@rapid-sdk/math';


/** Base URL for the MapWithAI vector tile API endpoint */
const APIROOT = 'https://mapwith.ai/maps/ml_roads';
/** Zoom level used for tiling MapWithAI data requests */
const TILEZOOM = 16;


/**
 * Internal cache structure for a single dataset.
 * Each dataset has its own Graph, Tree, and tracking sets.
 */
interface DatasetCache {
  /** Unique identifier for this dataset */
  id: DatasetID;
  /** Graph instance holding the loaded MapWithAI entity data */
  graph: Graph;
  /** Custom spatial tree for spatial queries on this dataset */
  tree: Tree;
  /** Set of tile IDs that have already been loaded */
  loaded: Set<EntityID>;
  /** Set of entity IDs already seen, to avoid processing duplicates */
  seen: Set<EntityID>;
  /** Set of first-node IDs used to detect duplicate buildings */
  seenFirstNodeID: Set<EntityID>;
  /** Map of original way IDs to sets of split way segments awaiting reassembly */
  splitWays: Map<string, Set<ParsedWay>>;
  /** Viewport version from the last data fetch, used to skip redundant loads */
  lastv: number | null;
}


/**
 * `MapWithAIService`
 * This service connects to the MapWithAI API to fetch data about Meta-hosted datasets.
 */
export class MapWithAIService extends AbstractSystem {
  /** Parser for converting OSM XML responses into entity props */
  _XMLParser: OsmXMLParser;
  /** Tiler instance used to compute tile coverage for the current viewport */
  _tiler: Tiler;
  /** Map of dataset IDs to their DatasetCache objects */
  _datasets: Map<DatasetID, DatasetCache>;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'mapwithai';
    this.requiredDependencies = new Set<SystemID>(['network', 'spatial']);
    this.optionalDependencies = new Set<SystemID>(['assets', 'gfx', 'l10n', 'locations', 'rapid', 'urlhash']);

    this._XMLParser = new OsmXMLParser();
    this._tiler = new Tiler().zoomRange(TILEZOOM) as Tiler;
    this._datasets = new Map();
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = super.initAsync()
      .then(() => this.resetAsync())
      .then(() => {
        // allocate a special dataset for the rapid intro graph.
        this.getDataset('rapid_intro_graph');
      });
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * getAvailableDatasets
   * Called by `RapidSystem` to get the datasets that this service provides.
   * @return The datasets this service provides
   */
  getAvailableDatasets(): RapidDataset[] {
    const context = this.context;

    const fbRoads = new RapidDataset(context, {
      id: 'fbRoads',
//      conflated: true,
      conflated: false,
      serviceID: 'mapwithai',
      categories: new Set(['meta', 'roads', 'featured']),
      dataUsed: ['mapwithai', 'Facebook Roads'],
      itemUrl: 'https://github.com/facebookmicrosites/Open-Mapping-At-Facebook',
      licenseUrl: 'https://rapideditor.org/doc/license/MapWithAILicense.pdf',
      labelStringID: 'rapid_menu.fbRoads.label',
      descriptionStringID: 'rapid_menu.fbRoads.description'
    });

    const msBuildings = new RapidDataset(context, {
      id: 'msBuildings',
//      conflated: true,
      conflated: false,
      serviceID: 'mapwithai',
      categories: new Set(['microsoft', 'buildings', 'featured']),
      dataUsed: ['mapwithai', 'Microsoft Buildings'],
      itemUrl: 'https://github.com/microsoft/GlobalMLBuildingFootprints',
      licenseUrl: 'https://github.com/microsoft/USBuildingFootprints/blob/master/LICENSE-DATA',
      labelStringID: 'rapid_menu.msBuildings.label',
      descriptionStringID: 'rapid_menu.msBuildings.description'
    });

//    const omdFootways = new RapidDataset(context, {
//      id: 'omdFootways',
//      conflated: true,
//      serviceID: 'mapwithai',
//      categories: new Set(['meta', 'footways', 'featured']),
//      tags: new Set(['opendata']),
//      overlay: {
//        url: 'https://external.xx.fbcdn.net/maps/vtp/rapid_overlay_footways/2/{z}/{x}/{y}/',
//        minZoom: 1,
//        maxZoom: 15,
//      },
//      dataUsed: ['mapwithai', 'Open Footways'],
//      itemUrl: 'https://github.com/facebookmicrosites/Open-Mapping-At-Facebook/wiki/Footways-FAQ',
//      licenseUrl: 'https://github.com/facebookmicrosites/Open-Mapping-At-Facebook/wiki/Footways-FAQ#attribution-and-license',
//      labelStringID: 'rapid_menu.omdFootways.label',
//      descriptionStringID: 'rapid_menu.omdFootways.description'
//    });
//
//
//    const metaSyntheticFootways = new RapidDataset(context, {
//      id: 'metaSyntheticFootways',
//      conflated: true,
//      serviceID: 'mapwithai',
//      categories: new Set(['meta', 'footways', 'featured', 'preview']),
//      tags: new Set(['opendata']),
//      dataUsed: ['mapwithai', 'Meta Synthetic Footways'],
//      itemUrl: 'https://github.com/facebookmicrosites/Open-Mapping-At-Facebook/wiki/Footways-FAQ',
//      licenseUrl: 'https://github.com/facebookmicrosites/Open-Mapping-At-Facebook/wiki/Footways-FAQ#attribution-and-license',
//      labelStringID: 'rapid_menu.metaSyntheticFootways.label',
//      descriptionStringID: 'rapid_menu.metaSyntheticFootways.description'
//    });
//
    const introGraph = new RapidDataset(context, {
      id: 'rapid_intro_graph',
      hidden: true,
      conflated: false,
      serviceID: 'mapwithai',
      categories: new Set(['meta', 'roads']),
      color: '#da26d3',
      dataUsed: [],
      label: 'Rapid Walkthrough'
    });

    return [fbRoads, msBuildings, /*omdFootways, metaSyntheticFootways,*/ introGraph];
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    const network = this.context.systems.network!;

    network.abortMatching(id => /^mapwithai-/.test(id));

    for (const [datasetID, ds] of this._datasets) {
      ds.graph = new Graph(this.context);
      ds.tree = new Tree(ds.graph, datasetID);
      ds.loaded.clear();
      ds.seen.clear();
      ds.seenFirstNodeID.clear();
      ds.splitWays.clear();
      ds.lastv = null;
    }

    this._XMLParser.reset();

    return Promise.resolve();
  }


  /**
   * getDataset
   * Get a dataset cache identified by the given datasetID.
   * Create it if it doesn't exist yet.
   * @param datasetID - the cache to get (or create)
   * @return dataset cache
   */
  getDataset(datasetID: DatasetID): DatasetCache {
    let ds = this._datasets.get(datasetID);
    if (!ds) {
      const graph = new Graph(this.context);
      const tree = new Tree(graph, datasetID);
      ds = {
        id: datasetID,
        graph: graph,
        tree: tree,
        loaded: new Set(),           // Set<TileID>
        seen: new Set(),             // Set<EntityID>
        seenFirstNodeID: new Set(),  // Set<EntityID>
        splitWays: new Map(),        // Map<originalID, Set<Entity>>
        lastv: null
      };
      this._datasets.set(datasetID, ds);
    }
    return ds;
  }


  /**
   * getData
   * Get already loaded data that appears in the current map view
   * @param datasetID - datasetID to get data for
   * @return Array of data (OSM Entities)
   */
  getData(datasetID: DatasetID): OsmEntity[] {
    const ds = this._datasets.get(datasetID);
    if (!ds || !ds.tree || !ds.graph) return [];

    const extent = this.context.viewport.visibleExtent();
    return ds.tree.intersects(extent, ds.graph);
  }


  /**
   * loadTiles
   * Schedule any data requests needed to cover the current map view
   * @param datasetID - datasetID to load tiles for
   */
  loadTiles(datasetID: DatasetID): void {
    if (this._paused) return;

    const context = this.context;
    const network = context.systems.network!;
    const viewport = context.viewport;

    const ds = this.getDataset(datasetID);  // create caches, if needed
    if (ds.lastv === viewport.v) return;    // exit early if the view is unchanged
    ds.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    const neededIDs = new Set(tiles.map(tile => `mapwithai-${tile.id}` as RequestID));
    network.abortMatching(id => /^mapwithai-/.test(id) && !neededIDs.has(id));

    for (const tile of tiles) {
      this.loadTile(ds, tile);
    }
  }


  /**
   * loadTile
   * Load a single tile of data
   * @param ds - the dataset info
   * @param tile - a tile object
   */
  loadTile(ds: DatasetCache, tile: Tile): void {
    if (!ds || this._paused) return;

    const context = this.context;
    const network = context.systems.network!;
    const locations = context.systems.locations;
    const tileID = tile.id;
    const requestID = `mapwithai-${tileID}` as RequestID;

    if (ds.loaded.has(tileID) || network.isInflight(requestID)) return;

    if (locations) {
      // Exit if this tile covers a blocked region (all corners are blocked)
      const corners = tile.wgs84Extent.polygon().slice(0, 4);
      const tileBlocked = corners.every(loc => locations.isBlockedAt(loc));
      if (tileBlocked) {
        ds.loaded.add(tile.id);  // don't try again
        return;
      }
    }

    const url = this._tileURL(ds, tile.wgs84Extent);
    network.fetch<Document>(url, { requestID })
      .then(xml => this._gotTile(xml, ds, tile))
      .catch(e => {
        if (e.name === 'AbortError') return;
        console.error(e);  // eslint-disable-line
      });
  }


  /**
   * _gotTile
   * Process the response from the tile fetch.
   * @param xml - the xml content to parse
   * @param ds - the dataset info
   * @param tile - a tile object
   */
  _gotTile(xml: Document, ds: DatasetCache, tile: Tile): void {
    if (!xml) return;  // ignore empty responses

    const context = this.context;
    const gfx = context.systems.gfx;

    const graph = ds.graph;
    const tree = ds.tree;
    const tileID = tile.id;

    const results = this._XMLParser.parse(xml, {
      skipSeen: false,                   // expect duplicate wayIDs that are split
      filter: new Set(['node', 'way'])   // don't expect 'relation' from this service
    });

    const entities: OsmEntity[] = [];
    for (const props of results.data) {
      const entityID = props.id as EntityID;

      // add some extra metadata properties
      Object.assign(props, {
        __fbid__: entityID,
        __service__: 'mapwithai',
        __datasetid__: ds.id
      });

      if (props.type === 'node') {
        if (ds.seen.has(entityID)) continue;   // can skip seen nodes
        ds.seen.add(entityID);
        entities.push(new OsmNode(context, props));

      } else if (props.type === 'way') {
        // The MapWithAI service uses a non-deterministic method for splitting ways into segments.
        // This means that each response may have split the way differently, see Rapid#1288
        // This is extra challenging because the user may accept some roads, store their edits to
        // localStorage, refresh Rapid and restore their edits, and we'd expect their restored
        // edits should still work with whatever ways we receive from the server.
        // We work around this issue in `_connectSplitWays`

        // If `orig_id` is present, it means that the way was split
        // by the server, and we will need to reassemble the pieces.
        const origID = props.orig_id as string | undefined;
        if (origID) {
          let splitWays = ds.splitWays.get(origID);
          if (!splitWays) {
            splitWays = new Set();
            ds.splitWays.set(origID, splitWays);
          }
          splitWays.add(props as ParsedWay);
          continue;  // bail out, `_connectSplitWays` will handle this instead

        } else {  // a normal unsplit way
          if (ds.seen.has(entityID)) continue;   // can skip seen ways
          ds.seen.add(entityID);

          // Ignore duplicate buildings in the MS Buildings dataset.
          // They will appear with unique entity id, but with the same nodelist, see Rapid#873
          if (/^msBuildings/.test(ds.id)) {
            const firstNodeID = props.nodes[0];
            if (!firstNodeID || ds.seenFirstNodeID.has(firstNodeID)) continue;
            ds.seenFirstNodeID.add(firstNodeID);
          }

          entities.push(new OsmWay(context, props));
        }
      }
    }

    // Try to reconnect split ways.
    entities.push(...this._connectSplitWays(ds));

    graph.rebase(entities, [graph], true);   // true = force replace entities
    tree.rebase(entities, true);
    ds.loaded.add(tileID);
    gfx?.deferredRedraw();
  }


  /**
   * graph
   * Returns the Graph for the given dataset.
   * @param datasetID - dataset to get the graph for
   * @return the dataset's Graph
   */
  graph(datasetID: DatasetID): Graph {
    const ds = this.getDataset(datasetID);  // create caches, if needed
    return ds.graph;
  }


  /**
   * merge
   * Merge entities directly into a dataset's graph and tree.
   * Used to load the rapid_intro_graph.
   * @param datasetID - dataset to merge into
   * @param entities - entities to merge
   */
  merge(datasetID: DatasetID, entities: OsmEntity[]): void {
    const ds = this.getDataset(datasetID);  // create caches, if needed
    ds.graph.rebase(entities);
    ds.tree.rebase(entities);
  }


  /**
   * _tileURL
   * Build the MapWithAI API URL for a given dataset and extent.
   * @param dataset - the dataset cache to build the URL for
   * @param extent - geographic extent of the tile
   * @return the fully-qualified API URL
   */
  _tileURL(dataset: DatasetCache, extent: Extent): string {
    const context = this.context;
    const rapid = context.systems.rapid;
    const urlhash = context.systems.urlhash;

    // Conflated datasets have a different ID, so they get stored in their own graph/tree
    const isConflated = /-conflated$/.test(dataset.id);
    const datasetID = dataset.id.replace('-conflated', '');

    const qs: Record<string, string | boolean> = {
      conflate_with_osm: isConflated,
      theme: 'ml_road_vector',
      collaborator: 'fbid',
      token: 'ASZUVdYpCkd3M6ZrzjXdQzHulqRMnxdlkeBJWEKOeTUoY_Gwm9fuEd2YObLrClgDB_xfavizBsh0oDfTWTF7Zb4C',
      hash: 'ASYM8LPNy8k1XoJiI7A'
    };

    if (datasetID === 'fbRoads') {
      qs.result_type = 'road_vector_xml';
    } else if (datasetID === 'metaSyntheticFootways' ) {
      qs.result_type = 'extended_osc';
      qs.sources = 'META_SYNTHETIC_FOOTWAYS';
    } else if (datasetID === 'omdFootways' ) {
      qs.result_type = 'extended_osc';
      qs.sources = 'OPEN_MAP_DATA_FOOTWAYS';
    } else if (datasetID === 'msBuildings') {
      qs.result_type = 'road_building_vector_xml';
      qs.building_source = 'microsoft';
    } else {
      qs.result_type = 'osm_xml';
      qs.sources = `esri_building.${datasetID}`;
    }

    qs.bbox = extent.toParam();

    if (rapid?.taskExtent) {
      qs.crop_bbox = rapid.taskExtent.toParam();
    }

    const customUrlRoot = urlhash?.getParam('fb_ml_road_url');
    const urlRoot = customUrlRoot || APIROOT;
    const url = urlRoot + '?' + MWAIQsString(qs, true);  // true = noencode
    return url;


    // This utilQsString does not sort the keys, because the MapWithAI service needs them to be ordered a certain way.
    function MWAIQsString(obj: Record<string, string | boolean>, noencode: boolean): string {
      // encode everything except special characters used in certain hash parameters:
      // "/" in map states, ":", ",", {" and "}" in background
      function softEncode(s: string): string {
        return encodeURIComponent(s).replace(/(%2F|%3A|%2C|%7B|%7D)/g, decodeURIComponent);
      }

      return Object.keys(obj).map(key => {  // NO SORT
        return encodeURIComponent(key) + '=' + (
          noencode ? softEncode(String(obj[key])) : encodeURIComponent(String(obj[key])));
      }).join('&');
    }
  }


  /**
   * _connectSplitWays
   * Call this sometimes to reassemble ways that were split by the server.
   * @param ds - the dataset info
   */
  _connectSplitWays(ds: DatasetCache): OsmWay[] {
    const context = this.context;
    const graph = ds.graph;
    const results: OsmWay[] = [];

    // Check each way that shares this `origID`.
    // Pick one to be the "survivor" (it doesn't matter which one).
    // Merge the nodes into the survivor (this will bump internal version `v`, so it gets redrawn)
    //
    // some implementation notes:
    // 1. Note that the "ways" here haven't been constructed as Entities yet, they are just props.
    // 2. `actionJoin` is similar to this, but does more than we need and uses `osmJoinWays`,
    // 3. `osmJoinWays` could almost do this, but it only can join head-tail, it can't
    //  deal with situations where ways partially overlap or reverse, which we get from this server.
    //  see examples below

    for (const [origID, ways] of ds.splitWays) {
      let survivor: OsmWay | undefined = graph.hasEntity(origID) as OsmWay | undefined;   // if we've done this before, the graph will have it

      for (const candidate of ways) {
        if (!survivor || !survivor.nodes.length) {   // first time, just pick first way we see.
          candidate.id = origID;                     // but use the original (stable) id
          survivor = new OsmWay(context, candidate);
          ways.delete(candidate);
          continue;
        }

        // We will attempt to merge the `candidate.nodes` into the `survivor.nodes` somewhere.
        // Here are some situations we account for (candidate can be forward or reverse):
        // survivor.nodes = [C, D, E, F, G, H, J, K]
        // candidate.nodes = [G, F, E, D], indexes = [4, 3, 2, 1]      (candidate aleady contained)
        // candidate.nodes = [A, B, C, D], indexes = [-1, -1, 0, 1]    (prepend at beginning)
        // candidate.nodes = [J, I, H, G], indexes = [6, -1, 5, 4]     (splice into middle)
        // candidate.nodes = [M, L, K, J], indexes = [-1, -1, 7, 6]    (append at end)
        // candidate.nodes = [N, O, P, Q], indexes = [-1, -1, -1, -1]  (discontinuity)
        const indexes: number[] = [];
        for (const nodeID of candidate.nodes) {
         indexes.push(survivor.nodes.indexOf(nodeID));
        }

        if (indexes.every(ix => ix !== -1)) {  // candidate already contained in survivor
          ways.delete(candidate);              // remove candidate
          continue;

        } else if (indexes.every(ix => ix === -1)) {  // discontinuity, keep candidate around
          continue;                                   // in case we load more map and can connect it
        }

        // We consider the survivor to be going in the forward direction.
        // We want to make sure the candidate also matches this direction.
        // To determine direction - do the matched (not `-1`) indexes go up or down?
        let isReverse = false;
        let onlyOneIndex = false;  // if only one matched index, we expect it at start or end
        let prev: number | undefined;
        for (const curr of indexes) {
          if (curr === -1) continue;   // ignore these

          if (prev === undefined) {  // found one
            onlyOneIndex = true;
            prev = curr;
          } else {    // found two, compare them
            onlyOneIndex = false;
            isReverse = curr < prev;
            break;
          }
        }

        if (onlyOneIndex) {   // new nodes (-1's) should go before the beginning or after the end
          if (indexes.at(0) === 0)  isReverse = true;   // indexes look like [ 0, -1, -1, -1 ]   move -1's to beginning
          if (indexes.at(-1) !== 0) isReverse = true;   // indexes look like [ -1, -1, -1, N ]   move -1's to end
        }

        if (isReverse) {
          candidate.nodes.reverse();  // ok to reverse it, candidate isn't an actual way in the graph
          indexes.reverse();
        }

        // Take nodes from either survivor or candidate
        const nodeIDs: EntityID[] = [];
        let s = 0;  // s = survivor index

        for (let c = 0; c < indexes.length; c++) {   // c = candidate index
          const i = indexes[c];
          if (i === -1) {
            nodeIDs.push(candidate.nodes[c]);  // take next candidate
          } else {
            while (s <= i) {
              nodeIDs.push(survivor.nodes[s]);   // take survivors up to i
              s++;
            }
          }
        }
        while (s < survivor.nodes.length) {   // take any remaining survivors
          nodeIDs.push(survivor.nodes[s]);
          s++;
        }

        ways.delete(candidate);            // remove candidate
        survivor.props.nodes = nodeIDs;    // update nodelist in-place, hope this is ok.
        survivor.updateGeometry(graph).touch();
      }

      if (survivor) {
        results.push(survivor);
      }
    }

    return results;
  }

}
