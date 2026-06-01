import { utilSafeString } from '@rapid-sdk/util';
import { utilGatherTokens } from '../util/string.ts';

import type { Context } from '../Context.ts';
import type { Preset } from './Preset.ts';
import type { LocationSet } from '@rapideditor/location-conflation';


/**
 * Properties that define a Category.
 * @see https://github.com/ideditor/schema-builder/blob/main/schemas/preset_category.json
 */
export interface CategoryProps {
  /** Unique identifier for this Category */
  id: CategoryID;
  /** The asset that this Category came from (e.g. 'id_tagging_schema') */
  assetID?: AssetID;
  /** The asset version that this Category came from (e.g. '^6.6.0') */
  assetVersion?: string;
  /** The scope that this Category applies to (e.g. 'osm') */
  scopeID?: ScopeID;
  /** Display name (fallback if localization unavailable) */
  name: string;
  /** Array of preset IDs that belong to this Category */
  members: PresetID[];
  /** Whether this Category appears in search results */
  searchable: boolean;
  /** Match score for ranking search results (always -1 for Categories) */
  matchScore: number;
  /** Name of preset icon which represents this preset */
  icon: string;
  /** URL of a remote image that is more specific than 'icon' */
  imageURL: string;
  /** Region IDs where this category is or isn't valid. See: https://github.com/ideditor/location-conflation */
  locationSet?: LocationSet;
  /** Resolved locationSet ID (added by SchemaSystem after processing locationSet) */
  locationSetID?: LocationSetID;
  /** Extra properties are allowed */
  [key: string]: unknown;
}


/** Localized strings for a Category */
interface CategoryStrings {
  id: CategoryID;
  type: string;
  suggestion: boolean;
  name: string;
  terms: string[];
  aliases: string[];
  primary: string;
  alternate: string;
}


/**
 * A `Category` is a thematic collection of Presets.
 * For example "Major Roads", "Barriers", "Buildings", "Golf Features"..
 * The Rapid user interface shows categories in the preset list as expandable folders.
 * See: https://github.com/ideditor/schema-builder/blob/main/schemas/preset_category.json
 *
 * Properties available:
 * - `id` (or `categoryID`)  Unique string to identify this Category.
 * - `safeid`                The id, but safe for use in classes, DOM element ids, css selectors..
 * - `props`                 Properties object
 * - `geometries`            `Set<GeometryType>` Geometries that this Category works with
 * - `presets`               `Array<Preset>` Presets in this Category
 */
export class Category {

  /** Global shared application context */
  public context: Context;
  /** Discriminator constant; always `'category'` */
  public type = 'category' as const;
  /** Unique identifier for this Category */
  public id: CategoryID;
  /** Version of `id` safe for use in CSS selectors and DOM element IDs */
  public safeid: string;
  /** Alias for `id`; provided for consistency with other schema classes */
  public categoryID: CategoryID;
  /** Full properties object (see `CategoryProps`) */
  public props: CategoryProps;
  /** Union of geometry types supported by all member presets */
  public geometries: Set<GeometryType>;
  /** Resolved `Preset` instances that belong to this Category */
  public presets: Preset[];

  /** Pre-localized display strings keyed by locale code */
  protected _strings: Map<string, CategoryStrings>;
  /** The locale code in effect when `_currStrings` was last computed */
  protected _currLocaleCode: LocaleCode | null;
  /** Display strings for the current locale (name, terms, search tokens) */
  protected _currStrings: CategoryStrings;


  /**
   * @constructor
   * @param context - Global shared application context
   * @param props - Properties for this Category
   */
  public constructor(context: Context, props: Partial<CategoryProps> = {}) {
    this.context = context;
    this.type = 'category';

    if (!props.id) {
      throw new Error('Category missing id property');
    }

    this._strings = new Map();    // Map<localeCode, Object> to store pre-localized text strings
    this._currLocaleCode = null;  // The current locale code
    this._currStrings = {} as CategoryStrings;  // The current strings

    // Preserve properties and assign some defaults
    this.props = structuredClone(props) as CategoryProps;
    this.props.name ??= props.id;  // default to id if not provided
    this.props.matchScore = -1;
    this.props.members ??= [];  // "members" here are presetIDs
    this.props.searchable ??= true;

    this.id = props.id;                       // For consistency, offer a `this.id` property.
    this.safeid = utilSafeString(props.id);   // For use in classes, element ids, css selectors

    // For convenient access:
    this.categoryID = this.props.id;
    this.geometries = new Set();
    this.presets = [];
  }


  /**
   * Resets all cached data.
   * This should happen whenever SchemaSystem merges in new data.
   * You must add the Category to the SchemaSystem and call `reset` before using the Category.
   */
  public reset(): void {
    const context = this.context;
    const l10n = context.systems.l10n;
    const schema = context.systems.schema;

    // Include only Presets that are currently known to the SchemaSystem.
    this.presets = (this.props.members ?? [])
      .map(presetID => schema?.getScope('osm').presets.get(presetID))
      .filter((p): p is Preset => !!p);

    // The geometries available for this category will include all geometries of its presets.
    this.geometries = new Set();
    for (const preset of this.presets) {
      this.geometries = this.geometries.union(preset.geometries);
    }

    // Invalidate any cached string localizations and redo for the current locale.
    this._strings.clear();
    this.setLocale(l10n?.localeCode || 'en-US');
  }


  /**
   * Changes the locale and re-localizes the strings.
   * This should happen whenever LocalizationSystem changes the locale.
   * This is done early because we want the strings indexed by the SchemaSystem for searching.
   * @param localeCode - the locale code to switch to (defaults to 'en-US')
   */
  public setLocale(localeCode: LocaleCode = 'en-US'): void {
    this._currLocaleCode = localeCode;
    if (this._strings.has(localeCode)) return;  // done already

    const l10n = this.context.systems.l10n;

    // Pre-localize and store strings so that the Miniseach full-text search can index these.
    // Categories are simple because they are just a `name` as a string.
    // No `terms` or `aliases`, but we include them as empty strings for compatibility with Presets.
    //
    // "category-golf": {
    //     "name": "Golf Features"
    // },

    const fallbackName = this.props.name || this.id;
    const nameStr = l10n?.t(`_tagging.presets.categories.${this.id}.name`, { 'default': '' }) || fallbackName;

    // We'll gather the search tokens ourselves into "primary" and "alternate" sets.
    // This is because once a token is seen in one field, we don't want it to appear again in another field.
    // (When search terms match in multiple fields, this can boost the Minisearch score, so a Preset
    // that happens to have redundant terms gets unfairly boosted in the search results)
    // The "primary" set will contain the preset name.
    // The "alternate" set will contain related terms and tag values a user might search for.
    const primary = new Set<string>();
    const alternate = new Set<string>();
    utilGatherTokens(nameStr, primary, alternate, true);

    this._currStrings = {
      id: this.id,
      type: this.type,
      suggestion: false,
      name: nameStr.trim(),
      terms: [],    // not used for Categories
      aliases: [],  // not used for Categories
      primary: [...primary].join(),      // Primary search terms (generally the name)
      alternate: [...alternate].join()   // Alternate search terms (aliases, tags, etc)
    };

    this._strings.set(this._currLocaleCode, this._currStrings);
  }


  /**
   * The name is the main display name of the Category, as shown in the user interface.
   * @return  Localized name
   * @readonly
   */
  public get name(): string {
    return this._currStrings.name;
  }

  /**
   * Aliases are alternate names for this Category, they may be displayed in the user interface.
   * This is not currently used by Categories, so it will always return an empty Array, '[]'.
   * @return  Localized aliases, always empty Array '[]' for Categories
   * @readonly
   */
  public get aliases(): string[] {
    return [];
  }

  /**
   * Terms are related words used for seraching for this Preset.
   * This is not currently used by Categories, so it will always return an empty Array, '[]'.
   * @return  Localized search terms, always empty Array '[]' for Categories
   * @readonly
   */
  public get terms(): string[] {
    return [];
  }

  /**
   * Matchscore is used for ranking search results.  Always returns `-1` for Categories
   * @return  Always returns `-1` for Categories
   */
  public matchScore(): number {
    return -1;
  }

  /**
   * Is this a fallback preset?  Always returns `false` for Categories.
   * @return  Always returns `false` for Categories
   */
  public isFallback(): boolean {
    return false;
  }

  /**
   * Is this one of the builtin objects?
   * We consider it "builtin" if it doesn't have a `assetID` (i.e. added via a merge).
   * (There are not builtin categories at this time, only the fallback presets are builtin).
   * @return  Returns `true` if this is a builtin Category, `false` if not
   */
  public isBuiltin(): boolean {
    return !this.props.assetID;
  }

}
