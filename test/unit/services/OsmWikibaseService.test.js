import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
import { assert } from 'chai';
import { promisify } from 'bun:util';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';
import * as sample from './OsmWikibaseService.sample.js';


function parseQueryString(url) {
  return Rapid.sdk.utilStringQs(url.substring(url.indexOf('?')));
}


describe('OsmWikibaseService', () => {
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
      it('constructs an OsmWikibaseService from a context', () => {
        const wikibase = new Rapid.OsmWikibaseService(context);
        assert.instanceOf(wikibase, Rapid.OsmWikibaseService);
        assert.strictEqual(wikibase.id, 'osmwikibase');
        assert.strictEqual(wikibase.context, context);
        assert.instanceOf(wikibase.requiredDependencies, Set);
        assert.instanceOf(wikibase.optionalDependencies, Set);
        assert.isTrue(wikibase.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const wikibase = new Rapid.OsmWikibaseService(context);
        const prom = wikibase.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const wikibase = new Rapid.OsmWikibaseService(context);
        wikibase.requiredDependencies.add('missing');
        const prom = wikibase.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const wikibase = new Rapid.OsmWikibaseService(context);
        const prom = wikibase.initAsync().then(() => wikibase.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(wikibase.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const wikibase = new Rapid.OsmWikibaseService(context);
        const prom = wikibase.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _wikibase;

    beforeAll(() => {
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


    describe('getDocs', () => {
      it('returns docs for a key+value pair with Commons image and wiki link', () => {
        fetchMock.route(/action=wbgetentities/, sample.entityResponseSuccess);
        const getDocs = promisify(_wikibase.getDocs).bind(_wikibase);

        return getDocs({ key: 'amenity', value: 'parking' })
          .then(result => {
            assert.strictEqual(result.title, 'Item:Q13');
            assert.strictEqual(result.description, 'French description');
            assert.strictEqual(result.descriptionLocaleCode, 'fr');
            assert.strictEqual(result.editURL, 'https://wiki.openstreetmap.org/wiki/Item:Q13');
            assert.include(result.imageURL, 'commons.wikimedia.org');
            assert.include(result.imageURL, 'Primary%20image.jpg');
            assert.deepEqual(result.wiki, {
              title: 'Key:bridge:movable',
              text: 'inspector.wiki_reference',
              url: 'https://wiki.openstreetmap.org/wiki/Key:bridge:movable'
            });
          });
      });

      it('returns docs for a key-only query with OSM wiki P28 image', () => {
        // Build an entity where P28 has 'preferred' rank (claimToValue only picks preferred)
        // and the sitelink matches the key being requested (Key:highway)
        const keyOnlyEntity = Object.assign({}, sample.keyData, {
          claims: Object.assign({}, sample.keyData.claims, {
            P28: [{
              mainsnak: { snaktype: 'value', datatype: 'string', datavalue: { value: 'TestImage.png', type: 'string' } },
              type: 'statement',
              rank: 'preferred'
            }]
          }),
          sitelinks: { wiki: { site: 'wiki', title: 'Key:highway', badges: [] } }
        });
        fetchMock.route(/action=wbgetentities/, { entities: { Q42: keyOnlyEntity }, success: 1 });
        const getDocs = promisify(_wikibase.getDocs).bind(_wikibase);

        return getDocs({ key: 'highway' })
          .then(result => {
            assert.strictEqual(result.title, 'Item:Q42');
            assert.strictEqual(result.editURL, 'https://wiki.openstreetmap.org/wiki/Item:Q42');
            assert.include(result.imageURL, 'wiki.openstreetmap.org/w/index.php');
            assert.include(result.imageURL, 'TestImage.png');
          });
      });

      it('calls back with "No entity" when no matching entity is found', () => {
        fetchMock.route(/action=wbgetentities/, { entities: {}, success: 1 });

        return new Promise((resolve, reject) => {
          _wikibase.getDocs({ key: 'nonexistent' }, (err) => {
            try {
              assert.strictEqual(err, 'No entity');
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });
      });

      it('propagates fetch errors to the callback', () => {
        // Use an uncached key so that a real fetch is attempted
        fetchMock.route(/action=wbgetentities/, { throws: new Error('network error') });

        return new Promise((resolve, reject) => {
          _wikibase.getDocs({ key: 'building' }, (err) => {
            try {
              assert.ok(err);
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });
      });
    });


    describe('_request', () => {
      it('calls back with the error message on network failure', () => {
        const url = 'https://wiki.openstreetmap.org/w/api.php?action=test';
        fetchMock.route(/action=test/, { throws: new Error('network failure') });

        return new Promise((resolve, reject) => {
          _wikibase._request(url, (err) => {
            try {
              assert.strictEqual(err, 'network failure');
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });
      });

    });
  });

});
