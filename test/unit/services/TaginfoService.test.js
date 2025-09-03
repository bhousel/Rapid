import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import { promisify } from 'node:util';
import * as Rapid from '../../../modules/headless.js';


describe('TaginfoService', () => {
  const context = new Rapid.MockContext();

  before(() => {
    fetchMock.hardReset().mockGlobal();
  });

  after(() => {
    fetchMock.hardReset();
  });

  beforeEach(() => {
    fetchMock.removeRoutes().clearHistory()
      // This matches the query run in `startAsync()` to get the list of popular keys.
     .route(/\/keys\/all.*sortname=values_all/, {
       body: '{"data":[{"count_all":56136034,"key":"name","count_all_fraction":0.0132}]}',
       status: 200,
       headers: { 'Content-Type': 'application/json' }
     });
  });

  afterEach(() => {
    fetchMock.removeRoutes().clearHistory();
  });


  function parseQueryString(url) {
    return Rapid.sdk.utilStringQs(url.substring(url.indexOf('?')));
  }

  describe('constructor', () => {
    it('constructs a TaginfoService from a context', () => {
      const taginfo = new Rapid.TaginfoService(context);
      assert.instanceOf(taginfo, Rapid.TaginfoService);
      assert.strictEqual(taginfo.id, 'taginfo');
      assert.strictEqual(taginfo.context, context);
      assert.instanceOf(taginfo.requiredDependencies, Set);
      assert.instanceOf(taginfo.optionalDependencies, Set);
      assert.isTrue(taginfo.autoStart);

      assert.deepEqual(taginfo._inflight, {});
    });
  });

  describe('initAsync', () => {
    it('returns a promise to init', () => {
      const taginfo = new Rapid.TaginfoService(context);
      const prom = taginfo.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });

    it('rejects if a dependency is missing', () => {
      const taginfo = new Rapid.TaginfoService(context);
      taginfo.requiredDependencies.add('missing');
      const prom = taginfo.initAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
        .catch(err => assert.match(err, /cannot init/i));
    });
  });

  describe('startAsync', () => {
    it('returns a promise to start', () => {
      const taginfo = new Rapid.TaginfoService(context);
      const prom = taginfo.initAsync().then(() => taginfo.startAsync());
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(taginfo.started))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });

  describe('resetAsync', () => {
    it('returns a promise to reset', () => {
      const taginfo = new Rapid.TaginfoService(context);
      const prom = taginfo.resetAsync();
      assert.instanceOf(prom, Promise);
      return prom
        .then(val => assert.isTrue(true))
        .catch(err => assert.fail(`Promise was rejected but should have been fulfilled: ${err}`));
    });
  });


  describe('methods', () => {
    let taginfo;

    beforeEach(() => {
      taginfo = new Rapid.TaginfoService(context);
      return taginfo.initAsync().then(() => taginfo.startAsync());
    });

    describe('keys', () => {
      it('calls the given callback with the results of the keys query', () => {
        const keys = promisify(taginfo.keys).bind(taginfo);
        fetchMock.route(/\/keys\/all/, {
          body: '{"data":[{"count_all":5190337,"key":"amenity","count_all_fraction":1.0}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return keys({ query: 'amen' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { query: 'amen', page: '1', rp: '10', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [{ title: 'amenity', value: 'amenity' }] );
          })
      });

      it('includes popular keys', () => {
        const keys = promisify(taginfo.keys).bind(taginfo);
        fetchMock.route(/\/keys\/all/, {
          body: '{"data":[{"count_all":5190337,"count_nodes":500000,"key":"amenity","count_all_fraction":1.0, "count_nodes_fraction":1.0},'
            + '{"count_all":1,"key":"amenityother","count_all_fraction":0.0, "count_nodes":100}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return keys({ query: 'amen' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { query: 'amen', page: '1', rp: '10', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { title: 'amenity', value: 'amenity' }
              // no 'amenityother'
            ]);
          });
      });

      it('includes popular keys with an entity type filter', () => {
        const keys = promisify(taginfo.keys).bind(taginfo);
        fetchMock.route(/\/keys\/all/, {
          body: '{"data":[{"count_all":5190337,"count_nodes":500000,"key":"amenity","count_all_fraction":1.0, "count_nodes_fraction":1.0},'
            + '{"count_all":1,"key":"amenityother","count_all_fraction":0.0, "count_nodes":100}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return keys({ query: 'amen', filter: 'nodes' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { filter: 'nodes', query: 'amen', page: '1', rp: '10', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { title: 'amenity', value: 'amenity' }
              // no 'amenityother'
            ]);
          });
      });

      it('includes unpopular keys with a wiki page', () => {
        const keys = promisify(taginfo.keys).bind(taginfo);
        fetchMock.route(/\/keys\/all/, {
          body: '{"data":[{"count_all":5190337,"key":"amenity","count_all_fraction":1.0, "count_nodes_fraction":1.0},'
            + '{"count_all":1,"key":"amenityother","count_all_fraction":0.0, "count_nodes_fraction":0.0, "in_wiki": true}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return keys({ query: 'amen' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { query: 'amen', page: '1', rp: '10', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { title: 'amenity', value: 'amenity' },
              { title: 'amenityother', value: 'amenityother' }
            ]);
          });
      });

      it('sorts keys with \':\' below keys without \':\'', () => {
        const keys = promisify(taginfo.keys).bind(taginfo);
        fetchMock.route(/\/keys\/all/, {
          body: '{"data":[{"key":"ref:bag","count_all":9790586,"count_all_fraction":0.0028},' +
            '{"key":"ref","count_all":7933528,"count_all_fraction":0.0023}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return keys({ query: 'ref' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { query: 'ref', page: '1', rp: '10', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { title: 'ref', value: 'ref' },
              { title: 'ref:bag', value: 'ref:bag' }
            ]);
          });
      });
    });


    describe('multikeys', () => {
      it('calls the given callback with the results of the multikeys query', () => {
        const multikeys = promisify(taginfo.multikeys).bind(taginfo);
        fetchMock.route(/\/keys\/all/, {
          body: '{"data":[{"count_all":69593,"key":"recycling:glass","count_all_fraction":0.0}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return multikeys({ query: 'recycling:' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { query: 'recycling:', page: '1', rp: '25', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [{ title: 'recycling:glass', value: 'recycling:glass' }]);
          });
      });

      it('excludes multikeys with extra colons', () => {
        const multikeys = promisify(taginfo.multikeys).bind(taginfo);
        fetchMock.route(/\/keys\/all/, {
          body: '{"data":[{"count_all":4426,"key":"service:bicycle:retail","count_all_fraction":0.0},' +
            '{"count_all":22,"key":"service:bicycle:retail:ebikes","count_all_fraction":0.0}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return multikeys({ query: 'service:bicycle:' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { query: 'service:bicycle:', page: '1', rp: '25', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { title: 'service:bicycle:retail', value: 'service:bicycle:retail' }
              // no 'service:bicycle:retail:ebikes'
            ]);
          });
      });

      it('excludes multikeys with wrong prefix', () => {
        const multikeys = promisify(taginfo.multikeys).bind(taginfo);
        fetchMock.route(/\/keys\/all/, {
          body: '{"data":[{"count_all":4426,"key":"service:bicycle:retail","count_all_fraction":0.0},' +
            '{"count_all":22,"key":"disused:service:bicycle","count_all_fraction":0.0}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return multikeys({ query: 'service:bicycle:' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { query: 'service:bicycle:', page: '1', rp: '25', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { title: 'service:bicycle:retail', value: 'service:bicycle:retail' }
              // no 'disused:service:bicycle'
            ]);
          });
      });
    });


    describe('values', () => {
      it('calls the given callback with the results of the values query', () => {
        const values = promisify(taginfo.values).bind(taginfo);
        fetchMock.route(/\/key\/values/, {
          body: '{"data":[{"value":"parking","description":"A place for parking cars", "fraction":0.1}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return values({ key: 'amenity', query: 'par' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { key: 'amenity', query: 'par', page: '1', rp: '25', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [{ value: 'parking', title: 'A place for parking cars' }]);
          });
      });

      it('includes popular values', () => {
        const values = promisify(taginfo.values).bind(taginfo);
        fetchMock.route(/\/key\/values/, {
          body: '{"data":[{"value":"parking","description":"A place for parking cars", "fraction":1.0},' +
            '{"value":"party","description":"A place for partying", "fraction":0.0}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return values({ key: 'amenity', query: 'par' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { key: 'amenity', query: 'par', page: '1', rp: '25', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { value: 'parking', title: 'A place for parking cars' }
              // no 'party'
            ]);
          });
      });

      it('does not get values for extremely popular keys', () => {  // iD#7485
        const values = promisify(taginfo.values).bind(taginfo);
        fetchMock.route(/\/key\/values/, {
          body: '{"data":[{"value":"Rue Pasteur","description":"", "fraction":0.0001},' +
            '{"value":"Via Trieste","description":"", "fraction":0.0001}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return values({ key: 'full_name', query: 'ste' })
          .then(data => {
// ignore the 'values_all' call that runs in `startAsync`
//            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
//            const expected = { key: 'full_name', query: 'ste', page: '1', rp: '25', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
//            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              // no results for a 'full_name' query
            ]);
          });
      });

      it('excludes values with capital letters and some punctuation', () => {
        const values = promisify(taginfo.values).bind(taginfo);
        fetchMock.route(/\/key\/values/, {
          body: '{"data":[{"value":"parking","description":"A place for parking cars", "fraction":0.2},'
            + '{"value":"PArking","description":"A common misspelling", "fraction":0.2},'
            + '{"value":"parking;partying","description":"A place for parking cars *and* partying", "fraction":0.2},'
            + '{"value":"parking, partying","description":"A place for parking cars *and* partying", "fraction":0.2},'
            + '{"value":"*","description":"", "fraction":0.2}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return values({ key: 'amenity', query: 'par' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { key: 'amenity', query: 'par', page: '1', rp: '25', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { value: 'parking', title: 'A place for parking cars' }
              // exclude results with capital letters, punctuation
            ]);
          });
      });

      it('includes network values with capital letters and some punctuation', () => {
        const values = promisify(taginfo.values).bind(taginfo);
        fetchMock.route(/\/key\/values/, {
          body: '{"data":[{"value":"US:TX:FM","description":"Farm to Market Roads in the U.S. state of Texas.", "fraction":0.34},'
            + '{"value":"US:KY","description":"Primary and secondary state highways in the U.S. state of Kentucky.", "fraction":0.31},'
            + '{"value":"US:US","description":"U.S. routes in the United States.", "fraction":0.19},'
            + '{"value":"US:I","description":"Interstate highways in the United States.", "fraction":0.11},'
            + '{"value":"US:MD","description":"State highways in the U.S. state of Maryland.", "fraction":0.06}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return values({ key: 'network', query: 'us' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { key: 'network', query: 'us', page: '1', rp: '25', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { value: 'US:TX:FM', title: 'Farm to Market Roads in the U.S. state of Texas.' },
              { value: 'US:KY', title: 'Primary and secondary state highways in the U.S. state of Kentucky.' },
              { value: 'US:US', title: 'U.S. routes in the United States.' },
              { value: 'US:I', title: 'Interstate highways in the United States.' },
              { value: 'US:MD', title: 'State highways in the U.S. state of Maryland.' }
            ]);
          });
      });

      it('includes biological genus values with capital letters', () => {
        const values = promisify(taginfo.values).bind(taginfo);
        fetchMock.route(/\/key\/values/, {
          body: '{"data":[{"value":"Quercus","description":"Oak", "fraction":0.5}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return values({ key: 'genus', query: 'qu' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { key: 'genus', query: 'qu', page: '1', rp: '25', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { value: 'Quercus', title: 'Oak' }
            ]);
          });
      });

      it('includes biological taxon values with capital letters', () => {
        const values = promisify(taginfo.values).bind(taginfo);
        fetchMock.route(/\/key\/values/, {
          body: '{"data":[{"value":"Quercus robur","description":"Oak", "fraction":0.5}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return values({ key: 'taxon', query: 'qu' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { key: 'taxon', query: 'qu', page: '1', rp: '25', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { value: 'Quercus robur', title: 'Oak' }
            ]);
          });
      });

      it('includes biological species values with capital letters', () => {
        const values = promisify(taginfo.values).bind(taginfo);
        fetchMock.route(/\/key\/values/, {
          body: '{"data":[{"value":"Quercus robur","description":"Oak", "fraction":0.5}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return values({ key: 'species', query: 'qu' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { key: 'species', query: 'qu', page: '1', rp: '25', sortname: 'count_all', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { value: 'Quercus robur', title: 'Oak' }
            ]);
          });
      });
    });


    describe('roles', () => {
      it('calls the given callback with the results of the roles query', () => {
        const roles = promisify(taginfo.roles).bind(taginfo);
        fetchMock.route(/\/relation\/roles/, {
          body: '{"data":[{"role":"stop","count_relation_members_fraction":0.1757},' +
            '{"role":"south","count_relation_members_fraction":0.0035}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return roles({ rtype: 'route', query: 's', geometry: 'relation' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { rtype: 'route', query: 's', page: '1', rp: '25', sortname: 'count_relation_members', sortorder: 'desc', lang: 'en' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { value: 'stop', title: 'stop' },
              { value: 'south', title: 'south' }
            ]);
          });
      });
    });


    describe('docs', () => {
      it('calls the given callback with the results of the docs query', () => {
        const docs = promisify(taginfo.docs).bind(taginfo);
        fetchMock.route(/\/tag\/wiki_page/, {
          body: '{"data":[{"on_way":false,"lang":"en","on_area":true,"image":"File:Car park2.jpg"}]}',
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return docs({ key: 'amenity', value: 'parking' })
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { key: 'amenity', value: 'parking' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, [
              { on_way: false, lang: 'en', on_area: true, image: 'File:Car park2.jpg' }
            ]);
          });
      });
    });

  });
});
