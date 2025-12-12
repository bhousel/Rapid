import { utilArrayUniq, utilObjectOmit, utilSafeString } from '@rapid-sdk/util';

import { utilNormalizeString } from '../util/string.js';
import { osmAreaKeys } from './tags.js';


/**
 * Preset
 * A Preset represents a bundle of tags that identify a feature type on OpenStreetMap.
 * Every feature in Rapid is matched to a Preset based on its tags.
 * Users can pick from the available Presets in the Rapid editor.
 *
 * Properties you can access:
 *   `id` (or `presetID`)   Unique string to identify this Preset.
 *   `safeid`               The id, but safe for use in classes, DOM element ids, css selectors..
 *   `props`                Properties object
 *   `geometries`           `Set<string>` Geometries that this Preset works with
 */
export class Preset {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   * @param  {Object}   props   - Object containing the properties for this Preset
   */
  constructor(context, props = {}) {
    this.context = context;
    this.type = 'preset';

    if (!props.id) {
      throw new Error('Preset missing id property');
    }

    if (props.geometry && (typeof props.geometry === 'string')) {
      props.geometry = [props.geometry];
    }

    // Preserve properties and assign some defaults
    this.props = globalThis.structuredClone(props);
    this.props.aliases ??= [];
    this.props.fields ??= [];
    this.props.geometry ??= [];
    this.props.matchScore ||= 1;
    this.props.moreFields ??= [];
    this.props.name ??= '';
    this.props.reference ??= {};
    this.props.searchable ??= true;
    this.props.tags ??= {};
    this.props.terms = (props.terms ?? []).join();

    this.props.addTags ??= this.props.tags;
    this.props.removeTags ??= this.props.addTags;

    this.id = props.id;                       // For consistency, offer a `this.id` property.
    this.safeid = utilSafeString(props.id);   // For use in classes, element ids, css selectors

    // For convenient access:
    this.presetID = this.props.id;
    this.tags = this.props.tags;
    this.addTags = this.props.addTags;
    this.removeTags = this.props.removeTags;
    this.searchable = this.props.searchable;
    this.suggestion = this.props.suggestion;

    const schema = context.systems.schema;
    if (this.props.geometry.length) {
      this.geometries = new Set(this.props.geometry);
    } else {
      this.geometries = new Set(schema.geometryTypes);  // all types allowed
    }

    this.resetCache();
  }


  /**
   * resetCache
   * Resets all cached data.
   */
  resetCache() {
    this._resolved = { fields: null, moreFields: null };

    // Reset localized names and cached fields used by MiniSearch.
    const name = this.name();
    const terms = this._resolveReference('name').t('terms', { 'default': this.props.terms });
    this.search = {
      id: this.id,
      type: this.type,
      suggestion: this.props.suggestion,
      name: name,
      nameNormalized: utilNormalizeString(name),
      terms: terms
    };

//    this._searchName = null;
//    this._searchNameNormalized = null;
//    this._searchAliases = null;
//    this._searchAliasesNormalized = null;
  }


  /**
   * name
   * Returns a localized name, if possible.  Falls back to original name.
   * @return  {string}  Localized name
   */
  name() {
    return this._resolveReference('name').t('name', { 'default': this.props.name || this.id });
  }

  /**
   * nameHtml
   * Returns a localized name HTML, if possible.  Falls back to original name.
   * @return  {string}  Localized name HTML
   */
  nameHtml() {
    return this._resolveReference('name').tHtml('name', { 'default': this.props.name || this.id });
  }

  /**
   * aliases
   * Returns localized aliases, if possible.  Falls back to original aliases.
   * @return  {Array<string>}  Localized aliases
   */
  aliases() {
    return this._resolveReference('name')
      .t('aliases', { 'default': this.props.aliases }).trim().split(/\s*[\r\n]+\s*/);
  }

  /**
   * terms
   * Returns localized search terms, if possible.  Falls back to original search terms.
   * @return  {Array<string>}  The localized search terms
   */
  terms() {
    return this._resolveReference('name')
      .t('terms', { 'default': this.props.terms })
      .toLowerCase().trim().split(/\s*,+\s*/);
  }

  /**
   * fields
   * Returns the fields for this Preset.
   * @return  {Array<Field>}  The Fields for this preset
   */
  fields() {
    return this._resolved.fields || (this._resolved.fields = this._resolveFields('fields'));
  }

  /**
   * moreFields
   * Returns the "more" Fields for this Preset.  These are Fields that are offered
   *  if the user expands the "more fields" combobox.
   * @return  {Array<Field>}  The "more" Fields for this preset
   */
  moreFields() {
    return this._resolved.moreFields || (this._resolved.moreFields = this._resolveFields('moreFields'));
  }

  /**
   * matchScore
   * Matchscore is used for ranking search results.
   * It is calculated by checking how many tags match the Preset tags.
   * @param   {Object}  matchTags - Tags to match
   * @return  {number}  The match score
   */
  matchScore(matchTags) {
    const tags = this.tags;
    let seen = {};
    let score = 0;

    // match on tags
    for (let k in tags) {
      seen[k] = true;
      if (matchTags[k] === tags[k]) {
        score += this.props.matchScore;
      } else if (tags[k] === '*' && k in matchTags) {
        score += this.props.matchScore / 2;
      } else {
        return -1;
      }
    }

    // boost score for additional matches in addTags - iD#6802
    const addTags = this.addTags;
    for (let k in addTags) {
      if (!seen[k] && matchTags[k] === addTags[k]) {
        score += this.props.matchScore;
      }
    }

    return score;
  }


  /**
   * t
   * Returns a localized string, wrapper around `l10n.t`.
   * @params  {string}   scope   - The trailing part of the stringID
   * @params  {Object?}  options - Optional options to pass to `l10n.t`
   * @return  {string}   Localized string
   */
  t(scope, options) {
    const l10n = this.context.systems.l10n;
    return l10n.t(`_tagging.presets.presets.${this.id}.${scope}`, options);
  }

  /**
   * tHtml
   * Returns a localized HTML string, wrapper around `l10n.tHtml`.
   * @params  {string}   scope   - The trailing part of the stringID
   * @params  {Object?}  options - Optional options to pass to `l10n.tHtml`
   * @return  {string}   Localized HTML string
   */
  tHtml(scope, options) {
    const l10n = this.context.systems.l10n;
    return l10n.tHtml(`_tagging.presets.presets.${this.id}.${scope}`, options);
  }

  /**
   * subtitle
   * Returns a subtitle, but only for suggestion presets.
   * Rapid displays the preset name on a second line below the brand name.
   * @return  {string}  Localized preset subtitle, or `null` if not applicable
   */
  subtitle() {
    if (this.suggestion) {
      const l10n = this.context.systems.l10n;
      let path = this.id.split('/');
      path.pop();  // remove brand name
      return l10n.t('_tagging.presets.presets.' + path.join('/') + '.name');
    }
    return null;
  }

  /**
   * subtitleHtml
   * Returns an HTML subtitle, but only for suggestion presets.
   * Rapid displays the preset name on a second line below the brand name.
   * @return  {string}  Localized HTML preset subtitle, or `null` if not applicable
   */
  subtitleHtml() {
    if (this.suggestion) {
      const l10n = this.context.systems.l10n;
      let path = this.id.split('/');
      path.pop();  // remove brand name
      return l10n.tHtml('_tagging.presets.presets.' + path.join('/') + '.name');
    }
    return null;
  }

  /**
   * searchName
   * The name used for searching - basically the `name()` but forced lowercase.
   * @return  {string}  The name used for searching
   */
  searchName() {
    return this.search.name;
    // if (!this._searchName) {
    //   this._searchName = (this.suggestion ? this.props.name : this.name()).toLowerCase();
    // }
    // return this._searchName;
  }

  /**
   * searchNameNormalized
   * The name used for searching, but with diacritic marks normalized (e.g. 'á' -> 'a').
   * @return  {string}  The name used for searching, but with diacritic marks normalized.
   */
  searchNameNormalized() {
    return this.search.nameNormalized;
    // if (!this._searchNameNormalized) {
    //   this._searchNameNormalized = utilNormalizeString(this.searchName());
    // }
    // return this._searchNameNormalized;
  }

  /**
   * searchAliases
   * Aliases for searching - basically the `aliases`, but forced lowercase.
   * @return  {Array<string>}  The aliases used for searching
   */
  searchAliases() {
    return this.search.aliases;
    // if (!this._searchAliases) {
    //   this._searchAliases = this.aliases().map(alias => alias.toLowerCase());
    // }
    // return this._searchAliases;
  }

  /**
   * searchAliasesNormalized
   * Aliases used for searching, but with diacritic marks normalized (e.g. 'á' -> 'a').
   * @return  {Array<string>}  The aliases used for searching, but with diacritic marks normalized.
   */
  searchAliasesNormalized() {
    return this.search.aliasesNormalized;
    // if (!this._searchAliasesNormalized) {
    //   this._searchAliasesNormalized = this.searchAliases().map(s => utilNormalizeString(s));
    // }
    // return this._searchAliasesNormalized;
  }

  /**
   * isFallback
   * Is this a fallback preset?
   * Fallback presets are created by the `SchemaSystem` at init time and can't be overridden.
   * The fallback presets are: 'point', 'line', 'area', 'relation'.
   * @return  {boolean}  `true` if this is a fallback preset, `false` otherwise.
   */
  isFallback() {
    return ['point', 'line', 'area', 'relation'].includes(this.id);
  }


  /**
   * reference
   * Returns some data about how to lookup reference information about this Preset.
   * If there is a `wikidata` identifier, lookup the QID on Wikidata.
   * Otherwise, use whatever `key`/`value` pair is specified for the reference,
   *  falling back to the `key`/`value` pair of the first tag.
   * @return  {Object}  Data used to lookup reference information
   */
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
    const key = this.props.reference.key || Object.keys(utilObjectOmit(this.tags, 'name'))[0];
    const value = this.props.reference.value || this.tags[key];

    if (value === '*') {
      return { key: key };
    } else {
      return { key: key, value: value };
    }
  }


  /**
   * unsetTags
   * Called when changing Presets, this removes tags that go with the old Preset.
   * @param   {Object}         tags - the initial tags for the Entity
   * @param   {string}         geometry - the geometry for the Entity
   * @param   {Array<string>}  ignoreKeys - optional Array of keys to ignore (not remove)
   * @param   {boolean}        skipFieldDefaults - `true` to ignore tags controlled by the Fields
   * @return  {Object}  The final tags for the Entity, after removal has happened.
   */
  unsetTags(tags, geometry, ignoreKeys, skipFieldDefaults) {
    // allow manually keeping some tags
    const removeTags = ignoreKeys ? utilObjectOmit(this.removeTags, ignoreKeys) : this.removeTags;
    tags = utilObjectOmit(tags, Object.keys(removeTags));

    if (geometry && !skipFieldDefaults) {
      for (const field of this.fields()) {
        const k = field.props.key;
        if (k && field.props.default === tags[k] && field.geometries.has(geometry)) {
          delete tags[k];
        }
      }
    }

    delete tags.area;
    return tags;
  }

  /**
   * setTags
   * Called when changing Presets, this adds tags that go with the new Preset.
   * @param   {Object}    tags - the initial tags for the Entity
   * @param   {string}    geometry - the geometry for the Entity
   * @param   {boolean}   skipFieldDefaults - `true` to ignore tags controlled by the Fields
   * @return  {Object}  The final tags for the Entity, after adding has happened.
   */
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

    // Add `area=yes` tag if necessary.
    // This tag is only needed for features that can be either a 'line' or an 'area'.
    // Set this tag if the geometry is already an area (e.g. user drew an area) AND:
    // 1. chosen preset could be either an 'area' or a 'line' (`barrier=city_wall`)
    // 2. chosen preset doesn't have a key in osmAreaKeys (`railway=station`)
    if (!addTags.hasOwnProperty('area')) {
      delete tags.area;
      if (geometry === 'area' && this.geometries.has('line')) {  // can also be a line
        let needsAreaTag = true;
        for (let k in addTags) {
          if (k in osmAreaKeys) {
            needsAreaTag = false;
            break;
          }
        }
        if (needsAreaTag) {
          tags.area = 'yes';
        }
      }
    }

    if (geometry && !skipFieldDefaults) {
      for (const field of this.fields()) {
        const k = field.props.key;
        const v = field.props.default;
        if (k && v && !tags[k] && field.geometries.has(geometry)) {
          tags[k] = v;
        }
      }
    }

    return tags;
  }


  /**
   * _resolveReference
   * Presets can inherit a property from another Preset.
   * If the property value contains a `{presetID}` placeholder, return the other Preset with that id.
   * @param   {string}  prop - the property to lookup
   * @return  {Preset}  the Preset to get the name from (either this Preset or another Preset)
   */
  _resolveReference(prop) {
    const schema = this.context.systems.schema;

    const val = this.props[prop] ?? '';    // always lookup original properties, don't use the functions
    const match = val.match(/^\{(.*)\}$/);
    if (match) {
      const preset = schema.presets.get(match[1]);
      if (preset) {
        return preset;
      } else {
        console.warn(`Unable to resolve referenced preset: ${match[1]}.${prop}`);  // eslint-disable-line no-console
      }
    }
    return this;
  }


  /**
   * _resolveFields
   * For a Preset without its own Fields, inherit fields from another preset.
   * Replace `{presetID}` placeholders with the fields of the other preset.
   * @param   {string}  prop - the property to lookup (either 'fields' or 'moreFields')
   * @return  {Array<Field>}  the resolved fields or moreFields
   */
  _resolveFields(prop) {
    const schema = this.context.systems.schema;

    const fieldIDs = this.props[prop] ?? [];  // always lookup original properties, don't use the functions
    let resolved = [];

    // Returns an Array of fields to inherit from the given presetID, if found
    const inheritFields = (presetID, prop) => {
      const parent = schema.presets.get(presetID);
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
      } else if (schema.fields.has(fieldID)) {    // a normal fieldID
        resolved.push(schema.fields.get(fieldID));
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
