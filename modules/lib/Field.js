import { utilSafeString } from '@rapid-sdk/util';


/**
 * Field
 * A Field represents a user interface component that appears in the Rapid inspector.
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

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   * @param  {Object}   props   - Object containing the properties for this Field
   */
  constructor(context, props = {}) {
    this.context = context;

    if (!props.id) {
      throw new Error('Field missing id property');
    }

    if (props.geometry && (typeof props.geometry === 'string')) {
      props.geometry = [props.geometry];
    }

    this._strings = new Map();    // Map<localeCode, Object> to store pre-localized text strings
    this._currLocaleCode = null;  // The current locale code
    this._currStrings = {};       // The current strings

    // Preserve properties and assign some defaults
    this.props = globalThis.structuredClone(props);
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

    const schema = context.systems.schema;
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
   * You must add the Field to the SchemaSystem and call `reset` before using the Field.
   */
  reset() {
    const l10n = this.context.systems.l10n;

    // Invalidate any cached string localizations and redo for the current locale.
    this._strings.clear();
    this.setLocale(l10n?.localeCode() || 'en-US');
  }


  /**
   * setLocale
   * Changes the locale and re-localizes the strings.
   * This should happen whenever LocalizationSystem changes the locale.
   * Note that unlike with Presets and Categories, we don't need to index these strings,
   *  but it is worth pre-localizing them for performance.
   * @param  {string}  localeCode - the locale code to switch to (defaults to 'en-US')
   */
  setLocale(localeCode = 'en-US') {
    this._currLocaleCode = localeCode;
    if (this._strings.has(localeCode)) return;  // done already

    const l10n = this.context.systems.l10n;

    // Some Fields may reference the values from another Field.
    const labelRef = this._resolveReference('label');
    const termsRef = this;   // Note that `terms` can't reference another Field because it is an Array property.
    const placeholderRef = this._resolveReference('placeholder');

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

    const termsArr = termsStr.split(',').map(s => s.trim()).filter(Boolean);   // Arrayify string

    this._currStrings = {
      id: this.id,
      label: labelStr.trim(),
      terms: termsArr,
      placeholder: placeholderStr.trim()
    };

    this._strings.set(this._currLocaleCode, this._currStrings);
  }


  /**
   * label
   * The label is the main display name of the Field, as shown in the user interface.
   * @return  {string}  Localized name
   * @readonly
   */
  get label() {
    return this._currStrings.label;
  }

  /**
   * terms
   * Terms are related words used for seearching for this Field.
   * @return  {Array<string>}  Localized search terms
   * @readonly
   */
  get terms() {
    return this._currStrings.terms;
  }

  /**
   * placeholder
   * A placeholder value appears in the field before the user enters a real value.
   * @return  {string}  Localized placeholder
   * @readonly
   */
  get placeholder() {
    return this._currStrings.placeholder;
  }


  /**
   * _resolveReference
   * Fields can inherit a property from another field.
   * If the property value contains a `{fieldID}` placeholder, return the other Field with that id.
   * @param   {string}  prop - the property to lookup
   * @return  {Field}   the Field to get the property from (either this Field or another Field)
   */
  _resolveReference(prop) {
    const schema = this.context.systems.schema;

    const val = this.props[prop];
    if (val && (typeof val === 'string')) {   // This will only work for strings
      const match = val.match(/^\{(.*)\}$/);
      if (match) {
        const field = schema.fields.get(match[1]);
        if (field) {
          return field;
        }
        console.warn(`Unable to resolve referenced fieldID: ${this.id}.${prop} -> ${match[1]}`);  // eslint-disable-line no-console
      }
    }
    return this;
  }

}
