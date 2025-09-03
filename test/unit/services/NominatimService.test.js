import { after, before, beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
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
      .sticky(/reverse\?.*lat=48&lon=16/, {
        body: '{"address":{"country_code":"at"}}',
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
      .sticky(/reverse\?.*lat=49&lon=17/, {
        body: '{"address":{"country_code":"cz"}}',
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
      .sticky(/reverse\?.*lat=1000&lon=1000/, {
        body: '{"error":"Unable to geocode"}',
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
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

  });


//
//  describe('countryCode', () => {
//    it('calls the given callback with the results of the country code query', done => {
//      const callback = sinon.spy();
//      nominatim.countryCode([16, 48], callback);
//
//      window.setTimeout(() => {
//        expect(parseQueryString(fetchMock.callHistory.lastCall().url)).to.eql(
//          { zoom: '13', format: 'json', addressdetails: '1', lat: '48', lon: '16' }
//        );
//        expect(callback.calledOnceWith(null, 'at')).to.be.ok;
//        done();
//      }, 20);
//    });
//  });
//
//
//  describe('reverse', () => {
//    it('should not cache distant result', done => {
//      let callback = sinon.spy();
//      nominatim.reverse([16, 48], callback);
//
//      window.setTimeout(() => {
//        expect(parseQueryString(fetchMock.callHistory.lastCall().url)).to.eql(
//          { zoom: '13', format: 'json', addressdetails: '1', lat: '48', lon: '16' }
//        );
//        expect(callback.calledOnceWith(null, { address: { country_code:'at' }})).to.be.ok;
//
//        fetchMock.clearHistory();
//        callback = sinon.spy();
//        nominatim.reverse([17, 49], callback);
//
//        window.setTimeout(() => {
//          expect(parseQueryString(fetchMock.callHistory.lastCall().url)).to.eql(
//            { zoom: '13', format: 'json', addressdetails: '1', lat: '49', lon: '17' }
//          );
//          expect(callback.calledOnceWith(null, { address: { country_code:'cz' }})).to.be.ok;
//          done();
//        }, 50);
//      }, 50);
//    });
//
//    it('should cache nearby result', done => {
//      let callback = sinon.spy();
//      nominatim.reverse([16, 48], callback);
//
//      window.setTimeout(() => {
//        expect(parseQueryString(fetchMock.callHistory.lastCall().url)).to.eql(
//          { zoom: '13', format: 'json', addressdetails: '1', lat: '48', lon: '16' }
//        );
//        expect(callback.calledOnceWith(null, { address: { country_code:'at' }})).to.be.ok;
//
//        fetchMock.clearHistory();
//
//        callback = sinon.spy();
//        nominatim.reverse([16.000001, 48.000001], callback);
//
//        window.setTimeout(() => {
//          expect(callback.calledOnceWith(null, { address: { country_code:'at' }})).to.be.ok;
//          done();
//        }, 50);
//      }, 50);
//    });
//
//
//    it('handles "unable to geocode" result as an error', done => {
//      const callback = sinon.spy();
//      nominatim.reverse([1000, 1000], callback);
//
//      window.setTimeout(() => {
//        expect(parseQueryString(fetchMock.callHistory.lastCall().url)).to.eql(
//          { zoom: '13', format: 'json', addressdetails: '1', lat: '1000', lon: '1000' }
//        );
//        expect(callback.calledOnceWith('Unable to geocode')).to.be.ok;
//        done();
//      }, 50);
//    });
//  });
//
//
//  describe('search', () => {
//    it('calls the given callback with the results of the search query', done => {
//      const callback = sinon.spy();
//      fetchMock.route(/search/, {
//        body: '[{"place_id":"158484588","osm_type":"relation","osm_id":"188022","boundingbox":["39.867005","40.1379593","-75.2802976","-74.9558313"],"lat":"39.9523993","lon":"-75.1635898","display_name":"Philadelphia, Philadelphia County, Pennsylvania, United States of America","class":"place","type":"city","importance":0.83238050437778}]',
//        status: 200,
//        headers: { 'Content-Type': 'application/json' }
//      });
//
//      nominatim.search('philadelphia', callback);
//
//      window.setTimeout(() => {
//        expect(parseQueryString(fetchMock.callHistory.lastCall().url)).to.eql({q: 'philadelphia', format: 'json', limit: '10' });
//        expect(callback.calledOnce).to.be.ok;
//        done();
//      }, 50);
//    });
//  });

});
