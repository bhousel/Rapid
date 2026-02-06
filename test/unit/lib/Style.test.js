import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Style', () => {

  describe('constructor', () => {
    it('requires an id', () => {
      assert.throws(() => new Rapid.Style({}), /id is required/);
    });

    it('creates a declaration with just an id', () => {
      const d = new Rapid.Style({ id: 'test' });
      assert.strictEqual(d.id, 'test');
      assert.isUndefined(d.fill);
      assert.isUndefined(d.casing);
      assert.isUndefined(d.stroke);
    });

    it('creates a declaration with fill', () => {
      const d = new Rapid.Style({
        id: 'green',
        fill: { color: 0x8cd05f, alpha: 0.3 }
      });
      assert.strictEqual(d.id, 'green');
      assert.deepEqual(d.fill, { color: 0x8cd05f, alpha: 0.3 });
    });

    it('creates a declaration with casing and stroke', () => {
      const d = new Rapid.Style({
        id: 'motorway',
        casing: { width: 10, color: 0x70372f },
        stroke: { width: 8, color: 0xcf2081 }
      });
      assert.strictEqual(d.id, 'motorway');
      assert.deepEqual(d.casing, { width: 10, color: 0x70372f });
      assert.deepEqual(d.stroke, { width: 8, color: 0xcf2081 });
    });

    it('deep clones input props', () => {
      const props = {
        id: 'test',
        fill: { color: 0xff0000 }
      };
      const d = new Rapid.Style(props);

      // Modify original should not affect declaration
      props.fill.color = 0x00ff00;
      assert.strictEqual(d.fill.color, 0xff0000);
    });
  });


  describe('accessors', () => {
    it('fill returns fill properties', () => {
      const d = new Rapid.Style({
        id: 'test',
        fill: { color: 0xff0000, alpha: 0.5 }
      });
      assert.strictEqual(d.fill.color, 0xff0000);
      assert.strictEqual(d.fill.alpha, 0.5);
    });

    it('casing returns casing properties', () => {
      const d = new Rapid.Style({
        id: 'test',
        casing: { width: 5, cap: 'round' }
      });
      assert.strictEqual(d.casing.width, 5);
      assert.strictEqual(d.casing.cap, 'round');
    });

    it('stroke returns stroke properties', () => {
      const d = new Rapid.Style({
        id: 'test',
        stroke: { width: 3, dash: [10, 5] }
      });
      assert.strictEqual(d.stroke.width, 3);
      assert.deepEqual(d.stroke.dash, [10, 5]);
    });

    it('assetID returns the asset ID', () => {
      const d = new Rapid.Style({
        id: 'test',
        assetID: 'rapid_style'
      });
      assert.strictEqual(d.assetID, 'rapid_style');
    });
  });


  describe('resolved methods', () => {
    it('resolvedFill returns defaults when no fill specified', () => {
      const d = new Rapid.Style({ id: 'test' });
      const resolved = d.resolvedFill();
      assert.strictEqual(resolved.width, 2);
      assert.strictEqual(resolved.color, 0xaaaaaa);
      assert.strictEqual(resolved.alpha, 0.3);
      assert.isUndefined(resolved.pattern);
    });

    it('resolvedFill merges with defaults', () => {
      const d = new Rapid.Style({
        id: 'test',
        fill: { color: 0xff0000 }  // only specify color
      });
      const resolved = d.resolvedFill();
      assert.strictEqual(resolved.color, 0xff0000);  // specified
      assert.strictEqual(resolved.width, 2);  // default
      assert.strictEqual(resolved.alpha, 0.3);  // default
    });

    it('resolvedFill includes pattern', () => {
      const d = new Rapid.Style({
        id: 'test',
        fill: { pattern: 'grass' }
      });
      const resolved = d.resolvedFill();
      assert.strictEqual(resolved.pattern, 'grass');
    });

    it('resolvedCasing returns defaults when no casing specified', () => {
      const d = new Rapid.Style({ id: 'test' });
      const resolved = d.resolvedCasing();
      assert.strictEqual(resolved.width, 5);  // casing default
      assert.strictEqual(resolved.color, 0x444444);  // casing default
      assert.strictEqual(resolved.cap, 'round');
      assert.strictEqual(resolved.join, 'round');
    });

    it('resolvedStroke returns defaults when no stroke specified', () => {
      const d = new Rapid.Style({ id: 'test' });
      const resolved = d.resolvedStroke();
      assert.strictEqual(resolved.width, 3);
      assert.strictEqual(resolved.color, 0xcccccc);
      assert.strictEqual(resolved.cap, 'round');
      assert.strictEqual(resolved.join, 'round');
    });

    it('resolvedStroke includes dash pattern', () => {
      const d = new Rapid.Style({
        id: 'test',
        stroke: { dash: [6, 6], cap: 'butt' }
      });
      const resolved = d.resolvedStroke();
      assert.deepEqual(resolved.dash, [6, 6]);
      assert.strictEqual(resolved.cap, 'butt');
    });
  });


  describe('merge', () => {
    it('merges fill properties', () => {
      const base = new Rapid.Style({
        id: 'base',
        fill: { color: 0xff0000, alpha: 0.3 }
      });
      const modifier = new Rapid.Style({
        id: 'modifier',
        fill: { alpha: 0.5 }  // override alpha
      });
      const merged = base.merge(modifier);

      assert.strictEqual(merged.id, 'base');  // keeps original ID
      assert.strictEqual(merged.fill.color, 0xff0000);  // from base
      assert.strictEqual(merged.fill.alpha, 0.5);  // from modifier
    });

    it('merges casing and stroke', () => {
      const base = new Rapid.Style({
        id: 'base',
        casing: { width: 10, color: 0x444444 },
        stroke: { width: 8, color: 0xffffff }
      });
      const modifier = new Rapid.Style({
        id: 'modifier',
        casing: { alpha: 0 },  // disable casing
        stroke: { dash: [7, 3], cap: 'butt' }  // add lifecycle style
      });
      const merged = base.merge(modifier);

      assert.strictEqual(merged.casing.width, 10);  // from base
      assert.strictEqual(merged.casing.alpha, 0);  // from modifier
      assert.strictEqual(merged.stroke.width, 8);  // from base
      assert.deepEqual(merged.stroke.dash, [7, 3]);  // from modifier
    });

    it('adds properties from modifier that base does not have', () => {
      const base = new Rapid.Style({
        id: 'base',
        fill: { color: 0x00ff00 }
      });
      const modifier = new Rapid.Style({
        id: 'modifier',
        stroke: { width: 3 }
      });
      const merged = base.merge(modifier);

      assert.deepEqual(merged.fill, { color: 0x00ff00 });
      assert.deepEqual(merged.stroke, { width: 3 });
    });
  });


  describe('clone', () => {
    it('creates an independent copy', () => {
      const original = new Rapid.Style({
        id: 'original',
        fill: { color: 0xff0000 }
      });
      const cloned = original.clone();

      assert.strictEqual(cloned.id, 'original');
      assert.deepEqual(cloned.fill, { color: 0xff0000 });

      // Should be separate objects
      assert.notStrictEqual(cloned, original);
      assert.notStrictEqual(cloned.props, original.props);
    });

    it('can clone with a new ID', () => {
      const original = new Rapid.Style({
        id: 'original',
        fill: { color: 0xff0000 }
      });
      const cloned = original.clone('new-id');

      assert.strictEqual(cloned.id, 'new-id');
      assert.deepEqual(cloned.fill, { color: 0xff0000 });
    });
  });


  describe('has* methods', () => {
    it('hasFill returns true when fill exists', () => {
      const d1 = new Rapid.Style({
        id: 'test',
        fill: { color: 0xff0000 }
      });
      assert.isTrue(d1.hasFill());

      const d2 = new Rapid.Style({ id: 'test' });
      assert.isFalse(d2.hasFill());

      const d3 = new Rapid.Style({
        id: 'test',
        fill: {}
      });
      assert.isFalse(d3.hasFill());  // empty object = no fill
    });

    it('hasCasing returns true when casing exists', () => {
      const d1 = new Rapid.Style({
        id: 'test',
        casing: { width: 5 }
      });
      assert.isTrue(d1.hasCasing());

      const d2 = new Rapid.Style({ id: 'test' });
      assert.isFalse(d2.hasCasing());
    });

    it('hasStroke returns true when stroke exists', () => {
      const d1 = new Rapid.Style({
        id: 'test',
        stroke: { width: 3 }
      });
      assert.isTrue(d1.hasStroke());

      const d2 = new Rapid.Style({ id: 'test' });
      assert.isFalse(d2.hasStroke());
    });
  });


  describe('serialization', () => {
    it('toJSON returns a plain object', () => {
      const d = new Rapid.Style({
        id: 'test',
        fill: { color: 0xff0000 },
        stroke: { width: 3 }
      });
      const json = d.toJSON();

      assert.deepEqual(json, {
        id: 'test',
        fill: { color: 0xff0000 },
        stroke: { width: 3 }
      });
    });

    it('toJSON deep clones the props', () => {
      const d = new Rapid.Style({
        id: 'test',
        fill: { color: 0xff0000 }
      });
      const json = d.toJSON();
      json.fill.color = 0x00ff00;

      // Original should not be affected
      assert.strictEqual(d.fill.color, 0xff0000);
    });

    it('toString returns readable format', () => {
      const d = new Rapid.Style({
        id: 'motorway',
        casing: { width: 10, color: 0x70372f },
        stroke: { width: 8, color: 0xcf2081 }
      });
      const str = d.toString();

      assert.include(str, 'motorway');
      assert.include(str, 'casing');
      assert.include(str, 'stroke');
    });
  });


  describe('static methods', () => {
    it('from creates a Style', () => {
      const d = Rapid.Style.from({
        id: 'test',
        fill: { color: 0xff0000 }
      });
      assert.instanceOf(d, Rapid.Style);
      assert.strictEqual(d.id, 'test');
    });
  });

});
