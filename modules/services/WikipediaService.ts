import { AbstractSystem } from '../core/AbstractSystem.ts';
import { utilQsString } from '@rapid-sdk/util';

import type { Context } from '../Context.ts';


/** Base URL template for the Wikipedia API — language code is substituted at call time */
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php?';


/**
 * `WikipediaService` runs queries against the Wikipedia API.
 * @see https://www.mediawiki.org/wiki/API:Main_page
 */
export class WikipediaService extends AbstractSystem {


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'wikipedia';
    this.requiredDependencies = new Set<SystemID>(['network']);
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
    // note: no need to clear network requests here - they can persist across sessions.
    return Promise.resolve();
  }


  /**
   * Searches Wikipedia article titles matching a query and returns them via the callback.
   * @param lang - language code
   * @param query - string to search for
   * @param callback - errback-style callback function to call with results
   */
  public search(lang: string, query: string, callback: (err: any, results: string[]) => void): void {
    if (!query) {
      if (callback) callback('No Query', []);
      return;
    }

    lang = lang || 'en';
    const url = WIKIPEDIA_API.replace('en', lang) +
      utilQsString({
        action: 'query',
        list: 'search',
        srlimit: '10',
        srinfo: 'suggestion',
        format: 'json',
        origin: '*',
        srsearch: query
      }, false);

    const network = this.context.systems.network!;
    network.fetch<any>(url)
      .then(result => {
        if (result && result.error) {
          throw new Error(result.error);
        } else if (!result || !result.query || !result.query.search) {
          throw new Error('No Results');
        }
        if (callback) {
          const titles = result.query.search.map((d: any) => d.title);
          callback(null, titles);
        }
      })
      .catch(err => {
        if (callback) callback(err, []);
      });
  }


  /**
   * Returns autocomplete suggestions for a Wikipedia search query via the callback.
   * @param lang - language code
   * @param query - string to search for
   * @param callback - errback-style callback function to call with results
   */
  public suggestions(lang: string, query: string, callback: (err: any, results: string[]) => void): void {
    if (!query) {
      if (callback) callback('', []);
      return;
    }

    lang = lang || 'en';
    const url = WIKIPEDIA_API.replace('en', lang) +
      utilQsString({
        action: 'opensearch',
        namespace: 0,
        suggest: '',
        format: 'json',
        origin: '*',
        search: query
      }, false);

    const network = this.context.systems.network!;
    network.fetch<any>(url)
      .then(result => {
        if (result && result.error) {
          throw new Error(result.error);
        } else if (!result || result.length < 2) {
          throw new Error('No Results');
        }
        if (callback) callback(null, result[1] || []);
      })
      .catch(err => {
        if (callback) callback(err.message, []);
      });
  }


  /**
   * Looks up the translations (langlinks) of a Wikipedia article via the callback.
   * @param lang - language code
   * @param title - string to search for
   * @param callback - errback-style callback function to call with results
   */
  public translations(lang: string, title: string, callback: (err: any, translations?: Record<string, string>) => void): void {
    if (!title) {
      if (callback) callback('No Title');
      return;
    }

    lang = lang || 'en';
    const url = WIKIPEDIA_API.replace('en', lang) +
      utilQsString({
        action: 'query',
        prop: 'langlinks',
        format: 'json',
        origin: '*',
        lllimit: 500,
        titles: title
      }, false);

    const network = this.context.systems.network!;
    network.fetch<any>(url)
      .then(result => {
        if (result && result.error) {
          throw new Error(result.error);
        } else if (!result || !result.query || !result.query.pages) {
          throw new Error('No Results');
        }
        if (callback) {
          const list = result.query.pages[Object.keys(result.query.pages)[0]];
          const translations: Record<string, string> = {};
          if (list && list.langlinks) {
            list.langlinks.forEach(function(d: any) { translations[d.lang] = d['*']; });
          }
          callback(null, translations);
        }
      })
      .catch(err => {
        if (callback) callback(err.message);
      });
  }

}
