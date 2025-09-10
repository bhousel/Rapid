import { after, before, beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import { promisify } from 'node:util';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './OsmWikibaseService.sample.js';


function parseQueryString(url) {
  return Rapid.sdk.utilStringQs(url.substring(url.indexOf('?')));
}


describe('OsmWikibaseService', () => {
  // Setup context..
  const context = new Rapid.MockContext();

  // Setup fetchMock..
  before(() => {
    fetchMock.mockGlobal();
  });

  after(() => {
    fetchMock.hardReset({ includeSticky: true });
  });

  beforeEach(() => {
    fetchMock.removeRoutes().clearHistory();
  });


  // Test construction and startup of the service..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs an OsmWikibaseService from a context', () => {
        const wikibase = new Rapid.OsmWikibaseService(context);
        assert.instanceOf(wikibase, Rapid.OsmWikibaseService);
        assert.strictEqual(wikibase.id, 'osmwikibase');
        assert.strictEqual(wikibase.context, context);
        assert.instanceOf(wikibase.requiredDependencies, Set);
        assert.instanceOf(wikibase.optionalDependencies, Set);
        assert.isTrue(wikibase.autoStart);

        assert.instanceOf(wikibase._inflight, Map);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const wikibase = new Rapid.OsmWikibaseService(context);
        const prom = wikibase.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const wikibase = new Rapid.OsmWikibaseService(context);
        wikibase.requiredDependencies.add('missing');
        const prom = wikibase.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const wikibase = new Rapid.OsmWikibaseService(context);
        const prom = wikibase.initAsync().then(() => wikibase.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(wikibase.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const wikibase = new Rapid.OsmWikibaseService(context);
        const prom = wikibase.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _wikibase;

    before(() => {
      _wikibase = new Rapid.OsmWikibaseService(context);
      return _wikibase.initAsync().then(() => _wikibase.startAsync());
    });

    beforeEach(() => {
      return _wikibase.resetAsync();
    });


    describe('getEntity', () => {
      it('calls the given callback with the results of the getEntity data item query', () => {
        fetchMock.route(/action=wbgetentities/, sample.entityResponseSuccess);
        const getEntity = promisify(_wikibase.getEntity).bind(_wikibase);

        return getEntity({ key: 'amenity', value: 'parking', langCodes: ['fr'] })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = {
              action: 'wbgetentities',
              sites: 'wiki',
              titles: 'Locale:fr|Key:amenity|Tag:amenity=parking',
              languages: 'fr',
              languagefallback: '1',
              origin: '*',
              format: 'json',
            };

            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, { key: sample.keyData, tag: sample.tagData });
          });
      });
    });


    it('creates correct sitelinks', () => {
      assert.strictEqual(_wikibase.toSitelink('amenity'), 'Key:amenity');
      assert.strictEqual(_wikibase.toSitelink('amenity_'), 'Key:amenity');
      assert.strictEqual(_wikibase.toSitelink('_amenity_'), 'Key: amenity');
      assert.strictEqual(_wikibase.toSitelink('amenity or_not_'), 'Key:amenity or not');
      assert.strictEqual(_wikibase.toSitelink('amenity', 'parking'), 'Tag:amenity=parking');
      assert.strictEqual(_wikibase.toSitelink(' amenity_', '_parking_'), 'Tag: amenity = parking');
      assert.strictEqual(_wikibase.toSitelink('amenity or_not', '_park ing_'), 'Tag:amenity or not= park ing');
    });

    it('gets correct value from entity', () => {
      _wikibase.addLocale('de', 'Q6994');
      _wikibase.addLocale('fr', 'Q7792');
      assert.strictEqual(_wikibase.claimToValue(sample.tagData, 'P4', 'en'), 'Primary image.jpg');
      assert.strictEqual(_wikibase.claimToValue(sample.keyData, 'P6', 'en'), 'Q15');
      assert.strictEqual(_wikibase.claimToValue(sample.keyData, 'P6', 'fr'), 'Q15');
      assert.strictEqual(_wikibase.claimToValue(sample.keyData, 'P6', 'de'), 'Q14');
    });

    it('gets monolingual value from entity as an object', () => {
      assert.deepEqual(_wikibase.monolingualClaimToValueObj(sample.tagData, 'P31'), {
        cs: 'Cs:Key:bridge:movable',
        de: 'DE:Key:bridge:movable',
        fr: 'FR:Key:bridge:movable',
        ja: 'JA:Key:bridge:movable',
        pl: 'Pl:Key:bridge:movable',
        en: 'Key:bridge:movable'
      });
    });
  });

});
