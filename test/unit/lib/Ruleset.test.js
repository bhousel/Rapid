import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Ruleset', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('requires an id', () => {
      assert.throws(() => new Rapid.Ruleset(context, {}), /Missing id/);
    });

    it('creates a ruleset with just an id', () => {
      const r = new Rapid.Ruleset(context, { id: 'test' });
      assert.strictEqual(r.id, 'test');
      assert.strictEqual(r.context, context);
      assert.deepEqual(r.rules, []);
    });

    it('creates a ruleset with rules', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'paved',
        rules: [
          { key: 'surface', value: 'asphalt' },
          { key: 'surface', value: 'concrete' },
        ]
      });
      assert.strictEqual(r.id, 'paved');
      assert.lengthOf(r.rules, 2);
    });

    it('stores assetID and scopeID', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'test',
        assetID: 'osm_rulesets',
        scopeID: 'osm',
        rules: []
      });
      assert.strictEqual(r.assetID, 'osm_rulesets');
      assert.strictEqual(r.scopeID, 'osm');
    });

    it('deep clones props to avoid mutations', () => {
      const rules = [{ key: 'surface', value: 'asphalt' }];
      const r = new Rapid.Ruleset(context, { id: 'test', rules });
      rules.push({ key: 'surface', value: 'concrete' });
      assert.lengthOf(r.rules, 1);  // original not affected
    });

    it('throws for invalid rule patterns', () => {
      assert.throws(
        () => new Rapid.Ruleset(context, {
          id: 'bad',
          rules: [{ key: 'test', op: '~', value: '[invalid' }]
        }),
        /invalid regex/
      );
    });
  });


  describe('matchAny', () => {
    it('returns true when any rule matches', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'paved',
        rules: [
          { key: 'surface', value: 'asphalt' },
          { key: 'surface', value: 'concrete' },
          { key: 'surface', value: 'paved' },
        ]
      });
      assert.isTrue(r.matchAny({ surface: 'asphalt' }));
      assert.isTrue(r.matchAny({ surface: 'concrete' }));
      assert.isTrue(r.matchAny({ surface: 'paved' }));
    });

    it('returns false when no rule matches', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'paved',
        rules: [
          { key: 'surface', value: 'asphalt' },
          { key: 'surface', value: 'concrete' },
        ]
      });
      assert.isFalse(r.matchAny({ surface: 'gravel' }));
      assert.isFalse(r.matchAny({ surface: 'dirt' }));
      assert.isFalse(r.matchAny({}));
    });

    it('returns false for empty ruleset', () => {
      const r = new Rapid.Ruleset(context, { id: 'empty' });
      assert.isFalse(r.matchAny({ anything: 'yes' }));
    });

    it('handles null/undefined input gracefully', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'test',
        rules: [{ key: 'highway', value: 'motorway' }]
      });
      assert.isFalse(r.matchAny(null));
      assert.isFalse(r.matchAny(undefined));
    });

    it('works with wildcard value matching', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'has_highway',
        rules: [
          { key: 'highway', value: '*' },
        ]
      });
      assert.isTrue(r.matchAny({ highway: 'motorway' }));
      assert.isTrue(r.matchAny({ highway: 'residential' }));
      assert.isFalse(r.matchAny({ building: 'yes' }));
    });

    it('works with existence check', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'has_surface',
        rules: [
          { key: 'surface', op: 'exists' },
        ]
      });
      assert.isTrue(r.matchAny({ surface: 'asphalt' }));
      assert.isTrue(r.matchAny({ surface: 'gravel' }));
      assert.isFalse(r.matchAny({ highway: 'residential' }));
    });

    it('works with regex rules', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'major_roads',
        rules: [
          { key: 'highway', op: '~', value: '^(motorway|trunk|primary)$' },
        ]
      });
      assert.isTrue(r.matchAny({ highway: 'motorway' }));
      assert.isTrue(r.matchAny({ highway: 'trunk' }));
      assert.isTrue(r.matchAny({ highway: 'primary' }));
      assert.isFalse(r.matchAny({ highway: 'residential' }));
    });

    it('works with mixed rule types', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'mixed',
        rules: [
          { key: 'highway', value: 'motorway' },       // exact match
          { key: 'railway', op: 'exists' },              // existence
          { key: 'surface', op: '~', value: '^pav' },   // regex
        ]
      });
      assert.isTrue(r.matchAny({ highway: 'motorway' }));
      assert.isTrue(r.matchAny({ railway: 'rail' }));
      assert.isTrue(r.matchAny({ surface: 'paved' }));
      assert.isFalse(r.matchAny({ highway: 'residential' }));
    });
  });


  describe('matchKV', () => {
    it('matches a key-value pair against rules', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'paved',
        rules: [
          { key: 'surface', value: 'asphalt' },
          { key: 'surface', value: 'concrete' },
        ]
      });
      assert.isTrue(r.matchKV('surface', 'asphalt'));
      assert.isTrue(r.matchKV('surface', 'concrete'));
      assert.isFalse(r.matchKV('surface', 'gravel'));
      assert.isFalse(r.matchKV('highway', 'motorway'));
    });
  });


  describe('firstMatchKey', () => {
    it('returns the first matching key', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'interesting',
        rules: [
          { key: 'highway', value: '*' },
          { key: 'building', value: '*' },
        ]
      });
      assert.strictEqual(r.firstMatchKey({ highway: 'motorway', name: 'Main St' }), 'highway');
      assert.strictEqual(r.firstMatchKey({ building: 'yes', name: 'Office' }), 'building');
    });

    it('returns undefined when no rule matches', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'test',
        rules: [
          { key: 'highway', value: 'motorway' },
        ]
      });
      assert.isUndefined(r.firstMatchKey({ building: 'yes' }));
      assert.isUndefined(r.firstMatchKey({}));
    });

    it('returns undefined for null/undefined input', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'test',
        rules: [{ key: 'highway', value: 'motorway' }]
      });
      assert.isUndefined(r.firstMatchKey(null));
      assert.isUndefined(r.firstMatchKey(undefined));
    });

    it('only matches keys present in the object', () => {
      // A rule for key='highway' should not match objects without 'highway'
      const r = new Rapid.Ruleset(context, {
        id: 'test',
        rules: [
          { key: 'highway', value: 'motorway' },
          { key: 'railway', value: 'rail' },
        ]
      });
      // Object has both keys but only railway matches
      assert.strictEqual(
        r.firstMatchKey({ highway: 'residential', railway: 'rail' }),
        'railway'
      );
    });
  });


  describe('ruleKeys', () => {
    it('returns all unique keys from rules', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'test',
        rules: [
          { key: 'surface', value: 'asphalt' },
          { key: 'surface', value: 'concrete' },
          { key: 'highway', value: 'motorway' },
        ]
      });
      const keys = r.ruleKeys();
      assert.strictEqual(keys.size, 2);
      assert.isTrue(keys.has('surface'));
      assert.isTrue(keys.has('highway'));
    });

    it('returns empty set for empty ruleset', () => {
      const r = new Rapid.Ruleset(context, { id: 'empty' });
      assert.strictEqual(r.ruleKeys().size, 0);
    });
  });


  describe('merge', () => {
    it('combines rules from both rulesets', () => {
      const r1 = new Rapid.Ruleset(context, {
        id: 'paved',
        rules: [{ key: 'surface', value: 'asphalt' }]
      });
      const r2 = new Rapid.Ruleset(context, {
        id: 'paved_extra',
        rules: [{ key: 'surface', value: 'concrete' }]
      });
      const merged = r1.merge(r2);
      assert.strictEqual(merged.id, 'paved');  // keeps original ID
      assert.lengthOf(merged.rules, 2);
      assert.isTrue(merged.matchKV('surface', 'asphalt'));
      assert.isTrue(merged.matchKV('surface', 'concrete'));
    });

    it('does not mutate originals', () => {
      const r1 = new Rapid.Ruleset(context, {
        id: 'a',
        rules: [{ key: 'surface', value: 'asphalt' }]
      });
      const r2 = new Rapid.Ruleset(context, {
        id: 'b',
        rules: [{ key: 'surface', value: 'concrete' }]
      });
      r1.merge(r2);
      assert.lengthOf(r1.rules, 1);
      assert.lengthOf(r2.rules, 1);
    });
  });


  describe('clone', () => {
    it('creates an independent copy', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'paved',
        rules: [{ key: 'surface', value: 'asphalt' }]
      });
      const copy = r.clone();
      assert.strictEqual(copy.id, 'paved');
      assert.lengthOf(copy.rules, 1);
      assert.notStrictEqual(copy, r);
      assert.notStrictEqual(copy.props, r.props);
    });

    it('allows a new ID', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'original',
        rules: [{ key: 'surface', value: 'asphalt' }]
      });
      const copy = r.clone('renamed');
      assert.strictEqual(copy.id, 'renamed');
    });
  });


  describe('toJSON', () => {
    it('returns a JSON-serializable object', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'paved',
        assetID: 'osm_rulesets',
        scopeID: 'osm',
        rules: [
          { key: 'surface', value: 'asphalt' },
          { key: 'surface', value: 'concrete' },
        ]
      });
      const json = r.toJSON();
      assert.strictEqual(json.id, 'paved');
      assert.strictEqual(json.assetID, 'osm_rulesets');
      assert.strictEqual(json.scopeID, 'osm');
      assert.lengthOf(json.rules, 2);
      assert.deepEqual(json.rules[0], { key: 'surface', value: 'asphalt' });
    });

    it('is round-trippable', () => {
      const original = new Rapid.Ruleset(context, {
        id: 'test',
        rules: [
          { key: 'highway', value: 'motorway' },
          { key: 'surface', op: '~', value: '^pav' },
        ]
      });
      const json = original.toJSON();
      const restored = new Rapid.Ruleset(context, json);
      assert.strictEqual(restored.id, original.id);
      assert.lengthOf(restored.rules, original.rules.length);
      // Verify same matching behavior
      assert.isTrue(restored.matchKV('highway', 'motorway'));
      assert.isTrue(restored.matchKV('surface', 'paved'));
      assert.isFalse(restored.matchKV('surface', 'gravel'));
    });
  });


  describe('toString', () => {
    it('returns a readable string', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'paved',
        rules: [
          { key: 'surface', value: 'asphalt' },
          { key: 'surface', value: 'concrete' },
        ]
      });
      assert.strictEqual(r.toString(), 'Ruleset(paved, 2 rules)');
    });
  });


  describe('real-world scenarios', () => {
    it('classifies paved surfaces (two-level shape)', () => {
      const paved = new Rapid.Ruleset(context, {
        id: 'paved',
        rules: [
          { key: 'surface', value: 'paved' },
          { key: 'surface', value: 'asphalt' },
          { key: 'surface', value: 'auto_cobblestone' },
          { key: 'surface', value: 'cobblestone' },
          { key: 'surface', value: 'cobblestone:flattened' },
          { key: 'surface', value: 'concrete' },
          { key: 'surface', value: 'concrete:lanes' },
          { key: 'surface', value: 'concrete:plates' },
          { key: 'surface', value: 'metal' },
          { key: 'surface', value: 'paving_stones' },
          { key: 'surface', value: 'sett' },
          { key: 'surface', value: 'unhewn_cobblestone' },
          { key: 'surface', value: 'wood' },
        ]
      });

      assert.isTrue(paved.matchAny({ surface: 'asphalt', highway: 'residential' }));
      assert.isTrue(paved.matchAny({ surface: 'concrete:lanes' }));
      assert.isFalse(paved.matchAny({ surface: 'gravel' }));
      assert.isFalse(paved.matchAny({ surface: 'dirt' }));
      assert.isFalse(paved.matchAny({ highway: 'residential' }));
    });

    it('classifies routable highways (single-level shape)', () => {
      const routable = new Rapid.Ruleset(context, {
        id: 'routable_highway',
        rules: [
          { key: 'highway', value: 'motorway' },
          { key: 'highway', value: 'trunk' },
          { key: 'highway', value: 'primary' },
          { key: 'highway', value: 'secondary' },
          { key: 'highway', value: 'tertiary' },
          { key: 'highway', value: 'residential' },
          { key: 'highway', value: 'motorway_link' },
          { key: 'highway', value: 'trunk_link' },
          { key: 'highway', value: 'primary_link' },
          { key: 'highway', value: 'secondary_link' },
          { key: 'highway', value: 'tertiary_link' },
          { key: 'highway', value: 'unclassified' },
          { key: 'highway', value: 'living_street' },
          { key: 'highway', value: 'service' },
        ]
      });

      assert.isTrue(routable.matchAny({ highway: 'motorway' }));
      assert.isTrue(routable.matchAny({ highway: 'service' }));
      assert.isFalse(routable.matchAny({ highway: 'path' }));
      assert.isFalse(routable.matchAny({ highway: 'footway' }));
      assert.isFalse(routable.matchAny({ railway: 'rail' }));
    });

    it('handles "one-shot" tags (single key, any value)', () => {
      const oneShot = new Rapid.Ruleset(context, {
        id: 'one_shot',
        rules: [
          { key: 'building', value: '*' },
          { key: 'landuse', value: '*' },
        ]
      });

      assert.isTrue(oneShot.matchAny({ building: 'yes' }));
      assert.isTrue(oneShot.matchAny({ building: 'commercial' }));
      assert.isTrue(oneShot.matchAny({ landuse: 'residential' }));
      assert.isFalse(oneShot.matchAny({ highway: 'motorway' }));
    });
  });

});
