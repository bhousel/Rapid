import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';


describe('WikipediaService', () => {
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
      it('constructs a WikipediaService from a context', () => {
        const wikipedia = new Rapid.WikipediaService(context);
        assert.instanceOf(wikipedia, Rapid.WikipediaService);
        assert.strictEqual(wikipedia.id, 'wikipedia');
        assert.strictEqual(wikipedia.context, context);
        assert.instanceOf(wikipedia.requiredDependencies, Set);
        assert.instanceOf(wikipedia.optionalDependencies, Set);
        assert.isTrue(wikipedia.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const wikipedia = new Rapid.WikipediaService(context);
        const prom = wikipedia.initAsync();
        assert.instanceOf(prom, Promise);
        return prom;
      });

      it('rejects if a dependency is missing', () => {
        const wikipedia = new Rapid.WikipediaService(context);
        wikipedia.requiredDependencies.add('missing');
        const prom = wikipedia.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const wikipedia = new Rapid.WikipediaService(context);
        const prom = wikipedia.initAsync().then(() => wikipedia.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(wikipedia.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const wikipedia = new Rapid.WikipediaService(context);
        const prom = wikipedia.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom;
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _wikipedia;

    beforeAll(() => {
      _wikipedia = new Rapid.WikipediaService(context);
      return _wikipedia.initAsync().then(() => _wikipedia.startAsync());
    });

    afterEach(() => {
      return _wikipedia.resetAsync();
    });


    describe('search', () => {
      it('calls back with an empty array when query is empty', done => {
        _wikipedia.search('en', '', (err, results) => {
          assert.strictEqual(err, 'No Query');
          assert.deepEqual(results, []);
          done();
        });
      });

      it('calls back with article titles from search results', done => {
        fetchMock.route(/en\.wikipedia\.org.*srsearch=paris/, {
          body: JSON.stringify({
            query: {
              search: [
                { title: 'Paris' },
                { title: 'Paris, Texas' }
              ]
            }
          }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikipedia.search('en', 'paris', (err, results) => {
          assert.isNull(err);
          assert.deepEqual(results, ['Paris', 'Paris, Texas']);
          done();
        });
      });

      it('uses the supplied language code in the URL', done => {
        fetchMock.route(/de\.wikipedia\.org.*srsearch=berlin/, {
          body: JSON.stringify({
            query: {
              search: [{ title: 'Berlin' }]
            }
          }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikipedia.search('de', 'berlin', (err, results) => {
          assert.isNull(err);
          assert.include(fetchMock.callHistory.lastCall().url, 'de.wikipedia.org');
          assert.deepEqual(results, ['Berlin']);
          done();
        });
      });

      it('defaults to English when no language is provided', done => {
        fetchMock.route(/en\.wikipedia\.org.*srsearch=test/, {
          body: JSON.stringify({
            query: {
              search: [{ title: 'Test' }]
            }
          }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikipedia.search(null, 'test', (err, results) => {
          assert.isNull(err);
          assert.include(fetchMock.callHistory.lastCall().url, 'en.wikipedia.org');
          done();
        });
      });

      it('calls back with error when response contains an error', done => {
        fetchMock.route(/en\.wikipedia\.org.*srsearch=bad/, {
          body: JSON.stringify({ error: { info: 'Bad request' } }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikipedia.search('en', 'bad', (err, results) => {
          assert.isNotNull(err);
          assert.deepEqual(results, []);
          done();
        });
      });

      it('calls back with error when response has no results', done => {
        fetchMock.route(/en\.wikipedia\.org.*srsearch=empty/, {
          body: JSON.stringify({}),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikipedia.search('en', 'empty', (err, results) => {
          assert.isNotNull(err);
          assert.deepEqual(results, []);
          done();
        });
      });

      it('calls back with error on network failure', done => {
        fetchMock.route(/en\.wikipedia\.org.*srsearch=fail/, { throws: new Error('Network error') });

        _wikipedia.search('en', 'fail', (err, results) => {
          assert.isNotNull(err);
          assert.deepEqual(results, []);
          done();
        });
      });
    });


    describe('suggestions', () => {
      it('calls back with empty string error when query is empty', done => {
        _wikipedia.suggestions('en', '', (err, results) => {
          assert.strictEqual(err, '');
          assert.deepEqual(results, []);
          done();
        });
      });

      it('calls back with suggestion titles', done => {
        fetchMock.route(/en\.wikipedia\.org.*search=lond/, {
          body: JSON.stringify(['lond', ['London', 'Londonderry', 'London Bridge']]),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikipedia.suggestions('en', 'lond', (err, results) => {
          assert.isNull(err);
          assert.deepEqual(results, ['London', 'Londonderry', 'London Bridge']);
          done();
        });
      });

      it('uses the supplied language code in the URL', done => {
        fetchMock.route(/fr\.wikipedia\.org.*search=paris/, {
          body: JSON.stringify(['paris', ['Paris', 'Paris 8e Arrondissement']]),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikipedia.suggestions('fr', 'paris', (err, results) => {
          assert.isNull(err);
          assert.include(fetchMock.callHistory.lastCall().url, 'fr.wikipedia.org');
          done();
        });
      });

      it('calls back with empty array when suggestion list is missing', done => {
        fetchMock.route(/en\.wikipedia\.org.*search=noresult/, {
          // A response with fewer than 2 elements triggers the 'No Results' error
          body: JSON.stringify(['noresult']),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikipedia.suggestions('en', 'noresult', (err, results) => {
          assert.isNotNull(err);
          assert.deepEqual(results, []);
          done();
        });
      });

      it('calls back with error when response contains an error', done => {
        fetchMock.route(/en\.wikipedia\.org.*search=errored/, {
          body: JSON.stringify({ error: { info: 'Bad request' } }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikipedia.suggestions('en', 'errored', (err, results) => {
          assert.isNotNull(err);
          assert.deepEqual(results, []);
          done();
        });
      });

      it('calls back with error on network failure', done => {
        fetchMock.route(/en\.wikipedia\.org.*search=netfail/, { throws: new Error('Network error') });

        _wikipedia.suggestions('en', 'netfail', (err, results) => {
          assert.isNotNull(err);
          assert.deepEqual(results, []);
          done();
        });
      });
    });


    describe('translations', () => {
      it('calls back with error when title is empty', done => {
        _wikipedia.translations('en', '', (err, results) => {
          assert.strictEqual(err, 'No Title');
          done();
        });
      });

      it('calls back with a map of language-to-title translations', done => {
        fetchMock.route(/en\.wikipedia\.org.*titles=Berlin/, {
          body: JSON.stringify({
            query: {
              pages: {
                '11867': {
                  title: 'Berlin',
                  langlinks: [
                    { lang: 'de', '*': 'Berlin' },
                    { lang: 'fr', '*': 'Berlin' }
                  ]
                }
              }
            }
          }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikipedia.translations('en', 'Berlin', (err, translations) => {
          assert.isNull(err);
          assert.deepEqual(translations, { de: 'Berlin', fr: 'Berlin' });
          done();
        });
      });

      it('returns an empty translations object when no langlinks exist', done => {
        fetchMock.route(/en\.wikipedia\.org.*titles=Obscure/, {
          body: JSON.stringify({
            query: {
              pages: {
                '99999': { title: 'Obscure' }  // no langlinks property
              }
            }
          }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikipedia.translations('en', 'Obscure', (err, translations) => {
          assert.isNull(err);
          assert.deepEqual(translations, {});
          done();
        });
      });

      it('calls back with error when response contains an error', done => {
        fetchMock.route(/en\.wikipedia\.org.*titles=Errored/, {
          body: JSON.stringify({ error: { info: 'Bad request' } }),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikipedia.translations('en', 'Errored', (err) => {
          assert.isNotNull(err);
          done();
        });
      });

      it('calls back with error when response has no results', done => {
        fetchMock.route(/en\.wikipedia\.org.*titles=Noresult/, {
          body: JSON.stringify({}),
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        _wikipedia.translations('en', 'Noresult', (err) => {
          assert.isNotNull(err);
          done();
        });
      });

      it('calls back with error on network failure', done => {
        fetchMock.route(/en\.wikipedia\.org.*titles=Netfail/, { throws: new Error('Network error') });

        _wikipedia.translations('en', 'Netfail', (err) => {
          assert.isNotNull(err);
          done();
        });
      });
    });
  });
});
