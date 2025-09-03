import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';


describe('OsmWikibaseService', () => {
  // Setup context
  const context = new Rapid.MockContext();

  // Setup FetchMock
  before(() => {
    fetchMock.mockGlobal();
  });

  after(() => {
    fetchMock.hardReset({ includeSticky: true });
  });

  beforeEach(() => {
    fetchMock.removeRoutes().clearHistory();
  });


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
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
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
        .then(val => assert.isTrue(wikibase.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const wikibase = new Rapid.OsmWikibaseService(context);
      const prom = wikibase.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });


  describe('methods', () => {
    let _wikibase;
    beforeEach(() => {
      _wikibase = new Rapid.OsmWikibaseService(context);
      return _wikibase.initAsync().then(() => _wikibase.startAsync());
    });


    describe('getEntity', () => {
      it('calls the given callback with the results of the getEntity data item query', () => {
        const getEntity = promisify(_wikibase.getEntity).bind(_wikibase);

        fetchMock
          .mockGlobal()
          .route(/action=wbgetentities/, {
            body: JSON.stringify({
              entities: {
                Q42: keyData(),
                Q13: tagData(),
                Q7792: localeData,
              },
              success: 1
            }),
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });

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
            assert.deepEqual(data, { key: keyData(), tag: tagData() });
          })
          .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
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
      assert.strictEqual(_wikibase.claimToValue(tagData(), 'P4', 'en'), 'Primary image.jpg');
      assert.strictEqual(_wikibase.claimToValue(keyData(), 'P6', 'en'), 'Q15');
      assert.strictEqual(_wikibase.claimToValue(keyData(), 'P6', 'fr'), 'Q15');
      assert.strictEqual(_wikibase.claimToValue(keyData(), 'P6', 'de'), 'Q14');
    });

    it('gets monolingual value from entity as an object', () => {
      assert.deepEqual(_wikibase.monolingualClaimToValueObj(tagData(), 'P31'), {
        cs: 'Cs:Key:bridge:movable',
        de: 'DE:Key:bridge:movable',
        fr: 'FR:Key:bridge:movable',
        ja: 'JA:Key:bridge:movable',
        pl: 'Pl:Key:bridge:movable',
        en: 'Key:bridge:movable'
      });
    });

  });



  function parseQueryString(url) {
    return Rapid.sdk.utilStringQs(url.substring(url.indexOf('?')));
  }

  function keyData() {
    return {
      pageid: 205725,
      ns: 120,
      title: 'Item:Q42',
      lastrevid: 1721242,
      modified: '2018-12-18T07:00:43Z',
      type: 'item',
      id: 'Q42',
      labels: {
        fr: {language: 'en', value: 'amenity', 'for-language': 'fr'}
      },
      descriptions: {
        fr: {language: 'en', value: 'English description', 'for-language': 'fr'}
      },
      aliases: {},
      claims: {
        P2: [ // instance of
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'wikibase-item',
              datavalue: {value: {'entity-type': 'item', id: 'Q7'}, type: 'wikibase-entityid'}
            },
            type: 'statement',
            rank: 'normal'
          }
        ],
        P16: [
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'string',
              datavalue: {value: 'amenity', type: 'string'}
            },
            type: 'statement',
            rank: 'normal'
          }
        ],
        P25: [
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'wikibase-item',
              datavalue: {value: {'entity-type': 'item', id: 'Q4679'}, type: 'wikibase-entityid'}
            },
            type: 'statement',
            rank: 'normal'
          }
        ],
        P9: [
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'wikibase-item',
              datavalue: {value: {'entity-type': 'item', id: 'Q8'}, type: 'wikibase-entityid'}
            },
            type: 'statement',
            rank: 'normal'
          }
        ],
        P6: [
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'wikibase-item',
              datavalue: {value: {'entity-type': 'item', id: 'Q15'}, type: 'wikibase-entityid'}
            },
            type: 'statement',
            rank: 'preferred'
          },
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'wikibase-item',
              datavalue: {value: {'entity-type': 'item', id: 'Q14'}, type: 'wikibase-entityid'}
            },
            type: 'statement',
            qualifiers: {
              P26: [
                {
                  snaktype: 'value',
                  datatype: 'wikibase-item',
                  datavalue: {value: {'entity-type': 'item', id: 'Q6994'}, type: 'wikibase-entityid'}
                }
              ]
            },
            rank: 'normal'
          }
        ],
        P28: [
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'string',
              datavalue: {value: 'Mapping-Features-Parking-Lot.png', type: 'string'}
            },
            type: 'statement',
            rank: 'normal'
          }
        ]
      },
      sitelinks: {
        wiki: {
          site: 'wiki',
          title: 'Key:amenity',
          badges: []
        }
      }
    };
  }

  function tagData() {
    return {
      pageid: 210934,
      ns: 120,
      title: 'Item:Q13',
      lastrevid: 1718041,
      modified: '2018-12-18T03:51:05Z',
      type: 'item',
      id: 'Q13',
      labels: {
        fr: {language: 'en', value: 'amenity=parking', 'for-language': 'fr'}
      },
      descriptions: {
        fr: {language: 'fr', value: 'French description'}
      },
      aliases: {},
      claims: {
        P2: [ // instance of = Q2 (tag)
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'wikibase-item',
              datavalue: {value: {'entity-type': 'item', id: 'Q2'}, type: 'wikibase-entityid'}
            },
            type: 'statement',
            rank: 'normal'
          }
        ],
        P19: [
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'string',
              datavalue: {value: 'amenity=parking', type: 'string'}
            },
            type: 'statement',
            rank: 'normal'
          }
        ],
        P10: [
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'wikibase-item',
              datavalue: {value: {'entity-type': 'item', id: 'Q42'}, type: 'wikibase-entityid'}
            },
            type: 'statement',
            rank: 'normal'
          }
        ],
        P4: [
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'commonsMedia',
              datavalue: {value: 'Primary image.jpg', type: 'string'}
            },
            type: 'statement',
            rank: 'preferred'
          }
        ],
        P6: [
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'wikibase-item',
              datavalue: {value: {'entity-type': 'item', id: 'Q14'}, type: 'wikibase-entityid'}
            },
            type: 'statement',
            rank: 'preferred'
          },
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'wikibase-item',
              datavalue: {value: {'entity-type': 'item', id: 'Q13'}, type: 'wikibase-entityid'}
            },
            type: 'statement',
            qualifiers: {
              P26: [
                {
                  snaktype: 'value',
                  datatype: 'wikibase-item',
                  datavalue: {value: {'entity-type': 'item', id: 'Q6994'}, type: 'wikibase-entityid'}
                }
              ]
            },
            rank: 'normal'
          }
        ],
        P25: [
          {
            mainsnak: {
              snaktype: 'value',
              datatype: 'wikibase-item',
              datavalue: {value: {'entity-type': 'item', id: 'Q4679'}, type: 'wikibase-entityid'}
            },
            type: 'statement',
            rank: 'normal'
          }
        ],
        P31: [
          {mainsnak: {datavalue: {value: {text: 'Cs:Key:bridge:movable', language: 'cs'}}}},
          {mainsnak: {datavalue: {value: {text: 'DE:Key:bridge:movable', language: 'de'}}}},
          {mainsnak: {datavalue: {value: {text: 'FR:Key:bridge:movable', language: 'fr'}}}},
          {mainsnak: {datavalue: {value: {text: 'JA:Key:bridge:movable', language: 'ja'}}}},
          {mainsnak: {datavalue: {value: {text: 'Pl:Key:bridge:movable', language: 'pl'}}}},
          {mainsnak: {datavalue: {value: {text: 'Key:bridge:movable', language: 'en'}}}},
        ],
      },
      sitelinks: {
        wiki: {
          site: 'wiki',
          title: 'Tag:amenity=parking',
          badges: []
        }
      }
    };
  }

  const localeData = {
    id: 'Q7792',
    sitelinks: { wiki: { site: 'wiki', title: 'Locale:fr' } }
  };


});
