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
        match: { dataset: 'osm', tags: [{ key: 'highway' }] }
      });
      assert.deepEqual(s.match.dataset, 'osm');
      assert.deepEqual(s.match.tags, [{ key: 'highway' }]);
    });

    it('exposes assetID via getter', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['motorway'],
        assetID: 'rapid_style',
        match: {}
      });
      assert.strictEqual(s.assetID, 'rapid_style');
    });

    it('assetID is undefined when not provided', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['motorway'],
        match: {}
      });
      assert.isUndefined(s.assetID);
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


  describe('matching - dataset', () => {
    it('matches when dataset not specified', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: {}
      });
      assert.isTrue(s.matches({ dataset: 'osm' }));
      assert.isTrue(s.matches({ dataset: 'rapid' }));
      assert.isTrue(s.matches({}));
    });

    it('matches single dataset', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: { dataset: 'osm' }
      });
      assert.isTrue(s.matches({ dataset: 'osm' }));
      assert.isFalse(s.matches({ dataset: 'rapid' }));
    });

    it('matches multiple datasets', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: { dataset: ['osm', 'rapid'] }
      });
      assert.isTrue(s.matches({ dataset: 'osm' }));
      assert.isTrue(s.matches({ dataset: 'rapid' }));
      assert.isFalse(s.matches({ dataset: 'custom' }));
    });

    it('matches wildcard dataset', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: { dataset: '*' }
      });
      assert.isTrue(s.matches({ dataset: 'osm' }));
      assert.isTrue(s.matches({ dataset: 'rapid' }));
      assert.isTrue(s.matches({ dataset: 'anything' }));
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
      assert.isTrue(s.matches({ tags: { highway: 'motorway' } }));
      assert.isFalse(s.matches({ tags: { highway: 'trunk' } }));
      assert.isFalse(s.matches({ tags: { building: 'yes' } }));
    });

    it('matches tag existence', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['building'],
        match: {
          tags: [{ key: 'building' }]  // any value
        }
      });
      assert.isTrue(s.matches({ tags: { building: 'yes' } }));
      assert.isTrue(s.matches({ tags: { building: 'residential' } }));
      assert.isFalse(s.matches({ tags: { highway: 'motorway' } }));
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
      assert.isTrue(s.matches({
        tags: { highway: 'motorway', tunnel: 'yes', name: 'Test' }
      }));
      assert.isFalse(s.matches({
        tags: { highway: 'motorway' }  // missing tunnel
      }));
      assert.isFalse(s.matches({
        tags: { highway: 'trunk', tunnel: 'yes' }  // wrong highway
      }));
    });

    it('accepts PropMatcherProps objects in tags', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: { tags: [{ key: 'highway', op: '~', value: '^motor' }] }
      });
      assert.isTrue(s.matches({ tags: { highway: 'motorway' } }));
      assert.isTrue(s.matches({ tags: { highway: 'motorway_link' } }));
      assert.isFalse(s.matches({ tags: { highway: 'trunk' } }));
    });
  });


  describe('matching - combined conditions', () => {
    it('matches dataset + geometry + tags', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['rapid_building'],
        priority: 10,
        match: {
          dataset: 'rapid',
          geometry: 'area',
          tags: [{ key: 'building' }]
        }
      });

      // All conditions match
      assert.isTrue(s.matches({
        dataset: 'rapid',
        geometry: 'area',
        tags: { building: 'yes' }
      }));

      // Wrong dataset
      assert.isFalse(s.matches({
        dataset: 'osm',
        geometry: 'area',
        tags: { building: 'yes' }
      }));

      // Wrong geometry
      assert.isFalse(s.matches({
        dataset: 'rapid',
        geometry: 'point',
        tags: { building: 'yes' }
      }));

      // Wrong tags
      assert.isFalse(s.matches({
        dataset: 'rapid',
        geometry: 'area',
        tags: { highway: 'motorway' }
      }));
    });
  });


  describe('specificity', () => {
    it('returns 0 for no conditions', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: {}
      });
      assert.strictEqual(s.specificity(), 0);
    });

    it('adds 100 for dataset condition', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: { dataset: 'osm' }
      });
      assert.strictEqual(s.specificity(), 100);
    });

    it('adds 50 for geometry condition', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: { geometry: 'line' }
      });
      assert.strictEqual(s.specificity(), 50);
    });

    it('adds 10 per tag matcher', () => {
      const s1 = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: { tags: [{ key: 'highway' }] }
      });
      assert.strictEqual(s1.specificity(), 10);

      const s2 = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: {
          tags: [
            { key: 'highway', value: 'motorway' },
            { key: 'tunnel', value: 'yes' }
          ]
        }
      });
      assert.strictEqual(s2.specificity(), 20);
    });

    it('combines all factors', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: {
          dataset: 'osm',     // +100
          geometry: 'line',   // +50
          tags: [             // +20
            { key: 'highway', value: 'motorway' },
            { key: 'tunnel' }
          ]
        }
      });
      assert.strictEqual(s.specificity(), 170);
    });

    it('does not count wildcard as specific', () => {
      const s1 = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: { dataset: '*' }
      });
      assert.strictEqual(s1.specificity(), 0);

      const s2 = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['style'],
        match: { geometry: '*' }
      });
      assert.strictEqual(s2.specificity(), 0);
    });
  });


  describe('compare', () => {
    it('higher specificity wins', () => {
      const lessSpecific = new Rapid.StyleSelector(context, {
        id: 'less',
        styleIDs: ['style'],
        match: { tags: [{ key: 'highway' }] }  // specificity: 10
      });
      const moreSpecific = new Rapid.StyleSelector(context, {
        id: 'more',
        styleIDs: ['style'],
        match: {
          dataset: 'osm',  // specificity: 100 + 10 = 110
          tags: [{ key: 'highway' }]
        }
      });

      assert.isAbove(lessSpecific.compare(moreSpecific), 0);  // more comes before less
      assert.isBelow(moreSpecific.compare(lessSpecific), 0);  // more comes before less
    });

    it('returns 0 for equal specificity', () => {
      const a = new Rapid.StyleSelector(context, {
        id: 'a',
        styleIDs: ['style'],
        match: { tags: [{ key: 'highway' }] }
      });
      const b = new Rapid.StyleSelector(context, {
        id: 'b',
        styleIDs: ['style'],
        match: { tags: [{ key: 'building' }] }
      });

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


  describe('serialization', () => {
    it('toJSON returns a plain object', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'test',
        styleIDs: ['motorway'],
        match: {
          dataset: 'osm',
          tags: [{ key: 'highway', value: 'motorway' }]
        }
      });
      const json = s.toJSON();

      assert.deepEqual(json, {
        id: 'test',
        styleIDs: ['motorway'],
        match: {
          dataset: 'osm',
          tags: [{ key: 'highway', value: 'motorway' }]
        }
      });
    });

    it('toString returns readable format', () => {
      const s = new Rapid.StyleSelector(context, {
        id: 'highway-motorway',
        styleIDs: ['motorway'],
        match: {
          dataset: 'osm',
          geometry: 'line',
          tags: [{ key: 'highway', value: 'motorway' }]
        }
      });
      const str = s.toString();

      assert.include(str, 'highway-motorway');
      assert.include(str, 'motorway');
    });
  });


  describe('static methods', () => {

    describe('findBest', () => {
      it('returns undefined when no selectors match', () => {
        const selectors = [
          new Rapid.StyleSelector(context, {
            id: 'motorway',
            styleIDs: ['motorway'],
            match: { tags: [{ key: 'highway', value: 'motorway' }] }
          })
        ];
        const result = Rapid.StyleSelector.findBest(selectors, {
          tags: { building: 'yes' }
        });
        assert.isUndefined(result);
      });

      it('returns the only matching selector', () => {
        const selector = new Rapid.StyleSelector(context, {
          id: 'motorway',
          styleIDs: ['motorway'],
          match: { tags: [{ key: 'highway', value: 'motorway' }] }
        });
        const result = Rapid.StyleSelector.findBest([selector], {
          tags: { highway: 'motorway' }
        });
        assert.strictEqual(result, selector);
      });

      it('returns most specific selector', () => {
        const selectors = [
          new Rapid.StyleSelector(context, {
            id: 'general',
            styleIDs: ['general'],
            match: { tags: [{ key: 'highway' }] }  // specificity: 10
          }),
          new Rapid.StyleSelector(context, {
            id: 'specific',
            styleIDs: ['specific'],
            match: {
              dataset: 'osm',  // specificity: 100 + 10 = 110
              tags: [{ key: 'highway', value: 'motorway' }]
            }
          })
        ];
        const result = Rapid.StyleSelector.findBest(selectors, {
          dataset: 'osm',
          tags: { highway: 'motorway' }
        });
        assert.strictEqual(result.id, 'specific');
      });

      it('uses specificity for ranking', () => {
        const selectors = [
          new Rapid.StyleSelector(context, {
            id: 'less-specific',
            styleIDs: ['less'],
            priority: 5,
            match: { tags: [{ key: 'highway' }] }  // specificity: 10
          }),
          new Rapid.StyleSelector(context, {
            id: 'more-specific',
            styleIDs: ['more'],
            priority: 5,
            match: {
              dataset: 'osm',
              tags: [{ key: 'highway' }]  // specificity: 110
            }
          })
        ];
        const result = Rapid.StyleSelector.findBest(selectors, {
          dataset: 'osm',
          tags: { highway: 'motorway' }
        });
        assert.strictEqual(result.id, 'more-specific');
      });
    });

    describe('findAll', () => {
      it('returns empty array when no selectors match', () => {
        const selectors = [
          new Rapid.StyleSelector(context, {
            id: 'motorway',
            styleIDs: ['motorway'],
            match: { tags: [{ key: 'highway', value: 'motorway' }] }
          })
        ];
        const result = Rapid.StyleSelector.findAll(selectors, {
          tags: { building: 'yes' }
        });
        assert.deepEqual(result, []);
      });

      it('returns all matching selectors sorted by specificity', () => {
        const selectors = [
          new Rapid.StyleSelector(context, {
            id: 'low',
            styleIDs: ['low'],
            match: { tags: [{ key: 'highway' }] }  // specificity: 10
          }),
          new Rapid.StyleSelector(context, {
            id: 'high',
            styleIDs: ['high'],
            match: {
              dataset: 'osm',
              geometry: 'line',
              tags: [{ key: 'highway' }]  // specificity: 160
            }
          }),
          new Rapid.StyleSelector(context, {
            id: 'medium',
            styleIDs: ['medium'],
            match: {
              dataset: 'osm',
              tags: [{ key: 'highway' }]  // specificity: 110
            }
          })
        ];
        const result = Rapid.StyleSelector.findAll(selectors, {
          dataset: 'osm',
          geometry: 'line',
          tags: { highway: 'motorway' }
        });

        assert.lengthOf(result, 3);
        assert.strictEqual(result[0].id, 'high');
        assert.strictEqual(result[1].id, 'medium');
        assert.strictEqual(result[2].id, 'low');
      });

      it('only includes matching selectors', () => {
        const selectors = [
          new Rapid.StyleSelector(context, {
            id: 'highway',
            styleIDs: ['road'],
            match: { tags: [{ key: 'highway' }] }
          }),
          new Rapid.StyleSelector(context, {
            id: 'building',
            styleIDs: ['building'],
            match: { tags: [{ key: 'building' }] }
          }),
          new Rapid.StyleSelector(context, {
            id: 'motorway',
            styleIDs: ['motorway'],
            match: { tags: [{ key: 'highway', value: 'motorway' }] }
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
