import { utilObjectOmit, utilSafeString } from '@rapid-sdk/util';

import { Collection } from './Collection.js';


/**
 *  Category
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
    this.orig.members = props.members ?? [];

    // Convert some `props` properties to class properties.. (others will become class functions)
    Object.assign(this, utilObjectOmit(this.orig, ['name', 'matchScore', 'members']));

    const allPresets = context.systems.presets.allPresets;
    const presets = this.orig.members.map(presetID => allPresets[presetID]).filter(Boolean);
    this.members = new Collection(context, presets);

    this.geometry = presets
      .reduce((acc, preset) => {
        for (let i in preset.geometry) {
          const geometry = preset.geometry[i];
          if (acc.indexOf(geometry) === -1) {
            acc.push(geometry);
          }
        }
        return acc;
      }, []);

    // caches
    this._searchName = null;
    this._searchNameStripped = null;
  }


  matchGeometry(geom) {
    return this.geometry.includes(geom);
  }

  matchAllGeometry(geometries) {
    return this.members.array.some(preset => preset.matchAllGeometry(geometries));
  }

  matchScore() {
    return -1;
  }

  name() {
    return this.context.systems.l10n.t(`_tagging.presets.categories.${this.id}.name`, { 'default': this.id });
  }

  nameLabel() {
    return this.context.systems.l10n.tHtml(`_tagging.presets.categories.${this.id}.name`, { 'default': this.id });
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
