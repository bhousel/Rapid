import { utilSafeString } from '@rapid-sdk/util';


/**
 * Category
 * A Category is a thematic collection of Presets.
 * For example "Major Roads", "Barriers", "Buildings", "Golf Features"..
 * The Rapid user interface shows categories in the preset list as expandable folders.
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

    if (!props.id) {
      throw new Error('Category missing id property');
    }

    // Preserve properties and assign some defaults
    this.props = globalThis.structuredClone(props);
    this.props.name ??= '';
    this.props.matchScore = -1;
    this.props.members ??= [];  // "members" here are presetIDs

    this.id = props.id;                       // For consistency, offer a `this.id` property.
    this.safeid = utilSafeString(props.id);   // For use in classes, element ids, css selectors

    // For convenient access:
    this.categoryID = this.props.id;

    this.resetCache();
  }


  /**
   * resetCache
   * Resets all cached data.
   */
  resetCache() {
    const context = this.context;
    const schema = context.systems.schema;

    // Include only Presets that are currently known to the SchemaSystem.
    this.presets = this.props.members.map(presetID => schema.presets.get(presetID)).filter(Boolean);

    // The geometries for this category will include all geometries of its presets.
    this.geometries = new Set();
    for (const preset of this.presets) {
      this.geometries = this.geometries.union(preset.geometries);
    }

    this._searchName = null;
    this._searchNameStripped = null;
  }


  /**
   * name
   * Returns a localized name, if possible.  Falls back to original name.
   * @return  {string}  Localized name
   */
  name() {
    const l10n = this.context.systems.l10n;
    return l10n?.t(`_tagging.presets.categories.${this.id}.name`, { 'default': this.id }) || this.props.name;
  }

  /**
   * nameLabel
   * Returns a localized name HTML, if possible.  Falls back to original name.
   * @return  {string}  Localized name HTML
   */
  nameLabel() {
    const l10n = this.context.systems.l10n;
    return l10n?.tHtml(`_tagging.presets.categories.${this.id}.name`, { 'default': this.id }) || this.props.name;
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
   * terms
   * Search terms, always returns `[]` for Categories.
   * @return  {Array<string>}  Always returns `[]` for Categories
   */
  terms() {
    return [];
  }

  /**
   * searchName
   * The name used for searching - basically the `name()` but forced lowercase.
   * @return  {string}  The name used for searching
   */
  searchName() {
    if (!this._searchName) {
      this._searchName = this.name().toLowerCase();
    }
    return this._searchName;
  }

  /**
   * searchNameStripped
   * The name used for searching, but with diacritic marks normalized (e.g. 'á' -> 'a').
   * @return  {string}  The name used for searching, but with diacritic marks normalized.
   */
  searchNameStripped() {
    if (!this._searchNameStripped) {
      this._searchNameStripped = this._stripDiacritics(this.searchName());
    }
    return this._searchNameStripped;
  }

  /**
   * searchAliases
   * Aliases for searching, always returns `[]` for Categories.
   * @return  {Array<string>}  Always returns `[]` for Categories
   */
  searchAliases() {
    return [];
  }

  /**
   * searchAliasesStripped
   * Aliases used for searching, but with diacritic marks normalized (e.g. 'á' -> 'a').
   * Always returns `[]` for Categories.
   * @return  {Array<string>}  Always returns `[]` for Categories
   */
  searchAliasesStripped() {
    return [];
  }

  /**
   * isFallback
   * Is this a fallback preset?  Always returns `false` for Categories.
   * @return  {boolean}  Always returns `false` for Categories
   */
  isFallback() {
    return false;
  }

  /**
   * _stripDiacritics
   * Internal function for normalizing strings to remove diacritic marks.
   * @param   {string}  s - the input string to normalize
   * @return  {string}  the normalized string
   */
  _stripDiacritics(s) {
    // split combined diacritical characters into their parts
    if (s.normalize) s = s.normalize('NFD');
    // remove diacritics
    s = s.replace(/[\u0300-\u036f]/g, '');
    return s;
  }

}
