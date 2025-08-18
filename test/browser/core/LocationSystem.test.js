describe('LocationSystem', () => {
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

  class MockContext {
    constructor()   {
      this.viewport = new Rapid.sdk.Viewport();
      this.sequences = {};
      this.systems = {};
    }
    next(which) {
      let num = this.sequences[which] || 0;
      return this.sequences[which] = ++num;
    }
  }

  const context = new MockContext();
  let _locations;


  beforeEach(() => {
    _locations = new Rapid.LocationSystem(context);
    return _locations.initAsync();
  });


  describe('mergeCustomGeoJSON', () => {
    it('merges geojson into lococation-conflation cache', () => {
      _locations.mergeCustomGeoJSON(fc);
      const loco = _locations._loco;
      expect(loco._cache['colorado.geojson']).to.eql(colorado);
    });
  });


  describe('mergeLocationSets', () => {
    it('returns a promise rejected if not passed an array', done => {
      const prom = _locations.mergeLocationSets({});
      expect(prom).to.be.an.instanceof(Promise);
      prom
        .then(() => {
          done(new Error('This was supposed to fail, but somehow succeeded.'));
        })
        .catch(err => {
          expect(/^nothing to do/.test(err)).to.be.true;
          done();
        });
    });

    it('resolves locationSets, assigning locationSetID', () => {
      const data = [
        { id: 'world', locationSet: { include: ['001'] } },
        { id: 'usa',   locationSet: { include: ['usa'] } }
      ];

      return _locations.mergeLocationSets(data)
        .then(result => {
          expect(result).to.equal(data);
          expect(result[0].locationSetID).to.eql('+[Q2]');
          expect(result[1].locationSetID).to.eql('+[Q30]');
        });
    });

    it('resolves locationSets, falls back to world locationSetID on errror', () => {
      const data = [
        { id: 'bogus1', locationSet: { foo: 'bar' } },
        { id: 'bogus2', locationSet: { include: ['fake.geojson'] } }
      ];

      return _locations.mergeLocationSets(data)
        .then(result => {
          expect(result).to.equal(data);
          expect(result[0].locationSetID).to.eql('+[Q2]');
          expect(result[1].locationSetID).to.eql('+[Q2]');
        });
    });
  });


  describe('locationSetID', () => {
    it('calculates a locationSetID for a locationSet', () => {
      expect(_locations.locationSetID({ include: ['usa'] })).to.eql('+[Q30]');
    });

    it('falls back to the world locationSetID in case of errors', () => {
      expect(_locations.locationSetID({ foo: 'bar' })).to.eql('+[Q2]');
      expect(_locations.locationSetID({ include: ['fake.geojson'] })).to.eql('+[Q2]');
    });
  });


  describe('getFeature', () => {
    it('has the world locationSet pre-resolved', () => {
      const result = _locations.getFeature('+[Q2]');
      expect(result instanceof Rapid.GeoJSON).to.be.ok;
      expect(result.props.geojson).to.include({ type: 'Feature', id: '+[Q2]' });
    });

    it('falls back to the world locationSetID in case of errors', () => {
      const result = _locations.getFeature('fake');
      expect(result instanceof Rapid.GeoJSON).to.be.ok;
      expect(result.props.geojson).to.include({ type: 'Feature', id: '+[Q2]' });
    });
  });


  describe('locationSetsAt', () => {
    it('has the world locationSet pre-resolved', () => {
      const result1 = _locations.locationSetsAt([-108.557, 39.065]);  // Grand Junction
      expect(result1).to.be.an('object').that.has.all.keys('+[Q2]');
      const result2 = _locations.locationSetsAt([-74.481, 40.797]);   // Morristown
      expect(result2).to.be.an('object').that.has.all.keys('+[Q2]');
      const result3 = _locations.locationSetsAt([13.575, 41.207]);    // Gaeta
      expect(result3).to.be.an('object').that.has.all.keys('+[Q2]');
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
          expect(result1).to.be.an('object').that.has.all.keys('+[Q2]', '+[Q30]', '+[colorado.geojson]');
          const result2 = _locations.locationSetsAt([-74.481, 40.797]);   // Morristown
          expect(result2).to.be.an('object').that.has.all.keys('+[Q2]', '+[Q30]');
          const result3 = _locations.locationSetsAt([13.575, 41.207]);    // Gaeta
          expect(result3).to.be.an('object').that.has.all.keys('+[Q2]');
        });
    });
  });

});
