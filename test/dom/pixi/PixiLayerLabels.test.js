import * as PIXI from 'pixi.js';
import { AvoidGrid } from '../../../modules/pixi/lib/AvoidGrid.ts';
import { PixiLayerLabels } from '../../../modules/pixi/PixiLayerLabels.ts';


// Labels are placed around the points and vertices. Those mark themselves in the scene's avoid
// grid as they're drawn (see `AbstractPixiFeature.updateAvoid`), and the labels layer places
// against the grid.
describe('PixiLayerLabels', () => {
  let layer, spatial, grid, hits, frees, changed;

  // A stand-in for a point feature drawn 10 px wide at [x, y] of label space
  function pointAt(id, x, y, avoided = true) {
    const cells = avoided ? grid.cellsOf(x, y, x + 10, y + 10) : null;
    if (cells) grid.mark('avoid', cells);
    return {
      id: id, type: 'Point', style: {}, avoidCells: cells,
      container: { visible: true, renderable: true, getBounds: () => new PIXI.Bounds(x, y, x + 10, y + 10) }
    };
  }

  const labelBoxes = () => spatial.getCache('labels').rbush.all().filter(item => item.contents.labelID);
  const MEASURE = { str: 'Cafe', style: 'normal', width: 40, height: 14 };

  beforeEach(() => {
    const context = new Rapid.MockContext();
    spatial = new Rapid.SpatialSystem(context);
    context.systems.spatial = spatial;
    context.getDebug = () => false;

    grid = new AvoidGrid(2);
    hits = [];
    const scene = {
      context: context,
      gfx: {},
      avoidGrid: grid,
      labelOffset: new PIXI.Point(0, 0),
      takeAvoidHits: () => hits.splice(0),
      numAvoidHits: 0,
      takeAvoidFrees: () => frees.splice(0),
      get numAvoidFrees() { return frees.length; },
      takeChangedFeatures: () => new Set(changed.splice(0)),
      features: new Map()
    };
    frees = [];
    changed = [];

    // (The constructor installs a bitmap font, which needs a canvas that draws text.)
    const install = PIXI.BitmapFont.install;
    PIXI.BitmapFont.install = () => {};
    try {
      layer = new PixiLayerLabels(scene);
    } finally {
      PIXI.BitmapFont.install = install;
    }
  });

  describe('placeTextLabel', () => {
    it('places a point\'s label next to the point, though the point itself is something to avoid', () => {
      const point = pointAt('osm-n1', 100, 100);
      layer.placeTextLabel(point, MEASURE);

      const [box] = labelBoxes();
      assert.isOk(box);
      assert.closeTo(box.minX, 111, 1.5);                 // to the right of it
      assert.isTrue(grid.isTaken('label', box.contents.cells));
      assert.isTrue(grid.isTaken('avoid', point.avoidCells));    // and the point is marked again
    });

    it('keeps the label off the other points around it', () => {
      const point = pointAt('osm-n1', 100, 100);
      pointAt('osm-n2', 120, 95);                         // where the label would go: to the right
      layer.placeTextLabel(point, MEASURE);

      const [box] = labelBoxes();
      assert.isOk(box);
      assert.isFalse(grid.isTaken('avoid', box.contents.cells));
      assert.isFalse(box.minX > 110 && box.minY < 106 && box.maxY > 94 && box.minX < 131);   // not over n2
    });

    it('places no label where every place around the point is taken', () => {
      const point = pointAt('osm-n1', 100, 100);
      grid.mark('avoid', grid.cellsOf(0, 0, 300, 98));
      grid.mark('avoid', grid.cellsOf(0, 112, 300, 300));
      grid.mark('avoid', grid.cellsOf(0, 0, 98, 300));
      grid.mark('avoid', grid.cellsOf(112, 0, 300, 300));
      layer.placeTextLabel(point, MEASURE);
      assert.lengthOf(labelBoxes(), 0);
    });

    it('keeps two labels off each other', () => {
      layer.placeTextLabel(pointAt('osm-n1', 100, 100, false), MEASURE);
      layer.placeTextLabel(pointAt('osm-n2', 100, 104, false), MEASURE);
      const [a, b] = labelBoxes();
      assert.isOk(b);
      const overlap = a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
      assert.isFalse(overlap);
    });
  });

  describe('resetFeature', () => {
    it('frees the cells that the feature\'s label had marked', () => {
      const point = pointAt('osm-n1', 100, 100, false);
      layer._labeled.add('osm-n1');
      layer.placeTextLabel(point, MEASURE);
      const cells = labelBoxes()[0].contents.cells;

      layer.resetFeature('osm-n1');
      assert.lengthOf(labelBoxes(), 0);
      assert.isFalse(grid.isTaken('label', cells));
      assert.isFalse(layer._labeled.has('osm-n1'));       // to be labeled again
    });
  });

  // A tile arrives, or a way is selected and gets vertices: something is drawn where a label is.
  describe('resolveAvoidHits', () => {
    it('takes back the label that something was drawn over, and no other', () => {
      layer.placeTextLabel(pointAt('osm-n1', 100, 100, false), MEASURE);
      layer.placeTextLabel(pointAt('osm-n2', 100, 300, false), MEASURE);
      layer._labeled.add('osm-n1').add('osm-n2');
      const [first] = labelBoxes().filter(item => item.contents.featureID === 'osm-n1');

      hits.push(grid.cellsOf(first.minX + 4, first.minY + 2, first.minX + 12, first.maxY - 2));   // a pin lands on it
      layer.resolveAvoidHits();
      assert.deepEqual(labelBoxes().map(item => item.contents.featureID), ['osm-n2']);
      assert.isFalse(layer._labeled.has('osm-n1'));
      assert.isTrue(layer._labeled.has('osm-n2'));
    });
  });

  // A feature is only looked at again when it changes, so one that found no room has to be told
  // when room is made.
  describe('_retryUnplaced', () => {
    it('tries a feature again when what was in its way is gone, and leaves the others', () => {
      layer._labeled.add('osm-w1').add('osm-w2');
      layer._unplaced.set('osm-w1', [100, 100, 300, 120]);
      layer._unplaced.set('osm-w2', [100, 500, 300, 520]);

      frees.push(grid.cellsOf(200, 104, 210, 114));        // a vertex along w1 is hidden
      layer._retryUnplaced();
      assert.isTrue(layer._pending.has('osm-w1'));
      assert.isFalse(layer._labeled.has('osm-w1'));
      assert.isFalse(layer._unplaced.has('osm-w1'));
      assert.isFalse(layer._pending.has('osm-w2'));
      assert.isTrue(layer._unplaced.has('osm-w2'));
    });

    it('tries a feature again where a label was taken away', () => {
      layer.placeTextLabel(pointAt('osm-n1', 100, 100, false), MEASURE);
      layer._labeled.add('osm-n1').add('osm-w1');
      layer._unplaced.set('osm-w1', [0, 90, 400, 130]);

      layer.resetFeature('osm-n1');
      layer._pending.clear();
      layer._retryUnplaced();
      assert.isTrue(layer._pending.has('osm-w1'));
    });

    it('asks for a frame while room was made and something waits for it', () => {
      assert.strictEqual(layer.numWaiting, 0);
      frees.push(grid.cellsOf(200, 104, 210, 114));
      assert.strictEqual(layer.numWaiting, 0);             // nothing is waiting for room
      layer._unplaced.set('osm-w1', [100, 100, 300, 120]);
      assert.strictEqual(layer.numWaiting, 1);
    });
  });

  describe('labelPoints', () => {
    it('remembers a point that got no room for its label', () => {
      layer.measureLabel = () => MEASURE;
      layer.scene.worldToLabel = (x, y, out) => { out[0] = 105; out[1] = 105; return out; };
      grid.mark('avoid', grid.cellsOf(0, 0, 400, 400));    // everything around it is taken
      const point = pointAt('osm-n1', 100, 100);
      point.label = 'Cafe';
      point.geometry = { world: { origin: [0, 0] } };
      point.container.position = { y: 0 };

      layer.labelPoints([point]);
      assert.lengthOf(labelBoxes(), 0);
      assert.isTrue(layer._unplaced.has('osm-n1'));
    });
  });
});
