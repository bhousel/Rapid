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
      assert.deepEqual(r.include, []);
      assert.deepEqual(r.exclude, []);
    });

    it('creates a ruleset with rules', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'surface_paved',
        include: [
          { key: 'surface', value: 'asphalt' },
          { key: 'surface', value: 'concrete' },
        ]
      });
      assert.strictEqual(r.id, 'surface_paved');
      assert.lengthOf(r.include, 2);
    });

    it('stores assetID and scopeID', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'test',
        assetID: 'osm_rulesets',
        scopeID: 'osm',
        include: []
      });
      assert.strictEqual(r.props.assetID, 'osm_rulesets');
      assert.strictEqual(r.props.scopeID, 'osm');
    });

    it('deep clones props to avoid mutations', () => {
      const include = [{ key: 'surface', value: 'asphalt' }];
      const r = new Rapid.Ruleset(context, { id: 'test', include });
      include.push({ key: 'surface', value: 'concrete' });
      assert.lengthOf(r.include, 1);  // original not affected
    });

    it('throws for invalid rule patterns', () => {
      assert.throws(
        () => new Rapid.Ruleset(context, {
          id: 'bad',
          include: [{ key: 'test', op: '~', value: '[invalid' }]
        }),
        /invalid regex/
      );
    });

    it('creates a ruleset with include and exclude', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'sided_right',
        include: [
          { key: 'natural', value: 'cliff' },
          { key: 'barrier', value: 'retaining_wall' },
        ],
        exclude: [
          { key: 'two_sided', value: 'yes' },
        ]
      });
      assert.strictEqual(r.id, 'sided_right');
      assert.lengthOf(r.include, 2);
      assert.lengthOf(r.exclude, 1);
    });
  });


  describe('match', () => {
    it('returns true when any rule matches', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'surface_paved',
        include: [
          { key: 'surface', value: 'asphalt' },
          { key: 'surface', value: 'concrete' },
          { key: 'surface', value: 'paved' },
        ]
      });
      assert.isTrue(r.match({ surface: 'asphalt' }));
      assert.isTrue(r.match({ surface: 'concrete' }));
      assert.isTrue(r.match({ surface: 'paved' }));
    });

    it('returns false when no rule matches', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'surface_paved',
        include: [
          { key: 'surface', value: 'asphalt' },
          { key: 'surface', value: 'concrete' },
        ]
      });
      assert.isFalse(r.match({ surface: 'gravel' }));
      assert.isFalse(r.match({ surface: 'dirt' }));
      assert.isFalse(r.match({}));
    });

    it('returns false for empty ruleset', () => {
      const r = new Rapid.Ruleset(context, { id: 'empty' });
      assert.isFalse(r.match({ anything: 'yes' }));
    });

    it('handles null/undefined input gracefully', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'test',
        include: [{ key: 'highway', value: 'motorway' }]
      });
      assert.isFalse(r.match(null));
      assert.isFalse(r.match(undefined));
    });

    it('works with wildcard value matching', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'has_highway',
        include: [
          { key: 'highway', value: '*' },
        ]
      });
      assert.isTrue(r.match({ highway: 'motorway' }));
      assert.isTrue(r.match({ highway: 'residential' }));
      assert.isFalse(r.match({ building: 'yes' }));
    });

    it('works with existence check', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'has_surface',
        include: [
          { key: 'surface', op: 'exists' },
        ]
      });
      assert.isTrue(r.match({ surface: 'asphalt' }));
      assert.isTrue(r.match({ surface: 'gravel' }));
      assert.isFalse(r.match({ highway: 'residential' }));
    });

    it('works with regex rules', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'major_roads',
        include: [
          { key: 'highway', op: '~', value: '^(motorway|trunk|primary)$' },
        ]
      });
      assert.isTrue(r.match({ highway: 'motorway' }));
      assert.isTrue(r.match({ highway: 'trunk' }));
      assert.isTrue(r.match({ highway: 'primary' }));
      assert.isFalse(r.match({ highway: 'residential' }));
    });

    it('works with mixed rule types', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'mixed',
        include: [
          { key: 'highway', value: 'motorway' },        // exact match
          { key: 'railway', op: 'exists' },             // existence
          { key: 'surface', op: '~', value: '^pav' },   // regex
        ]
      });
      assert.isTrue(r.match({ highway: 'motorway' }));
      assert.isTrue(r.match({ railway: 'rail' }));
      assert.isTrue(r.match({ surface: 'paved' }));
      assert.isFalse(r.match({ highway: 'residential' }));
    });

    it('returns false when an exclude rule matches', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'sided_right',
        include: [
          { key: 'natural', value: 'cliff' },
          { key: 'barrier', value: 'retaining_wall' },
        ],
        exclude: [
          { key: 'two_sided', value: 'yes' },
        ]
      });
      // Include matches and no exclude → true
      assert.isTrue(r.match({ natural: 'cliff' }));
      assert.isTrue(r.match({ barrier: 'retaining_wall' }));
      // Include matches but exclude also matches → false (vetoed)
      assert.isFalse(r.match({ natural: 'cliff', two_sided: 'yes' }));
      assert.isFalse(r.match({ barrier: 'retaining_wall', two_sided: 'yes' }));
      // Exclude matches but no include → false (no include match)
      assert.isFalse(r.match({ highway: 'motorway', two_sided: 'yes' }));
    });
  });


  describe('merge', () => {
    it('combines rules from both rulesets', () => {
      const r1 = new Rapid.Ruleset(context, {
        id: 'surface_paved',
        include: [{ key: 'surface', value: 'asphalt' }]
      });
      const r2 = new Rapid.Ruleset(context, {
        id: 'paved_extra',
        include: [{ key: 'surface', value: 'concrete' }]
      });
      const merged = r1.merge(r2);
      assert.strictEqual(merged.id, 'surface_paved');  // keeps original ID
      assert.lengthOf(merged.include, 2);
      assert.isTrue(merged.match({ surface: 'asphalt' }));
      assert.isTrue(merged.match({ surface: 'concrete' }));
    });

    it('does not mutate originals', () => {
      const r1 = new Rapid.Ruleset(context, {
        id: 'a',
        include: [{ key: 'surface', value: 'asphalt' }]
      });
      const r2 = new Rapid.Ruleset(context, {
        id: 'b',
        include: [{ key: 'surface', value: 'concrete' }]
      });
      r1.merge(r2);
      assert.lengthOf(r1.include, 1);
      assert.lengthOf(r2.include, 1);
    });

    it('merges excludes from both rulesets', () => {
      const r1 = new Rapid.Ruleset(context, {
        id: 'sided_right',
        include: [{ key: 'natural', value: 'cliff' }],
        exclude: [{ key: 'two_sided', value: 'yes' }]
      });
      const r2 = new Rapid.Ruleset(context, {
        id: 'extra',
        include: [{ key: 'barrier', value: 'retaining_wall' }],
        exclude: [{ key: 'area', value: 'yes' }]
      });
      const merged = r1.merge(r2);
      assert.lengthOf(merged.include, 2);
      assert.lengthOf(merged.exclude, 2);
      assert.isTrue(merged.match({ natural: 'cliff' }));
      assert.isFalse(merged.match({ natural: 'cliff', two_sided: 'yes' }));
      assert.isFalse(merged.match({ barrier: 'retaining_wall', area: 'yes' }));
    });
  });


  describe('clone', () => {
    it('creates an independent copy', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'surface_paved',
        include: [{ key: 'surface', value: 'asphalt' }]
      });
      const copy = r.clone();
      assert.strictEqual(copy.id, 'surface_paved');
      assert.lengthOf(copy.include, 1);
      assert.notStrictEqual(copy, r);
      assert.notStrictEqual(copy.props, r.props);
    });

    it('allows a new ID', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'original',
        include: [{ key: 'surface', value: 'asphalt' }]
      });
      const copy = r.clone('renamed');
      assert.strictEqual(copy.id, 'renamed');
    });
  });


  describe('toJSON', () => {
    it('returns a JSON-serializable object', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'surface_paved',
        assetID: 'osm_rulesets',
        scopeID: 'osm',
        include: [
          { key: 'surface', value: 'asphalt' },
          { key: 'surface', value: 'concrete' },
        ]
      });
      const json = r.toJSON();
      assert.strictEqual(json.id, 'surface_paved');
      assert.strictEqual(json.assetID, 'osm_rulesets');
      assert.strictEqual(json.scopeID, 'osm');
      assert.lengthOf(json.include, 2);
      assert.deepEqual(json.include[0], { key: 'surface', value: 'asphalt' });
    });

    it('includes exclude in JSON when non-empty', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'sided_right',
        include: [{ key: 'natural', value: 'cliff' }],
        exclude: [{ key: 'two_sided', value: 'yes' }]
      });
      const json = r.toJSON();
      assert.lengthOf(json.include, 1);
      assert.lengthOf(json.exclude, 1);
      assert.deepEqual(json.exclude[0], { key: 'two_sided', value: 'yes' });
    });

    it('omits exclude from JSON when empty', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'test',
        include: [{ key: 'highway', value: 'motorway' }]
      });
      const json = r.toJSON();
      assert.isUndefined(json.exclude);
    });

    it('is round-trippable', () => {
      const original = new Rapid.Ruleset(context, {
        id: 'test',
        include: [
          { key: 'highway', value: 'motorway' },
          { key: 'surface', op: '~', value: '^pav' },
        ]
      });
      const json = original.toJSON();
      const restored = new Rapid.Ruleset(context, json);
      assert.strictEqual(restored.id, original.id);
      assert.lengthOf(restored.include, original.include.length);
      // Verify same matching behavior
      assert.isTrue(restored.match({ highway: 'motorway' }));
      assert.isTrue(restored.match({ surface: 'paved' }));
      assert.isFalse(restored.match({ surface: 'gravel' }));
    });
  });


  describe('toString', () => {
    it('returns a readable string', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'surface_paved',
        include: [
          { key: 'surface', value: 'asphalt' },
          { key: 'surface', value: 'concrete' },
        ]
      });
      assert.strictEqual(r.toString(), 'Ruleset(surface_paved, 2 include)');
    });

    it('includes exclude count when non-empty', () => {
      const r = new Rapid.Ruleset(context, {
        id: 'sided_right',
        include: [
          { key: 'natural', value: 'cliff' },
          { key: 'barrier', value: 'retaining_wall' },
        ],
        exclude: [
          { key: 'two_sided', value: 'yes' },
        ]
      });
      assert.strictEqual(r.toString(), 'Ruleset(sided_right, 2 include, 1 exclude)');
    });
  });


  describe('real-world scenarios', () => {
    it('classifies paved surfaces (two-level shape)', () => {
      const paved = new Rapid.Ruleset(context, {
        id: 'surface_paved',
        include: [
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

      assert.isTrue(paved.match({ surface: 'asphalt', highway: 'residential' }));
      assert.isTrue(paved.match({ surface: 'concrete:lanes' }));
      assert.isFalse(paved.match({ surface: 'gravel' }));
      assert.isFalse(paved.match({ surface: 'dirt' }));
      assert.isFalse(paved.match({ highway: 'residential' }));
    });

    it('classifies routable highways (single-level shape)', () => {
      const routable = new Rapid.Ruleset(context, {
        id: 'connected_highway',
        include: [
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

      assert.isTrue(routable.match({ highway: 'motorway' }));
      assert.isTrue(routable.match({ highway: 'service' }));
      assert.isFalse(routable.match({ highway: 'path' }));
      assert.isFalse(routable.match({ highway: 'footway' }));
      assert.isFalse(routable.match({ railway: 'rail' }));
    });

    it('handles "one-shot" tags (single key, any value)', () => {
      const oneShot = new Rapid.Ruleset(context, {
        id: 'one_shot',
        include: [
          { key: 'building', value: '*' },
          { key: 'landuse', value: '*' },
        ]
      });

      assert.isTrue(oneShot.match({ building: 'yes' }));
      assert.isTrue(oneShot.match({ building: 'commercial' }));
      assert.isTrue(oneShot.match({ landuse: 'residential' }));
      assert.isFalse(oneShot.match({ highway: 'motorway' }));
    });
  });

});
