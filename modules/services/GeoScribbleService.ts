import { AbstractSystem } from '../core/AbstractSystem.ts';
import { GeoJSONData } from '../data/GeoJSONData.ts';
import { Tiler } from '@rapid-sdk/math';
import { utilQsString } from '@rapid-sdk/util';

import type { Context } from '../Context.ts';


/** Zoom level used for tiling GeoScribble data requests */
const TILEZOOM = 14;
/** Base URL for the GeoScribble GeoJSONData API endpoint */
const GEOSCRIBBLE_API = 'https://geoscribble.osmz.ru/geojson';


/**
 * `GeoScribbleService` allows users to collaboratively draw on the map.
 * This service connects to the GeoScribble API to fetch public 'scribbles'.
 * @see https://wiki.openstreetmap.org/wiki/GeoScribble
 * @see https://geoscribble.osmz.ru/docs
 * @see https://github.com/Zverik/geoscribble
 */
export class GeoScribbleService extends AbstractSystem {

  /** Tiler instance used to compute which tiles cover the current viewport */
  protected _tiler: Tiler;
  /** Last viewport version number used for change detection */
  protected _lastv: number | null;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'geoscribble';
    this.requiredDependencies = new Set<SystemID>(['network', 'spatial']);
    this.optionalDependencies = new Set<SystemID>(['gfx']);
    this.autoStart = false;

    this._tiler = (new Tiler().zoomRange(TILEZOOM) as Tiler).skipNullIsland(true) as Tiler;
    this._lastv = null;
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = super.initAsync()
      .then(() => this.resetAsync());
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
    const context = this.context;
    const network = context.systems.network!;
    const spatial = context.systems.spatial!;

    network.clearMatching(id => id.startsWith('geoscribble-') || id.includes(GEOSCRIBBLE_API));
    spatial.clearMatching(id => id.startsWith('geoscribble-'));

    this._lastv = null;

    return Promise.resolve();
  }


  /**
   * Get already loaded data that appears in the current map view
   * @return  Array of data
   */
  public getData(): GeoJSONData[] {
    const spatial = this.context.systems.spatial!;
    return spatial.getVisibleItems('geoscribble-data').map(hit => hit.contents as GeoJSONData);
  }


  /**
   * Schedule any data requests needed to cover the current map view
   */
  public loadTiles(): void {
    const context = this.context;
    const network = context.systems.network!;
    const viewport = context.viewport;

    if (this._lastv === viewport.v) return;  // exit early if the view is unchanged
    this._lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    const neededIDs = new Set<RequestID>(tiles.map(tile => `geoscribble-tile-${tile.id}`));
    network.abortMatching(id => id.startsWith('geoscribble-tile') && !neededIDs.has(id));

    // Issue new requests..
    for (const tile of tiles) {
      const tileID = tile.id;
      const requestID = `geoscribble-tile-${tileID}`;
      if (network.isCompleted(requestID) || network.isInflight(requestID)) continue;

      const rect = tile.wgs84Extent.rectangle().join(',');
      const url = GEOSCRIBBLE_API + '?' + utilQsString({ bbox: rect }, false);

      network.fetch<any>(url, { requestID })
        .then(response => this._gotTile(response))
        .catch(err => {
          if (err.name === 'AbortError') return;  // ok
          console.error(err);  // eslint-disable-line
        });
    }
  }


  /**
   * Parse the response from the tile fetch.
   * @param response - Response data
   */
  protected _gotTile(response: any): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial!;

    if (!Array.isArray(response?.features)) {
      throw new Error('Invalid response');
    }

    const toLoad: GeoJSONData[] = [];
    for (const feature of response.features) {
      toLoad.push(new GeoJSONData(context, { serviceID: this.id, geojson: feature }));
    }

    spatial.addData('geoscribble-data', toLoad);
    gfx?.deferredRedraw();
  }

}
