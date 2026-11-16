import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('PersistentVector', () => {
  const { vectorDiff, vectorEmpty, vectorForEach, vectorGet, vectorSet } = Rapid;

  it('gets what was set, across levels', () => {
    const owner = {};
    let v = vectorEmpty();
    for (const slot of [0, 5, 31, 32, 1023, 1024, 40000, 2000000]) {
      v = vectorSet(v, slot, `s${slot}`, owner);
    }
    for (const slot of [0, 5, 31, 32, 1023, 1024, 40000, 2000000]) {
      assert.strictEqual(vectorGet(v, slot), `s${slot}`);
    }
    assert.isUndefined(vectorGet(v, 1));
    assert.isUndefined(vectorGet(v, 3000000));
  });

  it('leaves an older version unchanged when another owner sets a slot', () => {
    const v1 = vectorSet(vectorEmpty(), 3, 'a', {});
    const v2 = vectorSet(v1, 3, 'b', {});
    assert.strictEqual(vectorGet(v1, 3), 'a');
    assert.strictEqual(vectorGet(v2, 3), 'b');
  });

  it('changes nodes in place for their owner', () => {
    const owner = {};
    const v1 = vectorSet(vectorEmpty(), 3, 'a', owner);
    const v2 = vectorSet(v1, 4, 'b', owner);
    assert.strictEqual(v2.root, v1.root);
    assert.strictEqual(vectorGet(v1, 4), 'b');   // same nodes
  });

  it('returns the same version when nothing changes', () => {
    const v1 = vectorSet(vectorEmpty(), 3, 'a', {});
    assert.strictEqual(vectorSet(v1, 3, 'a', {}), v1);
  });

  it('returns the same version when clearing an empty slot', () => {
    const empty = vectorEmpty();
    assert.strictEqual(vectorSet(empty, 3, undefined, {}), empty);

    const v1 = vectorSet(empty, 3, 'a', {});
    assert.strictEqual(vectorSet(v1, 4, undefined, {}), v1);        // same leaf
    assert.strictEqual(vectorSet(v1, 500, undefined, {}), v1);      // past the tree's capacity
    assert.notStrictEqual(vectorSet(v1, 3, undefined, {}), v1);     // a real clear still writes
  });

  it('diffs only the slots that differ', () => {
    let v1 = vectorEmpty();
    for (let slot = 0; slot < 5000; slot++) {
      v1 = vectorSet(v1, slot, slot, {});
    }
    let v2 = vectorSet(v1, 17, 'x', {});
    v2 = vectorSet(v2, 4321, 'y', {});
    v2 = vectorSet(v2, 70000, 'z', {});   // grows a level

    const found = [];
    vectorDiff(v1, v2, (slot, a, b) => found.push([slot, a, b]));
    assert.deepEqual(found, [[17, 17, 'x'], [4321, 4321, 'y'], [70000, undefined, 'z']]);
  });

  it('visits every slot with a value', () => {
    const owner = {};
    let v = vectorEmpty();
    for (const slot of [2, 40, 1500]) {
      v = vectorSet(v, slot, slot * 10, owner);
    }
    const seen = [];
    vectorForEach(v, (slot, value) => seen.push([slot, value]));
    assert.deepEqual(seen, [[2, 20], [40, 400], [1500, 15000]]);
  });
});
