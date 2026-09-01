import { Extent } from '@rapid-sdk/math';

import type { Context } from '../Context.ts';
import type { TreeValue } from './TreeStore.ts';


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
   * @constructor
   * @param context - Global shared application context
   * @param props - Properties for this RapidDataset
   */
  public constructor(context: Context, props: Partial<RapidDatasetProps>) {
    this.context = context;

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
}
