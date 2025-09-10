import { after, before, beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import { promisify } from 'node:util';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';


function parseQueryString(url) {
  return Rapid.sdk.utilStringQs(url.substring(url.indexOf('?')));
}


describe('NominatimService', () => {
  // Setup context..
  const context = new Rapid.MockContext();

  // Setup fetchMock..
  before(() => {
    fetchMock
      .mockGlobal()
      .sticky(/reverse\?.*lat=48&lon=16/, { address: { country_code: 'at' }})
      .sticky(/reverse\?.*lat=49&lon=17/, { address: { country_code: 'cz' }})
      .sticky(/reverse\?.*lat=1000&lon=1000/, { error: 'Unable to geocode' });
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
      it('constructs a NominatimService from a context', () => {
        const nominatim = new Rapid.NominatimService(context);
        assert.instanceOf(nominatim, Rapid.NominatimService);
        assert.strictEqual(nominatim.id, 'nominatim');
        assert.strictEqual(nominatim.context, context);
        assert.instanceOf(nominatim.requiredDependencies, Set);
        assert.instanceOf(nominatim.optionalDependencies, Set);
        assert.isTrue(nominatim.autoStart);

        assert.deepEqual(nominatim._inflight, {});
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const nominatim = new Rapid.NominatimService(context);
        const prom = nominatim.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const nominatim = new Rapid.NominatimService(context);
        nominatim.requiredDependencies.add('missing');
        const prom = nominatim.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const nominatim = new Rapid.NominatimService(context);
        const prom = nominatim.initAsync().then(() => nominatim.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(nominatim.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const nominatim = new Rapid.NominatimService(context);
        const prom = nominatim.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _nominatim;

    before(() => {
      _nominatim = new Rapid.NominatimService(context);
      return _nominatim.initAsync().then(() => _nominatim.startAsync());
    });

    beforeEach(() => {
      return _nominatim.resetAsync();
    });


    describe('countryCode', () => {
      it('calls the given callback with the results of the country code query', () => {
        const countryCode = promisify(_nominatim.countryCode).bind(_nominatim);

        return countryCode([16, 48])
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { addressdetails: '1', format: 'json', lon: '16', lat: '48', zoom: '13' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, 'at');
          });
      });
    });


    describe('reverse', () => {
      it('should not cache distant result', () => {
        const reverse = promisify(_nominatim.reverse).bind(_nominatim);

        return reverse([16, 48])
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { addressdetails: '1', format: 'json', lon: '16', lat: '48', zoom: '13' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, { address: { country_code: 'at' }});
          })
          .then(() => reverse([17, 49]))
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { addressdetails: '1', format: 'json', lon: '17', lat: '49', zoom: '13' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, { address: { country_code: 'cz' }});
          });
      });

      it('should cache nearby result', () => {
        const reverse = promisify(_nominatim.reverse).bind(_nominatim);
        let callCount1, callCount2;

        return reverse([16, 48])
          .then(data => {
            callCount1 = fetchMock.callHistory.calls().length;
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { addressdetails: '1', format: 'json', lon: '16', lat: '48', zoom: '13' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, { address: { country_code: 'at' }});
          })
          .then(() => reverse([16.000001, 48.000001]))
          .then(data => {
            callCount2 = fetchMock.callHistory.calls().length;
            assert.strictEqual(callCount1, callCount2);  // not called again
            assert.deepEqual(data, { address: { country_code: 'at' }});
          });
      });

      it('handles "unable to geocode" result as an error', () => {
        const reverse = promisify(_nominatim.reverse).bind(_nominatim);
        return reverse([1000, 1000])
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /unable to geocode/i));
      });
    });


    describe('search', () => {
      it('calls the given callback with the results of the search query', () => {
        const response = [{
          place_id: '158484588',
          osm_type: 'relation',
          osm_id: '188022',
          boundingbox: [ '39.867005', '40.1379593', '-75.2802976', '-74.9558313' ],
          lat: '39.9523993',
          lon: '-75.1635898',
          display_name: 'Philadelphia, Philadelphia County, Pennsylvania, United States of America',
          class: 'place',
          type: 'city',
          importance: 0.83238050437778
        }];

        fetchMock.route(/search/, response);
        const search = promisify(_nominatim.search).bind(_nominatim);

        return search('philadelphia')
          .then(data => {
            const lastCall = parseQueryString(fetchMock.callHistory.lastCall().url);
            const expected = { q: 'philadelphia', format: 'json', limit: '10' };
            assert.deepEqual(lastCall, expected);
            assert.deepEqual(data, response);
          });
      });
    });

  });

});
