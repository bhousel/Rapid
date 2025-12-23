import { utilSafeString } from '@rapid-sdk/util';

import { utilGatherTokens } from '../util/string.js';


/**
 * Category
 * A Category is a thematic collection of Presets.
 * For example "Major Roads", "Barriers", "Buildings", "Golf Features"..
 * The Rapid user interface shows categories in the preset list as expandable folders.
 * See: https://github.com/ideditor/schema-builder/blob/main/schemas/preset_category.json
 *
 * Properties you can access:
 *   `id` (or `categoryID`)  Unique string to identify this Category.
 *   `safeid`                The id, but safe for use in classes, DOM element ids, css selectors..
 *   `props`                 Properties object
 *   `geometries`            `Set<string>` Geometries that this Category works with
 *   `presets`               `Array<Preset>` Presets in this Category
 */
export class Category {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   * @param  {Object}   props   - Object containing the properties for this Category
   */
  constructor(context, props = {}) {
    this.context = context;
    this.type = 'category';

    if (!props.id) {
      throw new Error('Category missing id property');
    }

    this._strings = new Map();    // Map<localeCode, Object> to store pre-localized text strings
    this._currLocaleCode = null;  // The current locale code
    this._currStrings = {};       // The current strings

    // Preserve properties and assign some defaults
    this.props = globalThis.structuredClone(props);
    this.props.matchScore = -1;
    this.props.members ??= [];  // "members" here are presetIDs
    this.props.searchable ??= true;

    this.id = props.id;                       // For consistency, offer a `this.id` property.
    this.safeid = utilSafeString(props.id);   // For use in classes, element ids, css selectors

    // For convenient access:
    this.categoryID = this.props.id;
  }


  /**
   * reset
   * Resets all cached data.
   * This should happen whenever SchemaSystem merges in new data.
   * You must add the Category to the SchemaSystem and call `reset` before using the Category.
   */
  reset() {
    const context = this.context;
    const l10n = context.systems.l10n;
    const schema = context.systems.schema;

    // Include only Presets that are currently known to the SchemaSystem.
    this.presets = this.props.members.map(presetID => schema.presets.get(presetID)).filter(Boolean);

    // The geometries available for this category will include all geometries of its presets.
    this.geometries = new Set();
    for (const preset of this.presets) {
      this.geometries = this.geometries.union(preset.geometries);
    }

    // Invalidate any cached string localizations and redo for the current locale.
    this._strings.clear();
    this.setLocale(l10n?.localeCode() || 'en-US');
  }


  /**
   * setLocale
   * Changes the locale and re-localizes the strings.
   * This should happen whenever LocalizationSystem changes the locale.
   * This is done early because we want the strings indexed by the SchemaSystem for searching.
   */
  setLocale(localeCode = 'en-US') {
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
    const primary = new Set();
    const alternate = new Set();
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
   * name
   * The name is the main display name of the Category, as shown in the user interface.
   * @return  {string}  Localized name
   */
  name() {
    return this._currStrings.name;
  }

  /**
   * aliases
   * Aliases are alternate names for this Category, they may be displayed in the user interface.
   * This is not currently used by Categories, so it will always return an empty Array, '[]'.
   * @return  {Array<string>}  Localized aliases, always empty Array '[]' for Categories
   */
  aliases() {
    return [];
  }

  /**
   * terms
   * Terms are related words used for seraching for this Preset.
   * This is not currently used by Categories, so it will always return an empty Array, '[]'.
   * @return  {Array<string>}  Localized search terms, always empty Array '[]' for Categories
   */
  terms() {
    return [];
  }

  /**
   * matchScore
   * Matchscore is used for ranking search results.  Always returns `-1` for Categories
   * @return  {number}  Always returns `-1` for Categories
   */
  matchScore() {
    return -1;
  }

  /**
   * isFallback
   * Is this a fallback preset?  Always returns `false` for Categories.
   * @return  {boolean}  Always returns `false` for Categories
   */
  isFallback() {
    return false;
  }

}
