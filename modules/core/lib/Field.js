import { utilObjectOmit, utilSafeString } from '@rapid-sdk/util';


/**
 * Field
 * A Field represents a user interface component that appears in the Rapid inspector.
 * Each field corresponds to one or more "keys" (OpenStreetMap tag keys).
 * The available fields are determined by the preset matched.
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

    this.id = props.id;
    this.safeid = utilSafeString(props.id);    // for use in classes, element ids, css selectors

    // Preserve and cleanup all original properties..
    this.orig = {};
    this.orig.autoSuggestions = props.autoSuggestions ?? true;
    this.orig.caseSensitive = props.caseSensitive ?? false;
    this.orig.customValues = props.customValues ?? true;
    this.orig.default = props.default;
    this.orig.geometry = props.geometry ?? [];
    this.orig.icon = props.icon;
    this.orig.increment = props.increment ?? 1;
    this.orig.key = props.key;
    this.orig.keys = props.keys ?? [props.key];
    this.orig.label = props.label ?? '';
    this.orig.locationSet = props.locationSet;
    this.orig.maxValue = props.maxValue;
    this.orig.minValue = props.minValue;
    this.orig.options = props.options;
    this.orig.pattern = props.pattern;
    this.orig.placeholder = props.placeholder ?? '';
    this.orig.prerequisiteTag = props.prerequisiteTag;
    this.orig.reference = props.reference;
    this.orig.snake_case = props.snake_case ?? true;
    this.orig.strings = props.strings;
    this.orig.terms = (props.terms ?? []).join();
    this.orig.type = props.type;
    this.orig.universal = props.universal ?? false;
    this.orig.urlFormat = props.urlFormat;
    this.orig.usage = props.usage;

    // Convert some `props` properties to class properties.. (others will become class functions)
    Object.assign(this, utilObjectOmit(this.orig, ['increment', 'label', 'placeholder', 'terms']));

    const presets = context.systems.presets;
    if (this.orig.geometry.length) {
      this.geometries = new Set(this.orig.geometry);
    } else {
      this.geometries = new Set(presets.geometries);  // all geometries
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
    return this.type === 'number' ? this.orig.increment : undefined;
  }

  title() {
    return this._resolveReference('label').t('label', { 'default': this.orig.label || this.id });
  }

  label() {
    return this._resolveReference('label').tHtml('label', { 'default': this.orig.label || this.id });
  }

  placeholder() {
    return this._resolveReference('placeholder').t('placeholder', { 'default': this.orig.placeholder });
  }

  terms() {
    return this._resolveReference('terms').t('terms', { 'default': this.orig.terms })
      .toLowerCase().trim().split(/\s*,+\s*/);
  }

  t(scope, options) {
    return this.context.systems.l10n.t(`_tagging.presets.fields.${this.id}.${scope}`, options);
  }

  tHtml(scope, options) {
    return this.context.systems.l10n.tHtml(`_tagging.presets.fields.${this.id}.${scope}`, options);
  }

  _resolveReference(prop) {
    const allFields = this.context.systems.presets.allFields;

    const val = this.orig[prop] || '';    // always lookup original properties, don't use the functions
    const match = val.match(/^\{(.*)\}$/);
    if (match) {
      const field = allFields[match[1]];
      if (field) {
        return field;
      }
      console.error(`Unable to resolve referenced field: ${match[1]}`);  // eslint-disable-line no-console
    }
    return this;
  }

}
