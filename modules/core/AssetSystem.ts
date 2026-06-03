import { AbstractSystem } from './AbstractSystem.ts';
import { utilExtractValues } from '../util/string.ts';

import type { Context } from '../Context.ts';


/**
 * An `AssetOrigin` describes an strategy for fetching an asset.
 * 'preferred' is checked first, then either 'latest' or 'local' are checked as fallback.
 */
export type AssetOrigin = 'latest' | 'local' | 'preferred';

/**
 * An `AssetPath` is a string path we can use to load the asset
 * It should be either a relative path (e.g. 'data/languages.min.json')
 * or an absolute URL (e.g. 'https://cdn.jsdelivr.net/npm/…').
 */
export type AssetPath = string;

/**
 * An `AssetSource` lists the various alternatives for loading assets.
 * It represents a mapping from the available asset origins to asset paths.
 */
export interface AssetSource {
  /** 'latest' - Latest assets prioritize freshness, they may load from a CDN */
  latest?: AssetPath;
  /** 'local' - Local assets must be included with Rapid - for offline/standalone use */
  local?: AssetPath;
  /** 'preferred' - Preferred assets take priority over the 'latest' or 'local' assets */
  preferred?: AssetPath;
}

type BundlePartID = string;

/**
 * A `BundleAssetSource` describes a bundle - multiple files that are fetched together
 * and returned as a combined object. Each part is keyed by its partID.
 */
export interface BundleAssetSource {
  /** Map of PartID to AssetSource for each part of the bundle */
  parts: Record<BundlePartID, AssetSource>;
}


/**
 * `AssetSystem` keeps track of files and data that Rapid needs to load.
 *
 * Information about the assets can be found in the `sources` structure.
 * Each `AssetSource` lists the alternative paths for loading the asset.
 * - 'latest':  Latest assets prioritize freshness - they may load from a CDN.
 * - 'local':  Local assets must be included with Rapid - for environments where CDN is not allowed.
 * - 'preferred':  Preferred assets always take priority over the 'latest' or 'local' sources.
 *
 * When resolving an asset path, the system checks 'preferred' first, followed by the `this.origin` value.
 * `this.origin` defaults to 'latest', but can be set to 'local' before init.
 *
 * Important: To use 'local', you'll need to have installed a version of Rapid that
 *   has all of these dependencies copied into `/dist/data/modules/`.
 * See https://github.com/rapideditor/rapid-standalone if this is what you need.
 *
 * Properties available:
 *   `sources`   The sources Object contains all the details about where to fetch assets from
 *   `origin`    'latest' or 'local' - the fallback origin when asset is not found in 'preferred'
 */
export class AssetSystem extends AbstractSystem {

  /**
   * Map of string AssetID to AssetSource record of properties.
   * AssetIDs are string identifiers like 'address_formats', 'languages', 'oci_defaults'.
   */
  public sources: Record<AssetID, AssetSource>;

  /** Map of bundled assets - multiple files fetched together and returned as combined object */
  public bundles: Record<AssetID, BundleAssetSource>;

  /**
   * Fallback origin
   * The fallback origin (checked after 'preferred') must be set to 'local' or 'latest'.
   * (This must set before init, and should not be changed later)
   */
  public origin: 'latest' | 'local';

  /**
   * Root folder path for assets, with trailing slash (e.g. 'dist/')
   * The file path defines the root folder that files are stored under.
   * If used, it should have a trailing slash, for example 'dist/'
   * (This must set before init, and should not be changed later)
   */
  public filePath: string;

  /**
   * Custom filename replacements, e.g. from Rails asset pipeline
   * A custom asset map may be provided by a separate asset management system.
   * (For example this may be provided by the Rails asset pipeline.)
   * This should be in the form of key-value replacement filenames like:
   * ```ts
   * {
   *   'original1.json': 'replacement1.json',
   *   'original2.json': 'replacement2.json',
   *   …
   * }
   * ```
   * (This must set before init, and should not be changed later)
   */
  public fileReplacements: Record<string, string>;

  /** Cache of loaded asset data, keyed by asset identifier */
  protected _loaded: Record<AssetID, unknown>;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'assets';
    this.requiredDependencies = new Set<SystemID>(['network']);
    this.optionalDependencies = new Set<SystemID>(['urlhash']);

    this.sources = {
      'address_formats':      { preferred: 'data/address_formats.min.json' },
      'intro_graph':          { preferred: 'data/intro_graph.min.json' },
      'intro_rapid_graph':    { preferred: 'data/intro_rapid_graph.min.json' },
      'languages':            { preferred: 'data/languages.min.json' },
      'locales':              { preferred: 'data/locales.min.json' },
      'phone_formats':        { preferred: 'data/phone_formats.min.json' },
      'qa_data':              { preferred: 'data/qa_data.min.json5' },
      'shortcuts':            { preferred: 'data/shortcuts.min.json5' },
      'territory_languages':  { preferred: 'data/territory_languages.min.json' },

      'oci_defaults': {
        latest: 'https://cdn.jsdelivr.net/npm/osm-community-index@5.9/dist/defaults.min.json',
        local:  'data/modules/osm-community-index/defaults.min.json'
      },
      'oci_features': {
        latest: 'https://cdn.jsdelivr.net/npm/osm-community-index@5.9/dist/featureCollection.min.json',
        local:  'data/modules/osm-community-index/featureCollection.min.json'
      },
      'oci_resources': {
        latest: 'https://cdn.jsdelivr.net/npm/osm-community-index@5.9/dist/resources.min.json',
        local:  'data/modules/osm-community-index/resources.min.json'
      },
      'wmf_sitematrix': {
        latest: 'https://cdn.jsdelivr.net/npm/wmf-sitematrix@0.2/data/wikipedia.min.json',
        local:  'data/modules/wmf-sitematrix/wikipedia.min.json'
      }
    };

    this.bundles = {};

    this.origin = 'latest';
    this.filePath = '';
    this.fileReplacements = {};

    this._loaded = {};
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const urlhash = context.systems.urlhash;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [ urlhash?.initAsync() ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        const hash = urlhash?.initialHashParams || new Map<string, string>();

        // Parse `assets` parameter: `key|value` pairs separated by commas
        // e.g. `assets=my_presets|https://example.com/presets.json,my_imagery|https://example.com/imagery.json`
        // Assets specified this way are always flagged as 'preferred'.
        const str = hash.get('assets') || '';
        const vals = utilExtractValues(str, /[,;|]/).filter(Boolean);  // keep slashes
        for (let i = 0; i < vals.length; i += 2) {
          const [k, v] = [vals[i], vals[i+1]];
          if (k && v) {
            this.registerAsset(k, { preferred: v });
          }
        }
      });
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
    return super.resetAsync();
  }


  /**
   * Add an AssetSource to the list of sources.
   * Other systems and services should call this to track any assets that they need to load.
   * @param assetID - asset identifier
   * @param assetSource - source information
   * @param source
   * @throws Will throw if a reserved assetID is used.
   */
  public registerAsset(assetID: AssetID, source: AssetSource = {}): void {
    if (assetID === 'default') {
      throw new Error(`AssetSystem: assetID "${assetID}" is a reserved word`);
    }
    this.sources[assetID] = source;
  }


  /**
   * Register a bundle - multiple files that are fetched together and returned as a combined object.
   * This is useful when logically related data is split across multiple files (e.g. id_tagging_schema).
   * @param assetID - bundle identifier
   * @param parts - Object mapping a BundlePartID to AssetSource for each part
   * @throws Will throw if a reserved assetID is used.
   */
  public registerBundleAsset(assetID: AssetID, parts: Record<BundlePartID, AssetSource>): void {
    if (assetID === 'default') {
      throw new Error(`AssetSystem: assetID "${assetID}" is a reserved word`);
    }
    this.bundles[assetID] = { parts };
  }


  /**
   * Returns the URL for the given filename.
   *   If the given value is already a URL, it's returned
   *   If the given value is a relative path, return the real location of that file.
   * @param val - asset path
   * @return The real URL pointing to that filename
   */
  public getFileURL(val: AssetPath): string {
    if (/^http(s)?:\/\//i.test(val)) return val;  // already a url

    const filename = `${this.filePath}${val}`;
    return this.fileReplacements[filename] ?? filename;
  }


  /**
   * Returns the URL for the given asset key.
   * Checks the 'preferred' origin first, then falls back to the current origin ('latest' or 'local').
   * @param key - identifier for the asset, should be found in the asset map.
   * @param assetID
   * @return URL of the asset
   * @throws Will throw if the assetID is not found, or if an asset path can't be determined
   */
  public getAssetURL(assetID: AssetID): string {
    if (/^http(s)?:\/\//i.test(assetID)) return assetID;  // already a url

    const source = this.sources[assetID];
    if (!source) {
      throw new Error(`AssetSystem: Unknown assetID "${assetID}"`);
    }

    let path;
    if (source.preferred) {
      path = source.preferred;
    } else if (source[this.origin]) {
      path = source[this.origin];
    }

    if (!path) {
      throw new Error(`AssetSystem: No asset found for assetID "${assetID}" - "preferred" or "${this.origin}"`);
    } else {
      return this.getFileURL(path);
    }
  }


  /**
   * Returns a Promise to fetch the data identified by the assetID.
   * @param assetID - identifier for the data, should be found in the asset map.
   * @return Promise resolved with the data
   */
  public loadAssetAsync(assetID: AssetID): Promise<unknown> {
    if (this._loaded[assetID]) {
      return Promise.resolve(this._loaded[assetID]);
    }

    // Check if this is a bundle asset
    if (this.bundles[assetID]) {
      return this.loadBundleAssetAsync(assetID);
    }

    let url: string;
    try {
      url = this.getAssetURL(assetID);
    } catch (err) {
      return Promise.reject((err as Error).message);
    }

    const network = this.context.systems.network!;
    return network.fetch(url, { requestID: `asset-${assetID}` as RequestID })
      .then(data => {
        if (!data) {
          throw new Error('No data');
        }
        this._loaded[assetID] = data;
        return data;
      })
      .catch(err => {
        const info = { assetID, url };
        const message = `AssetSystem: ${err.message}\n`;
        console.error(message, JSON.stringify(info));  // eslint-disable-line no-console
        throw new Error(err);
      });
  }


  /**
   * Load all parts of a bundle asset in parallel and return a combined object.
   * The returned object has the `assetID` plus each `BundlePartID` as keys.
   * @param assetID - asset identifier for the bundle
   * @return Promise resolved with combined data object
   */
  public loadBundleAssetAsync(assetID: AssetID): Promise<Record<BundlePartID, unknown>> {
    if (this._loaded[assetID]) {
      return Promise.resolve(this._loaded[assetID] as Record<BundlePartID, unknown>);
    }

    const bundle = this.bundles[assetID];
    if (!bundle) {
      return Promise.reject(`AssetSystem: Unknown bundle assetID "${assetID}"`);
    }

    const network = this.context.systems.network!;
    const partIDs: BundlePartID[] = Object.keys(bundle.parts);
    const partPromises = partIDs.map(partID => {
      const source = bundle.parts[partID];
      const path = source.preferred ?? source[this.origin];
      if (!path) {
        return Promise.reject(`No asset path found for bundle part "${partID}"`);
      }

      const url = this.getFileURL(path);
      return network.fetch(url, { requestID: `asset-${assetID}-${partID}` as RequestID })
        .then(data => {
          if (!data) {
            throw new Error(`No data`);
          }
          return { partID, data };
        })
        .catch(err => {
          const info = { assetID, partID, url };
          const message = `AssetSystem: ${err.message}\n`;
          console.error(message, JSON.stringify(info));  // eslint-disable-line no-console
          throw new Error(err);
        });
    });

    // Type guard, see https://stackoverflow.com/a/73913774/7620
    const isFulfilled = <T,>(p: PromiseSettledResult<T>): p is PromiseFulfilledResult<T> => p.status === 'fulfilled';

    return Promise.allSettled(partPromises)
      .then(results => {
        const fulfilledValues = results.filter(isFulfilled).map(p => p.value);
        const combined: Record<BundlePartID, unknown> = { assetID };

        for (const value of fulfilledValues) {
          const { partID, data } = value;
          combined[partID] = data;
        }

        this._loaded[assetID] = combined;
        return combined;
      });
  }

}
