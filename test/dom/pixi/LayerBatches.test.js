import * as PIXI from 'pixi.js';
import { BatchShaders } from '../../../modules/pixi/lib/BatchShaders.ts';
import { FillBatchMesh } from '../../../modules/pixi/lib/FillBatchMesh.ts';
import { LayerBatches } from '../../../modules/pixi/lib/LayerBatches.ts';
import { LineBatchMesh } from '../../../modules/pixi/lib/LineBatchMesh.ts';
import { PointBatchMesh } from '../../../modules/pixi/lib/PointBatchMesh.ts';


// A layer's batches: at most one of each kind in each container. (How the OSM layer uses them,
// with its levels and tiles, is in `PixiLayerOsm.test.js`.)
describe('LayerBatches', () => {
  let shaders, batches, levelA, levelB, polygons, points;

  beforeEach(() => {
    shaders = new BatchShaders();
    batches = new LayerBatches(shaders);
    levelA = new PIXI.Container();
    levelB = new PIXI.Container();
    polygons = new PIXI.Container();
    points = new PIXI.Container();
  });
  afterEach(() => {
    for (const container of [levelA, levelB, polygons, points]) {
      container.destroy({ children: true });
    }
    shaders.destroy();
  });


  it('makes each batch with its kind\'s shader, where its coordinates start at the first thing it\'s wanted for', () => {
    const strokes = batches.lineBatch(levelA, false, [100, 200]);
    const fills = batches.fillBatch(polygons, [5, 5]);
    const outlines = batches.outlineBatch(polygons, [5, 5]);
    const pointBatch = batches.pointBatch(points, [7, 8]);

    assert.instanceOf(strokes, LineBatchMesh);
    assert.instanceOf(fills, FillBatchMesh);
    assert.instanceOf(pointBatch, PointBatchMesh);
    assert.strictEqual(strokes.shader, shaders.lines);
    assert.strictEqual(outlines.shader, shaders.lines);
    assert.strictEqual(fills.shader, shaders.fills);
    assert.strictEqual(pointBatch.shader, shaders.points);
    assert.strictEqual(strokes.glows.shader, shaders.lines);
    assert.strictEqual(pointBatch.glows.shader, shaders.points);
    assert.deepEqual([strokes.position.x, strokes.position.y], [100, 200]);
    assert.deepEqual([pointBatch.position.x, pointBatch.position.y], [7, 8]);
  });

  it('keeps one batch of a kind in each container', () => {
    const a = batches.lineBatch(levelA, false, [0, 0]);
    const b = batches.lineBatch(levelB, false, [0, 0]);
    assert.notStrictEqual(a, b);
    assert.strictEqual(batches.lineBatch(levelA, false, [9000, 9000]), a);
    assert.strictEqual(a.parent, levelA);
    assert.strictEqual(b.parent, levelB);
    assert.sameMembers(batches.lines, [a, b]);

    const fillsA = batches.fillBatch(levelA, [0, 0]);
    assert.notStrictEqual(batches.fillBatch(polygons, [0, 0]), fillsA);
  });

  it('lists the batches by what they draw, without their glows', () => {
    const casings = batches.lineBatch(levelA, true, [0, 0]);
    const strokes = batches.lineBatch(levelA, false, [0, 0]);
    const fills = batches.fillBatch(polygons, [0, 0]);
    const outlines = batches.outlineBatch(polygons, [0, 0]);
    const pointBatch = batches.pointBatch(points, [0, 0]);
    assert.sameMembers(batches.lines, [casings, strokes]);
    assert.sameMembers(batches.polygons, [fills, outlines]);
    assert.deepEqual(batches.points, [pointBatch]);
  });

  it('moves every batch and its glows to the view when the view has gone far', () => {
    const strokes = batches.lineBatch(levelA, false, [1000, 1000]);
    const pointBatch = batches.pointBatch(points, [1000, 1000]);
    const viewport = { transform: { zoom: 19 }, center: () => [0, 0], screenToWorld: () => [41000, 1000] };    // 320,000 pixels away
    batches.followView(viewport);
    for (const batch of [strokes, strokes.glows, pointBatch, pointBatch.glows]) {
      assert.deepEqual([batch.position.x, batch.position.y], [41000, 1000]);
    }
  });

  it('destroys what has emptied, with its glows, and forgets a container with nothing left', () => {
    const strokes = batches.lineBatch(levelA, false, [0, 0]);
    const glows = strokes.glows;
    const waitedFor = batches.lineBatch(levelB, false, [0, 0]);
    waitedFor.users = 1;     // a feature got it, and isn't drawn yet
    batches.removeEmpty();
    assert.isTrue(strokes.destroyed);
    assert.isTrue(glows.destroyed);
    assert.isFalse(waitedFor.destroyed);
    assert.isFalse(batches._byContainer.has(levelA));
    assert.isTrue(batches._byContainer.has(levelB));
    assert.notStrictEqual(batches.lineBatch(levelA, false, [0, 0]), strokes, 'a new one when it is wanted again');
  });

  it('makes another in place of one that was destroyed with its container, and forgets them all on a reset', () => {
    const fills = batches.fillBatch(polygons, [0, 0]);
    fills.destroy();
    const again = batches.fillBatch(polygons, [0, 0]);
    assert.notStrictEqual(again, fills);
    assert.deepEqual(batches.polygons, [again]);

    batches.forget();
    assert.isEmpty(batches.polygons);
    assert.isFalse(again.destroyed, 'forgotten, not destroyed: its container goes with it');
  });
});
