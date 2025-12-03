import { utilObjectOmit, utilSafeString } from '@rapid-sdk/util';

import { Collection } from './Collection.js';


/**
 * Category
 * A Category is a thematic collection of Presets.
 * For example "Major Roads", "Barriers", "Buildings", "Golf Features"..
 * The Rapid user interface shows categories as expandable folders.
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

    this.id = props.id;
    this.safeid = utilSafeString(props.id);    // for use in classes, element ids, css selectors

    // Preserve and cleanup all original properties..
    this.orig = {};
    this.orig.name = props.name ?? '';
    this.orig.icon = props.icon;
    this.orig.matchScore = -1;
    this.orig.members = props.members ?? [];  // "members" here are presetIDs

    // Convert some `props` properties to class properties.. (others will become class functions)
    Object.assign(this, utilObjectOmit(this.orig, ['name', 'matchScore', 'members']));

    this.resetCache();
  }


  /**
   * resetCache
   * Resets all cached data.
   */
  resetCache() {
    const context = this.context;
    const presets = context.systems.presets;
    const allPresets = presets.allPresets;

    // Include only Presets that are currently known to the PresetSystem.
    const foundPresets = this.orig.members.map(presetID => allPresets[presetID]).filter(Boolean);
    this.members = new Collection(context, foundPresets);

    // The geometries for this category will include all geometries of its presets.
    this.geometries = new Set();
    for (const preset of foundPresets) {
      this.geometries = this.geometries.union(preset.geometries);
    }

    this._searchName = null;
    this._searchNameStripped = null;
  }


  matchScore() {
    return -1;
  }

  name() {
    const l10n = this.context.systems.l10n;
    return l10n?.t(`_tagging.presets.categories.${this.id}.name`, { 'default': this.id }) || this.orig.name;
  }

  nameLabel() {
    const l10n = this.context.systems.l10n;
    return l10n?.tHtml(`_tagging.presets.categories.${this.id}.name`, { 'default': this.id }) || this.orig.name;
  }

  terms() {
    return [];
  }

  searchName() {
    if (!this._searchName) {
      this._searchName = this.name().toLowerCase();
    }
    return this._searchName;
  }

  searchNameStripped() {
    if (!this._searchNameStripped) {
      this._searchNameStripped = this._stripDiacritics(this.searchName());
    }
    return this._searchNameStripped;
  }

  searchAliases() {
    return [];
  }

  searchAliasesStripped() {
    return [];
  }

  isFallback() {
    return false;
  }

  _stripDiacritics(s) {
    // split combined diacritical characters into their parts
    if (s.normalize) s = s.normalize('NFD');
    // remove diacritics
    s = s.replace(/[\u0300-\u036f]/g, '');
    return s;
  }

}
