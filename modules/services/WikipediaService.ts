import { utilQsString } from '@rapid-sdk/util';

import { AbstractSystem } from '../core/AbstractSystem.ts';
import { utilFetchResponse } from '../util/fetch_response.ts';

import type { Context } from '../Context.ts';

/** Base URL template for the Wikipedia API — language code is substituted at call time */
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php?';


/**
 * `WikipediaService`
 * This service runs queries against the Wikipedia API.
 * @see https://www.mediawiki.org/wiki/API:Main_page
 */
export class WikipediaService extends AbstractSystem {

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'wikipedia';
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    return super.initAsync();
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
   * search
   * @param lang - language code
   * @param query - string to search for
   * @param callback - errback-style callback function to call with results
   */
  search(lang: string, query: string, callback: (err: any, results: string[]) => void): void {
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

    fetch(url)
      .then(utilFetchResponse)
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
   * suggestions
   * @param lang - language code
   * @param query - string to search for
   * @param callback - errback-style callback function to call with results
   */
  suggestions(lang: string, query: string, callback: (err: any, results: string[]) => void): void {
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

    fetch(url)
      .then(utilFetchResponse)
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
   * translations
   * @param lang - language code
   * @param title - string to search for
   * @param callback - errback-style callback function to call with results
   */
  translations(lang: string, title: string, callback: (err: any, translations?: Record<string, string>) => void): void {
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

    fetch(url)
      .then(utilFetchResponse)
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
