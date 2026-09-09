import { DOMParser } from '@xmldom/xmldom';
import { Extent } from '@rapid-sdk/math';
import { GeoJSONData } from '../data/GeoJSONData.ts';
import { geojsonFeatures } from '../util/util.ts';
import { gpx, kml } from '@tmcw/togeojson';

import type { Context } from '../Context.ts';
import type { TreeValue } from './TreeStore.ts';
import type { RapidDataDictionary } from './RapidDataDictionary.ts';
import type { Document as XmlDocument } from '@xmldom/xmldom';
import type { Vec2 } from '@rapid-sdk/math';

const RAPID_MAGENTA = '#da26d3';

/**
 * Prop keys whose values are booleans. The settings store is string-only, so these
 * are persisted as `'true'`/`'false'` strings by `toJSON()` and coerced back to real
 * booleans by `fromJSON()`. Add new boolean props here so they round-trip correctly.
 */
type RapidDatasetBooleanProp = 'beta' | 'conflated' | 'custom' | 'featured' | 'filtered' | 'hidden';
const BOOLEAN_PROPS: RapidDatasetBooleanProp[] = ['beta', 'conflated', 'custom', 'featured', 'filtered', 'hidden'];


/**
 * Properties that define a `RapidDataset`.
 */
export interface RapidDatasetProps {
  /** Unique identifier for this dataset */
  id: DatasetID;
  /** Service providing this dataset: 'esri', 'mapwithai', 'overture' */
  serviceID: ServiceID;

  /** Categories this dataset belongs to (e.g. 'buildings', 'addresses') */
  categories: string[];
  /** Display color for this dataset */
  color: string;
  /** Data usage information */
  dataUsed: string[];
  /** Geographic extent of the dataset */
  extent: Extent;
  /** URL for the data */
  sourceUrl: string;
  /** URL for more information about this dataset */
  itemUrl: string;
  /** URL for license information */
  licenseUrl: string;
  /** URL for thumbnail image */
  thumbnailUrl: string;

  /** Whether this is a beta/preview dataset */
  beta: boolean;
  /** Whether this is a featured dataset */
  featured: boolean;
  /** Whether this dataset is filtered from the catalog display */
  filtered: boolean;
  /** Whether this dataset is hidden from the catalog (e.g. walkthrough data) */
  hidden: boolean;
  /** Whether this dataset uses conflation */
  conflated: boolean;
  /** Whether this dataset is a "custom" dataset (i.e. setup by the user) */
  custom: boolean;

  /** Localization string ID for the label */
  labelStringID: StringID;
  /** Localization string ID for the description */
  descriptionStringID: StringID;
  /** Fallback label if localization not available */
  label: string;
  /** Fallback description if localization not available */
  description: string;
}


/**
 * A `RapidDataset` represents an external source of data that can be loaded into Rapid.
 * Datasets may be provided from various services (Esri, MapWithAI, Overture, etc.)
 * or be a custom dataset without a `serviceID`.
 */
export class RapidDataset {

  /** Global shared application context */
  public context: Context;
  /** Unique identifier for this dataset */
  public id: DatasetID;
  /** Service providing this dataset (e.g. 'esri', 'mapwithai', 'overture') */
  public serviceID: ServiceID;
  /** The data dictionary for this dataset, can be setup once the dataset is added to Rapid */
  public dictionary: RapidDataDictionary | null;

  /** Free-form categories this dataset belongs to (e.g. 'buildings', 'addresses') */
  public categories: Set<string>;
  /** Display color for features from this dataset */
  public color: string;
  /** Source attribution strings shown in the changeset */
  public dataUsed: string[];
  /** Geographic bounding extent of this dataset, if known */
  public extent: Extent | undefined;

  /** URL for the data */
  public sourceUrl: string;
  /** URL for a landing page with more information about this dataset */
  public itemUrl: string;
  /** URL for the license governing use of this dataset */
  public licenseUrl: string;
  /** URL for a thumbnail image representing this dataset */
  public thumbnailUrl: string;

  /** Whether this dataset is in beta/preview status */
  public beta: boolean;
  /** Whether this dataset is featured/promoted in the catalog */
  public featured: boolean;
  /** Whether this dataset is currently hidden by an active catalog filter */
  public filtered: boolean;
  /** Whether this dataset is hidden from the catalog (e.g. internal walkthrough data) */
  public hidden: boolean;
  /** Whether this dataset uses conflation when merging features into the OSM graph */
  public conflated: boolean;
  /** Whether this dataset is a "custom" dataset (i.e. setup by the user) */
  public custom: boolean;

  /** Localization string key for the dataset display name */
  public labelStringID: StringID | undefined;
  /** Localization string key for the dataset description */
  public descriptionStringID: StringID | undefined;
  /** Localized display label (updated whenever the locale changes) */
  public label: string;
  /** Localized description text (updated whenever the locale changes) */
  public description: string;

  /** Fallback label from props, used when no localized string is available */
  protected _label: string | undefined;
  /** Fallback description from props, used when no localized string is available */
  protected _description: string | undefined;


  /**
   * @param context - Global shared application context
   * @param props - Properties for this RapidDataset
   */
  public constructor(context: Context, props: Partial<RapidDatasetProps>) {
    this.context = context;
    this.dictionary = null;    // set up if the dataset is added to Rapid.

    this.id = props.id ?? '';
    this.serviceID = props.serviceID ?? '';
    this.categories = new Set<string>(props.categories ?? []);
    this.color = props.color ?? RAPID_MAGENTA;
    this.dataUsed = props.dataUsed ?? [];
    this.extent = props.extent;

    this.sourceUrl = props.sourceUrl ?? '';
    this.itemUrl = props.itemUrl ?? '';
    this.licenseUrl = props.licenseUrl ?? '';
    this.thumbnailUrl = props.thumbnailUrl ?? this.getThumbnail();

    // flags
    this.beta = props.beta ?? this.categories.has('preview');
    this.filtered = props.filtered ?? false;
    this.featured = props.featured ?? this.categories.has('featured');
    this.hidden = props.hidden ?? false;
    this.conflated = props.conflated ?? false;
    this.custom = props.custom ?? false;

    this.labelStringID = props.labelStringID;
    this.descriptionStringID = props.descriptionStringID;

    // If a `label` or `description` properties are passed in, store them,
    // but prefer to use the methods below to localize on the fly..
    this._label = props.label;
    this._description = props.description;
    this.label = this.getLabel();
    this.description = this.getDescription();
  }


  /**
   * Unique string to identify this dataset
   * @return  This data element's unique ID
   * @readonly
   */
  public get datasetID(): DatasetID {
    return this.id;
  }

  /**
   * Returns `true` if the dataset has been added to the Rapid menu.
   * @return  `true` if the dataset has been added to the Rapid menu.
   * @readonly
   */
  public get added(): boolean {
    const rapid = this.context.systems.rapid!;
    return rapid.addedDatasetIDs.has(this.id);
  }

  /**
   * Returns `true` if the dataset has been checked enabled.
   * @return  `true` if the dataset has been checked enabled.
   * @readonly
   */
  public get enabled(): boolean {
    const rapid = this.context.systems.rapid!;
    return rapid.enabledDatasetIDs.has(this.id);
  }


  /**
   * Choose a default thumbnail if we weren't supplied one.
   * @return URL for thumbnail image
   */
  public getThumbnail(): string {
    let type: string;
    if (this.categories.has('buildings'))     type = 'buildings';
    else if (this.categories.has('footways')) type = 'footways';
    else if (this.categories.has('roads'))    type = 'roads';
    else type = 'points';

    const assets = this.context.systems.assets;
    return assets?.getFileURL(`img/data-${type}.png`) || '';
  }


  /**
   * Attempt to localize the dataset name, fallback to 'label' or 'id'
   * @return Localized label string
   */
  public getLabel(): string {
    const l10n = this.context.systems.l10n;
    return (l10n && this.labelStringID) ? l10n.t(this.labelStringID) : (this._label || this.id);
  }


  /**
   * Attempt to localize the dataset description, fallback to empty string
   * @return Localized description string
   */
  public getDescription(): string {
    const l10n = this.context.systems.l10n;
    return (l10n && this.descriptionStringID) ? l10n.t(this.descriptionStringID) : (this._description || '');
  }

  /**
   * Returns a settings-safe JSON representation of this data element.
   * Boolean flags are serialized as `'true'`/`'false'` strings because the settings
   * store only holds string leaves. Use `fromJSON()` to reconstruct a `RapidDataset`.
   * @return JSON representation of this data element
   */
  public toJSON(): Record<string, TreeValue> {
    const result: Record<string, TreeValue> = { id: this.id };

    if (this.categories.size)      result.categories = [...this.categories];
    if (this.dataUsed.length)      result.dataUsed = this.dataUsed.slice();
    if (this.color)                result.color = this.color;
    if (this.sourceUrl)            result.sourceUrl = this.sourceUrl;
    if (this.itemUrl)              result.itemUrl = this.itemUrl;
    if (this.thumbnailUrl)         result.thumbnailUrl = this.thumbnailUrl;
    if (this.licenseUrl)           result.licenseUrl = this.licenseUrl;
    if (this.labelStringID)        result.labelStringID = this.labelStringID;
    if (this.descriptionStringID)  result.descriptionStringID = this.descriptionStringID;

    // The settings store is string-only, so persist boolean flags as 'true'/'false' strings.
    for (const key of BOOLEAN_PROPS) {
      result[key] = String(this[key]);
    }

    result.label = this.getLabel();
    result.description = this.getDescription();

    return result;
  }


  /**
   * Reconstructs a `RapidDataset` from its persisted JSON form (see `toJSON`).
   * The settings store is string-only, so boolean flags arrive as `'true'`/`'false'`
   * strings and are coerced back to real booleans here.
   * @param context - Global shared application context
   * @param json - The persisted settings object
   * @return A new `RapidDataset`
   */
  public static fromJSON(context: Context, json: Record<string, TreeValue>): RapidDataset {
    const props = { ...json } as Partial<RapidDatasetProps>;

    for (const key of BOOLEAN_PROPS) {
      const val = json[key];
      if (typeof val === 'string') {
        props[key] = (val === 'true');
      }
    }

    return new RapidDataset(context, props);
  }



  //---------------------------------------------------------------------------------------------
  // NOTE: CODE BELOW HERE IS MOSTLY COPIED FROM `PixiLayerCustomData` and `VectorTileService`!!
  // It is used for custom datasets.
  // We chould clean this up

  /**
   * This checks the url that was entered in the url field.
   * It decides whether the url looks like a single file to load or a vector tile template url.
   * NOTE: CODE COPIED FROM `PixiLayerCustomData` !!!
   * @return  Promise resolved when this custom source is ready, or rejected if errors
   */
  public setupCustomDatasetAsync(): Promise<void> {
    if (!this.custom) return Promise.reject(new Error('Not a custom source'));
    if (!this.sourceUrl) return Promise.reject(new Error('No source url'));

    const context = this.context;
    const gfx = context.systems.gfx;
    const network = context.systems.network!;
    const spatial = context.systems.spatial!;
    const spatialID = `rapid-${this.id}`;

    // reset
    spatial.clearCache(spatialID);
    // this._template = null;
    gfx?.deferredRedraw();

    // Strip off any querystring/hash from the url before checking extension
    const url = this.sourceUrl;
    const testUrl = url.toLowerCase().split(/[?#]/)[0];
    const extension = this._getExtension(testUrl);

    if (extension) {   // Looks like a gpx, kml, geojson file.. load it!
      return network.fetch<string | XmlDocument | GeoJSON.GeoJsonObject | null>(url)
        .then(data => {
          this._setFile(data, extension);
        });

    } else {   // Looks like a vector tile url template
      //this._setCustomUrlTemplate(url);
      return Promise.reject(new Error('Unsupported type (currently only support .geojson, .json, .gpx, .kml)'));
    }
  }


  /**
   * A url template is something we can pass to the Vector Tile service. It can be:
   * - Mapbox Vector Tiles (MVT) made available from a z/x/y tileserver
   * - Protomaps .pmtiles single-file archive containing MVT
   * NOTE: CODE COPIED FROM `PixiLayerCustomData` !!!
   * @param url - The URL template
   */
  protected _setCustomUrlTemplate(url: string): void {
    // Test source against OSM imagery blocklists..
    const osm = this.context.services.osm;
    if (osm) {
      const blocklists = osm.imageryBlocklists ?? [];
      let fail: boolean;
      let tested = 0;
      let regex;

      for (regex of blocklists) {
        fail = regex.test(url);
        tested++;
        if (fail) return;   // a banned source
      }

      // ensure at least one test was run.
      if (!tested) {
        regex = /.*\.google(apis)?\..*\/(vt|kh)[\?\/].*([xyz]=.*){3}.*/;
        fail = regex.test(url);
        if (fail) return;   // a banned source
      }
    }

    // this._template = url;

    // strip off the querystring/hash from the template, it often includes the access token
    // this._dataUsed = 'vectortile:' + url.split(/[?#]/)[0];
    // this.scene.enableLayers(this.layerID);  // emits 'layerchange', so UI gets updated
  }


  /**
   * This function is either called from the `FileReader` onload callback, or the `fetch` then chain.
   * It can accept:
   *  - a `string` of text data, in which case it will be parsed according to the given extension.
   *  - a `Document` parsed by `xmldom.DOMParser` (like we would receive from `utilFetchResponse`),
   *  - an `Object`, in the case of JSON/GeoJSON.
   * All files get converted to GeoJSON.
   * NOTE: CODE COPIED FROM `PixiLayerCustomData` !!!
   * @param data - The file data
   * @param extension - The file extension
   */
  protected _setFile(data: string | XmlDocument | GeoJSON.GeoJsonObject | null, extension: string | null | undefined): void {
    if (!data) {
      throw new Error('No data');
    }

    const context = this.context;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial!;
    const spatialID = `rapid-${this.id}`;

    const isString = (typeof data === 'string');
    let geojson: GeoJSON.GeoJsonObject | undefined;
    switch (extension) {
      case '.gpx':
        geojson = gpx(isString ? _parseXML(data as string) : data as XmlDocument);
        break;
      case '.kml':
        geojson = kml(isString ? _parseXML(data as string) : data as XmlDocument);
        break;
      case '.geojson':
      case '.json':
        geojson = isString ? JSON.parse(data as string) : data as GeoJSON.GeoJsonObject;
        break;
    }

    geojson = geojson || {} as GeoJSON.GeoJsonObject;

    if (!Object.keys(geojson).length) {
      throw new Error('Empty geojson');
    }

    // this._dataUsed = `${extension} data file`;
    const newFeatures = [];
    this.extent = new Extent();

    // We may have a Feature or a FeatureCollection, coax it to an array of Features.
    const features = geojsonFeatures(geojson as GeoJSON.Feature | GeoJSON.FeatureCollection);
    for (const feature of features) {
      // We may have a MultiPolygon/MultiLineString/MultiPoint..
      // For our purposes, we really want to work with them as single part features..
      for (const part of this._toSingleFeatures(feature)) {
        const extent = this._calcExtent(part);   // sanity check
        if (!isFinite(extent.min[0])) continue;  // invalid - no coordinates?

        const d = new GeoJSONData(this.context, { geojson: feature });
        newFeatures.push(d);
        this.extent.extendSelf(extent);
      }
    }

    if (newFeatures.length) {
      spatial.addData(spatialID, newFeatures);
      gfx?.deferredRedraw();
    }
    // this.scene.enableLayers(this.layerID);  // emits 'layerchange', so UI gets updated


    /**
     * Create a DOMParser and parse the given string as an XML Document.
     * @param text
     */
    function _parseXML(text: string): XmlDocument {
      return (new DOMParser()).parseFromString(text.trimStart(), 'text/xml');
    }
  }


  /**
   * Return the extension at the end of a filename or url.
   * This only returns the extension if it one of the recognized file types:
   *   '.gpx', '.kml', '.json', '.geojson'
   * NOTE: CODE COPIED FROM `PixiLayerCustomData` !!!
   * @param name - A filename or url
   * @return The extension including the dot '.'
   */
  protected _getExtension(name: string): string | null {
    if (!name) return null;
    const regex = /\.(gpx|kml|(geo)?json)$/i;
    const match = name.match(regex);
    return match?.[0] ?? null;
  }


  /**
   * Call this to convert a multi feature to an array of single features
   * (e.g. convert MultiPolygon to array of Polygons)
   * (If passed a single feature, this will just return the single feature in an array)
   * NOTE: CODE COPIED FROM `VectorTileService` !!!
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
   * Computes the geographic extent covering a GeoJSON feature's geometry.
   * NOTE: CODE COPIED FROM `VectorTileService` !!!
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

}
