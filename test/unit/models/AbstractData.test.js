import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


// This is an abstract class that shouldn't be instantiated in normal sitations.
describe('AbstractData', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs an AbstractData from a context', () => {
      const a = new Rapid.AbstractData(context);
      assert.instanceOf(a, Rapid.AbstractData);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.isObject(a.props);
    });

    it('constructs an AbstractData from a context, with props', () => {
      const orig = { hello: 'world' };
      const a = new Rapid.AbstractData(context, orig);
      assert.instanceOf(a, Rapid.AbstractData);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.notStrictEqual(a.props, orig);  // cloned, not ===
      assert.deepInclude(a.props, orig);
    });

    it('constructs an AbstractData from another AbstractData', () => {
      const a = new Rapid.AbstractData(context);
      const b = new Rapid.AbstractData(a);
      assert.instanceOf(b, Rapid.AbstractData);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.isObject(b.props);
    });

    it('constructs an AbstractData from another AbstractData, with props', () => {
      const orig = { hello: 'world' };
      const a = new Rapid.AbstractData(context, orig);
      const update = { foo: 'bar' };
      const b = new Rapid.AbstractData(a, update);
      assert.instanceOf(b, Rapid.AbstractData);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.deepInclude(b.props, orig);
      assert.deepInclude(b.props, update);
    });
  });

  describe('destroy', () => {
    it('destroys and frees the data', () => {
      const a = new Rapid.AbstractData(context);
      a.destroy();
      assert.isNull(a.geoms);
      assert.isNull(a.props);
      assert.isNull(a.context);
    });
  });

  describe('update', () => {
    it('returns a new AbstractData', () => {
      const a = new Rapid.AbstractData(context);
      const b = a.update({});
      assert.instanceOf(b, Rapid.AbstractData);
      assert.notStrictEqual(b, a);
    });

    it('updates the specified properties', () => {
      const a = new Rapid.AbstractData(context);
      const update = { foo: 'bar' };
      const b = a.update(update);
      assert.notStrictEqual(b.props, a.props);  // new object, not ===
      assert.notStrictEqual(b.props, update);   // cloned, not ===
      assert.deepInclude(b.props, update);
    });

    it('defaults to empty props argument', () => {
      const a = new Rapid.AbstractData(context);
      const b = a.update();
      assert.notStrictEqual(b.props, a.props);  // new object, not ===
    });

    it('preserves existing properties', () => {
      const orig = { hello: 'world' };
      const a = new Rapid.AbstractData(context, orig);
      const update = { foo: 'bar' };
      const b = a.update(update);
      assert.notStrictEqual(b.props, a.props);   // new object, not ===
      assert.notStrictEqual(b.props, update);    // cloned, not ===
      assert.deepInclude(b.props, orig);
      assert.deepInclude(b.props, update);
    });

    it('doesn\'t copy prototype properties', () => {
      const a = new Rapid.AbstractData(context);
      const update = { foo: 'bar' };
      const b = a.update(update);
      assert.doesNotHaveAnyKeys(b.props, ['constructor', '__proto__', 'toString']);
    });

    it('updates v', () => {
      const a = new Rapid.AbstractData(context);
      const v1 = a.v;
      const b = a.update({});
      assert.isAbove(b.v, v1);
    });
  });


  describe('updateSelf', () => {
    it('returns the same AbstractData', () => {
      const a = new Rapid.AbstractData(context);
      const b = a.updateSelf({});
      assert.strictEqual(b, a);
    });

    it('updates the specified properties', () => {
      const a = new Rapid.AbstractData(context);
      const update = { foo: 'bar' };
      const b = a.updateSelf(update);
      assert.strictEqual(b.props, a.props);     // same object, ===
      assert.notStrictEqual(b.props, update);   // cloned, not ===
      assert.deepInclude(b.props, update);
    });

    it('defaults to empty props argument', () => {
      const a = new Rapid.AbstractData(context);
      const b = a.updateSelf();
      assert.strictEqual(b.props, a.props);   // same object, ===
    });

    it('preserves existing properties', () => {
      const orig = { hello: 'world' };
      const a = new Rapid.AbstractData(context, orig);
      const update = { foo: 'bar' };
      const b = a.updateSelf(update);
      assert.strictEqual(b.props, a.props);    // same object, ===
      assert.notStrictEqual(b.props, update);  // cloned, not ===
      assert.deepInclude(b.props, orig);
      assert.deepInclude(b.props, update);
    });

    it('doesn\'t copy prototype properties', () => {
      const a = new Rapid.AbstractData(context);
      const update = { foo: 'bar' };
      const b = a.updateSelf(update);
      assert.doesNotHaveAnyKeys(b.props, ['constructor', '__proto__', 'toString']);
    });

    it('updates v', () => {
      const a = new Rapid.AbstractData(context);
      const v1 = a.v;
      a.updateSelf({});
      assert.isAbove(a.v, v1);
    });
  });

  describe('updateGeometry', () => {
    it('throws when calling AbstractData.updateGeometry', () => {
      const a = new Rapid.AbstractData(context);
      assert.throws(() => a.updateGeometry(), /do not call/i);
    });
  });

  describe('asGeoJSON', () => {
    it('throws when calling AbstractData.asGeoJSON', () => {
      const a = new Rapid.AbstractData(context);
      assert.throws(() => a.asGeoJSON(), /do not call/i);
    });
  });

  describe('extent', () => {
    it('doesn\'t return an extent', () => {
      const a = new Rapid.AbstractData(context);
      assert.isNotOk(a.extent());
    });
  });

  describe('intersects', () => {
    it('doesn\'t intersect anything', () => {
      const a = new Rapid.AbstractData(context);
      const extent = new Rapid.sdk.Extent([-180, -90], [180, 90]);
      assert.isFalse(a.intersects(extent));
    });
  });

  describe('touch', () => {
    it('updates v in place', () => {
      const a = new Rapid.AbstractData(context);
      const v1 = a.v;
      a.touch();
      assert.isAbove(a.v, v1);
    });
  });

  describe('type', () => {
    it('gets type', () => {
      const a = new Rapid.AbstractData(context, { type: 'node' });
      assert.strictEqual(a.props.type, 'node');
      assert.strictEqual(a.type, 'node');
    });

    it('gets empty string if no type', () => {
      const a = new Rapid.AbstractData(context);
      assert.strictEqual(a.type, '');
    });
  });

  describe('id', () => {
    it('gets id', () => {
      const a = new Rapid.AbstractData(context, { id: '10' });
      assert.strictEqual(a.props.id, '10');
      assert.strictEqual(a.id, '10');
    });

    it('gets empty string if no id', () => {
      const a = new Rapid.AbstractData(context);
      assert.strictEqual(a.id, '');
    });
  });

  describe('v', () => {
    it('gets v', () => {
      const a = new Rapid.AbstractData(context, { v: 10 });
      assert.strictEqual(a.props.v, 10);
      assert.strictEqual(a.v, 10);
    });

    it('gets 0 if no v', () => {
      const a = new Rapid.AbstractData(context);
      assert.strictEqual(a.v, 0);
    });
  });

  describe('key', () => {
    it('gets key as a combination of id and v', () => {
      const a = new Rapid.AbstractData(context, { id: '10', v: 5 });
      assert.strictEqual(a.key, `10v5`);
    });
  });

});
