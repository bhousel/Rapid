import { beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('LocationSystem', () => {
  // Setup context..
  const context = new Rapid.MockContext();

  // Test construction and startup of the system..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs an LocationSystem from a context', () => {
        const locations = new Rapid.LocationSystem(context);
        assert.instanceOf(locations, Rapid.LocationSystem);
        assert.strictEqual(locations.id, 'locations');
        assert.strictEqual(locations.context, context);
        assert.instanceOf(locations.requiredDependencies, Set);
        assert.instanceOf(locations.optionalDependencies, Set);
        assert.isTrue(locations.autoStart);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const locations = new Rapid.LocationSystem(context);
        const prom = locations.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });

      it('rejects if a dependency is missing', () => {
        const locations = new Rapid.LocationSystem(context);
        locations.requiredDependencies.add('missing');
        const prom = locations.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const locations = new Rapid.LocationSystem(context);
        const prom = locations.initAsync().then(() => locations.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(locations.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const locations = new Rapid.LocationSystem(context);
        const prom = locations.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(true));
      });
    });
  });


  // Test an already-constructed instance of the system..
  describe('methods', () => {
    let _locations;

    beforeEach(() => {
      _locations = new Rapid.LocationSystem(context);
      return _locations.initAsync().then(() => _locations.startAsync());
    });

    const colorado = {
      type: 'Feature',
      id: 'colorado.geojson',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-107.9197, 41.0039],
            [-102.0539, 41.0039],
            [-102.043, 36.9948],
            [-109.0425, 37.0003],
            [-109.048, 40.9984],
            [-107.9197, 41.0039]
          ]
        ]
      }
    };

    const fc = { type: 'FeatureCollection', features: [colorado] };


    describe('mergeCustomGeoJSON', () => {
      it('merges geojson into lococation-conflation cache', () => {
        _locations.mergeCustomGeoJSON(fc);
        const loco = _locations._loco;
        assert.deepEqual(loco._cache['colorado.geojson'], colorado);
      });
    });


    describe('mergeLocationSets', () => {
      it('returns a promise rejected if not passed an array', () => {
        const prom = _locations.mergeLocationSets({});
        assert.instanceOf(prom, Promise);
        return prom
          .then(data => assert.fail(`This was supposed to fail, but somehow succeeded`))
          .catch(err => assert.match(err, /^nothing to do/));
      });

      it('resolves locationSets, assigning locationSetID', () => {
        const data = [
          { id: 'world', locationSet: { include: ['001'] } },
          { id: 'usa',   locationSet: { include: ['usa'] } }
        ];

        return _locations.mergeLocationSets(data)
          .then(result => {
            assert.strictEqual(result, data);
            assert.strictEqual(result[0].locationSetID, '+[Q2]');
            assert.strictEqual(result[1].locationSetID, '+[Q30]');
          });
      });

      it('resolves locationSets, falls back to world locationSetID on errror', () => {
        const data = [
          { id: 'bogus1', locationSet: { foo: 'bar' } },
          { id: 'bogus2', locationSet: { include: ['fake.geojson'] } }
        ];

        return _locations.mergeLocationSets(data)
          .then(result => {
            assert.strictEqual(result, data);
            assert.strictEqual(result[0].locationSetID, '+[Q2]');
            assert.strictEqual(result[1].locationSetID, '+[Q2]');
          });
      });
    });


    describe('locationSetID', () => {
      it('calculates a locationSetID for a locationSet', () => {
        assert.strictEqual(_locations.locationSetID({ include: ['usa'] }), '+[Q30]');
      });

      it('falls back to the world locationSetID in case of errors', () => {
        assert.strictEqual(_locations.locationSetID({ foo: 'bar' }), '+[Q2]');
        assert.strictEqual(_locations.locationSetID({ include: ['fake.geojson'] }), '+[Q2]');
      });
    });


    describe('getFeature', () => {
      it('has the world locationSet pre-resolved', () => {
        const result = _locations.getFeature('+[Q2]');
        assert.instanceOf(result, Rapid.GeoJSON);
        assert.deepInclude(result.props.geojson, { type: 'Feature', id: '+[Q2]' });
      });

      it('falls back to the world locationSetID in case of errors', () => {
        const result = _locations.getFeature('fake');
        assert.instanceOf(result, Rapid.GeoJSON);
        assert.deepInclude(result.props.geojson, { type: 'Feature', id: '+[Q2]' });
      });
    });


    describe('locationSetsAt', () => {
      it('has the world locationSet pre-resolved', () => {
        const result1 = _locations.locationSetsAt([-108.557, 39.065]);  // Grand Junction
        assert.hasAllKeys(result1, ['+[Q2]']);
        const result2 = _locations.locationSetsAt([-74.481, 40.797]);   // Morristown
        assert.hasAllKeys(result2, ['+[Q2]']);
        const result3 = _locations.locationSetsAt([13.575, 41.207]);    // Gaeta
        assert.hasAllKeys(result3, ['+[Q2]']);
      });

      it('returns valid locationSets at a given lon,lat', () => {
        // setup, load colorado.geojson and resolve some locationSets
        _locations.mergeCustomGeoJSON(fc);
        const data = [
          { id: 'OSM-World', locationSet: { include: ['001'] } },
          { id: 'OSM-USA', locationSet: { include: ['us'] } },
          { id: 'OSM-Colorado', locationSet: { include: ['colorado.geojson'] } }
        ];
        return _locations.mergeLocationSets(data)
          .then(() => {
            const result1 = _locations.locationSetsAt([-108.557, 39.065]);  // Grand Junction
            assert.hasAllKeys(result1, ['+[Q2]', '+[Q30]', '+[colorado.geojson]']);
            const result2 = _locations.locationSetsAt([-74.481, 40.797]);   // Morristown
            assert.hasAllKeys(result2, ['+[Q2]', '+[Q30]']);
            const result3 = _locations.locationSetsAt([13.575, 41.207]);    // Gaeta
            assert.hasAllKeys(result3, ['+[Q2]']);
          });
      });
    });
  });

});
