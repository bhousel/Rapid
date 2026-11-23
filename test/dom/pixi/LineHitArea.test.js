import { LineHitArea } from '../../../modules/pixi/lib/LineHitArea.ts';


describe('LineHitArea', () => {
  // A line from [0,0] to [100,0] to [100,50], hit within 5 of it
  const flat = [0, 0, 100, 0, 100, 50];
  const extent = new Rapid.sdk.Extent([0, 0], [100, 50]);

  it('says whether a point is within the distance of the line', () => {
    const hitArea = new LineHitArea(flat, 5, extent);
    assert.isTrue(hitArea.contains(50, 0), 'on the line');
    assert.isTrue(hitArea.contains(50, 4), 'beside it');
    assert.isTrue(hitArea.contains(97, 30), 'beside the second segment');
    assert.isTrue(hitArea.contains(-4, 0), 'past the end, within the distance');
    assert.isFalse(hitArea.contains(50, 8), 'beside it, too far');
    assert.isFalse(hitArea.contains(50, 30), 'inside the box, far from the line');
    assert.isFalse(hitArea.contains(-4, -4), 'past the end, inside the box, too far');
    assert.isFalse(hitArea.contains(500, 500), 'far away');
  });

  it('looks at the line only for a point inside its box', () => {
    let reads = 0;
    const counted = new Proxy(flat, { get: (target, key) => { reads++; return target[key]; } });
    const hitArea = new LineHitArea(counted, 5, extent);
    assert.isFalse(hitArea.contains(500, 500));
    assert.isFalse(hitArea.contains(-20, 0));
    assert.strictEqual(reads, 0);

    assert.isFalse(hitArea.contains(50, 30));    // inside the box: now the line matters
    assert.isAbove(reads, 0);
  });

  it('takes a new distance or a new line', () => {
    const hitArea = new LineHitArea(flat, 5, extent);
    assert.isFalse(hitArea.contains(50, 8));
    assert.isFalse(hitArea.contains(-8, 0));

    hitArea.set(flat, 10, extent);     // as a zoom out does
    assert.isTrue(hitArea.contains(50, 8));
    assert.isTrue(hitArea.contains(-8, 0), 'the box grows with the distance');

    hitArea.set([0, 200, 100, 200], 5, new Rapid.sdk.Extent([0, 200], [100, 200]));
    assert.isFalse(hitArea.contains(50, 0));
    assert.isTrue(hitArea.contains(50, 203));
  });

  it('counts the segment that closes a ring', () => {
    const ring = [0, 0, 100, 0, 100, 100, 0, 100];
    const box = new Rapid.sdk.Extent([0, 0], [100, 100]);
    assert.isFalse(new LineHitArea(ring, 5, box).contains(2, 50), 'open');

    const hitArea = new LineHitArea(ring, 5, box, true);
    assert.isTrue(hitArea.contains(2, 50), 'on the closing segment');
    assert.isTrue(hitArea.contains(50, 2), 'on the edge');
    assert.isFalse(hitArea.contains(50, 50), 'in the middle of the ring');
  });

  it('gives its edge for a halo: one ring around an open line', () => {
    const outline = new LineHitArea(flat, 5, extent).outline();
    assert.isNull(outline.inner);
    assert.strictEqual(outline.outer[0], outline.outer.at(-2));
    assert.strictEqual(outline.outer[1], outline.outer.at(-1));
    const expected = [0, 5, 95, 5, 95, 50];    // 5 to the left of the line
    expected.forEach((value, i) => assert.closeTo(outline.outer[i], value, 1e-9));
  });

  it('gives a closed line a ring outside it and a ring inside it', () => {
    const ring = [0, 0, 100, 0, 100, 100, 0, 100, 0, 0];
    const outline = new LineHitArea(ring, 5, new Rapid.sdk.Extent([0, 0], [100, 100]), true).outline({ join: 'round' });
    const xs = ring => Array.from(ring).filter((_, i) => i % 2 === 0);
    assert.closeTo(Math.min(...xs(outline.outer)), -5, 1e-9);
    assert.closeTo(Math.max(...xs(outline.outer)), 105, 1e-9);
    assert.closeTo(Math.min(...xs(outline.inner)), 5, 1e-9);
    assert.closeTo(Math.max(...xs(outline.inner)), 95, 1e-9);
  });
});
