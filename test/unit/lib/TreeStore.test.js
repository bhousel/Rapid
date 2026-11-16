import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';

const { TreeStore } = Rapid;


describe('TreeStore', () => {
  describe('get / set / has / unset', () => {
    it('sets and gets a nested value', () => {
      const store = new TreeStore();
      store.set('imagery.custom[0].template', 'https://example.com/{z}/{x}/{y}.png');
      assert.strictEqual(store.get('imagery.custom[0].template'), 'https://example.com/{z}/{x}/{y}.png');
    });

    it('returns undefined for a missing path', () => {
      const store = new TreeStore();
      assert.isUndefined(store.get('imagery.nope'));
    });

    it('stores whole objects and arrays', () => {
      const store = new TreeStore();
      store.set('schema.presetRecents', ['highway/residential', 'building']);
      assert.deepEqual(store.get('schema.presetRecents'), ['highway/residential', 'building']);
    });

    it('reports presence with has()', () => {
      const store = new TreeStore();
      assert.isFalse(store.has('ui.saw'));
      store.set('ui.saw', 'true');
      assert.isTrue(store.has('ui.saw'));
    });

    it('unsets a value', () => {
      const store = new TreeStore();
      store.set('ui.width', '240');
      store.unset('ui.width');
      assert.isUndefined(store.get('ui.width'));
    });

    it('compacts arrays when unsetting an indexed element', () => {
      const store = new TreeStore();
      store.set('a[0]', 'A');
      store.set('a[1]', 'B');
      store.set('a[2]', 'C');
      store.unset('a[1]');
      assert.deepEqual(store.get('a'), ['A', 'C']);
    });

    it('supports chaining on set/unset/clear/replace', () => {
      const store = new TreeStore();
      const ret = store.set('a', '1').set('b', '2').unset('a');
      assert.strictEqual(ret, store);
      assert.isUndefined(store.get('a'));
      assert.strictEqual(store.get('b'), '2');
    });

    it('throws on an empty path', () => {
      const store = new TreeStore();
      assert.throws(() => store.set('', '1'), /empty/i);
    });
  });


  describe('copy semantics', () => {
    it('deep-copies the seed tree', () => {
      const seed = { a: { b: '1' } };
      const store = new TreeStore(seed);
      seed.a.b = 'mutated';
      assert.strictEqual(store.get('a.b'), '1');
    });

    it('returns copies of composite values so callers cannot mutate internal state', () => {
      const store = new TreeStore();
      store.set('list', ['a', 'b']);
      const list = store.get('list');
      list.push('c');
      assert.deepEqual(store.get('list'), ['a', 'b']);
    });

    it('detaches values passed to set()', () => {
      const store = new TreeStore();
      const arr = ['a', 'b'];
      store.set('list', arr);
      arr.push('c');
      assert.deepEqual(store.get('list'), ['a', 'b']);
    });

    it('toJSON returns a deep copy', () => {
      const store = new TreeStore();
      store.set('ui.width', '240');
      const json = store.toJSON();
      json.ui.width = '999';
      assert.strictEqual(store.get('ui.width'), '240');
    });
  });


  describe('toFlat / fromFlat', () => {
    it('flattens a tree into dotted/bracketed keys', () => {
      const store = new TreeStore();
      store.set('imagery.custom[0].name', 'Custom');
      store.set('imagery.custom[0].template', 'https://example.com/a');
      store.set('imagery.opacity', '0.5');

      const flat = store.toFlat();
      assert.strictEqual(flat.get('imagery.custom[0].name'), 'Custom');
      assert.strictEqual(flat.get('imagery.custom[0].template'), 'https://example.com/a');
      assert.strictEqual(flat.get('imagery.opacity'), '0.5');
    });

    it('percent-encodes object keys that contain structural characters', () => {
      const store = new TreeStore();
      store.set('a', { 'b.c': 'v' });  // dotted object key must not become two segments
      const flat = store.toFlat();
      assert.strictEqual(flat.get('a.b%2Ec'), 'v');
    });

    it('round-trips through toFlat / fromFlat', () => {
      const store = new TreeStore();
      store.set('imagery.custom[0].name', 'Custom');
      store.set('imagery.favorites', ['EsriWorldImagery', 'Bing']);
      store.set('a', { 'dotted.key': 'v' });

      const restored = TreeStore.fromFlat(store.toFlat());
      assert.deepEqual(restored.toJSON(), store.toJSON());
    });

    it('emits keys in sorted order for deterministic output', () => {
      const store = new TreeStore();
      store.set('b', '2');
      store.set('a', '1');
      store.set('c', '3');
      assert.deepEqual([...store.toFlat().keys()], ['a', 'b', 'c']);
    });

    it('produces no keys for empty containers', () => {
      const store = new TreeStore();
      store.set('emptyArr', []);
      store.set('emptyObj', {});
      assert.strictEqual(store.toFlat().size, 0);
    });

    it('skips unparseable flat keys in fromFlat', () => {
      const store = TreeStore.fromFlat([['a.b', 'ok'], ['bad[', 'dropped']]);
      assert.strictEqual(store.get('a.b'), 'ok');
      assert.strictEqual(store.toFlat().size, 1);
    });
  });


  describe('flat entry helpers (static)', () => {
    const flat = new Map([
      ['imagery.favorites[0]', 'A'],
      ['imagery.favorites[1]', 'B'],
      ['imagery.favoritesOld', 'C'],
      ['imagery.opacity', '0.5'],
      ['a.b%2Ec', 'dotted']
    ]);

    it('pathToFlatKey accepts a path string or segments', () => {
      assert.strictEqual(TreeStore.pathToFlatKey('imagery.favorites[0]'), 'imagery.favorites[0]');
      assert.strictEqual(TreeStore.pathToFlatKey(['a', 'b.c']), 'a.b%2Ec');
    });

    it('isFlatKeyWithin matches the path itself and keys beneath it', () => {
      assert.isTrue(TreeStore.isFlatKeyWithin('imagery.favorites', 'imagery.favorites'));
      assert.isTrue(TreeStore.isFlatKeyWithin('imagery.favorites[0]', 'imagery.favorites'));
      assert.isTrue(TreeStore.isFlatKeyWithin('imagery.custom[0].template', 'imagery.custom'));
      assert.isFalse(TreeStore.isFlatKeyWithin('imagery.favoritesOld', 'imagery.favorites'));
      assert.isFalse(TreeStore.isFlatKeyWithin('imagery', 'imagery.favorites'));
    });

    it('isFlatKeyWithin compares encoded keys with paths given as segments', () => {
      assert.isTrue(TreeStore.isFlatKeyWithin('a.b%2Ec', ['a', 'b.c']));
      assert.isFalse(TreeStore.isFlatKeyWithin('a.b%2Ec', 'a.b'));
    });

    it('flatEntriesWithin returns only the entries at or under a path', () => {
      const result = TreeStore.flatEntriesWithin(flat, 'imagery.favorites');
      assert.deepEqual([...result], [['imagery.favorites[0]', 'A'], ['imagery.favorites[1]', 'B']]);
    });

    it('replaceFlatEntriesWithin swaps the entries under a path and leaves the rest', () => {
      const copy = new Map(flat);
      TreeStore.replaceFlatEntriesWithin(copy, 'imagery.favorites', new Map([['imagery.favorites[0]', 'Z']]));
      assert.strictEqual(copy.get('imagery.favorites[0]'), 'Z');
      assert.isFalse(copy.has('imagery.favorites[1]'));
      assert.strictEqual(copy.get('imagery.favoritesOld'), 'C');
      assert.strictEqual(copy.get('imagery.opacity'), '0.5');
    });

    it('sameFlat compares keys and values, ignoring order', () => {
      const a = new Map([['x', '1'], ['y', '2']]);
      assert.isTrue(TreeStore.sameFlat(a, new Map([['y', '2'], ['x', '1']])));
      assert.isFalse(TreeStore.sameFlat(a, new Map([['x', '1'], ['y', '3']])));
      assert.isFalse(TreeStore.sameFlat(a, new Map([['x', '1']])));
    });
  });


  describe('merge', () => {
    it('merges plain objects key-by-key with override winning', () => {
      const result = TreeStore.merge({ a: '1', b: '2' }, { b: '9', c: '3' });
      assert.deepEqual(result, { a: '1', b: '9', c: '3' });
    });

    it('replaces arrays wholesale rather than merging by index', () => {
      const result = TreeStore.merge({ list: ['a', 'b', 'c'] }, { list: ['x'] });
      assert.deepEqual(result, { list: ['x'] });
    });

    it('returns base when override is undefined', () => {
      assert.deepEqual(TreeStore.merge({ a: '1' }, undefined), { a: '1' });
    });

    it('does not mutate its inputs', () => {
      const base = { a: { b: '1' } };
      const override = { a: { c: '2' } };
      TreeStore.merge(base, override);
      assert.deepEqual(base, { a: { b: '1' } });
      assert.deepEqual(override, { a: { c: '2' } });
    });
  });


  describe('replace / clear', () => {
    it('replaces the whole tree with a deep copy', () => {
      const store = new TreeStore();
      store.set('old', '1');
      const next = { new: '2' };
      store.replace(next);
      next.new = 'mutated';
      assert.isUndefined(store.get('old'));
      assert.strictEqual(store.get('new'), '2');
    });

    it('clears all values', () => {
      const store = new TreeStore();
      store.set('a', '1');
      store.clear();
      assert.deepEqual(store.toJSON(), {});
    });
  });


  describe('parsePath (static)', () => {
    it('parses a simple dotted path', () => {
      assert.deepEqual(TreeStore.parsePath('a.b.c'), ['a', 'b', 'c']);
    });

    it('parses array indices as numbers', () => {
      assert.deepEqual(TreeStore.parsePath('a.b[0].c'), ['a', 'b', 0, 'c']);
    });

    it('parses a leading array index', () => {
      assert.deepEqual(TreeStore.parsePath('[2].name'), [2, 'name']);
    });

    it('throws on an empty path', () => {
      assert.throws(() => TreeStore.parsePath(''), /empty/i);
    });

    it('throws on an unclosed bracket', () => {
      assert.throws(() => TreeStore.parsePath('a[0'), /invalid/i);
    });

    it('throws on a negative array index', () => {
      assert.throws(() => TreeStore.parsePath('a[-1]'), /invalid array index/i);
    });

    it('throws on a non-numeric array index', () => {
      assert.throws(() => TreeStore.parsePath('a[x]'), /invalid array index/i);
    });
  });


  describe('path navigation edge cases', () => {
    it('accepts pre-parsed segment arrays', () => {
      const store = new TreeStore({ a: { b: [{ c: 'hello' }] } });
      assert.strictEqual(store.get(['a', 'b', 0, 'c']), 'hello');
    });

    it('does not split literal path segments that contain dots (array form)', () => {
      const store = new TreeStore({ core: { 'my.key': 'value' } });
      assert.strictEqual(store.get(['core', 'my.key']), 'value');
    });

    it('returns undefined when traversing into a non-object', () => {
      const store = new TreeStore({ flag: 'true' });
      assert.isUndefined(store.get('flag.nope'));
    });

    it('replaces a scalar intermediate with a container on set', () => {
      const store = new TreeStore({ a: 'scalar' });
      store.set('a.b', 'x');
      assert.deepEqual(store.get('a'), { b: 'x' });
    });

    it('ignores unset of a missing path or out-of-range index', () => {
      const store = new TreeStore({ a: ['x'] });
      assert.doesNotThrow(() => store.unset('a.x.y'));
      store.unset('a[5]');
      assert.deepEqual(store.get('a'), ['x']);
    });
  });
});
