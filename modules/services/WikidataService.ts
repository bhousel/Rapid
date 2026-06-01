import { AbstractSystem } from '../core/AbstractSystem.ts';
import { utilQsString } from '@rapid-sdk/util';

import type { Context } from '../Context.ts';


/** Base URL for the Wikidata MediaWiki API */
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php?';


/** Internal cache for Wikidata service */
type WikidataCache = Map<string, Record<string, any>>;


/**
 * `WikidataService` runs queries against the Wikidata API.
 * @see https://www.mediawiki.org/wiki/API:Main_page
 */
export class WikidataService extends AbstractSystem {

  /** Cache of fetched Wikidata entities keyed by QID */
  protected _cache: WikidataCache;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'wikidata';
    this.requiredDependencies = new Set<SystemID>(['network']);
    this.optionalDependencies = new Set<SystemID>(['l10n']);

    this._cache = new Map();  // Map<qid, entitydata>
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    return super.initAsync();
  }


  /**
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    this._cache.clear();
    return Promise.resolve();
  }


  /**
   * Search for Wikidata items matching the query
   * @param query - string to search for
   * @param callback - errback-style callback function to call with results
   */
  public itemsForSearchQuery(query: string, callback: (err: any, result: Record<string, any>) => void): void {
    if (!query) {
      if (callback) callback('No query', {});
      return;
    }

    const lang = this.languagesToQuery()[0];
    const url = WIKIDATA_API + utilQsString({
      action: 'wbsearchentities',
      format: 'json',
      formatversion: 2,
      search: query,
      type: 'item',
      language: lang,   // the language to search
      uselang: lang,    // the language for the label and description in the result
      limit: 10,
      origin: '*'
    }, false);

    const network = this.context.systems.network!;
    network.fetch<any>(url)
      .then(result => {
        if (result && result.error) {
          throw new Error(result.error);
        }
        if (callback) callback(null, result.search || {});
      })
      .catch(err => {
        if (callback) callback(err.message, {});
      });
  }


  /**
   * Given a Wikipedia language and article title,
   *  retrieve an array of corresponding Wikidata entities.
   * @param lang - language code
   * @param title - article title
   * @param callback - errback-style callback function to call with results
   */
  public itemsByTitle(lang: string, title: string, callback: (err: any, result: Record<string, any>) => void): void {
    if (!title) {
      if (callback) callback('No title', {});
      return;
    }

    lang = lang || 'en';
    const url = WIKIDATA_API + utilQsString({
      action: 'wbgetentities',
      format: 'json',
      formatversion: 2,
      sites: lang.replace(/-/g, '_') + 'wiki',
      titles: title,
      languages: 'en', // shrink response by filtering to one language
      origin: '*'
    }, false);

    const network = this.context.systems.network!;
    network.fetch<any>(url)
      .then(result => {
        if (result && result.error) {
          throw new Error(result.error);
        }
        if (callback) callback(null, result.entities || {});
      })
      .catch(err => {
        if (callback) callback(err.message, {});
      });
  }


  /**
   * Returns the list of language codes to request from Wikidata, derived from the user's locales.
   * @return  The language codes to query
   */
  public languagesToQuery(): string[] {
    const l10n = this.context.systems.l10n;
    const localeCodes = l10n?.localeCodes || ['en'];

    return localeCodes
      .map(code => code.toLowerCase())
      .filter(code => code !== 'en-us');

    // HACK: `en-us` isn't a Wikidata language. We should really be filtering by
    // the languages known to be supported by wikidata.
  }


  /**
   * Looks up a Wikidata entity by its QID and returns the result via the callback.
   * @param qid - qid to query
   * @param callback - errback-style callback function to call with results
   */
  public entityByQID(qid: string, callback: (err: any, result?: Record<string, any>) => void): void {
    if (!qid) {
      callback('No qid', {});
      return;
    }
    if (this._cache.has(qid)) {
      if (callback) callback(null, this._cache.get(qid));
      return;
    }

    const langs = this.languagesToQuery();
    const url = WIKIDATA_API + utilQsString({
      action: 'wbgetentities',
      format: 'json',
      formatversion: 2,
      ids: qid,
      props: 'labels|descriptions|claims|sitelinks',
      sitefilter: langs.map(code => `${code}wiki`).join('|'),
      languages: langs.join('|'),
      languagefallback: 1,
      origin: '*'
    }, false);

    const network = this.context.systems.network!;
    network.fetch<any>(url)
      .then(result => {
        if (result && result.error) {
          throw new Error(result.error);
        }
        this._cache.set(qid, result.entities[qid]);
        if (callback) callback(null, result.entities[qid] || {});
      })
      .catch(err => {
        if (callback) callback(err.message, {});
      });
  }


  /**
   * Pass `params` object of the form:
   * ```ts
   * {
   *   qid: 'string'      // brand wikidata  (e.g. 'Q37158')
   * }
   * ```
   *
   * Get an result object used to display tag documentation
   * ```ts
   * {
   *   title:        'string',
   *   description:  'string',
   *   editURL:      'string',
   *   imageURL:     'string',
   *   wiki:         { title: 'string', text: 'string', url: 'string' }
   * }
   * ```
   * @param params
   * @param callback - errback-style callback function to call with results
  */
  public getDocs(params: Record<string, any>, callback: (err: any, result?: Record<string, any>) => void): void {
    const langs = this.languagesToQuery();

    this.entityByQID(params.qid, (err: any, entity: Record<string, any> | undefined) => {
      if (err || !entity) {
        callback(err || 'No entity');
        return;
      }

      let description: Record<string, any> | undefined;
      for (const code of langs) {
        if (entity.descriptions[code] && entity.descriptions[code].language === code) {
          description = entity.descriptions[code];
          break;
        }
      }
      if (!description && Object.values(entity.descriptions).length) {
        description = Object.values(entity.descriptions)[0] as Record<string, any>;
      }

      // prepare result
      const result: Record<string, any> = {
        title: entity.id,
        description: description?.value ?? '',
        descriptionLocaleCode: description?.language ?? '',
        editURL: `https://www.wikidata.org/wiki/${entity.id}`
      };

      // add image
      if (entity.claims) {
        const imageroot = 'https://commons.wikimedia.org/w/index.php?';
        for (const prop of ['P154', 'P18']) {  // logo image, image
          const val = entity.claims[prop];
          if (val && Object.keys(val).length) {
            const image = val[Object.keys(val)[0]].mainsnak.datavalue.value;
            if (image) {
              result.imageURL = imageroot + utilQsString({
                title: `Special:Redirect/file/${image}`,
                width: 400
              }, false);
              break;
            }
          }
        }
      }

      // add wiki sitelink
      if (entity.sitelinks) {
        const l10n = this.context.systems.l10n;
        const languageCode = l10n?.languageCode || 'en';
        const isEn = languageCode.toLowerCase() === 'en';

        // must be one of these that we requested..
        for (const code of langs) {    // check each, in order of preference
          const w = `${code}wiki`;
          if (entity.sitelinks[w]) {
            const title = entity.sitelinks[w].title;
            let tKey = 'inspector.wiki_reference';
            if (!isEn && code === 'en') {             // user's locale isn't English but
              tKey = 'inspector.wiki_en_reference';   // we are sending them to enwiki anyway..
            }

            result.wiki = {
              title: title,
              text: tKey,
              url: `https://${code}.wikipedia.org/wiki/` + title.replace(/ /g, '_')
            };
            break;
          }
        }
      }

      callback(null, result);
    });
  }

}
