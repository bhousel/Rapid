import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';


describe('WikidataService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems.network = new Rapid.NetworkSystem(context);

  // Setup fetchMock..
  beforeAll(() => {
    fetchMock.mockGlobal();
  });

  afterAll(() => {
    fetchMock.hardReset({ includeSticky: true });
  });

  beforeEach(() => {
    fetchMock.removeRoutes().clearHistory();
  });


  // Test construction and startup of the service..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs a WikidataService from a context', () => {
        const wikidata = new Rapid.WikidataService(context);
        assert.instanceOf(wikidata, Rapid.WikidataService);
        assert.strictEqual(wikidata.id, 'wikidata');
        assert.strictEqual(wikidata.context, context);
        assert.instanceOf(wikidata.requiredDependencies, Set);
        assert.instanceOf(wikidata.optionalDependencies, Set);
        assert.isTrue(wikidata.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const wikidata = new Rapid.WikidataService(context);
        const prom = wikidata.initAsync();
        assert.instanceOf(prom, Promise);
        return prom;
      });

      it('rejects if a dependency is missing', () => {
        const wikidata = new Rapid.WikidataService(context);
        wikidata.requiredDependencies.add('missing');
        const prom = wikidata.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const wikidata = new Rapid.WikidataService(context);
        const prom = wikidata.initAsync().then(() => wikidata.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(wikidata.started));
      });
    });

    describe('resetAsync', () => {
      it('clears the cache and returns a promise', () => {
        const wikidata = new Rapid.WikidataService(context);
        wikidata._cache.set('Q1', { id: 'Q1' });
        assert.strictEqual(wikidata._cache.size, 1);
        const prom = wikidata.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom.then(() => {
          assert.strictEqual(wikidata._cache.size, 0);
        });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _wikidata;

    beforeAll(() => {
      _wikidata = new Rapid.WikidataService(context);
      return _wikidata.initAsync().then(() => _wikidata.startAsync());
    });

    beforeEach(() => {
      return _wikidata.resetAsync();
    });


    describe('itemsForSearchQuery', () => {
      it('calls back with empty object when query is empty', done => {
        _wikidata.itemsForSearchQuery('', (err, results) => {
          assert.strictEqual(err, 'No query');
          assert.deepEqual(results, {});
          done();
        });
      });

      it('returns search results from the wikidata API', done => {
        fetchMock.route(/wikidata\.org.*wbsearchentities.*search=mac/, {
          body: JSON.stringify({
            search: [
              { id: 'Q312', label: 'Apple Inc.', description: 'American technology company' },
              { id: 'Q1569', label: 'McDonald\'s', description: 'American fast food company' }
            ]
          }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikidata.itemsForSearchQuery('mac', (err, results) => {
          assert.isNull(err);
          assert.isArray(results);
          assert.strictEqual(results.length, 2);
          assert.strictEqual(results[0].id, 'Q312');
          done();
        });
      });

      it('calls back with error when response contains an error', done => {
        fetchMock.route(/wikidata\.org.*wbsearchentities.*search=bad/, {
          body: JSON.stringify({ error: { info: 'Invalid parameter' } }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikidata.itemsForSearchQuery('bad', (err, results) => {
          assert.isNotNull(err);
          assert.deepEqual(results, {});
          done();
        });
      });

      it('calls back with error on network failure', done => {
        fetchMock.route(/wikidata\.org.*wbsearchentities.*search=fail/, {
          throws: new Error('Network error')
        });

        _wikidata.itemsForSearchQuery('fail', (err, results) => {
          assert.isNotNull(err);
          assert.deepEqual(results, {});
          done();
        });
      });
    });


    describe('itemsByTitle', () => {
      it('calls back with empty object when title is empty', done => {
        _wikidata.itemsByTitle('en', '', (err, results) => {
          assert.strictEqual(err, 'No title');
          assert.deepEqual(results, {});
          done();
        });
      });

      it('returns entities for the given Wikipedia title', done => {
        fetchMock.route(/wikidata\.org.*wbgetentities.*titles=Berlin/, {
          body: JSON.stringify({
            entities: {
              'Q64': { id: 'Q64', labels: { en: { value: 'Berlin' } } }
            }
          }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikidata.itemsByTitle('en', 'Berlin', (err, results) => {
          assert.isNull(err);
          assert.isObject(results);
          assert.property(results, 'Q64');
          done();
        });
      });

      it('defaults to English when no language is provided', done => {
        fetchMock.route(/wikidata\.org.*wbgetentities.*titles=Test/, {
          body: JSON.stringify({ entities: { 'Q1': { id: 'Q1' } } }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikidata.itemsByTitle(null, 'Test', (err, results) => {
          assert.isNull(err);
          assert.include(fetchMock.callHistory.lastCall().url, 'enwiki');
          done();
        });
      });

      it('calls back with error when response contains an error', done => {
        fetchMock.route(/wikidata\.org.*wbgetentities.*titles=Errored/, {
          body: JSON.stringify({ error: { info: 'Invalid parameter' } }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikidata.itemsByTitle('en', 'Errored', (err, results) => {
          assert.isNotNull(err);
          assert.deepEqual(results, {});
          done();
        });
      });

      it('calls back with error on network failure', done => {
        fetchMock.route(/wikidata\.org.*wbgetentities.*titles=Netfail/, {
          throws: new Error('Network error')
        });

        _wikidata.itemsByTitle('en', 'Netfail', (err, results) => {
          assert.isNotNull(err);
          assert.deepEqual(results, {});
          done();
        });
      });
    });


    describe('entityByQID', () => {
      it('calls back with empty object when qid is empty', done => {
        _wikidata.entityByQID('', (err, results) => {
          assert.strictEqual(err, 'No qid');
          done();
        });
      });

      it('fetches and returns the entity for the given QID', done => {
        fetchMock.route(/wikidata\.org.*ids=Q64/, {
          body: JSON.stringify({
            entities: {
              'Q64': { id: 'Q64', labels: { en: { value: 'Berlin' } }, descriptions: {}, claims: {}, sitelinks: {} }
            }
          }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikidata.entityByQID('Q64', (err, result) => {
          assert.isNull(err);
          assert.strictEqual(result.id, 'Q64');
          done();
        });
      });

      it('caches the result and does not re-fetch on subsequent calls', done => {
        fetchMock.route(/wikidata\.org.*ids=Q100/, {
          body: JSON.stringify({
            entities: { 'Q100': { id: 'Q100', labels: {}, descriptions: {}, claims: {}, sitelinks: {} } }
          }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikidata.entityByQID('Q100', () => {
          const callCount1 = fetchMock.callHistory.calls().length;
          _wikidata.entityByQID('Q100', (err, result) => {
            const callCount2 = fetchMock.callHistory.calls().length;
            assert.isNull(err);
            assert.strictEqual(callCount1, callCount2);  // not re-fetched
            assert.strictEqual(result.id, 'Q100');
            done();
          });
        });
      });

      it('calls back with error when response contains an error', done => {
        fetchMock.route(/wikidata\.org.*ids=Q999/, {
          body: JSON.stringify({ error: { info: 'No such entity' } }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikidata.entityByQID('Q999', (err) => {
          assert.isNotNull(err);
          done();
        });
      });

      it('calls back with error on network failure', done => {
        fetchMock.route(/wikidata\.org.*ids=Q404/, { throws: new Error('Network error') });

        _wikidata.entityByQID('Q404', (err) => {
          assert.isNotNull(err);
          done();
        });
      });
    });


    describe('getDocs', () => {
      // Full entity fixture with labels, descriptions, claims (logo), and sitelinks
      const fullEntity = {
        id: 'Q37158',
        labels: { en: { language: 'en', value: 'Starbucks' } },
        descriptions: {
          en: { language: 'en', value: 'American coffeehouse chain' }
        },
        claims: {
          P154: {  // logo image
            '0': { mainsnak: { datavalue: { value: 'Starbucks_Corporation_Logo_2011.svg' } } }
          }
        },
        sitelinks: {
          enwiki: { title: 'Starbucks' }
        }
      };

      beforeEach(() => {
        fetchMock.route(/wikidata\.org.*ids=Q37158/, {
          body: JSON.stringify({ entities: { 'Q37158': fullEntity } }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });

      it('returns a docs result with title, description, editURL, imageURL, and wiki', done => {
        _wikidata.getDocs({ qid: 'Q37158' }, (err, result) => {
          assert.isNull(err);
          assert.strictEqual(result.title, 'Q37158');
          assert.strictEqual(result.description, 'American coffeehouse chain');
          assert.include(result.editURL, 'Q37158');
          assert.include(result.imageURL, 'Starbucks_Corporation_Logo_2011.svg');
          assert.isObject(result.wiki);
          assert.strictEqual(result.wiki.title, 'Starbucks');
          assert.include(result.wiki.url, 'wikipedia.org');
          done();
        });
      });

      it('returns a docs result with fallback description when preferred language has none', done => {
        const entityNoDesc = {
          ...fullEntity,
          id: 'Q37159',
          descriptions: {
            fr: { language: 'fr', value: 'Chaîne de cafés américaine' }
          }
        };
        fetchMock.route(/wikidata\.org.*ids=Q37159/, {
          body: JSON.stringify({ entities: { 'Q37159': entityNoDesc } }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikidata.getDocs({ qid: 'Q37159' }, (err, result) => {
          assert.isNull(err);
          assert.strictEqual(result.description, 'Chaîne de cafés américaine');
          done();
        });
      });

      it('returns empty description when entity has no descriptions', done => {
        const entityNoDesc = { ...fullEntity, id: 'Q37160', descriptions: {}, claims: {}, sitelinks: {} };
        fetchMock.route(/wikidata\.org.*ids=Q37160/, {
          body: JSON.stringify({ entities: { 'Q37160': entityNoDesc } }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikidata.getDocs({ qid: 'Q37160' }, (err, result) => {
          assert.isNull(err);
          assert.strictEqual(result.description, '');
          assert.isUndefined(result.imageURL);
          assert.isUndefined(result.wiki);
          done();
        });
      });

      it('falls back to P18 (image) when P154 (logo) is absent', done => {
        const entityP18 = {
          ...fullEntity,
          id: 'Q37161',
          claims: {
            P18: {
              '0': { mainsnak: { datavalue: { value: 'SomeImage.jpg' } } }
            }
          }
        };
        fetchMock.route(/wikidata\.org.*ids=Q37161/, {
          body: JSON.stringify({ entities: { 'Q37161': entityP18 } }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikidata.getDocs({ qid: 'Q37161' }, (err, result) => {
          assert.isNull(err);
          assert.include(result.imageURL, 'SomeImage.jpg');
          done();
        });
      });

      it('calls back with error when entityByQID fails', done => {
        fetchMock.route(/wikidata\.org.*ids=Q000/, { throws: new Error('Network error') });

        _wikidata.getDocs({ qid: 'Q000' }, (err) => {
          assert.isNotNull(err);
          done();
        });
      });
    });


    describe('languagesToQuery', () => {
      it('returns an array including a language code', () => {
        const langs = _wikidata.languagesToQuery();
        assert.isArray(langs);
        assert.isAbove(langs.length, 0);
      });

      it('excludes en-us from the list', () => {
        const langs = _wikidata.languagesToQuery();
        assert.notInclude(langs, 'en-us');
      });
    });
  });
});
