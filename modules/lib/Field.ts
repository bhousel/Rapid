import { utilSafeString } from '@rapid-sdk/util';

import type { Context } from '../Context.ts';
import type { LocationSet } from '@rapideditor/location-conflation';


/**
 * Properties that define a `Field`.
 * @see https://github.com/ideditor/schema-builder/blob/main/schemas/field.json
 */
export interface FieldProps {
  /** Unique identifier for this Field */
  id: FieldID;
  /** The asset that this Field came from (e.g. 'id_tagging_schema') */
  assetID?: AssetID;
  /** The asset version that this Field came from (e.g. '^6.6.0') */
  assetVersion?: string;
  /** The scope that this Field applies to (e.g. 'osm') */
  scopeID?: ScopeID;
  /** Type of field (e.g., 'text', 'combo', 'check', 'number', etc.) */
  type: string;
  /** English label for the field caption */
  label: string;
  /** Tag key whose value is to be displayed */
  key: string;
  /** Tag keys whose value is to be displayed (for multi-key fields) */
  keys: string[];
  /** Geometry types this Field works with */
  geometry: GeometryType[];
  /** The default value for this field */
  default: string;
  /** Placeholder text for this field */
  placeholder: string;
  /** English synonyms or related search terms */
  terms: string[];
  /** List of untranslatable string suggestions (combo fields) */
  options: string[];
  /** If true, the top values from TagInfo will be suggested (combo fields only) */
  autoSuggestions: boolean;
  /** If true, the user can type their own value (combo fields only) */
  customValues: boolean;
  /** If true, this field will appear in the Add Field list for all presets */
  universal: boolean;
  /** If true, replace spaces with underscores in the tag value (combo fields only) */
  snake_case: boolean;
  /** If true, allow case sensitive field values (combo fields only) */
  caseSensitive: boolean;
  /** If true, duplicate values are allowed (semiCombo fields only) */
  allowDuplicates: boolean;
  /** Minimum field value (number fields only) */
  minValue: number;
  /** Maximum field value (number fields only) */
  maxValue: number;
  /** The amount the stepper control should add or subtract (number fields only) */
  increment: number;
  /** Tagging constraint for showing this field in the editor */
  prerequisiteTag: { key?: string; value?: string; valueNot?: string; values?: string[]; valuesNot?: string[]; keyNot?: string };
  /** Taginfo documentation parameters */
  reference: { key?: string; value?: string; rtype?: string };
  /** Strings sent to transifex for translation */
  strings: { options?: Record<string, string | { title: string; description: string }>; types?: Record<string, string>; placeholders?: Record<string, string> };
  /** A field can reference strings of another field */
  stringsCrossReference: string;
  /** Permalink URL for identifier fields. Must contain a {value} placeholder */
  urlFormat: string;
  /** Regular expression that a valid identifier value is expected to match */
  pattern: string;
  /** The manner and context in which the field is used */
  usage: 'preset' | 'changeset' | 'manual' | 'group';
  /** For combo fields: Name of icons which represent different values */
  icons: Record<string, string>;
  /** A field can reference icons of another field */
  iconsCrossReference: string;
  /** Region IDs where this field is or isn't valid */
  locationSet: LocationSet;
  /** Resolved locationSet ID (added by SchemaSystem after processing) */
  locationSetID: LocationSetID;
  /** Extra properties are allowed */
  [key: string]: unknown;
}


/** Localized strings for a Field */
interface FieldStrings {
  id: FieldID;
  label: string;
  terms: string[];
  placeholder: string;
}


/**
 * A `Field` represents a user interface component that appears in the Rapid inspector.
 * Each field corresponds to one or more "keys" (OpenStreetMap tag keys).
 * The available fields are determined by the preset matched.
 * See:  https://github.com/ideditor/schema-builder/blob/main/schemas/field.json
 *
 * Properties you can access:
 *   `id` (or `fieldID`)   Unique string to identify this Field.
 *   `safeid`              The id, but safe for use in classes, DOM element ids, css selectors..
 *   `props`               Properties object
 *   `geometries`          `Set<string>` Geometries that this Field works with
 */
export class Field {

  /** Global shared application context */
  public context: Context;
  /** Unique identifier for this Field */
  public id: FieldID;
  /** Version of `id` safe for use in CSS selectors and DOM element IDs */
  public safeid: string;
  /** Alias for `id`; provided for consistency with other schema classes */
  public fieldID: FieldID;
  /** Input type for this Field (e.g. 'text', 'combo', 'check', 'number') */
  public type: string;
  /** Full properties object (see `FieldProps`) */
  public props: FieldProps;
  /** Geometry types this Field is compatible with */
  public geometries: Set<GeometryType>;

  /** Pre-localized display strings keyed by locale code */
  protected _strings: Map<string, FieldStrings>;
  /** The locale code in effect when `_currStrings` was last computed */
  protected _currLocaleCode: LocaleCode | null;
  /** Display strings for the current locale (label, terms, placeholder) */
  protected _currStrings: FieldStrings;


  /**
   * @constructor
   * @param context - Global shared application context
   * @param props - Properties for this Field
   */
  public constructor(context: Context, props: Partial<FieldProps> = {}) {
    this.context = context;

    if (!props.id) {
      throw new Error('Field missing id property');
    }

    if (props.geometry && (typeof props.geometry === 'string')) {
      props.geometry = [props.geometry];
    }

    this._strings = new Map();    // Map<localeCode, Object> to store pre-localized text strings
    this._currLocaleCode = null;  // The current locale code
    this._currStrings = {} as FieldStrings;  // The current strings

    // Preserve properties and assign some defaults
    this.props = structuredClone(props) as FieldProps;
    this.props.autoSuggestions ??= true;
    this.props.caseSensitive ??= false;
    this.props.customValues ??= true;
    this.props.geometry ??= [];
    this.props.increment ||= 1;
    this.props.keys ??= [this.props.key];
    this.props.snake_case ??= true;
    this.props.terms ??= [];
    this.props.universal ??= false;

    this.id = props.id;                       // For consistency, offer a `this.id` property.
    this.safeid = utilSafeString(props.id);   // For use in classes, element ids, css selectors

    // For convenient access:
    this.fieldID = this.props.id;
    this.type = this.props.type;

    const schema = context.systems.schema!;
    if (this.props.geometry.length) {
      this.geometries = new Set(this.props.geometry);
    } else {
      this.geometries = new Set(schema.geometryTypes);  // all types allowed
    }
  }


  /**
   * Resets all cached data.
   * This should happen whenever SchemaSystem merges in new data.
   * You must add the Field to the SchemaSystem and call `reset` before using the Field.
   */
  public reset(): void {
    const l10n = this.context.systems.l10n;

    // Invalidate any cached string localizations and redo for the current locale.
    this._strings.clear();
    this.setLocale(l10n?.localeCode || 'en-US');
  }


  /**
   * Changes the locale and re-localizes the strings.
   * This should happen whenever LocalizationSystem changes the locale.
   * Note that unlike with Presets and Categories, we don't need to index these strings,
   *  but it is worth pre-localizing them for performance.
   * @param localeCode - the locale code to switch to (defaults to 'en-US')
   */
  public setLocale(localeCode: LocaleCode = 'en-US'): void {
    this._currLocaleCode = localeCode;
    if (this._strings.has(localeCode)) return;  // done already

    const l10n = this.context.systems.l10n;

    // Some Fields may reference the values from another Field.
    /* eslint-disable @typescript-eslint/no-this-alias */
    const labelRef = this._resolveReference('label');
    const termsRef = this;   // Note that `terms` can't reference another Field because it is an Array property.
    const placeholderRef = this._resolveReference('placeholder');
    /* eslint-enable @typescript-eslint/no-this-alias */

    // Pre-localize and store strings (although there is no full-text search for now).
    // `name` and `placeholder` are strings, while `terms` is an Array of strings.
    // By convention `terms` are comma-delimited.
    //
    //  "website": {
    //      "label": "Website",
    //      "terms": "internet presence,uri,url,webpage",
    //      "placeholder": "https://example.com"
    //  },

    const fallbackLabel = labelRef.props.label || labelRef.id;
    const fallbackTerms = termsRef.props.terms.join(',');    // stringify Array
    const fallbackPlaceholder = placeholderRef.props.placeholder || '';

    const labelStr = l10n?.t(`_tagging.presets.fields.${labelRef.id}.label`, { 'default': '' }) || fallbackLabel;
    const termsStr = l10n?.t(`_tagging.presets.fields.${termsRef.id}.terms`, { 'default': '' }) || fallbackTerms;
    const placeholderStr = l10n?.t(`_tagging.presets.fields.${placeholderRef.id}.placeholder`, { 'default': '' }) || fallbackPlaceholder;

    const termsArr = termsStr.split(',').map((s: string) => s.trim()).filter(Boolean);   // Arrayify string

    this._currStrings = {
      id: this.id,
      label: labelStr.trim(),
      terms: termsArr,
      placeholder: placeholderStr.trim()
    };

    this._strings.set(this._currLocaleCode, this._currStrings);
  }


  /**
   * The label is the main display name of the Field, as shown in the user interface.
   * @return Localized name
   * @readonly
   */
  public get label(): string {
    return this._currStrings.label;
  }

  /**
   * Terms are related words used for seearching for this Field.
   * @return Localized search terms
   * @readonly
   */
  public get terms(): string[] {
    return this._currStrings.terms;
  }

  /**
   * A placeholder value appears in the field before the user enters a real value.
   * @return Localized placeholder
   * @readonly
   */
  public get placeholder(): string {
    return this._currStrings.placeholder;
  }

  /**
   * Is this one of the builtin objects?
   * We consider it "builtin" if it doesn't have a `assetID` (i.e. added via a merge).
   * (There are not builtin fields at this time, only the fallback presets are builtin).
   * @return  Returns `true` if this is a builtin Field, `false` if not
   */
  public isBuiltin(): boolean {
    return !this.props.assetID;
  }


  /**
   * Fields can inherit a property from another field.
   * If the property value contains a `{fieldID}` placeholder, return the other Field with that id.
   * @param prop - the property to lookup
   * @return the Field to get the property from (either this Field or another Field)
   */
  protected _resolveReference(prop: keyof FieldProps): Field {
    const schema = this.context.systems.schema;

    const val = this.props[prop];
    if (val && (typeof val === 'string')) {   // This will only work for strings
      const match = val.match(/^\{(.*)\}$/);
      if (match) {
        const field = schema?.getScope('osm').fields.get(match[1])
          ?? schema?.getScope('*').fields.get(match[1]);
        if (field) {
          return field;
        }
        console.warn(`Unable to resolve referenced fieldID: ${this.id}.${prop} -> ${match[1]}`);  // eslint-disable-line no-console
      }
    }
    return this;
  }

}
