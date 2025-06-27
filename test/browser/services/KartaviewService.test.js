describe('KartaviewService', () => {

  class MockGfxSystem {
    constructor()     {}
    deferredRedraw()  {}
    immediateRedraw() {}
  }

  class MockContext {
    constructor() {
      this.viewport = new Rapid.sdk.Viewport();
      this.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
      this.viewport.dimensions = [64, 64];

      this.sequences = {};
      this.systems = {
        gfx: new MockGfxSystem()
      };
    }
    next(which) {
      let num = this.sequences[which] || 0;
      return this.sequences[which] = ++num;
    }
  }


  const context = new MockContext();
  let _kartaview;

  beforeEach(() => {
    fetchMock.removeRoutes().clearHistory();
    _kartaview = new Rapid.KartaviewService(context);
    return _kartaview.initAsync();
  });

  afterEach(() => {
    fetchMock.removeRoutes().clearHistory();
    // some tests move the viewport - move it back
    context.viewport.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
  });


  describe('#initAsync', () => {
    it('initializes cache', () => {
      const cache = _kartaview._cache;
      expect(cache).to.have.property('images');
      expect(cache).to.have.property('sequences');
      expect(cache.images).to.be.an.instanceof(Map);
      expect(cache.sequences).to.be.an.instanceof(Map);
    });
  });

  describe('#resetAsync', () => {
    it('resets cache and selected image', () => {
      _kartaview._cache.images.set('foo', { id: 'foo' });

      return _kartaview.resetAsync()
        .then(() => {
          expect(_kartaview._cache.images.has('foo')).to.be.false;
        });
    });
  });

  describe('#loadTiles', () => {
    it('fires loadedData when tiles are loaded', done => {
      const nearbyResponse = {
        status: { apiCode: '600', httpCode: 200, httpMessage: 'Success' },
        currentPageItems:[{
          id: '1',
          sequence_id: '100',
          sequence_index: '1',
          lat: '0',
          lng: '10.001',
          shot_date: '2017-09-24 23:58:07',
          heading: '90',
          username: 'test'
        }, {
          id: '2',
          sequence_id: '100',
          sequence_index: '2',
          lat: '0',
          lng: '10.002',
          shot_date: '2017-09-24 23:58:07',
          heading: '90',
          username: 'test'
        }, {
          id: '3',
          sequence_id: '100',
          sequence_index: '3',
          lat: '0',
          lng: '10.003',
          shot_date: '2017-09-24 23:58:07',
          heading: '90',
          username: 'test'
        }],
        totalFilteredItems: ['3']
      };

      fetchMock.route(/nearby-photos/, {
        body: JSON.stringify(nearbyResponse),
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      _kartaview.on('loadedData', () => {
        expect(fetchMock.callHistory.calls().length).to.eql(1);  // after /photo/?sequenceId=100
        done();
      });

      _kartaview.loadTiles();
    });


    it('does not load tiles around Null Island', done => {
      const nearbyResponse = {
        status: { apiCode: '600', httpCode: 200, httpMessage: 'Success' },
        currentPageItems:[{
          id: '1',
          sequence_id: '100',
          sequence_index: '1',
          lat: '0',
          lng: '0.001',
          shot_date: '2017-09-24 23:58:07',
          heading: '90',
          username: 'test'
        }, {
          id: '2',
          sequence_id: '100',
          sequence_index: '2',
          lat: '0',
          lng: '0.002',
          shot_date: '2017-09-24 23:58:07',
          heading: '90',
          username: 'test'
        }, {
          id: '3',
          sequence_id: '100',
          sequence_index: '3',
          lat: '0',
          lng: '0.003',
          shot_date: '2017-09-24 23:58:07',
          heading: '90',
          username: 'test'
        }],
        totalFilteredItems: ['3']
      };

      fetchMock.route(/nearby-photos/, {
        body: JSON.stringify(nearbyResponse),
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      const spy = sinon.spy();

      _kartaview.context.viewport.transform.translation = [0, 0];  // move map to Null Island
      _kartaview.on('loadedData', spy);
      _kartaview.loadTiles();

      window.setTimeout(() => {
        expect(spy.notCalled).to.be.ok;
        expect(fetchMock.callHistory.calls().length).to.eql(0);   // no tile requests of any kind
        done();
      }, 20);
    });
  });


  describe('#getImages', () => {
    it('returns images in the visible map area', () => {
      const photos = [
        new Rapid.Marker(context, { type: 'photo', id: '0', loc: [10,0], ca: 90, isPano: false, sequenceID: '100', sequenceIndex: 0 }),
        new Rapid.Marker(context, { type: 'photo', id: '1', loc: [10,0], ca: 90, isPano: false, sequenceID: '100', sequenceIndex: 1 }),
        new Rapid.Marker(context, { type: 'photo', id: '2', loc: [10,1], ca: 90, isPano: false, sequenceID: '100', sequenceIndex: 2 })
      ];
      const boxes = [
        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: photos[0] },
        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: photos[1] },
        { minX: 10, minY: 1, maxX: 10, maxY: 1, data: photos[2] }
      ];

      const cache = _kartaview._cache;
      for (const d of photos) {
        cache.images.set(d.id, d);
      }
      cache.rbush.load(boxes);

      const result = _kartaview.getImages();
      expect(result).to.deep.eql([photos[0], photos[1]]);
    });
  });


  describe('#getSequences', () => {
    it('returns sequence linestrings in the visible map area', () => {
      const photos = [
        new Rapid.Marker(context, { type: 'photo', id: '0', loc: [10,0], ca: 90, isPano: false, sequenceID: '100', sequenceIndex: 0 }),
        new Rapid.Marker(context, { type: 'photo', id: '1', loc: [10,0], ca: 90, isPano: false, sequenceID: '100', sequenceIndex: 1 }),
        new Rapid.Marker(context, { type: 'photo', id: '2', loc: [10,1], ca: 90, isPano: false, sequenceID: '100', sequenceIndex: 2 })
      ];
      const boxes = [
        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: photos[0] },
        { minX: 10, minY: 0, maxX: 10, maxY: 0, data: photos[1] },
        { minX: 10, minY: 1, maxX: 10, maxY: 1, data: photos[2] }
      ];

      const sequence = new Rapid.GeoJSON(context, {
        type: 'Feature',
        id: '100',
        properties: {
          type: 'sequence',
          serviceID: 'kartaview',
          id: '100',
          rotation: 0,
          isPano: false,
          images: [ photos[0], photos[1], photos[2] ],
          v: 1
        },
        geometry: {
          type: 'LineString',
          coordinates: [ [10,0], [10,0], [10,1] ],
        }
      });

      const cache = _kartaview._cache;
      for (const d of photos) {
        cache.images.set(d.id, d);
      }
      cache.rbush.load(boxes);
      cache.sequences.set(sequence.id, sequence);

      const result = _kartaview.getSequences();
      expect(result).to.deep.eql([sequence]);
    });
  });

});
