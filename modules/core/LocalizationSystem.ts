import { numClamp, numWrap } from '@rapid-sdk/math';

import { AbstractSystem } from './AbstractSystem.ts';
import { utilDate } from '../util/date.ts';
import { utilDetect } from '../util/detect.ts';

import type { Context, D3Selection } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { EntityID, Tags, Vec2 } from '../data/index.js';


/** Information about a language */
export interface LanguageInfo {
  /** Native name of the language (e.g. "Deutsch" for German) */
  nativeName?: string;
  /** Base language code for derived languages */
  base?: string;
  /** Script code for the language */
  script?: string;
}

/** Information about a locale */
export interface LocaleInfo {
  /** Whether the locale uses right-to-left text direction */
  rtl?: boolean;
}

/** Result of resolving a localized string */
interface ResolvedString {
  /** The resolved text */
  text: string;
  /** The locale the text was found in, or null if using default */
  locale: string | null;
}

/** Replacement tokens for localized strings */
export interface StringReplacements {
  /** Default value if string is not found */
  default?: string;
  /** Prefix to prepend to the result */
  prefix?: string;
  /** Suffix to append to the result */
  suffix?: string;
  /** Any other replacement tokens */
  [key: string]: string | number | undefined;
}

/** Cache structure for localized strings by scope */
type LocaleCache = Record<string, Record<string, any>>;

/** Function that appends localized text to a D3 selection */
export interface AppendFunction {
  (selection: D3Selection): D3Selection;
  /** The string ID that was used */
  stringID: string;
}


/**
 * `LocalizationSystem` manages language and locale parameters including translated strings
 *
 * Events available:
 *   `localechange`    Fires on any change in the current locale
 */
export class LocalizationSystem extends AbstractSystem {
  // These are the different language packs that can be loaded
  private readonly _scopes: Set<string>;

  // Preferred locale codes can be used to override the detected locale
  private _preferredLocaleCodes: string[];

  // Current locale state
  private _currLocaleCode: string;
  private _currLocaleCodes: string[];
  private _currLanguageCode: string;
  private _currTextDirection: 'ltr' | 'rtl';
  private _currIsMetric: boolean;
  private _currLanguageNames: Record<string, string>;
  private _currScriptNames: Record<string, string>;

  // All known language codes and their local name
  private _languages: Record<string, LanguageInfo>;

  // All supported locale codes
  private _locales: Record<string, LocaleInfo>;

  // Cache for loaded string data, organized by locale then scope
  private _cache: LocaleCache;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'l10n';
    this.requiredDependencies = new Set(['assets']);
    this.optionalDependencies = new Set(['gfx', 'schema', 'urlhash']);

    // These are the different language packs that can be loaded..
    this._scopes = new Set(['core', 'tagging', 'imagery', 'community']);

    // Preferred locale codes can be used to override the detected locale, if they are set before init
    this._preferredLocaleCodes = [];

    // Some notes on language and locale codes.
    // Browsers provide the locale codes in BCP47 format in the `navigator.languages` property.
    // So we expect locale codes to look like `['en-US', 'en']`  (with hyphens).
    // Our source language in Transifex is `en` however we treat it like `en-US`.

    // A few defaults:
    this._currLocaleCode = 'en-US';            // The current locale
    this._currLocaleCodes = ['en-US', 'en'];   // Must contain `_currLocaleCode` first, followed by fallbacks
    this._currLanguageCode = 'en';
    this._currTextDirection = 'ltr';
    this._currIsMetric = false;
    this._currLanguageNames = {};
    this._currScriptNames = {};


    // `_languages`
    // All known language codes and their local name. This is used for the language pickers.
    // {
    //   "ar": { "nativeName": "العربية" },
    //   "de": { "nativeName": "Deutsch" },
    //   "en": { "nativeName": "English" },
    //   …
    // }
    this._languages = {};

    // `_locales`
    // All supported locale codes that we can fetch translated strings for.
    // We generate this based on the data that we fetch from Transifex.
    //
    // * `rtl` - right-to-left or left-to-right text direction
    //
    // {
    //   "ar":    { "rtl": true },
    //   "ar-AA": { "rtl": true },
    //   "en":    { "rtl": false },
    //   "en-AU": { "rtl": false },
    //   "en-GB": { "rtl": false },
    //   "de":    { "rtl": false },
    //   …
    // }
    this._locales = {};

    // `_cache`
    // Where we keep all loaded string data, organized by "locale" then "scope":
    // {
    //   en: {
    //     core:    { icons: {…}, toolbar: {…}, modes: {…}, operations: {…}, … },
    //     tagging: { presets: {…}, fields: {…}, … },
    //     …
    //   },
    //   de: {
    //     core:    { icons: {…}, toolbar: {…}, modes: {…}, operations: {…}, … },
    //     tagging: { presets: {…}, fields: {…}, … },
    //     …
    //   },
    // }
    this._cache = {} as LocaleCache;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._hashchange = this._hashchange.bind(this);
    this._localeChanged = this._localeChanged.bind(this);
    this.t = this.t.bind(this);
    this.tHtml = this.tHtml.bind(this);
    this.tAppend = this.tAppend.bind(this);
  }


  /**
   * localeCode
   * The current locale code (e.g. 'en-US', 'de', 'zh-CN')
   */
  get localeCode(): string {
    return this._currLocaleCode;
  }

  /**
   * localeCodes
   * Array of locale codes in priority order, with the current locale first followed by fallbacks
   */
  get localeCodes(): string[] {
    return this._currLocaleCodes;
  }

  /**
   * languageCode
   * The language portion of the current locale (e.g. 'en' from 'en-US')
   */
  get languageCode(): string {
    return this._currLanguageCode;
  }

  /**
   * textDirection
   * The text direction for the current locale ('ltr' or 'rtl')
   */
  get textDirection(): 'ltr' | 'rtl' {
    return this._currTextDirection;
  }

  /**
   * isMetric
   * Whether the current locale uses metric units (true for most locales, false for 'en-US')
   */
  get isMetric(): boolean {
    return this._currIsMetric;
  }

  /**
   * languageNames
   * Map of language codes to their localized display names
   */
  get languageNames(): Record<string, string> {
    return this._currLanguageNames;
  }

  /**
   * scriptNames
   * Map of script codes to their localized display names
   */
  get scriptNames(): Record<string, string> {
    return this._currScriptNames;
  }

  /**
   * isRTL
   * Whether the current locale uses right-to-left text direction
   */
  get isRTL(): boolean {
    return this._currTextDirection === 'rtl';
  }

  /**
   * preferredLocaleCodes
   * Allows the user to manually set the locale, overriding the locales specified by the browser
   * If you're going to use this, you must call it before `initAsync` starts fetching data.
   * @param codes - Array or String of preferred locales
   */
  set preferredLocaleCodes(codes: string | string[]) {
    if (typeof codes === 'string') {
      // Be generous and accept delimited strings as input
      this._preferredLocaleCodes = codes.split(/,|;| /gi).filter(Boolean);
    } else {
      this._preferredLocaleCodes = codes || [];
    }
  }
  get preferredLocaleCodes(): string[] {
    return this._preferredLocaleCodes;
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return Promise resolved after the files have been loaded
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const assets = context.systems.assets;
    const urlhash = context.systems.urlhash;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          assets?.initAsync(),
          urlhash?.initAsync()
        ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        return Promise.all([
          assets!.loadAssetAsync('languages'),
          assets!.loadAssetAsync('locales')
        ]);
      })
      .then((results) => {
        const langResult = results[0] as { languages: Record<string, LanguageInfo> };
        const localeResult = results[1] as { locales: Record<string, LocaleInfo> };
        this._languages = langResult.languages;
        this._locales = localeResult.locales;

        // Setup event handlers..
        urlhash?.on('hashchange', this._hashchange);

        return this.selectLocaleAsync();
      });
//      .catch(e => console.error(e));  // eslint-disable-line
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  /**
   * _selectLocale
   * Returns a Promise to select the locale.
   * @return Promise resolved when the locale has been selected and strings loaded
   */
  selectLocaleAsync(): Promise<void> {
    const context = this.context;
    const urlhash = context.systems.urlhash;

    const urlLocale = urlhash?.getParam('locale');
    let urlLocaleCodes: string[] = [];
    if (typeof urlLocale === 'string') {
      urlLocaleCodes = urlLocale.split(',').map(s => s.trim()).filter(Boolean);
    }

    // Choose the preferred locales in this order:
    //   1. Locales stored in `_preferredLocaleCodes`
    //   2. Locales included in the url hash
    //   3. Locales detected by the browser
    //   4. English (always fallback)
    const requestedLocales = (this._preferredLocaleCodes || [])
      .concat(urlLocaleCodes)
      .concat(utilDetect().locales)   // Locales preferred by the browser in priority order.
      .concat(['en']);                // Fallback to English since it's the only guaranteed complete language

    this._currLocaleCodes = this._getSupportedLocales(requestedLocales);
    this._currLocaleCode = this._currLocaleCodes[0];   // First is highest priority locale; the rest are fallbacks

    const loadPromises = this._currLocaleCodes.map(locale => this._loadStringsAsync(locale));
    return Promise.all(loadPromises)
      .then(() => this._localeChanged());
  }


  /**
   * _loadStringsAsync
   * Returns a Promise to load the strings for the requested locale
   * Note that this returns a `Promise.allSettled` because some of these may
   *   fail/reject if a particular language pack doesn't exist.
   * (For example `core.zh-CN.min.json` exists but `imagery.zh-CC.min.json` doesn't)
   *
   * @param locale - locale code to load
   * @return Promise resolved when all string loading has settled
   */
  private _loadStringsAsync(locale: string): Promise<void | PromiseSettledResult<void>[]> {
    const context = this.context;
    const assets = context.systems.assets;

    if (locale.toLowerCase() === 'en-us') {  // `en-US` strings are stored as `en`
      locale = 'en';
    }

    const cache = this._cache;
    if (cache[locale]) {  // already loaded
      return Promise.resolve();
    } else {
      cache[locale] = {};
    }

    const loadPromises: Promise<void>[] = [];
    for (const scope of this._scopes) {   // 'core', 'tagging', 'imagery', 'community'
      const key = `l10n_${scope}_${locale}`;
      const path = `data/l10n/${scope}.${locale}.min.json`;
      assets!.setAsset(key, path);

      const prom = assets!.loadAssetAsync(key)
        .then((data) => {
          const d = data as Record<string, any>;
          cache[locale][scope] = d[locale];
        });

      loadPromises.push(prom);
    }

    return Promise.allSettled(loadPromises);
  }


  /**
   * _hashchange
   * Respond to any changes appearing in the url hash
   * @param currParams - The current hash parameters
   * @param prevParams - The previous hash parameters
   */
  private _hashchange(currParams: Map<string, string>, prevParams: Map<string, string>): void {
    const context = this.context;
    const urlhash = context.systems.urlhash;

    // rtl
    const newRTL = currParams.get('rtl');
    const oldRTL = prevParams.get('rtl');
    if (newRTL !== oldRTL) {
      let cleaned = null;
      if (typeof newRTL === 'string') {
        cleaned = newRTL.trim().toLowerCase();
        if (cleaned !== 'true' && cleaned !== 'false') cleaned = null;
      }
      urlhash?.setParam('rtl', cleaned);
      this._localeChanged();
    }

    // locale
    const newLocale = currParams.get('locale');
    const oldLocale = prevParams.get('locale');
    if (newLocale !== oldLocale) {
      let cleaned: string[] = [];
      if (typeof newLocale === 'string') {
        const requested = newLocale.split(',').map(s => s.trim()).filter(Boolean);
        cleaned = this._getSupportedLocales(requested);
      }
      urlhash?.setParam('locale', cleaned.length ? cleaned.join(',') : null);
      this.selectLocaleAsync();
    }
  }


  /**
   * pluralRule
   * Returns the plural rule for the given `number` with the given `code`.
   * see: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules/select
   *
   * @param num - number to get the plural rule
   * @param locale - locale to use (defaults to currentLocale)
   * @return One of: `zero`, `one`, `two`, `few`, `many`, `other`
   */
  pluralRule(num: number, locale: string = this._currLocaleCode): Intl.LDMLPluralRule {
    // modern browsers have this functionality built-in
    const rules = 'Intl' in globalThis && Intl.PluralRules && new Intl.PluralRules(locale);
    if (rules) {
      return rules.select(num);
    }
    // fallback to basic one/other, as in English
    return (num === 1) ? 'one' : 'other';
  }


  /**
   * _resolveString
   * Try to find a localized string matching the given `stringID`.
   * This function will recurse through all `searchLocales` until a string is found.
   * or until we run out of locales, then we will return a special "Missing translation" string.
   *
   * Note: If the `stringID` starts with an underscore, the first part is used as the "scope".
   * Otherwise, the default `core` scope will be used.
   *
   * @param origStringID  - string identifier
   * @param replacements  - token replacements and default string
   * @param searchLocales - locales to search (defaults to currentLocales)
   * @return result containing the localized string and chosen locale
   */
  private _resolveString(
    origStringID: string,
    replacements?: StringReplacements,
    searchLocales?: string[]
  ): ResolvedString {
    if (!Array.isArray(searchLocales)) {
      searchLocales = this._currLocaleCodes.slice();  // copy
    }

    const locale = searchLocales.shift();  // remove first one
    if (!locale) {
      const missing = `Missing translation: ${origStringID}`;
      if (typeof console !== 'undefined') console.error(missing);  // eslint-disable-line
      return { text: missing, locale: 'en' };
    }

    // Note that we don't overwrite `locale` because that `en-US` value
    // might be used later by the pluralRule or number formatter.
    let tryLocale: string | undefined = locale;
    if (locale.toLowerCase() === 'en-us') {  // `en-US` strings are stored as `en`
      tryLocale = 'en';
    }

    let stringID = origStringID.trim();
    let scope = 'core';

    if (stringID[0] === '_') {
      const parts = stringID.split('.');
      scope = parts[0].slice(1);
      stringID = parts.slice(1).join('.');
    }

    const path = stringID
      .split('.')
      .map(s => s.replace(/<TX_DOT>/g, '.'))
      .reverse();

    let result: any = tryLocale && this._cache[tryLocale] && this._cache[tryLocale][scope];
    while (result !== undefined && path.length) {
      const key = path.pop()!;
      result = result[key];
    }

    if (result !== undefined) {
      if (replacements) {
        if (typeof result === 'object' && Object.keys(result).length) {
          // If plural forms are provided, dig one level deeper based on the
          // first numeric token replacement provided.
          const number = Object.values(replacements).find(val => (typeof val === 'number'));
          if (number !== undefined) {
            const rule = this.pluralRule(number, locale);
            if (result[rule]) {
              result = result[rule];
            } else {
              // We're pretty sure this should be a plural but no string
              // could be found for the given rule. Just pick the first
              // string and hope it makes sense.
              result = Object.values(result)[0];
            }
          }
        }

        if (typeof result === 'string') {
          for (const [key, value] of Object.entries(replacements)) {
            let strValue: string;
            if (typeof value === 'number') {
              if (value.toLocaleString) {
                // format numbers for the locale
                strValue = value.toLocaleString(locale, {
                  style: 'decimal',
                  useGrouping: true,
                  minimumFractionDigits: 0
                });
              } else {
                strValue = value.toString();
              }
            } else if (typeof value === 'string') {
              strValue = value;
            } else {
              continue;  // skip undefined values
            }
            const token = `{${key}}`;
            const regex = new RegExp(token, 'g');
            result = result.replace(regex, strValue);
          }
        }
      }

      if (typeof result === 'string') {  // found a localized string!
        return { text: result, locale: locale };
      }
    }

    // no localized string found...

    // Attempt to fallback to a lower-priority language
    if (searchLocales.length) {
      return this._resolveString(origStringID, replacements, searchLocales);
    }

    // Fallback to a default value if one is specified in `replacements`
    if (replacements && ('default' in replacements) && (replacements.default !== undefined)) {
      return { text: replacements.default, locale: null };
    }

    const missing = `Missing ${locale} translation: ${origStringID}`;
    if (typeof console !== 'undefined') console.error(missing);  // eslint-disable-line

    return { text: missing, locale: 'en' };
  }


  /**
   * hasTextForStringID
   * Returns true if the given string id will return a string
   *
   * @param stringID - string identifier
   * @return true if the given string id will return a string
   */
  hasTextForStringID(stringID: string): boolean {
    return !!this._resolveString(stringID, { default: 'nothing found' }).locale;
  }


  /**
   * t
   * Returns only the localized text, discarding the locale info
   * @param stringID      - string identifier
   * @param replacements  - token replacements and default string
   * @param locale        - locale to use (defaults to currentLocale)
   * @return the localized string
   */
  t(stringID: string, replacements?: StringReplacements, locale?: string | string[]): string {
    let localeParam: string[] | undefined;
    if (typeof locale === 'string') localeParam = [locale];
    else if (Array.isArray(locale)) localeParam = locale;

    return this._resolveString(stringID, replacements, localeParam).text;
  }


  /**
   * t.html
   * Returns the localized text wrapped in an HTML span element encoding the locale info
   * @param stringID      - string identifier
   * @param replacements  - token replacements and default string
   * @param locale        - locale to use (defaults to currentLocale)
   * @return localized string wrapped in a HTML span, or empty string ''
   */
  tHtml(stringID: string, replacements?: StringReplacements, locale?: string | string[]): string {
    let localeParam: string[] | undefined;
    if (typeof locale === 'string') localeParam = [locale];
    else if (Array.isArray(locale)) localeParam = locale;

    const info = this._resolveString(stringID, replacements, localeParam);
    // text may be empty or undefined depending on `replacements.default`
    return info.text ? this.htmlForLocalizedText(info.text, info.locale) : '';
  }


  /**
   * t.append
   * Safer version of t.html that instead uses a function that appends the localized text to the given d3 selection
   * @param stringID      - string identifier
   * @param replacements  - token replacements and default string
   * @param locale        - locale to use (defaults to currentLocale)
   * @return Function that accepts a d3 selection and appends the localized text
   */
  tAppend(stringID: string, replacements?: StringReplacements, locale?: string | string[]): AppendFunction {
    let localeParam: string[] | undefined;
    if (typeof locale === 'string') localeParam = [locale];
    else if (Array.isArray(locale)) localeParam = locale;

    const ret = ((selection: D3Selection) => {
      const info = this._resolveString(stringID, replacements, localeParam);
      return selection.append('span')
        .attr('class', 'localized-text')
        .attr('lang', info.locale || 'und')
        .text((replacements?.prefix || '') + info.text + (replacements?.suffix || ''));
    }) as AppendFunction;
    ret.stringID = stringID;
    return ret;
  }


  /**
   * htmlForLocalizedText
   * Just returns the given text wrapped in an HTML span element encoding the locale
   * @param text       - the text content for the span
   * @param localeCode - the locale code for the span
   * @return text wrapped in a HTML span
   */
  htmlForLocalizedText(text: string, localeCode?: string | null): string {
    return `<span class="localized-text" lang="${localeCode || 'unknown'}">${text}</span>`;
  }


  /**
   * languageName
   * Returns a display-ready string for a given language code
   * @param code    - the language code (e.g. 'de')
   * @param options - options object with optional `localOnly` property
   * @return the language string to display (e.g. "Deutsch (de)")
   */
  languageName(code: string, options?: { localOnly?: boolean }): string | null {
    if (this._currLanguageNames[code]) {      // name in locale language
      // e.g. "German"
      return this._currLanguageNames[code];
    }

    // sometimes we only want the local name
    if (options && options.localOnly) return null;

    const langInfo = this._languages[code];
    if (langInfo) {
      if (langInfo.nativeName) {  // name in native language
        // e.g. "Deutsch (de)"
        return this.t('translate.language_and_code', { language: langInfo.nativeName, code: code });

      } else if (langInfo.base && langInfo.script) {
        const base = langInfo.base;  // the code of the language this is based on

        if (this._currLanguageNames[base]) {   // base language name in locale language
          const scriptCode = langInfo.script;
          const script = this._currScriptNames[scriptCode] || scriptCode;
          // e.g. "Serbian (Cyrillic)"
          return this.t('translate.language_and_code', { language: this._currLanguageNames[base], code: script });

        } else if (this._languages[base] && this._languages[base].nativeName) {
          // e.g. "српски (sr-Cyrl)"
          return this.t('translate.language_and_code', { language: this._languages[base].nativeName, code: code });
        }
      }
    }

    return code;  // if not found, use the code
  }


  /**
   * displayName
   * Get a localized display name for a map feature
   * @param tags        - OSM tags object
   * @param hideNetwork - If true, the `network` tag will not be used in the name to prevent
   *   it being shown twice (see PR iD#8707#discussion_r712658175)
   * @return A name string suitable for display
   */
  displayName(tags: Tags, hideNetwork?: boolean): string {
    const code = this._currLanguageCode.toLowerCase();

    const route = tags.route;
    const name = tags[`name:${code}`] ?? tags.name ?? '';

    // Gather the properties we may use to construct a display name
    const props = {
      name: name,
      direction: tags.direction,
      from: tags.from,
      network: hideNetwork ? undefined : (tags.cycle_network ?? tags.network),
      ref: tags.ref,
      to: tags.to,
      via: tags.via
    };

    // For routes, prefer `network+ref+name` or `ref+name` over `name`
    if (route && props.ref && props.name) {
      return props.network ?
        this.t('inspector.display_name.network_ref_name', props) :
        this.t('inspector.display_name.ref_name', props);
    }

    // If we have a name, return it
    if (name) {
      return name;
    }

    // Construct a name from other tags.
    const keyComponents: string[] = [];
    if (props.network) {
      keyComponents.push('network');
    }
    if (props.ref) {
      keyComponents.push('ref');
    }

    // Routes may need more disambiguation based on direction or destination
    if (route) {
      if (props.direction) {
        keyComponents.push('direction');
      } else if (props.from && props.to) {
        keyComponents.push('from');
        keyComponents.push('to');
        if (props.via) {
          keyComponents.push('via');
        }
      }
    }

    if (keyComponents.length) {
      return this.t('inspector.display_name.' + keyComponents.join('_'), props);
    }

    // bhousel 3/28/22 - no labels for addresses for now
    // // if there's still no name found, try addr:housename
    // if (tags['addr:housename']) {
    //   return tags['addr:housename'];
    // }
    //
    // // as a last resort, use the street address as a name
    // if (tags['addr:housenumber'] && tags['addr:street']) {
    //   return tags['addr:housenumber'] + ' ' + tags['addr:street'];
    // }

    return '';
  }


  /**
   * displayPOIName
   * This is like `displayName`, but more useful for POI display names (includes brand)
   * @param tags - OSM tags object
   * @return A name string suitable for display
   */
  displayPOIName(tags: Tags): string {
    const code = this._currLanguageCode.toLowerCase();
    return tags[`name:${code}`] ?? tags.name ??
      tags[`brand:${code}`] ?? tags.brand ??
      tags[`operator:${code}`] ?? tags.operator ??
      '';
  }


  /**
   * displayType
   * @param entityID - OSM-like ID that starts with 'n', 'w', or 'r'
   * @return Localized string for 'Node', 'Way', or 'Relation'
   */
  displayType(entityID: string): string {
    return ({
      n: this.t('inspector.node'),
      w: this.t('inspector.way'),
      r: this.t('inspector.relation')
    } as Record<string, string>)[entityID.charAt(0)];
  }


  /**
   * displayLabel
   * Returns a string suitable for display
   * By default returns something like name/ref, fallback to preset type, fallback to OSM type
   *   "Main Street" or "Tertiary Road"
   * If `verbose=true`, include both preset name and feature name.
   *   "Tertiary Road Main Street"
   * @param entity          - The entity to get the label for
   * @param graphOrGeometry - Either a Graph or geometry string
   * @param verbose         - Whether to include both preset and feature name
   * @return A name string suitable for display
   */
  displayLabel(entity: { id: EntityID; tags: Tags }, graphOrGeometry: Graph | string, verbose?: boolean): string {
    const context = this.context;
    const schema = context.systems.schema as any;

    // Choose the display name, if possible
    const displayName = this.displayName(entity.tags);

    // Choose the preset name, if possible.
    let presetName;
    if (schema) {
      const preset = typeof graphOrGeometry === 'string' ?
        schema.matchTags(entity.tags, graphOrGeometry) :
        schema.match(entity, graphOrGeometry);
      presetName = preset && (preset.props.suggestion ? preset.subtitle() : preset.name);
    }

    let result;
    if (verbose) {
      result = [presetName, displayName].filter(Boolean).join(' ');
    } else {
      result = displayName || presetName;
    }

    // Fallback to the OSM type (node/way/relation)
    return result ?? this.displayType(entity.id);
  }


  /**
   * Returns a localized representation of the given length measurement.
   * @param meters     - length in meters
   * @param isImperial - true for U.S. customary units; false for metric
   * @return Text to display
   */
  displayLength(meters: number, isImperial: boolean): string {
    const locale = this._currLocaleCode;
    let n = meters * (isImperial ? 3.28084 : 1);
    let unit;

    if (isImperial) {
      if (n >= 5280) {
        n /= 5280;
        unit = 'miles';
      } else {
        unit = 'feet';
      }
    } else {
      if (n >= 1000) {
        n /= 1000;
        unit = 'kilometers';
      } else {
        unit = 'meters';
      }
    }

    return this.t(`units.${unit}`, {
      quantity: n.toLocaleString(locale, { maximumSignificantDigits: 4 })
    });
  }


  /**
   * Returns a localized representation of the given area measurement.
   *
   * @param meters2    - area in square meters
   * @param isImperial - true for U.S. customary units; false for metric
   * @return Text to display
   */
  displayArea(meters2: number, isImperial: boolean): string {
    const locale = this._currLocaleCode;
    const n = meters2 * (isImperial ? 10.7639111056 : 1);
    let n1: number;
    let n2: number | undefined;
    let unit1: string;
    let unit2: string | undefined;

    if (isImperial) {
      if (n >= 6969600) {  // > 0.25mi² show mi²
        n1 = n / 27878400;
        unit1 = 'square_miles';
      } else {
        n1 = n;
        unit1 = 'square_feet';
      }

      if (n > 4356 && n < 43560000) {  // 0.1 - 1000 acres
        n2 = n / 43560;
        unit2 = 'acres';
      }

    } else {
      if (n >= 250000) {  // > 0.25km² show km²
        n1 = n / 1000000;
        unit1 = 'square_kilometers';
      } else {
        n1 = n;
        unit1 = 'square_meters';
      }

      if (n > 1000 && n < 10000000) {   // 0.1 - 1000 hectares
        n2 = n / 10000;
        unit2 = 'hectares';
      }
    }

    const area = this.t(`units.${unit1}`, {
      quantity: n1.toLocaleString(locale, { maximumSignificantDigits: 4 })
    });

    if (unit2 && n2 !== undefined) {
      const area2 = this.t(`units.${unit2}`, {
        quantity: n2.toLocaleString(locale, { maximumSignificantDigits: 2 })
      });

      return this.t('units.area_pair', { area1: area, area2: area2 });
    } else {
      return area;
    }
  }


  /**
   * displayShortDate
   * Displays a date in its localized short format, for example in US would be 'Jan 01, 2025'.
   * It treats dates as UTC, to avoid timezone surprises.
   * Accepts a date, a numeric timestamp, or a string that looks like a Date.
   * @param val - the Date-like value to display.
   * @return Text to display
   */
  displayShortDate(val: string | number | Date): string {
    const d = utilDate(val);
    if (!d) return '';

    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
    return d.toLocaleDateString(this._currLocaleCode, options);
  }


  /**
   * Returns given coordinate pair in degree-minute-second format.
   * @param coord - longitude and latitude as [lon, lat]
   * @return Text to display
   */
  dmsCoordinatePair(coord: Vec2): string {
    return this.t('units.coordinate_pair', {
      latitude: this._displayCoordinate(numClamp(coord[1], -90, 90), 'north', 'south'),
      longitude: this._displayCoordinate(numWrap(coord[0], -180, 180), 'east', 'west')
    });
  }


  /**
   * Return some parsed values in DMS formats that @mapbox/sexagesimal can't parse, see iD#10066
   * Note that `@mapbox/sexagesimal` returns [lat,lon], so this code does too.
   * @param q - string to attempt to parse
   * @return The location formatted as `[lat,lon]`, or `null` it can't be parsed
   */
  dmsMatcher(q: string): Vec2 | null {
    let match;

    // DD MM SS , DD MM SS  ex: 35 11 10.1 , 136 49 53.8
    const DMS_DMS = /^\s*(-?)\s*(\d+)\s+(\d+)\s+(\d+\.?\d*)\s*\,\s*(-?)\s*(\d+)\s+(\d+)\s+(\d+\.?\d*)\s*$/;
    match = q.match(DMS_DMS);
    if (match) {
      let lat = (+match[2]) + (+match[3]) / 60 + (+match[4]) / 3600;
      let lon = (+match[6]) + (+match[7]) / 60 + (+match[8]) / 3600;
      if (match[1] === '-') lat *= -1;
      if (match[5] === '-') lon *= -1;
      return [lat, lon];
    }

    // DD MM , DD MM  ex: 35 11 10.1 , 136 49 53.8
    const DM_DM = /^\s*(-?)\s*(\d+)\s+(\d+\.?\d*)\s*\,\s*(-?)\s*(\d+)\s+(\d+\.?\d*)\s*$/;
    match = q.match(DM_DM);
    if (match) {
      let lat = +match[2] + (+match[3]) / 60;
      let lon = +match[5] + (+match[6]) / 60;
      if (match[1] === '-') lat *= -1;
      if (match[4] === '-') lon *= -1;
      return [lat, lon];
    }

    return null;
  }


  /**
   * Returns the given coordinate pair in decimal format.
   * note: unlocalized to avoid comma ambiguity - see iD#4765
   * @param coord - longitude and latitude as [lon, lat]
   * @return Text to display
   */
  decimalCoordinatePair(coord: Vec2): string {
    const OSM_PRECISION = 7;
    return this.t('units.coordinate_pair', {
      latitude: numClamp(coord[1], -90, 90).toFixed(OSM_PRECISION),
      longitude: numWrap(coord[0], -180, 180).toFixed(OSM_PRECISION)
    });
  }


  /**
   * Format a degree coordinate as DMS (degree minute second)for display
   * @param deg - degrees to convert to DMS
   * @param pos - string to use for positive values (either 'north' or 'east')
   * @param neg - string to use for negative values (either 'south' or 'west')
   * @return Text to display
   */
  private _displayCoordinate(deg: number, pos: string, neg: string): string {
    const EPSILON = 0.01;
    const locale = this._currLocaleCode;
    const min = (Math.abs(deg) - Math.floor(Math.abs(deg))) * 60;
    let sec = (min - Math.floor(min)) * 60;

    // If you input 45°,90°0'0.5" , sec should be 0.5 instead 0.499999…
    // To mitigate precision errors after calculating, round again, see iD#10066
    sec = +sec.toFixed(8);   // 0.499999… => 0.5

    const displayDegrees = this.t('units.arcdegrees', {
      quantity: Math.floor(Math.abs(deg)).toLocaleString(locale)
    });

    let displayCoordinate;

    if (Math.abs(sec) > EPSILON) {
      displayCoordinate = displayDegrees +
        this.t('units.arcminutes', { quantity: Math.floor(min).toLocaleString(locale) }) +
        this.t('units.arcseconds', { quantity: Math.round(sec).toLocaleString(locale) });
    } else if (Math.abs(min) > EPSILON) {
      displayCoordinate = displayDegrees +
        this.t('units.arcminutes', { quantity: Math.round(min).toLocaleString(locale) });
    } else {
      displayCoordinate = displayDegrees;
    }

    if (deg === 0) {
      return displayCoordinate;
    } else {
      return this.t('units.coordinate', {
        coordinate: displayCoordinate,
        direction: this.t('units.' + (deg > 0 ? pos : neg))
      });
    }
  }


  /**
   * _getSupportedLocales
   * Returns the locales from `requestedLocales` that are actually supported
   * In here we also correct the capitalization/hyphenation to make the locales look like BCP47.
   * @param requested - locale codes to consider, in priority order
   * @return The locales that we can actually support
   */
  private _getSupportedLocales(requested: Iterable<string>): string[] {
    const results = new Set();

    for (const locale of requested) {
      if (!locale) continue;

      // Note: Replace CLDR-style underscores with BCP47-style hypens to make things easier.
      let fullCode = locale.replace(/_/g, '-');

      // Split it apart, fix capitalization, put back together
      let [languageCode, territoryCode] = fullCode.split('-', 2);
      languageCode = languageCode.toLowerCase();
      fullCode = languageCode;

      if (territoryCode) {
        territoryCode = territoryCode.toUpperCase();
        fullCode = fullCode + '-' + territoryCode;
      }

      // If it's in the locales list, or 'en-US', it's supported
      if (this._locales[fullCode] || fullCode === 'en-US') {
        results.add(fullCode);
      }

      // For a locale with a territory code `zh-CN`, also fallback to the base locale `zh`
      if (territoryCode) {
        if (this._locales[languageCode]) {
          results.add(languageCode);
        }
      }
    }

    return Array.from(results) as string[];
  }


  /**
   * _localeChanged
   * Called whenever something about the locale has changed.
   * This should happen after all locale files have been fetched.
   * This will trigger a redraw, and emit a 'localechange' event.
   */
  private _localeChanged(): void {
    const context = this.context;
    const gfx = context.systems.gfx as any;
    const urlhash = context.systems.urlhash;

    if (!this._currLocaleCode) {       // no current locale?  shouldn't happen, reset to defaults
      this._currLocaleCode = 'en-US';
      this._currLocaleCodes = ['en-US', 'en'];
    }

    const [languageCode, territoryCode] = this._currLocaleCode.toLowerCase().split('-', 2);
    this._currLanguageCode = languageCode;
    this._currIsMetric = (territoryCode !== 'us');

    // Determine text direction
    // If an `rtl` param is present in the urlhash, use that instead
    const urlRTL = urlhash?.getParam('rtl');
    if (urlRTL === 'true') {
      this._currTextDirection = 'rtl';
    } else if (urlRTL === 'false') {
      this._currTextDirection = 'ltr';
    } else {
      const supported = this._locales[this._currLocaleCode] || this._locales[this._currLanguageCode];
      this._currTextDirection = supported && supported.rtl ? 'rtl' : 'ltr';
    }

    // Language and Script names will appear in the local language
    // Like other strings, these names follow fallback rules, e.g. `zh-CN` -> `zh` -> `en`
    let currLocale = this._currLocaleCode;
    if (currLocale.toLowerCase() === 'en-us') {  // `en-US` strings are stored as `en`
      currLocale = 'en';
    }

    const langNamesCurr = this._cache[currLocale]?.core?.languageNames ?? {};
    const langNamesLang = this._cache[languageCode]?.core?.languageNames ?? {};
    const langNamesEn = this._cache?.en?.core?.languageNames ?? {};
    this._currLanguageNames = Object.assign({}, langNamesEn, langNamesLang, langNamesCurr);

    const scriptNamesCurr = this._cache[currLocale]?.core?.scriptNames ?? {};
    const scriptNamesLang = this._cache[languageCode]?.core?.scriptNames ?? {};
    const scriptNamesEn = this._cache?.en?.core?.scriptNames ?? {};
    this._currScriptNames = Object.assign({}, scriptNamesEn, scriptNamesLang, scriptNamesCurr);

    gfx?.immediateRedraw();
    this.emit('localechange');
  }

}
