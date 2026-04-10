import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('StyleSelector', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('throws if missing an id', () => {
      assert.throws(() => new Rapid.StyleSelector(context), /missing id/i);
    });

    it('requires styleIDs', () => {
      assert.throws(() => new Rapid.StyleSelector(context, { id: 'test', match: {} }), /styleIDs is required/);
    });

    it('creates a selector with minimal props', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['motorway'],
        match: {}
      });
      assert.strictEqual(s.id, 'test');
      assert.deepEqual(s.styleIDs, ['motorway']);
    });

    it('exposes match conditions via getter', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['motorway'],
        match: { tags: [{ key: 'highway' }] }
      });
      assert.deepEqual(s.match.tags, [{ key: 'highway' }]);
    });

    it('preserves assetID in props', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['motorway'],
        assetID: 'rapid_style',
        match: {}
      });
      assert.strictEqual(s.props.assetID, 'rapid_style');
    });

    it('deep clones input props', () => {
      const props = {
        id: 'test',
        styleIDs: ['motorway'],
        match: { tags: [{ key: 'highway', value: 'motorway' }] }
      };
      const s = new Rapid.StyleSelector(context, props);

      // Modify original should not affect selector
      props.match.tags[0].value = 'trunk';
      assert.strictEqual(s.props.match.tags[0].value, 'motorway');
    });
  });


  describe('matching - geometry', () => {
    it('matches when geometry not specified', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: {}
      });
      assert.isTrue(s.matches({ geometry: 'point' }));
      assert.isTrue(s.matches({ geometry: 'line' }));
      assert.isTrue(s.matches({ geometry: 'area' }));
    });

    it('matches single geometry', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: { geometry: 'line' }
      });
      assert.isTrue(s.matches({ geometry: 'line' }));
      assert.isFalse(s.matches({ geometry: 'area' }));
      assert.isFalse(s.matches({ geometry: 'point' }));
    });

    it('matches multiple geometries', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: { geometry: ['line', 'area'] }
      });
      assert.isTrue(s.matches({ geometry: 'line' }));
      assert.isTrue(s.matches({ geometry: 'area' }));
      assert.isFalse(s.matches({ geometry: 'point' }));
    });

    it('matches wildcard geometry', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: { geometry: '*' }
      });
      assert.isTrue(s.matches({ geometry: 'point' }));
      assert.isTrue(s.matches({ geometry: 'line' }));
      assert.isTrue(s.matches({ geometry: 'area' }));
    });
  });


  describe('matching - tags', () => {
    it('matches when no tags specified', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: {}
      });
      assert.isTrue(s.matches({ tags: { highway: 'motorway' } }));
      assert.isTrue(s.matches({ tags: {} }));
      assert.isTrue(s.matches({}));
    });

    it('matches single tag', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['motorway'],
        match: {
          tags: [{ key: 'highway', value: 'motorway' }]
        }
      });
      assert.isTrue(s.matches({ tags: { highway: 'motorway' } }), 'matches highway=motorway');
      assert.isFalse(s.matches({ tags: { highway: 'trunk' } }), 'does not match highway=trunk');
      assert.isFalse(s.matches({ tags: { building: 'yes' } }), 'does not match building=yes');
    });

    it('matches tag existence', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['building'],
        match: {
          tags: [{ key: 'building' }]  // any value
        }
      });
      assert.isTrue(s.matches({ tags: { building: 'yes' } }), 'matches building=yes');
      assert.isTrue(s.matches({ tags: { building: 'residential' } }), 'matches building=residential');
      assert.isFalse(s.matches({ tags: { highway: 'motorway' } }), 'does not match motorway=*');
    });

    it('matches multiple tags (AND logic)', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['tunnel_road'],
        match: {
          tags: [
            { key: 'highway', value: 'motorway' },
            { key: 'tunnel', value: 'yes' }
          ]
        }
      });
      assert.isTrue(s.matches({ tags: { highway: 'motorway', tunnel: 'yes', name: 'Test' } }), 'matches all conditions');
      assert.isFalse(s.matches({ tags: { highway: 'motorway' } }), 'missing tunnel tag');
      assert.isFalse(s.matches({ tags: { highway: 'trunk', tunnel: 'yes' } }), 'wrong highway value');
    });

    it('accepts PropMatcherProps objects in tags', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['test'],
        match: { tags: [{ key: 'highway', op: '~', value: '^motor' }] }
      });
      assert.isTrue(s.matches({ tags: { highway: 'motorway' } }), 'matches motorway');
      assert.isTrue(s.matches({ tags: { highway: 'motorway_link' } }), 'matches motorway_link');
      assert.isFalse(s.matches({ tags: { highway: 'trunk' } }), 'does not match trunk');
    });
  });


  describe('matching - combined conditions', () => {
    it('matches geometry + tags', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['rapid_building'],
        match: {
          geometry: 'area',
          tags: [{ key: 'building' }]
        }
      });

      assert.isTrue(s.matches({ geometry: 'area', tags: { building: 'yes' } }), 'all conditions match');
      assert.isFalse(s.matches({ geometry: 'point', tags: { building: 'yes' } }), 'geometry does not match');
      assert.isFalse(s.matches({ geometry: 'area', tags: { highway: 'motorway' } }), 'tags do not match');
    });
  });


  describe('weight', () => {
    it('returns the weight property value', () => {
      const s = new Rapid.StyleSelector(context, { id: 'test', styleIDs: ['test'], weight: 2 });
      assert.strictEqual(s.weight, 2);
    });

    it('returns 1 by default', () => {
      const s = new Rapid.StyleSelector(context, { id: 'test', styleIDs: ['test'] });
      assert.strictEqual(s.weight, 1);
    });

    it('0 is a valid weight', () => {
      const s = new Rapid.StyleSelector(context, { id: 'test', styleIDs: ['test'], weight: 0 });
      assert.strictEqual(s.weight, 0);
    });
  });


  describe('compare', () => {
    it('higher weight wins', () => {
      const a = new Rapid.StyleSelector(context, { id: 'a', styleIDs: ['test'], weight: 1 });
      const b = new Rapid.StyleSelector(context, { id: 'b', styleIDs: ['test'], weight: 2 });
      assert.isBelow(a.compare(b), 0);
      assert.isAbove(b.compare(a), 0);
    });

    it('returns 0 for equal weight', () => {
      const a = new Rapid.StyleSelector(context, { id: 'a', styleIDs: ['test'], weight: 1 });
      const b = new Rapid.StyleSelector(context, { id: 'b', styleIDs: ['test'], weight: 1 });
      assert.strictEqual(a.compare(b), 0);
    });
  });


  describe('clone', () => {
    it('creates an independent copy', () => {
      const original = new Rapid.StyleSelector(context, {
        id: 'original',
        styleIDs: ['style'],
        match: { tags: [{ key: 'highway' }] }
      });
      const cloned = original.clone();

      assert.strictEqual(cloned.id, 'original');
      assert.deepEqual(cloned.styleIDs, ['style']);
      assert.notStrictEqual(cloned, original);
    });

    it('can clone with a new ID', () => {
      const original = new Rapid.StyleSelector(context, {
        id: 'original',
        styleIDs: ['style'],
        match: {}
      });
      const cloned = original.clone('new-id');

      assert.strictEqual(cloned.id, 'new-id');
    });
  });


  describe('toJSON', () => {
    it('toJSON returns a plain object', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['motorway'],
        match: {
          tags: [{ key: 'highway', value: 'motorway' }]
        }
      });
      const json = s.toJSON();

      assert.deepEqual(json, {
        id: 'test',
        styleIDs: ['motorway'],
        match: {
          tags: [{ key: 'highway', value: 'motorway' }]
        }
      });
    });
  });


  describe('static methods', () => {

    describe('findAll', () => {
      it('returns empty array when no selectors match', () => {
        const selectors = [
          new Rapid.StyleSelector(context, {
            id: 'motorway', styleIDs: ['motorway'], match: { tags: [{ key: 'highway', value: 'motorway' }] }
          })
        ];
        const result = Rapid.StyleSelector.findAll(selectors, {
          tags: { building: 'yes' }
        });
        assert.deepEqual(result, []);
      });

      it('returns all matching selectors sorted by weight', () => {
        const selectors = [
          new Rapid.StyleSelector(context, {
            id: 'low', styleIDs: ['low'], match: { tags: [{ key: 'highway' }] }
          }),
          new Rapid.StyleSelector(context, {
            id: 'high', styleIDs: ['high'], weight: 2, match: { tags: [{ key: 'highway' }] }
          })
        ];
        const result = Rapid.StyleSelector.findAll(selectors, {
          geometry: 'line',
          tags: { highway: 'motorway' }
        });

        assert.lengthOf(result, 2);
        assert.strictEqual(result[0].id, 'low');
        assert.strictEqual(result[1].id, 'high');
      });

      it('only includes matching selectors', () => {
        const selectors = [
          new Rapid.StyleSelector(context, {
            id: 'highway', styleIDs: ['road'], match: { tags: [{ key: 'highway' }] }
          }),
          new Rapid.StyleSelector(context, {
            id: 'building', styleIDs: ['building'], match: { tags: [{ key: 'building' }] }
          }),
          new Rapid.StyleSelector(context, {
            id: 'motorway', styleIDs: ['motorway'], match: { tags: [{ key: 'highway', value: 'motorway' }] }
          })
        ];
        const result = Rapid.StyleSelector.findAll(selectors, {
          tags: { highway: 'motorway' }
        });

        assert.lengthOf(result, 2);
        const ids = result.map(s => s.id);
        assert.include(ids, 'highway');
        assert.include(ids, 'motorway');
        assert.notInclude(ids, 'building');
      });
    });
  });

});
