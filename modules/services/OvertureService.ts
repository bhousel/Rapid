import { AbstractSystem } from '../core/AbstractSystem.ts';
import { RapidDataset } from '../lib/RapidDataset.ts';
import { utilFetchResponse } from '../util/fetch_response.ts';

import type { Context } from '../Context.ts';
import type { GeoJSONData } from '../data/GeoJSONData.ts';
import type { VectorTileService } from './VectorTileService.ts';

/** Base URL for Overture PMTiles hosted on S3 */
const PMTILES_ROOT_URL = 'https://overturemaps-tiles-us-west-2-beta.s3.us-west-2.amazonaws.com/';
/** Path to the PMTiles catalog JSON file */
const PMTILES_CATALOG_PATH = 'pmtiles_catalog.json';

/** Catalog file structure from S3 */
interface PMTilesCatalog {
  /** Available PMTiles releases with their file listings */
  releases: Array<{
    release_id: string;
    files: Array<{ theme: string; href: string }>;
  }>;
}


/**
 * `OvertureService` connects to the 'official' sources of Overture PMTiles
 *  by acting as a wrapper around the vector tile service
 *
 * - Protomaps .pmtiles single-file archive containing MVT
 *    https://protomaps.com/docs/pmtiles
 *    https://github.com/protomaps/PMTiles
 */
export class OvertureService extends AbstractSystem {

  /** Parsed PMTiles catalog data from S3 */
  pmTilesCatalog: PMTilesCatalog;
  /** The most recent release entry from the catalog */
  latestRelease: any;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'overture';
    this.pmTilesCatalog = { releases: [] };
    this.latestRelease = '';
  }


  /**
   * Load and parse the overture catalog data
   * @return  Promise resolved when the data has been loaded
   */
  _loadS3CatalogAsync(): Promise<void> {
    return fetch(PMTILES_ROOT_URL + PMTILES_CATALOG_PATH)
      .then(utilFetchResponse)
      .then((json: PMTilesCatalog) => {
        this.pmTilesCatalog = json;

        // Grab the very latest date stamp and keep track of the release associated with it.
        const dateStrings = this.pmTilesCatalog.releases.map(release => release.release_id);
        dateStrings.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
        this.latestRelease = this.pmTilesCatalog.releases.find(release => release.release_id === dateStrings[0]);
      })
      .catch(error => {
        console.error('Error fetching or parsing the PMTiles Catalog: ', error);   // eslint-disable-line no-console
      });
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const vtService = this.context.services.vectortile as VectorTileService;

    return this._initPromise = super.initAsync()
      .then(() => vtService.initAsync())
      .then(() => this._loadS3CatalogAsync());
  }


  /**
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    const vtService = this.context.services.vectortile as VectorTileService;

    return this._startPromise = Promise.resolve()
      .then(() => vtService.startAsync())
      .then(() => { this._started = true; });
  }


  /**
   * Called by `RapidSystem` to get the datasets that this service provides.
   * @return  The datasets this service provides
   */
  getAvailableDatasets(): RapidDataset[] {
    // just this one for now
    const places = new RapidDataset(this.context, {
      id: 'overture-places',
      conflated: false,
      serviceID: 'overture',
      categories: new Set(['overture', 'places', 'featured']),
      color: '#00ffff',
      dataUsed: ['overture', 'Overture Places'],
      itemUrl: 'https://docs.overturemaps.org/guides/places/',
      licenseUrl: 'https://docs.overturemaps.org/attribution/#places',
      labelStringID: 'rapid_menu.overture.places.label',
      descriptionStringID: 'rapid_menu.overture.places.description'
    });

    return [places];
  }


  /**
   * Use the vector tile service to schedule any data requests needed to cover the current map view
   * @param  datasetID - dataset to load tiles for
   */
  loadTiles(datasetID: DatasetID): void {
    const vtService = this.context.services.vectortile as VectorTileService;

    //TODO: Revisit the id-to-url mapping once we're done.
    if (datasetID.includes('places')) {
      const file = this.latestRelease.files.find((file: any) => file.theme === 'places');
      const url = PMTILES_ROOT_URL + file.href;

      vtService.loadTiles(url);
    }
  }


  /**
   * Get already loaded data that appears in the current map view
   * @param  datasetID - datasetID to get data for
   * @return Array of data
   */
  getData(datasetID: DatasetID): GeoJSONData[] {
    const vtService = this.context.services.vectortile as VectorTileService;

    if (datasetID.includes('places')) {
      const file = this.latestRelease.files.find((file: any) => file.theme === 'places');
      const url = PMTILES_ROOT_URL + file.href;
      return vtService.getData(url);
    } else {
      return [];
    }
  }

}
