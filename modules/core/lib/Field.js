import { utilSafeString } from '@rapid-sdk/util';


/**
 * Field
 * A Field represents a user interface component that appears in the Rapid inspector.
 * Each field corresponds to one or more "keys" (OpenStreetMap tag keys).
 * The available fields are determined by the preset matched.
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

    // Preserve properties and assign some defaults
    this.props = globalThis.structuredClone(props);
    this.props.autoSuggestions ??= true;
    this.props.caseSensitive ??= false;
    this.props.customValues ??= true;
    this.props.geometry ??= [];
    this.props.increment ||= 1;
    this.props.keys ??= [this.props.key];
    this.props.label ??= '';
    this.props.placeholder ??= '';
    this.props.snake_case ??= true;
    this.props.terms = (props.terms ?? []).join();
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
      this.geometries = new Set(schema.geometries);  // all geometries
    }

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.title = this.title.bind(this);
    this.label = this.label.bind(this);
    this.placeholder = this.placeholder.bind(this);
    this.terms = this.terms.bind(this);
  }


  /**
   * resetCache
   * Resets all cached data.
   */
  resetCache() {
  }


  increment() {
    return this.type === 'number' ? this.props.increment : undefined;
  }

  /**
   * title
   * Returns a localized field name, if possible.  Falls back to original label.
   * @return  {string}  Localized name
   */
  title() {
    return this._resolveReference('label').t('label', { 'default': this.props.label || this.id });
  }

  /**
   * label
   * Returns a localized field name HTML, if possible.  Falls back to original label.
   * @return  {string}  Localized name HTML
   */
  label() {
    return this._resolveReference('label').tHtml('label', { 'default': this.props.label || this.id });
  }

  /**
   * placeholder
   * Returns a localized field placeholder value, if possible.  Falls back to original placeholder value.
   * @return  {string}  Localized placeholder value
   */
  placeholder() {
    return this._resolveReference('placeholder').t('placeholder', { 'default': this.props.placeholder });
  }

  /**
   * terms
   * Returns localized search terms, if possible.  Falls back to original search terms.
   * @return  {Array<string>}  The localized search terms
   */
  terms() {
    return this._resolveReference('terms').t('terms', { 'default': this.props.terms })
      .toLowerCase().trim().split(/\s*,+\s*/);
  }

  /**
   * t
   * Returns a localized string, wrapper around `l10n.t`.
   * @params  {string}  scope   - The trailing part of the stringID
   * @params  {Object?} options - Optional options to pass to `l10n.t`
   * @return  {string}  Localized string
   */
  t(scope, options) {
    return this.context.systems.l10n.t(`_tagging.presets.fields.${this.id}.${scope}`, options);
  }

  /**
   * tHtml
   * Returns a localized HTML string, wrapper around `l10n.tHtml`.
   * @params  {string}  scope   - The trailing part of the stringID
   * @params  {Object?} options - Optional options to pass to `l10n.tHtml`
   * @return  {string}  Localized HTML string
   */
  tHtml(scope, options) {
    return this.context.systems.l10n.tHtml(`_tagging.presets.fields.${this.id}.${scope}`, options);
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

    const val = this.props[prop] || '';    // always lookup original properties, don't use the functions
    const match = val.match(/^\{(.*)\}$/);
    if (match) {
      const field = schema.fields.get(match[1]);
      if (field) {
        return field;
      }
      console.error(`Unable to resolve referenced field: ${match[1]}`);  // eslint-disable-line no-console
    }
    return this;
  }

}
