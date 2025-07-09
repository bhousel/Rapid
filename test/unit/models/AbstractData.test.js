import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


// This is an abstract class that shouldn't be instantiated in normal sitations.
describe('AbstractData', () => {
  const context = new Rapid.MockContext();

  describe('constructor', () => {
    it('constructs AbstractData from a context', () => {
      const a = new Rapid.AbstractData(context);
      assert.instanceOf(a, Rapid.AbstractData);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      assert.isObject(a.props);
    });

    it('constructs AbstractData from a context, with props', () => {
      const props = { foo: 'bar' };
      const a = new Rapid.AbstractData(context, props);
      assert.instanceOf(a, Rapid.AbstractData);
      assert.strictEqual(a.context, context);
      assert.instanceOf(a.geoms, Rapid.Geometry);
      // `a.props` will be deep clone of props, possibly with other properties ('id') added.
      assert.deepInclude(a.props, props);
      assert.notStrictEqual(a.props, props);  // cloned, not ===
    });

    it('constructs AbstractData from another AbstractData', () => {
      const a = new Rapid.AbstractData(context);
      const b = new Rapid.AbstractData(a);
      assert.instanceOf(b, Rapid.AbstractData);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.isObject(b.props);
    });

    it('constructs AbstractData from another AbstractData, with props', () => {
      const aprops = { foo: 'bar' };
      const bprops = { hello: 'world' };
      const a = new Rapid.AbstractData(context, aprops);
      const b = new Rapid.AbstractData(a, bprops);
      assert.instanceOf(b, Rapid.AbstractData);
      assert.strictEqual(b.context, context);
      assert.instanceOf(b.geoms, Rapid.Geometry);
      assert.notStrictEqual(b.geoms, a.geoms);  // cloned, not ===
      assert.notStrictEqual(b.props, a.props);  // cloned, not ===
      assert.deepInclude(b.props, { foo: 'bar', hello: 'world' });
    });
  });

  describe('destroy', () => {
    it('destroys and frees the data', () => {
      const a = new Rapid.AbstractData(context);
      a.destroy();
      assert.isNull(a.geoms);
      assert.isNull(a.props);
    });
  });

  describe('update', () => {
    it('throws when calling AbstractData.update', () => {
      const a = new Rapid.AbstractData(context);
      assert.throws(() => a.update({}), /do not call/i);
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
      const aprops = a.props;
      const update = { foo: 'bar' };
      const b = a.updateSelf(update);
      const bprops = b.props;
      assert.strictEqual(bprops, aprops);      // same props object, ===
      assert.notStrictEqual(bprops, update);   // cloned, not ===
      assert.deepInclude(bprops, update);      // will also include a `v`
    });

    it('defaults to empty props argument', () => {
      const a = new Rapid.AbstractData(context);
      const aprops = a.props;
      const b = a.updateSelf();
      const bprops = b.props;
      assert.strictEqual(bprops, aprops);      // same props object, ===
    });

    it('preserves existing properties', () => {
      const a = new Rapid.AbstractData(context, { foo: 'bar' });
      const aprops = a.props;
      const update = { hello: 'world' };
      const b = a.updateSelf(update);
      const bprops = b.props;
      assert.strictEqual(bprops, aprops);      // same props object, ===
      assert.notStrictEqual(bprops, update);   // cloned, not ===
      assert.deepInclude(bprops, { foo: 'bar', hello: 'world' });  // will also include a `v`
    });

    it('doesn\'t copy prototype properties', () => {
      const a = new Rapid.AbstractData(context);
      const aprops = a.props;
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

    it('sets type', () => {
      const a = new Rapid.AbstractData(context, { type: 'node' });
      a.type = 'way';
      assert.strictEqual(a.props.type, 'way');
      assert.strictEqual(a.type, 'way');
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

    it('sets id', () => {
      const a = new Rapid.AbstractData(context, { id: '10' });
      a.id = '5';
      assert.strictEqual(a.props.id, '5');
      assert.strictEqual(a.id, '5');
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

    it('sets v', () => {
      const a = new Rapid.AbstractData(context, { v: 10 });
      a.v = 5;
      assert.strictEqual(a.props.v, 5);
      assert.strictEqual(a.v, 5);
    });
  });

  describe('key', () => {
    it('gets key as a combination of id and v', () => {
      const a = new Rapid.AbstractData(context, { id: '10', v: 5 });
      assert.strictEqual(a.key, `10v5`);
    });
  });

});
