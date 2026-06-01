import { Extent } from '@rapid-sdk/math';

import type { Context } from '../Context.ts';


const RAPID_MAGENTA = '#da26d3';


/**
 * Properties that define a `RapidDataset`.
 */
export interface RapidDatasetProps {
  /** Unique identifier for this dataset */
  id: DatasetID;
  /** Service providing this dataset: 'esri', 'mapwithai', 'overture' */
  serviceID: ServiceID;
  /** Categories this dataset belongs to (e.g. 'buildings', 'addresses') */
  categories: Set<string>;
  /** Tags/flags for this dataset (e.g. 'opendata') */
  tags: Set<string>;
  /** Display color for this dataset */
  color: string;
  /** Data usage information */
  dataUsed: string[];
  /** Geographic extent of the dataset */
  extent: Extent;
  /** Whether this is an overlay dataset */
  overlay: boolean;
  /** URL for more information about this dataset */
  itemUrl: string;
  /** URL for license information */
  licenseUrl: string;
  /** URL for thumbnail image */
  thumbnailUrl: string;
  /** Whether this dataset appears in the list */
  added: boolean;
  /** Whether this is a beta/preview dataset */
  beta: boolean;
  /** Whether the user has enabled this dataset */
  enabled: boolean;
  /** Whether this is a featured dataset */
  featured: boolean;
  /** Whether this dataset is filtered from the catalog display */
  filtered: boolean;
  /** Whether this dataset is hidden from the catalog (e.g. walkthrough data) */
  hidden: boolean;
  /** Whether this dataset uses conflation */
  conflated: boolean;
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
 * Datasets come from various services (Esri, MapWithAI, Overture, etc.)
 * and contain features like buildings, roads, addresses, etc.
 */
export class RapidDataset {

  public context: Context;
  public id: DatasetID;
  public serviceID: ServiceID;
  public categories: Set<string>;
  public tags: Set<string>;
  public color: string;
  public dataUsed: string[];
  public extent: Extent | undefined;
  public overlay: boolean | undefined;
  public itemUrl: string;
  public licenseUrl: string;
  public thumbnailUrl: string;
  public added: boolean;
  public beta: boolean;
  public enabled: boolean;
  public featured: boolean;
  public filtered: boolean;
  public hidden: boolean;
  public conflated: boolean;
  public labelStringID: StringID | undefined;
  public descriptionStringID: StringID | undefined;
  public label: string;
  public description: string;

  protected _label: string | undefined;
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
    this.categories = props.categories ?? new Set();
    this.tags = props.tags ?? new Set();
    this.color = props.color ?? RAPID_MAGENTA;
    this.dataUsed = props.dataUsed ?? [];
    this.extent = props.extent;
    this.overlay = props.overlay;

    this.itemUrl = props.itemUrl ?? '';
    this.licenseUrl = props.licenseUrl ?? '';
    this.thumbnailUrl = props.thumbnailUrl ?? this.getThumbnail();

    // flags
    this.added = props.added ?? false;
    this.beta = props.beta ?? this.categories.has('preview');
    this.enabled = props.enabled ?? false;
    this.filtered = props.filtered ?? false;
    this.featured = props.featured ?? this.categories.has('featured');
    this.hidden = props.hidden ?? false;
    this.conflated = props.conflated ?? false;

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
}
