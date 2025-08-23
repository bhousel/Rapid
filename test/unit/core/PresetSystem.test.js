import { afterEach, beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('PresetSystem', () => {

  class MockUrlHashSystem {
    constructor() {
      this.initialHashParams = new Map();
      this._currParams = new Map();
    }
    initAsync()   { return Promise.resolve(); }
    on()          { return this; }
    getParam(k)   { return this._currParams.get(k); }
    setParam(k, v) {
      if (typeof k !== 'string') return;
      if (v === undefined || v === null || v === 'undefined' || v === 'null') {
        this._currParams.delete(k);
      } else {
        this._currParams.set(k, v);
      }
    }
  }

  class MockContext {
    constructor()   {
      this.sequences = {};
      this.viewport = new Rapid.sdk.Viewport();
      this.systems = {
        assets:     new Rapid.AssetSystem(this),
        l10n:       new Rapid.LocalizationSystem(this),
        locations:  new Rapid.LocationSystem(this),
        storage:    new Rapid.StorageSystem(this),
        urlhash:    new MockUrlHashSystem(this)
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
      const graph = new Rapid.Graph(context, [node]);
      const presets = new Rapid.PresetSystem(context);
      assert.strictEqual(presets.match(node, graph).id, 'point');
    });

    it('has a fallback line preset', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const way = new Rapid.OsmWay(context, { id: 'w', nodes: ['n'] });
      const graph = new Rapid.Graph(context, [node, way]);
      const presets = new Rapid.PresetSystem(context);
      assert.strictEqual(presets.match(way, graph).id, 'line');
    });

    it('has a fallback area preset', () => {
      const node = new Rapid.OsmNode(context, { id: 'n' });
      const way = new Rapid.OsmWay(context, { id: 'w', nodes: ['n'], tags: { area: 'yes' }});
      const graph = new Rapid.Graph(context, [node, way]);
      const presets = new Rapid.PresetSystem(context);
      assert.strictEqual(presets.match(way, graph).id, 'area');
    });

    it('has a fallback relation preset', () => {
      const relation = new Rapid.OsmRelation(context, { id: 'r' });
      const graph = new Rapid.Graph(context, [relation]);
      const presets = new Rapid.PresetSystem(context);
      assert.strictEqual(presets.match(relation, graph).id, 'relation');
    });
  });


  describe('match', () => {
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
        const graph = new Rapid.Graph(context, [way]);
        assert.strictEqual(presets.match(way, graph).id, 'residential');
      });
    });

    it('returns the appropriate fallback preset when no tags match', () => {
      const presets = new Rapid.PresetSystem(context);
      const point = new Rapid.OsmNode(context, );
      const line = new Rapid.OsmWay(context, { tags: { foo: 'bar' } });
      const graph = new Rapid.Graph(context, [point, line]);

      return presets.initAsync().then(() => {
        assert.strictEqual(presets.match(point, graph).id, 'point');
        assert.strictEqual(presets.match(line, graph).id, 'line');
      });
    });

    it('matches vertices on a line as points', () => {
      const presets = new Rapid.PresetSystem(context);
      const point = new Rapid.OsmNode(context, { tags: { leisure: 'park' } });
      const line = new Rapid.OsmWay(context, { nodes: [point.id], tags: { 'highway': 'residential' } });
      const graph = new Rapid.Graph(context, [point, line]);

      return presets.initAsync().then(() => {
        assert.strictEqual(presets.match(point, graph).id, 'point');
      });
    });

    it('matches vertices on an addr:interpolation line as points', () => {
      const presets = new Rapid.PresetSystem(context);
      const point = new Rapid.OsmNode(context, { tags: { leisure: 'park' } });
      const line = new Rapid.OsmWay(context, { nodes: [point.id], tags: { 'addr:interpolation': 'even' } });
      const graph = new Rapid.Graph(context, [point, line]);

      return presets.initAsync().then(() => {
        assert.strictEqual(presets.match(point, graph).id, 'park');
      });
    });
  });


  describe('areaKeys', () => {
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
        assert.containsAllKeys(presets.areaKeys(), ['natural']);
      });
    });

    it('discards key-values for presets with a line geometry', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        assert.containsAllKeys(presets.areaKeys().natural, ['tree_row']);
        assert.isTrue(presets.areaKeys().natural.tree_row);
      });
    });

    it('discards key-values for presets with both area and line geometry', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        assert.containsAllKeys(presets.areaKeys().leisure, ['track']);
      });
    });

    it('does not discard key-values for presets with neither area nor line geometry', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        assert.doesNotHaveAllKeys(presets.areaKeys().natural, ['peak']);
      });
    });

    it('does not discard generic \'*\' key-values', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        assert.doesNotHaveAllKeys(presets.areaKeys().natural, ['natural']);
      });
    });

    it('ignores keys like \'highway\' that are assumed to be lines', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        assert.doesNotHaveAllKeys(presets.areaKeys(), ['highway']);
      });
    });

    it('ignores suggestion presets', () => {
      const presets = new Rapid.PresetSystem(context);
      return presets.initAsync().then(() => {
        assert.doesNotHaveAllKeys(presets.areaKeys(), ['amenity']);
      });
    });
  });


  describe('merge', () => {
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

      let matched = presets.match(surfShop, new Rapid.Graph(context, [surfShop]));
      assert.strictEqual(matched.id, 'point');   // no surfshop preset yet, matches fallback point
      presets.merge(presetData);

      // todo: need to touch the entity now, due to change in how transients work.
      // may need to rethink how this works.
      surfShop.touch();
      matched = presets.match(surfShop, new Rapid.Graph(context, [surfShop]));
      assert.strictEqual(matched.id, 'amenity/shop/surf');
    });
  });


  describe('match', () => {

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
      const graph = new Rapid.Graph(context, [relation]);
      return presets.initAsync().then(() => {
        const match = presets.match(relation, graph);
        assert.strictEqual(match.id, 'building');
      });
    });

    it('prefers building to address', () => {
      const presets = new Rapid.PresetSystem(context);
      const way = new Rapid.OsmWay(context, { tags: { area: 'yes', building: 'yes', 'addr:housenumber': '1234' } });
      const graph = new Rapid.Graph(context, [way]);
      return presets.initAsync().then(() => {
        const match = presets.match(way, graph);
        assert.strictEqual(match.id, 'building');
      });
    });

    it('prefers pedestrian to area', () => {
      const presets = new Rapid.PresetSystem(context);
      const way = new Rapid.OsmWay(context, { tags: { area: 'yes', highway: 'pedestrian' } });
      const graph = new Rapid.Graph(context, [way]);
      return presets.initAsync().then(() => {
        const match = presets.match(way, graph);
        assert.strictEqual(match.id, 'highway/pedestrian_area');
      });
    });
  });

});
