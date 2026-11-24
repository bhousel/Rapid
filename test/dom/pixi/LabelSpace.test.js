import * as PIXI from 'pixi.js';
import { LabelSpace } from '../../../modules/pixi/lib/LabelSpace.ts';


// Label space is the screen minus an offset that moves with the map, so a pan changes nothing
// in it. The scene works it out once a frame (`update`), and the label space owns the grid of
// what labels avoid, and what the labels layer is told.
describe('LabelSpace', () => {
  function makeSpace() {
    const stage = new PIXI.Container();
    const origin = new PIXI.Container();
    stage.addChild(origin);
    return { space: new LabelSpace(), stage, origin };
  }
  const viewportAt = (x, y) => ({ transform: { translation: [x, y] } });

  it('gives a world coordinate the same label coordinates however the map is panned', () => {
    const { space, origin } = makeSpace();
    origin.scale.set(2, 2);
    origin.position.set(-1000, -500);
    space.update(origin, viewportAt(300, 200));
    const before = space.worldToLabel(600, 400, [0, 0]).slice();

    origin.position.set(-1000 + 37, -500 - 12);       // a pan moves `origin`, and nothing else
    space.update(origin, viewportAt(300, 200));
    const after = space.worldToLabel(600, 400, [0, 0]);
    assert.closeTo(after[0], before[0], 1e-6);
    assert.closeTo(after[1], before[1], 1e-6);
  });

  it('puts two world coordinates as far apart as they are on screen, also when the map is turned', () => {
    const { space, stage, origin } = makeSpace();
    origin.scale.set(2, 2);
    stage.rotation = Math.PI / 2;
    space.update(origin, viewportAt(0, 0));
    const a = space.worldToLabel(100, 100, [0, 0]).slice();
    const b = space.worldToLabel(110, 100, [0, 0]);     // 10 world units east, 20 px on screen
    assert.closeTo(b[0] - a[0], 0, 1e-6);               // which is down, a quarter turn on
    assert.closeTo(b[1] - a[1], 20, 1e-6);
  });

  it('empties the avoid grid when it starts again (a new zoom or rotation)', () => {
    const { space } = makeSpace();
    const cells = space.avoidGrid.cellsOf(0, 0, 10, 10);
    space.avoidGrid.mark('avoid', cells);
    space.avoidHit(cells);
    const generation = space.avoidGrid.generation;

    space.reset();
    assert.isFalse(space.avoidGrid.isTaken('avoid', cells));
    assert.isAbove(space.avoidGrid.generation, generation);
    assert.strictEqual(space.numAvoidHits, 0);
  });

  it('hands over where something was drawn over a label, once', () => {
    const { space } = makeSpace();
    space.avoidHit([1, 2, 3, 4]);
    assert.strictEqual(space.numAvoidHits, 1);
    assert.deepEqual(space.takeAvoidHits(), [[1, 2, 3, 4]]);
    assert.deepEqual(space.takeAvoidHits(), []);
  });

  it('hands over where something to avoid has left, once, and forgets it when it starts again', () => {
    const { space } = makeSpace();
    space.avoidFreed([1, 2, 3, 4]);
    assert.strictEqual(space.numAvoidFrees, 1);
    assert.deepEqual(space.takeAvoidFrees(), [[1, 2, 3, 4]]);
    assert.deepEqual(space.takeAvoidFrees(), []);

    space.avoidFreed([1, 2, 3, 4]);
    space.reset();
    assert.strictEqual(space.numAvoidFrees, 0);
  });

  it('hands over the features that changed, each once', () => {
    const { space } = makeSpace();
    space.featureChanged({ id: 'osm-w1' });
    space.featureChanged({ id: 'osm-n1' });
    space.featureChanged({ id: 'osm-w1' });
    assert.deepEqual([...space.takeChangedFeatures()], ['osm-w1', 'osm-n1']);
    assert.strictEqual(space.takeChangedFeatures().size, 0);
  });
});
