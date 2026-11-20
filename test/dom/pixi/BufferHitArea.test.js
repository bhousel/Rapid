import { BufferHitArea } from '../../../modules/pixi/lib/BufferHitArea.ts';


describe('BufferHitArea', () => {
  // A line from [0,0] to [100,0] to [100,50], with a buffer 10 wide (5 on each side)
  const flat = [0, 0, 100, 0, 100, 50];
  const extent = new Rapid.sdk.Extent([0, 0], [100, 50]);
  const style = { width: 10, alignment: 0.5, cap: 'butt', join: 'bevel' };

  it('says whether a point is within the line\'s buffer', () => {
    const hitArea = new BufferHitArea(flat, { ...style }, extent);
    assert.isTrue(hitArea.contains(50, 0), 'on the line');
    assert.isTrue(hitArea.contains(50, 4), 'beside it, within the buffer');
    assert.isTrue(hitArea.contains(97, 30), 'beside the second segment');
    assert.isFalse(hitArea.contains(50, 8), 'beside it, outside the buffer');
    assert.isFalse(hitArea.contains(50, 30), 'inside the box, far from the line');
    assert.isFalse(hitArea.contains(500, 500), 'far away');
  });

  it('does not work the buffer out until a point is inside the line\'s box', () => {
    const hitArea = new BufferHitArea(flat, { ...style }, extent);
    assert.isFalse(hitArea.contains(500, 500));
    assert.isFalse(hitArea.contains(-20, 0));
    assert.isNull(hitArea._buffer);

    hitArea.contains(50, 30);    // inside the box: now the shape matters
    assert.isOk(hitArea._buffer);
  });

  it('gives the buffer\'s shape for a halo, and works it out once', () => {
    const hitArea = new BufferHitArea(flat, { ...style }, extent);
    const buffer = hitArea.buffer;
    assert.isAbove(buffer.perimeter.length, 8);
    assert.strictEqual(hitArea.buffer, buffer);
    assert.isUndefined(buffer.inner);    // not a closed line
  });

  it('gives a closed line an outer and an inner edge', () => {
    const ring = [0, 0, 100, 0, 100, 100, 0, 100, 0, 0];
    const hitArea = new BufferHitArea(ring, { ...style }, new Rapid.sdk.Extent([0, 0], [100, 100]));
    assert.isOk(hitArea.buffer.outer);
    assert.isOk(hitArea.buffer.inner);
    assert.isTrue(hitArea.contains(50, 2), 'on the edge');
    assert.isFalse(hitArea.contains(50, 50), 'in the middle of the ring');
  });
});
