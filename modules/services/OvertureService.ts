import { RapidDataset } from '../lib/RapidDataset.ts';
import { utilFetchResponse } from '../util/fetch_response.ts';
import { VectorTileService } from './VectorTileService.ts';

import type { Context } from '../Context.ts';
import type { GeoJSONData } from '../data/GeoJSONData.ts';


/**
 * STAC catalog root — used to discover the latest Overture release and per-theme PMTiles URLs.
 * See: https://stac.overturemaps.org/catalog.json
 */
const STAC_CATALOG_URL = 'https://stac.overturemaps.org/catalog.json';

/** STAC themes to fetch PMTiles URLs for */
const WANTED_THEMES = new Set(['buildings', 'places', 'transportation']);

/** Minimum zoom level for loading building data (prevents slowdown at low zooms) */
const MIN_BUILDING_ZOOM = 17;
/** Minimum zoom level for loading transportation data */
const MIN_TRANSPORTATION_ZOOM = 16;


/**
 * `OvertureService` connects to the 'official' sources of Overture PMTiles
 *  by extending the vector tile service.
 *
 * - Protomaps .pmtiles single-file archive containing MVT
 *    https://protomaps.com/docs/pmtiles
 *    https://github.com/protomaps/PMTiles
 */
export class OvertureService extends VectorTileService {
  /** Map of theme id to PMTiles URL, e.g. 'buildings' → 'https://…/buildings.pmtiles' */
  protected _pmtilesUrls: Map<string, string>;
  /** The latest releaseID, e.g. '2026-01-21.0' */
  protected _releaseID: string;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'overture';

    this._pmtilesUrls = new Map<string, string>();
    this._releaseID = '';
  }


  /**
   * _loadStacCatalogAsync
   * Walk the Overture STAC catalog to discover the latest release and resolve
   * per-theme PMTiles URLs (buildings, places, etc.).
   *
   * Catalog structure:
   *   root catalog → release catalogs (latest tagged) → theme catalogs → pmtiles links
   *
   * @return {Promise} Promise resolved when the catalog has been loaded
   */
  protected async _loadStacCatalogAsync() {
    try {
      // 1. Fetch root catalog
      const rootData = await fetch(STAC_CATALOG_URL).then(utilFetchResponse);

      // 2. Find the latest release (link with `latest: true`)
      const childLinks = (rootData.links ?? []).filter((l: any) => l.rel === 'child');
      const latestLink = childLinks.find((l: any) => l.latest === true);
      if (!latestLink) throw new Error('No latest release found in STAC root catalog');

      const releaseUrl = new URL(latestLink.href, STAC_CATALOG_URL).href;
      const releaseData = await fetch(releaseUrl).then(utilFetchResponse);
      this._releaseID = releaseData.id ?? '';

      // 3. Fetch only the themes we need
      const themeLinks = (releaseData.links ?? []).filter((l: any) => l.rel === 'child' && WANTED_THEMES.has(l.title));
      const themeFetches = themeLinks.map(async (link: any) => {
        const themeUrl = new URL(link.href, releaseUrl).href;
        const themeData = await fetch(themeUrl).then(utilFetchResponse);
        const pmtilesLink = (themeData.links ?? []).find((l: any) => l.rel === 'pmtiles');
        if (pmtilesLink) {
          const themeName = themeData.id ?? link.title;
          const pmtilesUrl = new URL(pmtilesLink.href, themeUrl).href;
          this._pmtilesUrls.set(themeName, pmtilesUrl);
        }
      });

      await Promise.all(themeFetches);
      // console.log(`[OvertureService] Loaded STAC release "${this._releaseID}" with themes: ${[...this._pmtilesUrls.keys()].join(', ')}`);  // eslint-disable-line no-console
    } catch (error) {
      console.error('[OvertureService] Error loading STAC catalog:', error);  // eslint-disable-line no-console
    }
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = super.initAsync()
      .then(() => this._loadStacCatalogAsync());
  }


  /**
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called by `RapidSystem` to get the datasets that this service provides.
   * @return  The datasets this service provides
   */
  public getAvailableDatasets(): RapidDataset[] {
    const places = new RapidDataset(this.context, {
      id: 'overture-places',
      conflated: false,
      serviceID: 'overture',
      categories: new Set<string>(['overture', 'places']),
      color: '#00ffff',
      dataUsed: ['overture', 'Overture Places'],
      itemUrl: 'https://docs.overturemaps.org/guides/places/',
      licenseUrl: 'https://docs.overturemaps.org/attribution/',
      labelStringID: 'rapid_menu.overture.places.label',
      descriptionStringID: 'rapid_menu.overture.places.description'
    });

    const buildings = new RapidDataset(this.context, {
      id: 'overture-buildings',
      conflated: false,
      serviceID: 'overture',
      categories: new Set<string>(['overture', 'buildings']),
      color: '#00ffff', // '#00bfff',  // Deep sky blue for Esri community maps
      dataUsed: ['overture', 'Overture Buildings'],
      itemUrl: 'https://docs.overturemaps.org/guides/buildings/',
      licenseUrl: 'https://docs.overturemaps.org/attribution/#buildings',
      labelStringID: 'rapid_menu.overture.buildings.label',
      descriptionStringID: 'rapid_menu.overture.buildings.description'
    });

    const tomtomRoads = new RapidDataset(this.context, {
      id: 'overture-tomtom-roads',
      conflated: false,
      serviceID: 'overture',
      categories: new Set<string>(['overture', 'tomtom', 'roads', 'featured']),
      color: '#00ffff',  // '#da26d3',  // Rapid magenta
      dataUsed: ['overture', 'TomTom'],
      itemUrl: 'https://docs.overturemaps.org/guides/transportation/',
      licenseUrl: 'https://docs.overturemaps.org/attribution/',
      labelStringID: 'rapid_menu.overture.tomtom_roads.label',
      descriptionStringID: 'rapid_menu.overture.tomtom_roads.description'
    });

    return [places, buildings, tomtomRoads];
  }


  /**
   * Use the vector tile service to schedule any data requests needed to cover the current map view
   * @param  datasetID - dataset to load tiles for
   */
  public loadTiles(datasetID: DatasetID): void {
    const context = this.context;
    const zoom = context.viewport.transform.zoom;

    if (datasetID === 'overture-places') {
      const url = this._pmtilesUrls.get('places');
      if (url) super.loadTiles(url, datasetID);

    } else if (datasetID === 'overture-buildings') {
      if (zoom < MIN_BUILDING_ZOOM) return;
      const url = this._pmtilesUrls.get('buildings');
      if (url) super.loadTiles(url, datasetID);

    } else if (datasetID === 'overture-tomtom-roads') {
      if (zoom < MIN_TRANSPORTATION_ZOOM) return;
      const url = this._pmtilesUrls.get('transportation');
      if (url) super.loadTiles(url, datasetID);
    }
  }


  /**
   * Get already loaded data that appears in the current map view
   * @param  datasetID - datasetID to get data for
   * @return Array of data
   */
  public getData(datasetID: DatasetID): GeoJSONData[] {
    const context = this.context;
    const zoom = context.viewport.transform.zoom;

    if (datasetID === 'overture-places') {
      const url = this._pmtilesUrls.get('places');
      if (url) return super.getData(url);

    } else if (datasetID === 'overture-buildings') {
      if (zoom < MIN_BUILDING_ZOOM) return [];
      const url = this._pmtilesUrls.get('buildings');
      if (url) return super.getData(url);

    } else if (datasetID === 'overture-tomtom-roads') {
      if (zoom < MIN_TRANSPORTATION_ZOOM) return [];
      const url = this._pmtilesUrls.get('transportation');
      if (url) return super.getData(url);
    }

    return [];
  }

}
