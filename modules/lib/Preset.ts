import { utilArrayUniq, utilObjectOmit, utilSafeString } from '@rapid-sdk/util';
import diacritics from 'diacritics';
import { utilGatherTokens } from '../util/string.ts';

import type { TagKeyValueLookup } from './tags.ts';

import type { Context } from '../Context.ts';
import type { Field } from './Field.ts';
import type { GeometryType } from '../core/SchemaSystem.ts';
import type { LocationSet } from '@rapideditor/location-conflation';
import type { Tags } from '../data/types.ts';


/**
 * Properties that define a Preset.
 * @see https://github.com/ideditor/schema-builder/blob/main/schemas/preset.json
 */
export interface PresetProps {
  /** Unique identifier for this Preset */
  id: PresetID;
  /** The asset that this Preset came from (e.g. 'id_tagging_schema') */
  assetID?: AssetID;
  /** The asset version that this Preset came from (e.g. '^6.6.0') */
  assetVersion?: string;
  /** The scope that this Preset applies to (e.g. 'osm') */
  scopeID?: ScopeID;
  /** Display name */
  name: string;
  /** Alternate names that may be displayed in the UI */
  aliases: string[];
  /** Related words used for searching */
  terms: string[];
  /** Tags that identify this Preset */
  tags: Tags;
  /** Tags to add when applying this Preset */
  addTags: Tags;
  /** Tags to remove when removing this Preset */
  removeTags: Tags;
  /** Field IDs for this Preset */
  fields: FieldID[];
  /** Additional Field IDs shown in "more fields" */
  moreFields: FieldID[];
  /** Geometry types this Preset works with */
  geometry: GeometryType[];
  /** Score for ranking search results */
  matchScore: number;
  /** Whether this Preset appears in search results */
  searchable: boolean;
  /** Whether this is a suggestion preset (from NSI) */
  suggestion: boolean;
  /** Reference data for documentation lookup */
  reference: { key?: string; value?: string };
  /** Name of preset icon which represents this preset */
  icon: string;
  /** URL of a remote image that is more specific than 'icon' */
  imageURL: string;
  /** The ID of a preset that is preferable to this one (for deprecated presets) */
  replacement: string;
  /** Region IDs where this preset is or isn't valid. See: https://github.com/ideditor/location-conflation */
  locationSet: LocationSet;
  /** Resolved locationSet ID (added by SchemaSystem after processing locationSet) */
  locationSetID: LocationSetID;
  /** Extra properties are allowed */
  [key: string]: unknown;
}


/** Localized strings for a Preset */
interface PresetStrings {
  id: PresetID;
  type: string;
  suggestion: boolean;
  name: string;
  terms: string[];
  aliases: string[];
  primary: string;
  alternate: string;
}


/** Resolved fields cache */
interface ResolvedFields {
  fields: Field[] | null;
  moreFields: Field[] | null;
}


/**
 * Preset
 * A Preset represents a set of tags that identify a feature type on OpenStreetMap.
 * Every feature in Rapid is matched to a Preset based on its tags.
 * Users can pick from the available Presets in the Rapid editor.
 * See:  https://github.com/ideditor/schema-builder/blob/main/schemas/preset.json
 *
 * Properties you can access:
 *   `id` (or `presetID`)   Unique string to identify this Preset.
 *   `safeid`               The id, but safe for use in classes, DOM element ids, css selectors..
 *   `props`                Properties object
 *   `geometries`           `Set<GeometryType>` Geometries that this Preset works with
 */
export class Preset {
  context: Context;
  type = 'preset' as const;
  id: PresetID;
  safeid: string;
  presetID: PresetID;
  props: PresetProps;
  geometries: Set<GeometryType>;
  tags: Tags;
  addTags: Tags;
  removeTags: Tags;
  searchable: boolean;
  suggestion: boolean;

  private _strings: Map<string, PresetStrings>;
  private _currLocaleCode: LocaleCode | null;
  private _currStrings: PresetStrings;
  private _resolved: ResolvedFields;

  /**
   * @constructor
   * @param context - Global shared application context
   * @param props - Properties for this Preset
   */
  constructor(context: Context, props: Partial<PresetProps> = {}) {
    this.context = context;
    this.type = 'preset';

    if (!props.id) {
      throw new Error('Preset missing id property');
    }

    if (props.geometry && (typeof props.geometry === 'string')) {
      props.geometry = [props.geometry];
    }

    this._strings = new Map();    // Map<localeCode, Object> to store pre-localized text strings
    this._currLocaleCode = null;  // The current locale code
    this._currStrings = {} as PresetStrings;  // The current strings
    this._resolved = { fields: null, moreFields: null };

    // Preserve properties and assign some defaults
    this.props = globalThis.structuredClone(props) as PresetProps;
    this.props.aliases ??= [];
    this.props.fields ??= [];
    this.props.geometry ??= [];
    this.props.matchScore ||= 1;
    this.props.moreFields ??= [];
    this.props.name ??= '';
    this.props.reference ??= {};
    this.props.searchable ??= true;
    this.props.suggestion ??= false;
    this.props.tags ??= {};
    this.props.terms ??= [];

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

    const schema = context.systems.schema!;
    if (this.props.geometry.length) {
      this.geometries = new Set(this.props.geometry);
    } else {
      this.geometries = new Set(schema.geometryTypes);  // all types allowed
    }
  }


  /**
   * reset
   * Resets all cached data.
   * This should happen whenever SchemaSystem merges in new data.
   * You must add the Preset to the SchemaSystem and call `reset` before using the Preset.
   */
  reset(): void {
    const l10n = this.context.systems.l10n;

    this._resolved = { fields: null, moreFields: null };

    // Invalidate any cached string localizations and redo for the current locale.
    this._strings.clear();
    this.setLocale(l10n?.localeCode || 'en-US');
  }


  /**
   * setLocale
   * Changes the locale and re-localizes the strings.
   * This should happen whenever LocalizationSystem changes the locale.
   * This is done early because we need the strings indexed by the SchemaSystem for searching.
   * @param localeCode - the locale code to switch to (defaults to 'en-US')
   */
  setLocale(localeCode: LocaleCode = 'en-US'): void {
    this._currLocaleCode = localeCode;
    if (this._strings.has(localeCode)) return;  // done already

    const l10n = this.context.systems.l10n;

    const primary = new Set<string>();
    const alternate = new Set<string>();
    let nameStr: string, termsArr: string[], aliasesArr: string[];

    // Performance optimization:
    // We can skip a lot of this for "suggestion" presets from NSI.
    // They will never have a hit in the translation system nor reference another preset's props.
    if (this.props.suggestion) {
      nameStr = this.props.name.replace(/\s+\(.*?\)/g, '');  // remove parenthesis, e.g. "(USA)"
      termsArr = this.props.terms;                           // already contains alternate names
      aliasesArr = [];                                       // there won't be aliases

      primary.add(nameStr);
      this._gatherSuggestionTerms(primary, alternate);
      this._gatherSuggestionTags(primary, alternate);

    } else {
      // Some Presets may reference the values from another Preset.
      /* eslint-disable @typescript-eslint/no-this-alias */
      const refName = this._resolveReference('name');
      const refTerms = this;     // Note that `terms` and `aliases` can't reference
      const refAliases = this;   // other Presets because they are Array properties.
      /* eslint-enable @typescript-eslint/no-this-alias */

      // Pre-localize and store strings so that the Miniseach full-text search can index these.
      // `name` is a string, while `terms` and `aliases` are Arrays of strings.
      // Unfortunately, the localized values returned from Transifex are inconsistent.
      // By convention `aliases` are newline-delimited and `terms` are comma-delimited.
      // We will also make the OSM tag values available for searching.
      //
      // "shop/second_hand": {
      //     "name": "Thrift Store",
      //     "aliases": "Thrift Shop\nConsignment Store\nResale Shop\nSecondhand Shop",
      //     "terms": "resale,second-hand,used"
      // }

      const fallbackName = refName.props.name || refName.id;
      const fallbackTerms = refTerms.props.terms.join(',');       // stringify Array
      const fallbackAliases = refAliases.props.aliases.join('\n');  // stringify Array

      nameStr = l10n?.t(`_tagging.presets.presets.${refName.id}.name`, { 'default': '' }) || fallbackName;
      const termsStr = l10n?.t(`_tagging.presets.presets.${refTerms.id}.terms`, { 'default': '' }) || fallbackTerms;
      const aliasesStr = l10n?.t(`_tagging.presets.presets.${refAliases.id}.aliases`, { 'default': '' }) || fallbackAliases;
      const tagsStr = Object.values(this.props.tags).filter(v => v !== '*').filter(Boolean).join(',');

      // We'll gather the search tokens ourselves into "primary" and "alternate" sets.
      // This is because once a token is seen in one field, we don't want it to appear again in another field.
      // (When search terms match in multiple fields, this can boost the Minisearch score, so a Preset
      // that happens to have redundant terms gets unfairly boosted in the search results)
      // The "primary" set will contain the preset name.
      // The "alternate" set will contain related terms and tag values a user might search for.
      utilGatherTokens(nameStr, primary, alternate, true);
      utilGatherTokens(termsStr, primary, alternate, false);
      utilGatherTokens(aliasesStr, primary, alternate, false);
      utilGatherTokens(tagsStr, primary, alternate, false);

      termsArr = termsStr.split(',').map((s: string) => s.trim()).filter(Boolean);                  // Arrayify string
      aliasesArr = aliasesStr.split(/\s*[\r\n]+\s*/).map((s: string) => s.trim()).filter(Boolean);  // Arrayify string
    }

    this._currStrings = {
      id: this.id,
      type: this.type,
      suggestion: this.props.suggestion,
      name: nameStr.trim(),              // Display Name
      terms: termsArr,                   // Display Terms
      aliases: aliasesArr,               // Display Aliases
      primary: [...primary].join(),      // Primary search terms (generally the name)
      alternate: [...alternate].join()   // Alternate search terms (aliases, tags, etc)
    };

    this._strings.set(this._currLocaleCode, this._currStrings);
  }

  /**
   * name
   * The name is the main display name of the Preset, as shown in the user interface.
   * @return Localized name
   * @readonly
   */
  get name(): string {
    return this._currStrings.name;
  }

  /**
   * aliases
   * Aliases are alternate names for this Preset, they may be displayed in the user interface.
   * @return Localized aliases
   * @readonly
   */
  get aliases(): string[] {
    return this._currStrings.aliases;
  }

  /**
   * terms
   * Terms are related words used for seraching for this Preset.
   * (For suggestion presets, the terms are alternate names)
   * @return Localized search terms
   * @readonly
   */
  get terms(): string[] {
    return this._currStrings.terms;
  }

  /**
   * fields
   * Returns the fields for this Preset.
   * @return The Fields for this preset
   */
  fields(): Field[] {
    return this._resolved.fields || (this._resolved.fields = this._resolveFields('fields'));
  }

  /**
   * moreFields
   * Returns the "more" Fields for this Preset.  These are Fields that are offered
   *  if the user expands the "more fields" combobox.
   * @return The "more" Fields for this preset
   */
  moreFields(): Field[] {
    return this._resolved.moreFields || (this._resolved.moreFields = this._resolveFields('moreFields'));
  }


  /**
   * matchScore
   * Matchscore is used for ranking search results.
   * It is calculated by checking how many tags match the Preset tags.
   * @param matchTags - Tags to match
   * @return The match score
   */
  matchScore(matchTags: Tags): number {
    const tags = this.tags;
    const seen: Record<string, boolean> = {};
    let score = 0;

    // match on tags
    for (const k in tags) {
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
    for (const k in addTags) {
      if (!seen[k] && matchTags[k] === addTags[k]) {
        score += this.props.matchScore;
      }
    }

    return score;
  }


  /**
   * subtitle
   * Returns a subtitle, but only for suggestion presets.
   * Rapid displays the preset name on a second line below the brand name.
   * @return Localized preset subtitle, or `null` if not applicable
   */
  subtitle(): string | null {
    if (!this.props.suggestion) return null;

    const schema = this.context.systems.schema;
    const scope = schema?.getScope('osm');
    const commonScope = schema?.getScope('*');

    const path = this.id.split('/');
    path.pop();  // remove brand name

    const parentID = path.join('/');
    const parentPreset = scope?.presets.get(parentID) ?? commonScope?.presets.get(parentID);

    return parentPreset?.name || parentID;
  }


  /**
   * isFallback
   * Is this a fallback preset?
   * Fallback presets are created by the `SchemaSystem` at init time and can't be overridden.
   * The fallback presets are: 'point', 'line', 'area', 'relation'.
   * @return `true` if this is a fallback preset, `false` otherwise.
   */
  isFallback(): boolean {
    return ['point', 'line', 'area', 'relation'].includes(this.id);
  }

  /**
   * isBuiltin
   * Is this one of the builtin objects?
   * We consider it "builtin" if it doesn't have a `assetID` (i.e. added via a merge).
   * (At this time, only the fallback presets are builtin).
   * @return  Returns `true` if this is a builtin Preset, `false` if not
   */
  isBuiltin(): boolean {
    return !this.props.assetID;
  }


  /**
   * reference
   * Returns some data about how to lookup reference information about this Preset.
   * If there is a `wikidata` identifier, lookup the QID on Wikidata.
   * Otherwise, use whatever `key`/`value` pair is specified for the reference,
   *  falling back to the `key`/`value` pair of the first tag.
   * @return Data used to lookup reference information
   */
  reference(): { qid?: string; key?: string; value?: string } {
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
    const key = this.props.reference.key || Object.keys(utilObjectOmit(this.tags, ['name']))[0];
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
   * @param tags - the initial tags for the Entity
   * @param geometry - the geometry for the Entity
   * @param ignoreKeys - optional Array of keys to ignore (not remove)
   * @param skipFieldDefaults - `true` to ignore tags controlled by the Fields
   * @return The final tags for the Entity, after removal has happened.
   */
  unsetTags(tags: Tags, geometry: GeometryType, ignoreKeys?: string[], skipFieldDefaults?: boolean): Tags {
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
   * @param tags - the initial tags for the Entity
   * @param geometry - the geometry for the Entity
   * @param skipFieldDefaults - `true` to ignore tags controlled by the Fields
   * @return The final tags for the Entity, after adding has happened.
   */
  setTags(tags: Tags, geometry: GeometryType, skipFieldDefaults?: boolean): Tags {
    const addTags = this.addTags;
    tags = Object.assign({}, tags);   // shallow copy

    for (const k in addTags) {
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
    // 2. chosen preset doesn't have a key in areaKeys (`railway=station`)
    if (!addTags.hasOwnProperty('area')) {
      delete tags.area;
      if (geometry === 'area' && this.geometries.has('line')) {  // can also be a line
        const areaKeys: TagKeyValueLookup = this.context?.systems?.schema?.getScope('osm')?.areaKeys ?? {};
        let needsAreaTag = true;
        for (const k in addTags) {
          if (k in areaKeys) {
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
   * @param prop - the property to lookup
   * @return the Preset to get the name from (either this Preset or another Preset)
   */
  private _resolveReference(prop: keyof PresetProps): Preset {
    const schema = this.context.systems.schema;

    const val = this.props[prop];
    if (val && (typeof val === 'string')) {   // This will only work for strings
      const match = val.match(/^\{(.*)\}$/);
      if (match) {
        const preset = schema?.getScope('osm').presets.get(match[1])
          ?? schema?.getScope('*').presets.get(match[1]);
        if (preset) {
          return preset;
        } else {
          console.warn(`Unable to resolve referenced preset: ${this.id}.${prop} -> ${match[1]}`);  // eslint-disable-line no-console
        }
      }
    }
    return this;
  }


  /**
   * _resolveFields
   * For a Preset without its own Fields, inherit fields from another Preset.
   * Replace `{presetID}` placeholders with the fields of the other preset.
   * @param prop - the property to lookup (either 'fields' or 'moreFields')
   * @return the resolved fields or moreFields
   */
  private _resolveFields(prop: 'fields' | 'moreFields'): Field[] {
    const schema = this.context.systems.schema;
    const scope = schema?.getScope('osm');
    const commonScope = schema?.getScope('*');

    const fieldIDs = this.props[prop] ?? [];  // always lookup original properties, don't use the functions
    let resolved: Field[] = [];

    // Returns an Array of fields to inherit from the given presetID, if found
    const inheritFields = (presetID: string, prop: 'fields' | 'moreFields'): Field[] => {
      const other = scope?.presets.get(presetID) ?? commonScope?.presets.get(presetID);
      if (!other) {
        console.warn(`Unable to resolve referenced presetID: ${this.id}.${prop} -> ${presetID}`);  // eslint-disable-line no-console
        return [];
      }
      if (prop === 'fields') {
        return other.fields();
      } else if (prop === 'moreFields') {
        return other.moreFields();
      } else {
        return [];
      }
    };

    for (const fieldID of fieldIDs) {
      const match = fieldID.match(/^\{(.*)\}$/);
      if (match !== null) {    // a presetID wrapped in braces {}
        resolved = resolved.concat(inheritFields(match[1], prop));
      } else if (scope?.fields.get(fieldID) ?? commonScope?.fields.get(fieldID)) {    // a normal fieldID
        resolved.push((scope?.fields.get(fieldID) ?? commonScope?.fields.get(fieldID))!);
      } else {
        console.warn(`Unable to resolve referenced fieldID: ${this.id}.${prop} -> ${fieldID}`);  // eslint-disable-line no-console
      }
    }

    // No fields resolved for this preset, search up the preset path until we find some.
    // e.g. `highway/footway/crossing/zebra` will try:
    //  `highway/footway/crossing`
    //  `highway/footway`
    //  `highway`
    const parts = this.id.split('/');
    while (!resolved.length && parts.length) {
      parts.pop();
      const parentID = parts.join('/');
      if (parentID) {
        resolved = inheritFields(parentID, prop);
      }
    }

    return utilArrayUniq(resolved);
  }


  /**
   * _gatherSuggestionTerms
   * A simpler version of `utilGatherTokens` to gather 'terms' from suggestion presets
   * The `terms` is already an Array of strings that can function as search names.
   */
  private _gatherSuggestionTerms(primary: Set<string>, alternate: Set<string>): void {
    for (const s of this.props.terms) {
      if (!s || primary.has(s) || alternate.has(s)) continue;  // seen it before
      primary.add(s);

      // Generate a version with the diacritics folded, e.g. 'ö' -> 'o'
      // If it differs from the original, add it as an alternate match.
      // (extra 'i' hack for Turkish, for BİM, İşbank - NSI#5017, NSI#8261)
      const s2 = diacritics.remove(s.replace(/(İ|i̇)/ig, 'i'));
      if (s2 !== s) {
        alternate.add(s2);
      }
    }
  }

  /**
   * _gatherSuggestionTags
   * A simpler version of `utilGatherTokens` to gather 'tags' from suggestion presets.
   */
  private _gatherSuggestionTags(primary: Set<string>, alternate: Set<string>): void {
    for (const s of Object.values(this.props.tags)) {
      if (!s || primary.has(s) || alternate.has(s)) continue;  // seen it before
      alternate.add(s);

      // Generate a version with the diacritics folded, e.g. 'ö' -> 'o'
      // If it differs from the original, add it as an alternate match.
      // (extra 'i' hack for Turkish, for BİM, İşbank - NSI#5017, NSI#8261)
      const s2 = diacritics.remove(s.replace(/(İ|i̇)/ig, 'i'));
      if (s2 !== s) {
        alternate.add(s2);
      }
    }
  }

}
