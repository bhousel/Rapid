describe('PresetSystem', () => {
  class MockStorageSystem {
    constructor() { }
    getItem() { return ''; }
  }

  class MockUrlSystem {
    constructor() {
      this.initialHashParams = new Map();
    }
    initAsync()   { return Promise.resolve(); }
    on()          { return this; }
  }

  class MockLocalizationSystem {
    constructor() { }
    initAsync()   { return Promise.resolve(); }
    t(id)         { return id; }
    tHtml(id)     { return id; }
  }

  class MockContext {
    constructor()   {
      this.sequences = {};
      this.viewport = new Rapid.sdk.Viewport();
      this.systems = {
        assets:     new Rapid.AssetSystem(this),
        l10n:       new MockLocalizationSystem(),
        locations:  new Rapid.LocationSystem(this),
        storage:    new MockStorageSystem(),
        urlhash:    new MockUrlSystem()
      };
    }
    next(which) {
      let num = this.sequences[which] || 0;
      return this.sequences[which] = ++num;
    }
  }

  const context = new MockContext();
  let _savedAreaKeys;

  beforeEach(() => {
    _savedAreaKeys = Rapid.osmAreaKeys;
  });

  afterEach(() => {
    Rapid.osmSetAreaKeys(_savedAreaKeys);
  });


  describe('fallbacks', () => {
    it('has a fallback point preset', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const graph = new Rapid.Graph([node]);
      const presets = new Rapid.PresetSystem(context);
      expect(presets.match(node, graph).id).to.eql('point');
    });

    it('has a fallback line preset', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const way = new Rapid.OsmWay(context, { id: 'w', nodes: ['n'] });
      const graph = new Rapid.Graph([node, way]);
      const presets = new Rapid.PresetSystem(context);
      expect(presets.match(way, graph).id).to.eql('line');
    });

    it('has a fallback area preset', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const way = new Rapid.OsmWay(context, { id: 'w', nodes: ['n'], tags: { area: 'yes' }});
      const graph = new Rapid.Graph([node, way]);
      const presets = new Rapid.PresetSystem(context);
      expect(presets.match(way, graph).id).to.eql('area');
    });

    it('has a fallback relation preset', () => {
      const relation = new Rapid.OsmRelation(context, { id: 'r' });
      const graph = new Rapid.Graph([relation]);
      const presets = new Rapid.PresetSystem(context);
      expect(presets.match(relation, graph).id).to.eql('relation');
    });
  });


  describe('#match', () => {
    beforeEach(() => {
      const testPresets = {
        residential: { tags: { highway: 'residential' }, geometry: ['line'] },
        park: { tags: { leisure: 'park' }, geometry: ['point', 'area'] }
      };
      context.systems.assets._cache.tagging_preset_presets = testPresets;
    });

    it('returns a collection containing presets matching a geometry and tags', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        const way = new Rapid.OsmWay(context, { tags: { highway: 'residential' } });
        const graph = new Rapid.Graph([way]);
        expect(presets.match(way, graph).id).to.eql('residential');
      });
    });

    it('returns the appropriate fallback preset when no tags match', () => {
      const presets = new Rapid.PresetSystem(context);
      const point = new Rapid.OsmNode(context, );
      const line = new Rapid.OsmWay(context, { tags: { foo: 'bar' } });
      const graph = new Rapid.Graph([point, line]);

      return presets.initAsync().then(() => {
        expect(presets.match(point, graph).id).to.eql('point');
        expect(presets.match(line, graph).id).to.eql('line');
      });
    });

    it('matches vertices on a line as points', () => {
      const presets = new Rapid.PresetSystem(context);
      const point = new Rapid.OsmNode(context, { tags: { leisure: 'park' } });
      const line = new Rapid.OsmWay(context, { nodes: [point.id], tags: { 'highway': 'residential' } });
      const graph = new Rapid.Graph([point, line]);

      return presets.initAsync().then(() => {
        expect(presets.match(point, graph).id).to.eql('point');
      });
    });

    it('matches vertices on an addr:interpolation line as points', () => {
      const presets = new Rapid.PresetSystem(context);
      const point = new Rapid.OsmNode(context, { tags: { leisure: 'park' } });
      const line = new Rapid.OsmWay(context, { nodes: [point.id], tags: { 'addr:interpolation': 'even' } });
      const graph = new Rapid.Graph([point, line]);

      return presets.initAsync().then(() => {
        expect(presets.match(point, graph).id).to.eql('park');
      });
    });
  });


  describe('#areaKeys', () => {
    beforeEach(() => {
      const testPresets = {
        'amenity/fuel/shell': { tags: { 'amenity': 'fuel' }, geometry: ['point', 'area'], suggestion: true },
        'highway/foo': { tags: { 'highway': 'foo' }, geometry: ['area'] },
        'leisure/track': { tags: { 'leisure': 'track' }, geometry: ['line', 'area'] },
        'natural': { tags: { 'natural': '*' }, geometry: ['point', 'vertex', 'area'] },
        'natural/peak': { tags: { 'natural': 'peak' }, geometry: ['point', 'vertex'] },
        'natural/tree_row': { tags: { 'natural': 'tree_row' }, geometry: ['line'] },
        'natural/wood': { tags: { 'natural': 'wood' }, geometry: ['point', 'area'] }
      };
      context.systems.assets._cache.tagging_preset_presets = testPresets;
    });

    it('includes keys for presets with area geometry', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        expect(presets.areaKeys()).to.include.keys('natural');
      });
    });

    it('discards key-values for presets with a line geometry', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        expect(presets.areaKeys().natural).to.include.keys('tree_row');
        expect(presets.areaKeys().natural.tree_row).to.be.true;
      });
    });

    it('discards key-values for presets with both area and line geometry', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        expect(presets.areaKeys().leisure).to.include.keys('track');
      });
    });

    it('does not discard key-values for presets with neither area nor line geometry', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        expect(presets.areaKeys().natural).not.to.include.keys('peak');
      });
    });

    it('does not discard generic \'*\' key-values', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        expect(presets.areaKeys().natural).not.to.include.keys('natural');
      });
    });

    it('ignores keys like \'highway\' that are assumed to be lines', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        expect(presets.areaKeys()).not.to.include.keys('highway');
      });
    });

    it('ignores suggestion presets', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        expect(presets.areaKeys()).not.to.include.keys('amenity');
      });
    });
  });


  describe('#merge', () => {
    it('builds presets from provided', () => {
      const surfShop = new Rapid.OsmNode(context, { tags: { amenity: 'shop', 'shop:type': 'surf' } });
      const presets = new Rapid.PresetSystem(context);
      const presetData = {
        presets: {
          'amenity/shop/surf': {
            tags: { amenity: 'shop', 'shop:type': 'surf' },
            geometry: ['point', 'area']
          }
        }
      };

      let matched = presets.match(surfShop, new Rapid.Graph([surfShop]));
      expect(matched.id).to.eql('point');   // no surfshop preset yet, matches fallback point
      presets.merge(presetData);

      matched = presets.match(surfShop, new Rapid.Graph([surfShop]));
      expect(matched.id).to.eql('amenity/shop/surf');
    });
  });


  describe('#match', () => {

    beforeEach(() => {
      const testPresets = {
        building: {
          name: 'Building',
          tags: { building: 'yes' },
          geometry: ['area']
        },
        'type/multipolygon': {
          name: 'Multipolygon',
          geometry: ['area', 'relation'],
          tags: { 'type': 'multipolygon' },
          searchable: false,
          matchScore: 0.1
        },
        address: {
          name: 'Address',
          geometry: ['point', 'vertex', 'area'],
          tags: { 'addr:*': '*' },
          matchScore: 0.15
        },
        'highway/pedestrian_area': {
          name: 'Pedestrian Area',
          geometry: ['area'],
          tags: { highway: 'pedestrian', area: 'yes' }
        }
      };
      context.systems.assets._cache.tagging_preset_presets = testPresets;
    });


    it('prefers building to multipolygon', () => {
      const presets = new Rapid.PresetSystem(context);
      const relation = new Rapid.OsmRelation(context, { tags: { type: 'multipolygon', building: 'yes' } });
      const graph = new Rapid.Graph([relation]);
      return presets.initAsync().then(() => {
        const match = presets.match(relation, graph);
        expect(match.id).to.eql('building');
      });
    });

    it('prefers building to address', () => {
      const presets = new Rapid.PresetSystem(context);
      const way = new Rapid.OsmWay(context, { tags: { area: 'yes', building: 'yes', 'addr:housenumber': '1234' } });
      const graph = new Rapid.Graph([way]);
      return presets.initAsync().then(() => {
        const match = presets.match(way, graph);
        expect(match.id).to.eql('building');
      });
    });

    it('prefers pedestrian to area', () => {
      const presets = new Rapid.PresetSystem(context);
      const way = new Rapid.OsmWay(context, { tags: { area: 'yes', highway: 'pedestrian' } });
      const graph = new Rapid.Graph([way]);
      return presets.initAsync().then(() => {
        const match = presets.match(way, graph);
        expect(match.id).to.eql('highway/pedestrian_area');
      });
    });
  });

});
