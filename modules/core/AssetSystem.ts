import { AbstractSystem } from './AbstractSystem.ts';
import { utilFetchResponse } from '../util/fetch_response.ts';

import type { Context } from '../Context.ts';


/**
 * Map of asset keys to their file paths or URLs.
 * Keys are identifiers like 'address_formats', 'languages', 'oci_defaults'.
 * Values are either relative paths (e.g. 'data/languages.min.json')
 * or absolute URLs (e.g. 'https://cdn.jsdelivr.net/npm/...').
 */
type AssetMap = Record<string, string>;

/**
 * Sources object containing asset maps for each origin.
 */
interface AssetSources {
  /** 'custom' - Assets specified at runtime - these override the assets from 'latest' or 'local' */
  custom: AssetMap;
  /** 'latest' - These are the default assets that Rapid loads, may load from CDN */
  latest: AssetMap;
  /** 'local' - Local assets only, for offline/standalone use */
  local: AssetMap;
}

/** Origin types for asset loading - derived from AssetSources keys */
export type AssetOrigin = keyof AssetSources;


/**
 * `AssetSystem` keeps track of files and data that Rapid needs to load.
 *
 * Information about the assets can be found in the `sources` structure.
 * Sources are identified by keys, and are grouped by origin.
 *  'custom' - assets added at runtime, these override 'latest' and 'local'.
 *  'latest' - may load latest assets from a CDN which match the expected semantic version
 *  'local' - will only load assets from the local folder.
 *
 * Important: To use 'local', you'll need to have installed a version of Rapid
 *   that has all of these dependencies copied into `/dist/data/modules/`.
 * See https://github.com/rapideditor/rapid-standalone if this is what you need.
 *
 * Properties available:
 *   `sources`   The sources Object contains all the details about where to fetch assets from
 *   `origin`    'local' (all files fetched from dist) or 'latest' (newer files may be fetched from CDN)
 */
export class AssetSystem extends AbstractSystem {
  /** Asset maps organized by origin ('custom', 'latest', and 'local') */
  sources: AssetSources;
  /** Current origin for asset loading - should be 'latest', or 'local' */
  origin: AssetOrigin;
  /** Root folder path for assets, with trailing slash (e.g. 'dist/') */
  filePath: string;
  /** Custom filename replacements, e.g. from Rails asset pipeline */
  fileReplacements: Record<string, string>;

  /** Cache of loaded asset data, keyed by asset identifier */
  private _cache: Record<string, unknown>;
  /** In-flight fetch promises, keyed by URL */
  private _inflight: Record<string, Promise<unknown>>;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'assets';

    this.sources = {
      custom: {},

      latest: {
        'address_formats':      'data/address_formats.min.json',
        'intro_graph':          'data/intro_graph.min.json',
        'intro_rapid_graph':    'data/intro_rapid_graph.min.json',
        'languages':            'data/languages.min.json',
        'locales':              'data/locales.min.json',
        'phone_formats':        'data/phone_formats.min.json',
        'qa_data':              'data/qa_data.min.json',
        'shortcuts':            'data/shortcuts.min.json',
        'territory_languages':  'data/territory_languages.min.json',

        'oci_defaults':   'https://cdn.jsdelivr.net/npm/osm-community-index@5.9/dist/defaults.min.json',
        'oci_features':   'https://cdn.jsdelivr.net/npm/osm-community-index@5.9/dist/featureCollection.min.json',
        'oci_resources':  'https://cdn.jsdelivr.net/npm/osm-community-index@5.9/dist/resources.min.json',

        'wmf_sitematrix':  'https://cdn.jsdelivr.net/npm/wmf-sitematrix@0.2/data/wikipedia.min.json'
      },

      local: {
        'address_formats':      'data/address_formats.min.json',
        'intro_graph':          'data/intro_graph.min.json',
        'intro_rapid_graph':    'data/intro_rapid_graph.min.json',
        'languages':            'data/languages.min.json',
        'locales':              'data/locales.min.json',
        'phone_formats':        'data/phone_formats.min.json',
        'qa_data':              'data/qa_data.min.json',
        'shortcuts':            'data/shortcuts.min.json',
        'territory_languages':  'data/territory_languages.min.json',

        'oci_defaults':   'data/modules/osm-community-index/defaults.min.json',
        'oci_features':   'data/modules/osm-community-index/featureCollection.min.json',
        'oci_resources':  'data/modules/osm-community-index/resources.min.json',

        'wmf_sitematrix':  'data/modules/wmf-sitematrix/wikipedia.min.json'
      }
    };

    // The origin can be set to 'local' or 'latest'
    // (This must set before init, and should not be changed later)
    this.origin = 'latest';

    // The file path defines the root folder that files are stored under.
    // If used, it should have a trailing slash, for example 'dist/'
    // (This must set before init, and should not be changed later)
    this.filePath = '';

    // A custom asset map may be provided by a separate asset management system.
    // (For example this may be provided by the Rails asset pipeline.)
    // This should be in the form of key-value replacement filenames like:
    // {
    //   'original1.json': 'replacement1.json',
    //   'original2.json': 'replacement2.json',
    //   …
    // }
    // (This must set before init, and should not be changed later)
    this.fileReplacements = {};

    this._cache = {};
    this._inflight = {};

    // Mock data for testing, prevents the data from being fetched.
    // Not sure how I feel about this :-/
    /* c8 ignore start */
    const isTestEnvironment = (!('window' in globalThis)) || ('assert' in globalThis) || ('expect' in globalThis);
    if (isTestEnvironment) {
      const c = this._cache;
      c.address_formats = { addressFormats: [{ format: [['housenumber', 'street'], ['city', 'postcode'] ] }] };
      c.editor_layer_index = { assetID: 'editor_layer_index' };
      c.rapid_imagery_overrides = { assetID: 'rapid_imagery_overrides' };
      c.languages = { languages: { de: { nativeName: 'Deutsch' }, en: { nativeName: 'English' } } };
      c.locales = { locales: { en: { rtl: false } } };
      c.phone_formats = { phoneFormats: {} };
      c.shortcuts = { shortcuts: [] };
      c.territory_languages = { territoryLanguages: {} };
      c.iD_schema_deprecated = [{ old: { highway: 'no' } }, { old: { highway: 'ford' }, replace: { ford: '*' } }];
      c.iD_schema_discarded = {};
      c.iD_schema_categories = {};
      c.iD_schema_defaults = {};
      c.iD_schema_fields = {};
      c.iD_schema_presets = {};
      c.rapid_schema_overrides = {};
      c.l10n_core_en = {};
      c.l10n_tagging_en = {};
      c.l10n_imagery_en = {};
      c.l10n_community_en = {};
      c.wmf_sitematrix = [ ['English', 'English', 'en'], ['German', 'Deutsch', 'de'] ];
    }
    /* c8 ignore end */
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
    return super.resetAsync();
  }


  /**
   * setAsset
   * Set an asset in the list of sources.
   * Other systems and services should call this to track the assets they need to load.
   * @param key - asset identifier
   * @param path - file path or URL
   * @param origin - optional, 'custom', 'latest', or 'local' (if missing, sets 'latest' and 'local')
   * @throws Will throw if the given origin is invalid
   */
  setAsset(key: string, path: string, origin?: AssetOrigin): void {
    if (origin) {
      const sources = this.sources[origin];
      if (!sources) {
        throw new Error(`Unknown origin "${origin}"`);
      }
      sources[key] = path;

    } else {
      this.sources.latest[key] = path;
      this.sources.local[key] = path;
    }
  }


  /**
   * getAsset
   * Get an asset path from the list of sources.
   * @param key - asset identifier
   * @param origin - optional, 'custom', 'latest', or 'local' (if missing, returns current origin)
   * @return The asset path or undefined if not found
   * @throws Will throw if the given origin is invalid
   */
  getAsset(key: string, origin: AssetOrigin = this.origin): string | undefined {
    const sources = this.sources[origin];
    if (!sources) {
      throw new Error(`Unknown origin "${this.origin}"`);
    }
    return sources[key];
  }


  /**
   * getFileURL
   * Returns the URL for the given filename.
   *   If the given value is already a URL, it's returned
   *   If the given value is a relative path, return the real location of that file.
   * @param val - asset path
   * @return The real URL pointing to that filename
   */
  getFileURL(val: string): string {
    if (/^http(s)?:\/\//i.test(val)) return val; // already a url

    const filename = `${this.filePath}${val}`;
    return this.fileReplacements[filename] ?? filename;
  }


  /**
   * getAssetURL
   * Returns the URL for the given asset key.
   * @param key - identifier for the asset, should be found in the asset map.
   * @return URL of the asset
   * @throws Will throw if the asset key is not found, or the current origin is invalid
   */
  getAssetURL(key: string): string {
    if (/^http(s)?:\/\//i.test(key)) return key; // already a url

    const sources = this.sources[this.origin];
    if (!sources) {
      throw new Error(`Unknown origin "${this.origin}"`);
    }
    const val = sources[key];
    if (!val) {
      throw new Error(`Unknown asset key "${key}"`);
    }

    return this.getFileURL(val);
  }


  /**
   * loadAssetAsync
   * Returns a Promise to fetch the data identified by the key.
   * @param key - identifier for the data, should be found in the asset map.
   * @return Promise resolved with the data
   */
  loadAssetAsync(key: string): Promise<unknown> {
    if (this._cache[key]) {
      return Promise.resolve(this._cache[key]);
    }

    let url: string;
    try {
      url = this.getAssetURL(key);
    } catch (err) {
      return Promise.reject((err as Error).message);
    }

    let loadPromise = this._inflight[url];
    if (!loadPromise) {
      this._inflight[url] = loadPromise = fetch(url)
        .then(utilFetchResponse)
        .then(result => {
          if (!result) {
            throw new Error(`No data loaded for "${key}"`);
          }
          this._cache[key] = result;
          return result;
        })
        //.catch(err => {
        //  console.error(`key: ${key}, url: ${url}`);
        //  throw new Error(err);
        //})
        .finally(() => {
          delete this._inflight[url];
        });
    }

    return loadPromise;
  }

}
