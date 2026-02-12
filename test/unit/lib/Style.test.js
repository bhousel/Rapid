import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('Style', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('throws if missing an id', () => {
      assert.throws(() => new Rapid.Style(context), /missing id/i);
    });

    it('constructs a Style from a context and props', () => {
      const preset = new Rapid.Style(context, { id: 'test' });
      assert.instanceOf(preset, Rapid.Style);
      assert.strictEqual(preset.context, context);
    });

    it('constructs a Style with just an id', () => {
      const d = new Rapid.Style(context, { id: 'test' });
      assert.strictEqual(d.id, 'test');
      assert.isUndefined(d.fill);
      assert.isUndefined(d.casing);
      assert.isUndefined(d.stroke);
    });

    it('constructs a Style with fill', () => {
      const d = new Rapid.Style(context, {
        id: 'green',
        fill: { color: 0x8cd05f, opacity: 0.3 }
      });
      assert.strictEqual(d.id, 'green');
      assert.deepEqual(d.fill, { color: 0x8cd05f, opacity: 0.3 });
    });

    it('constructs a Style with casing and stroke', () => {
      const d = new Rapid.Style(context, {
        id: 'motorway',
        casing: { width: 10, color: 0x70372f },
        stroke: { width: 8, color: 0xcf2081 }
      });
      assert.strictEqual(d.id, 'motorway');
      assert.deepEqual(d.casing, { width: 10, color: 0x70372f });
      assert.deepEqual(d.stroke, { width: 8, color: 0xcf2081 });
    });

    it('constructs a Style with marker and icon', () => {
      const d = new Rapid.Style(context, {
        id: 'poi_pin',
        marker: { image: 'pin', color: 0xffffff },
        icon: { color: 0x111111, size: 11 }
      });
      assert.strictEqual(d.id, 'poi_pin');
      assert.deepEqual(d.marker, { image: 'pin', color: 0xffffff });
      assert.deepEqual(d.icon, { color: 0x111111, size: 11 });
    });

    it('deep clones input props', () => {
      const props = {
        id: 'test',
        fill: { color: 0xff0000 }
      };
      const d = new Rapid.Style(context, props);

      // Modify original should not affect style
      props.fill.color = 0x00ff00;
      assert.strictEqual(d.fill.color, 0xff0000);
    });
  });


  describe('getters', () => {
    it('fill returns fill properties', () => {
      const d = new Rapid.Style(context, {
        id: 'test',
        fill: { color: 0xff0000, opacity: 0.5 }
      });
      assert.strictEqual(d.fill.color, 0xff0000);
      assert.strictEqual(d.fill.opacity, 0.5);
    });

    it('casing returns casing properties', () => {
      const d = new Rapid.Style(context, {
        id: 'test',
        casing: { width: 5, cap: 'round' }
      });
      assert.strictEqual(d.casing.width, 5);
      assert.strictEqual(d.casing.cap, 'round');
    });

    it('stroke returns stroke properties', () => {
      const d = new Rapid.Style(context, {
        id: 'test',
        stroke: { width: 3, dash: [10, 5] }
      });
      assert.strictEqual(d.stroke.width, 3);
      assert.deepEqual(d.stroke.dash, [10, 5]);
    });

    it('assetID returns the asset ID', () => {
      const d = new Rapid.Style(context, {
        id: 'test',
        assetID: 'rapid_style'
      });
      assert.strictEqual(d.assetID, 'rapid_style');
    });

    it('marker returns marker properties', () => {
      const d = new Rapid.Style(context, {
        id: 'test',
        marker: { image: 'pin', color: 0xffffff, opacity: 0.8 }
      });
      assert.strictEqual(d.marker.image, 'pin');
      assert.strictEqual(d.marker.color, 0xffffff);
      assert.strictEqual(d.marker.opacity, 0.8);
    });

    it('icon returns icon properties', () => {
      const d = new Rapid.Style(context, {
        id: 'test',
        icon: { image: 'maki-restaurant', color: 0x111111, size: 15 }
      });
      assert.strictEqual(d.icon.image, 'maki-restaurant');
      assert.strictEqual(d.icon.color, 0x111111);
      assert.strictEqual(d.icon.size, 15);
    });

    it('lineMarker returns line marker properties', () => {
      const d = new Rapid.Style(context, {
        id: 'test',
        lineMarker: { image: 'oneway', color: 0x000000 }
      });
      assert.strictEqual(d.lineMarker.image, 'oneway');
      assert.strictEqual(d.lineMarker.color, 0x000000);
    });

    it('sidedMarker returns sided marker properties', () => {
      const d = new Rapid.Style(context, {
        id: 'test',
        sidedMarker: { image: 'sided', color: 0xcccccc }
      });
      assert.strictEqual(d.sidedMarker.image, 'sided');
      assert.strictEqual(d.sidedMarker.color, 0xcccccc);
    });
  });


  describe('resolvedStyle', () => {

    describe('fill', () => {
      it('returns defaults when no fill specified', () => {
        const d = new Rapid.Style(context, { id: 'test' });
        const resolved = d.resolvedStyle().fill;
        assert.strictEqual(resolved.width, 2);
        assert.strictEqual(resolved.color, 0xaaaaaa);
        assert.strictEqual(resolved.opacity, 0.3);
        assert.isUndefined(resolved.pattern);
      });

      it('merges with defaults', () => {
        const d = new Rapid.Style(context, {
          id: 'test',
          fill: { color: 0xff0000 }  // only specify color
        });
        const resolved = d.resolvedStyle().fill;
        assert.strictEqual(resolved.color, 0xff0000);  // specified
        assert.strictEqual(resolved.width, 2);  // default
        assert.strictEqual(resolved.opacity, 0.3);  // default
      });

      it('includes pattern', () => {
        const d = new Rapid.Style(context, {
          id: 'test',
          fill: { pattern: 'grass' }
        });
        const resolved = d.resolvedStyle().fill;
        assert.strictEqual(resolved.pattern, 'grass');
      });

      it('cascades base.color into fill.color', () => {
        const d = new Rapid.Style(context, {
          id: 'test',
          base: { color: 0x00ff00 }
        });
        const resolved = d.resolvedStyle().fill;
        assert.strictEqual(resolved.color, 0x00ff00);
      });
    });

    describe('casing', () => {
      it('returns defaults when no casing specified', () => {
        const d = new Rapid.Style(context, { id: 'test' });
        const resolved = d.resolvedStyle().casing;
        assert.strictEqual(resolved.width, 5);  // casing default
        assert.strictEqual(resolved.color, 0x444444);  // casing default
        assert.strictEqual(resolved.cap, 'round');
        assert.strictEqual(resolved.join, 'round');
      });
    });

    describe('stroke', () => {
      it('returns defaults when no stroke specified', () => {
        const d = new Rapid.Style(context, { id: 'test' });
        const resolved = d.resolvedStyle().stroke;
        assert.strictEqual(resolved.width, 3);
        assert.strictEqual(resolved.color, 0xcccccc);
        assert.strictEqual(resolved.cap, 'round');
        assert.strictEqual(resolved.join, 'round');
      });

      it('includes dash pattern', () => {
        const d = new Rapid.Style(context, {
          id: 'test',
          stroke: { dash: [6, 6], cap: 'butt' }
        });
        const resolved = d.resolvedStyle().stroke;
        assert.deepEqual(resolved.dash, [6, 6]);
        assert.strictEqual(resolved.cap, 'butt');
      });

      it('cascades base.color into stroke.color', () => {
        const d = new Rapid.Style(context, {
          id: 'test',
          base: { color: 0x00ff00 }
        });
        const resolved = d.resolvedStyle().stroke;
        assert.strictEqual(resolved.color, 0x00ff00);
      });

      it('cascades base.opacity into stroke.opacity', () => {
        const d = new Rapid.Style(context, {
          id: 'test',
          base: { opacity: 0.5 }
        });
        const resolved = d.resolvedStyle().stroke;
        assert.strictEqual(resolved.opacity, 0.5);
      });
    });

    describe('marker', () => {
      it('returns defaults when no marker specified', () => {
        const d = new Rapid.Style(context, { id: 'test' });
        const resolved = d.resolvedStyle().marker;
        assert.strictEqual(resolved.image, 'smallCircle');
        assert.strictEqual(resolved.color, 0xffffff);
        assert.strictEqual(resolved.opacity, 1);
      });

      it('merges with defaults', () => {
        const d = new Rapid.Style(context, {
          id: 'test',
          marker: { image: 'pin' }  // only specify name
        });
        const resolved = d.resolvedStyle().marker;
        assert.strictEqual(resolved.image, 'pin');  // specified
        assert.strictEqual(resolved.color, 0xffffff);  // default
        assert.strictEqual(resolved.opacity, 1);  // default
      });
    });

    describe('icon', () => {
      it('returns defaults when no icon specified', () => {
        const d = new Rapid.Style(context, { id: 'test' });
        const resolved = d.resolvedStyle().icon;
        assert.isUndefined(resolved.image);  // name is undefined by default
        assert.strictEqual(resolved.color, 0x111111);
        assert.strictEqual(resolved.opacity, 1);
        assert.strictEqual(resolved.size, 11);
      });

      it('includes image when specified', () => {
        const d = new Rapid.Style(context, {
          id: 'test',
          icon: { image: 'maki-restaurant', size: 15 }
        });
        const resolved = d.resolvedStyle().icon;
        assert.strictEqual(resolved.image, 'maki-restaurant');
        assert.strictEqual(resolved.size, 15);
        assert.strictEqual(resolved.color, 0x111111);  // default
      });
    });

    describe('label', () => {
      it('returns defaults when no label specified', () => {
        const d = new Rapid.Style(context, { id: 'test' });
        const resolved = d.resolvedStyle().label;
        assert.strictEqual(resolved.color, 0xeeeeee);
        assert.strictEqual(resolved.opacity, 1);
      });

      it('returns explicit value', () => {
        const d = new Rapid.Style(context, {
          id: 'test',
          label: { color: 0xdddddd }
        });
        const resolved = d.resolvedStyle().label;
        assert.strictEqual(resolved.color, 0xdddddd);
      });

      it('cascades fill.color into label.color', () => {
        const d = new Rapid.Style(context, {
          id: 'test',
          fill: { color: 0xff0000 }
        });
        const resolved = d.resolvedStyle().label;
        assert.strictEqual(resolved.color, 0xff0000);
      });

      it('cascades stroke.color into label.color when no fill', () => {
        const d = new Rapid.Style(context, {
          id: 'test',
          stroke: { color: 0x00ff00 }
        });
        const resolved = d.resolvedStyle().label;
        assert.strictEqual(resolved.color, 0x00ff00);
      });

      it('prefers fill.color over stroke.color for label cascade', () => {
        const d = new Rapid.Style(context, {
          id: 'test',
          fill: { color: 0xff0000 },
          stroke: { color: 0x00ff00 }
        });
        const resolved = d.resolvedStyle().label;
        assert.strictEqual(resolved.color, 0xff0000);
      });
    });
  });


  describe('merge', () => {
    it('merges fill properties', () => {
      const base = new Rapid.Style(context, {
        id: 'base',
        fill: { color: 0xff0000, opacity: 0.3 }
      });
      const modifier = new Rapid.Style(context, {
        id: 'modifier',
        fill: { opacity: 0.5 }  // override opacity
      });
      const merged = base.merge(modifier);

      assert.strictEqual(merged.id, 'base');  // keeps original ID
      assert.strictEqual(merged.fill.color, 0xff0000);  // from base
      assert.strictEqual(merged.fill.opacity, 0.5);  // from modifier
    });

    it('merges casing and stroke', () => {
      const base = new Rapid.Style(context, {
        id: 'base',
        casing: { width: 10, color: 0x444444 },
        stroke: { width: 8, color: 0xffffff }
      });
      const modifier = new Rapid.Style(context, {
        id: 'modifier',
        casing: { opacity: 0 },  // disable casing
        stroke: { dash: [7, 3], cap: 'butt' }  // add lifecycle style
      });
      const merged = base.merge(modifier);

      assert.strictEqual(merged.casing.width, 10);  // from base
      assert.strictEqual(merged.casing.opacity, 0);  // from modifier
      assert.strictEqual(merged.stroke.width, 8);  // from base
      assert.deepEqual(merged.stroke.dash, [7, 3]);  // from modifier
    });

    it('adds properties from modifier that base does not have', () => {
      const base = new Rapid.Style(context, {
        id: 'base',
        fill: { color: 0x00ff00 }
      });
      const modifier = new Rapid.Style(context, {
        id: 'modifier',
        stroke: { width: 3 }
      });
      const merged = base.merge(modifier);

      assert.deepEqual(merged.fill, { color: 0x00ff00 });
      assert.deepEqual(merged.stroke, { width: 3 });
    });

    it('merges marker and icon properties', () => {
      const base = new Rapid.Style(context, {
        id: 'base',
        marker: { image: 'pin', color: 0xffffff }
      });
      const modifier = new Rapid.Style(context, {
        id: 'modifier',
        marker: { opacity: 0.8 },
        icon: { image: 'maki-restaurant', color: 0x111111 }
      });
      const merged = base.merge(modifier);

      assert.strictEqual(merged.marker.image, 'pin');  // from base
      assert.strictEqual(merged.marker.color, 0xffffff);  // from base
      assert.strictEqual(merged.marker.opacity, 0.8);  // from modifier
      assert.deepEqual(merged.icon, { image: 'maki-restaurant', color: 0x111111 });  // from modifier
    });
  });


  describe('clone', () => {
    it('creates an independent copy', () => {
      const original = new Rapid.Style(context, {
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
      const original = new Rapid.Style(context, {
        id: 'original',
        fill: { color: 0xff0000 }
      });
      const cloned = original.clone('new-id');

      assert.strictEqual(cloned.id, 'new-id');
      assert.deepEqual(cloned.fill, { color: 0xff0000 });
    });
  });


  describe('serialization', () => {
    it('toJSON returns a plain object', () => {
      const d = new Rapid.Style(context, {
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
      const d = new Rapid.Style(context, {
        id: 'test',
        fill: { color: 0xff0000 }
      });
      const json = d.toJSON();
      json.fill.color = 0x00ff00;

      // Original should not be affected
      assert.strictEqual(d.fill.color, 0xff0000);
    });
  });

});
