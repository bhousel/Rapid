import { utilArrayUniq, utilObjectOmit, utilSafeString } from '@rapid-sdk/util';

import { osmAreaKeys } from '../../data/lib/tags.js';


/**
 *  Preset
 */
export class Preset {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   * @param  {Object}   props   - Object containing the properties for this Preset
   */
  constructor(context, props = {}) {
    this.context = context;

    if (!props.id) {
      throw new Error('Preset missing id property');
    }

    this.id = props.id;
    this.safeid = utilSafeString(props.id);    // for use in classes, element ids, css selectors

    // Preserve and cleanup all original properties..
    this.orig = {};
    this.orig.addTags = props.addTags ?? props.tags ?? {};
    this.orig.aliases = props.aliases ?? [];
    this.orig.fields = props.fields ?? [];
    this.orig.geometry = props.geometry ?? [];
    this.orig.icon = props.icon;
    this.orig.imageURL = props.imageURL;
    this.orig.locationSet = props.locationSet;
    this.orig.matchScore = props.matchScore ?? 1;
    this.orig.moreFields = props.moreFields ?? [];
    this.orig.name = props.name ?? '';
    this.orig.reference = props.reference ?? {};
    this.orig.removeTags = props.removeTags ?? props.addTags ?? props.tags ?? {};
    this.orig.replacement = props.replacement;
    this.orig.searchable = props.searchable ?? true;
    this.orig.suggestion = props.suggestion;  // warning - not in the schema, but code uses it
    this.orig.tags = props.tags ?? {};
    this.orig.terms = (props.terms ?? []).join();

    // Convert some `props` properties to class properties.. (others will become class functions)
    Object.assign(this, utilObjectOmit(this.orig, ['aliases', 'fields', 'matchScore', 'moreFields', 'name', 'reference', 'terms']));

    this.resetCache();
  }


  /**
   * resetCache
   * Resets all cached data.
   */
  resetCache() {
    this._resolved = { fields: null, moreFields: null };
    this._searchName = null;
    this._searchNameStripped = null;
    this._searchAliases = null;
    this._searchAliasesStripped = null;
  }


  aliases() {
    return this._resolveName('name')
      .t('aliases', { 'default': this.orig.aliases }).trim().split(/\s*[\r\n]+\s*/);
  }

  name() {
    return this._resolveName('name').t('name', { 'default': this.orig.name || this.id });
  }

  nameLabel() {
    return this._resolveName('name').tHtml('name', { 'default': this.orig.name || this.id });
    // return this._resolveName('name').t.append('name', { 'default': this.orig.name || this.id });  // someday?
  }

  fields() {
    return this._resolved.fields || (this._resolved.fields = this._resolveFields('fields'));
  }

  moreFields() {
    return this._resolved.moreFields || (this._resolved.moreFields = this._resolveFields('moreFields'));
  }

  matchGeometry(geom) {
    return this.geometry.includes(geom);
  }

  matchAllGeometry(geometries) {
    return geometries.every(geom => this.matchGeometry(geom));
  }

  matchScore(entityTags) {
    const tags = this.tags;
    let seen = {};
    let score = 0;

    // match on tags
    for (let k in tags) {
      seen[k] = true;
      if (entityTags[k] === tags[k]) {
        score += this.orig.matchScore;
      } else if (tags[k] === '*' && k in entityTags) {
        score += this.orig.matchScore / 2;
      } else {
        return -1;
      }
    }

    // boost score for additional matches in addTags - iD#6802
    const addTags = this.addTags;
    for (let k in addTags) {
      if (!seen[k] && entityTags[k] === addTags[k]) {
        score += this.orig.matchScore;
      }
    }

    return score;
  }


  t(scope, options) {
    const l10n = this.context.systems.l10n;
    return l10n.t(`_tagging.presets.presets.${this.id}.${scope}`, options);
  }

  tHtml(scope, options) {
    const l10n = this.context.systems.l10n;
    return l10n.tHtml(`_tagging.presets.presets.${this.id}.${scope}`, options);
  }

  subtitle() {
    if (this.suggestion) {
      const l10n = this.context.systems.l10n;
      let path = this.id.split('/');
      path.pop();  // remove brand name
      return l10n.t('_tagging.presets.presets.' + path.join('/') + '.name');
    }
    return null;
  }

  subtitleLabel() {
    if (this.suggestion) {
      const l10n = this.context.systems.l10n;
      let path = this.id.split('/');
      path.pop();  // remove brand name
      return l10n.tHtml('_tagging.presets.presets.' + path.join('/') + '.name');
    }
    return null;
  }


  terms() {
    return this._resolveName('name')
      .t('terms', { 'default': this.orig.terms })
      .toLowerCase().trim().split(/\s*,+\s*/);
  }


  searchName() {
    if (!this._searchName) {
      this._searchName = (this.suggestion ? this.orig.name : this.name()).toLowerCase();
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
    if (!this._searchAliases) {
      this._searchAliases = this.aliases().map(alias => alias.toLowerCase());
    }
    return this._searchAliases;
  }


  searchAliasesStripped() {
    if (!this._searchAliasesStripped) {
      this._searchAliasesStripped = this.searchAliases().map(this._stripDiacritics);
    }
    return this._searchAliasesStripped;
  }


  isFallback() {
    return ['point', 'line', 'area', 'relation'].includes(this.id);
//    const tagCount = Object.keys(this.tags).length;
//    return tagCount === 0 || (tagCount === 1 && this.tags.hasOwnProperty('area'));
  }


  reference() {
    // Lookup documentation on Wikidata...
    const qid = (
      this.tags.wikidata ||
      this.tags['flag:wikidata'] ||
      this.tags['brand:wikidata'] ||
      this.tags['network:wikidata'] ||
      this.tags['operator:wikidata']
    );
    if (qid) {
      return { qid: qid };
    }

    // Lookup documentation on OSM Wikibase...
    const key = this.orig.reference.key || Object.keys(utilObjectOmit(this.tags, 'name'))[0];
    const value = this.orig.reference.value || this.tags[key];

    if (value === '*') {
      return { key: key };
    } else {
      return { key: key, value: value };
    }
  }


  unsetTags(tags, geometry, ignoringKeys, skipFieldDefaults) {
    // allow manually keeping some tags
    const removeTags = ignoringKeys ? utilObjectOmit(this.removeTags, ignoringKeys) : this.removeTags;
    tags = utilObjectOmit(tags, Object.keys(removeTags));

    if (geometry && !skipFieldDefaults) {
      this.fields().forEach(field => {
        if (field.matchGeometry(geometry) && field.key && field.default === tags[field.key]) {
          delete tags[field.key];
        }
      });
    }

    delete tags.area;
    return tags;
  }


  setTags(tags, geometry, skipFieldDefaults) {
    const addTags = this.addTags;
    tags = Object.assign({}, tags);   // shallow copy

    for (let k in addTags) {
      if (addTags[k] === '*') {
        // if this tag is ancillary, don't override an existing value since any value is okay
        if (this.tags[k] || !tags[k] || tags[k] === 'no') {
          tags[k] = 'yes';
        }
      } else {
        tags[k] = addTags[k];
      }
    }

    // Add area=yes if necessary.
    // This is necessary if the geometry is already an area (e.g. user drew an area) AND any of:
    // 1. chosen preset could be either an area or a line (`barrier=city_wall`)
    // 2. chosen preset doesn't have a key in osmAreaKeys (`railway=station`)
    if (!addTags.hasOwnProperty('area')) {
      delete tags.area;
      if (geometry === 'area') {
        let needsAreaTag = true;
        if (this.geometry.indexOf('line') === -1) {
          for (let k in addTags) {
            if (k in osmAreaKeys) {
              needsAreaTag = false;
              break;
            }
          }
        }
        if (needsAreaTag) {
          tags.area = 'yes';
        }
      }
    }

    if (geometry && !skipFieldDefaults) {
      this.fields().forEach(field => {
        if (field.matchGeometry(geometry) && field.key && !tags[field.key] && field.default) {
          tags[field.key] = field.default;
        }
      });
    }

    return tags;
  }


  _stripDiacritics(s) {
    // split combined diacritical characters into their parts
    if (s.normalize) s = s.normalize('NFD');
    // remove diacritics
    s = s.replace(/[\u0300-\u036f]/g, '');
    return s;
  }


  // For a preset without its own name, use names from another preset.
  // Replace {presetID} placeholders with the name of the specified presets.
  _resolveName(prop) {
    const allPresets = this.context.systems.presets.allPresets;

    const val = this.orig[prop] ?? '';    // always lookup original properties, don't use the functions
    const match = val.match(/^\{(.*)\}$/);
    if (match) {
      const preset = allPresets[match[1]];
      if (preset) {
        return preset;
      } else {
        console.warn(`Unable to resolve referenced preset: ${match[1]}.${prop}`);  // eslint-disable-line no-console
      }
    }
    return this;
  }


  // For a preset without fields, use the fields of the parent preset.
  // Replace {presetID} placeholders with the fields of the specified presets.
  _resolveFields(prop) {
    const allPresets = this.context.systems.presets.allPresets;
    const allFields = this.context.systems.presets.allFields;

    const fieldIDs = this.orig[prop] ?? [];    // always lookup original properties, don't use the functions
    let resolved = [];

    // Returns an Array of fields to inherit from the given presetID, if found
    const inheritFields = (presetID, prop) => {
      const parent = allPresets[presetID];
      if (!parent) return [];

      if (prop === 'fields') {
        return parent.fields();
      } else if (prop === 'moreFields') {
        return parent.moreFields();
      } else {
        return [];
      }
    };

    for (const fieldID of fieldIDs) {
      const match = fieldID.match(/^\{(.*)\}$/);
      if (match !== null) {    // a presetID wrapped in braces {}
        resolved = resolved.concat(inheritFields(match[1], prop));
      } else if (allFields[fieldID]) {    // a normal fieldID
        resolved.push(allFields[fieldID]);
      } else {
        console.warn(`Cannot resolve "${fieldID}" found in ${this.id}.${prop}`);  // eslint-disable-line no-console
      }
    }

    // No fields resolved for this preset, search up the preset path until we find some.
    // e.g. `highway/footway/crossing/zebra` will try:
    //  `highway/footway/crossing`
    //  `highway/footway`
    //  `highway`
    let parts = this.id.split('/');
    while (!resolved.length && parts.length) {
      parts.pop();
      const parentID = parts.join('/');
      if (parentID) {
        resolved = inheritFields(parentID, prop);
      }
    }

    return utilArrayUniq(resolved);
  }

}
