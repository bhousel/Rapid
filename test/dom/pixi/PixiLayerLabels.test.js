import * as PIXI from 'pixi.js';
import { PixiLayerLabels } from '../../../modules/pixi/PixiLayerLabels.ts';


describe('PixiLayerLabels', () => {
  let layer, spatial, points;

  // A stand-in for a point feature's container, 10 px wide at [x, y], linked back to its feature
  function addPoint(parent, id, x, y, dirty = false) {
    const container = new PIXI.Container();
    container.label = id;
    container.__feature__ = { id: id, dirty: dirty };
    container.getBounds = () => ({ rectangle: new PIXI.Rectangle(x, y, 10, 10) });
    parent.addChild(container);
    return container;
  }

  const avoidIDs = () => spatial.getCache('labels').rbush.all().filter(item => item.contents.type === 'avoid').map(item => item.contents.featureID).sort();

  beforeEach(() => {
    const context = new Rapid.MockContext();
    spatial = new Rapid.SpatialSystem(context);
    context.systems.spatial = spatial;
    context.getDebug = () => false;

    points = new PIXI.Container();     // `points/osm`: what a layer puts its points in
    const scene = {
      context: context,
      gfx: {},
      layers: new Map([['map-ui', { selected: new PIXI.Container() }]]),
      groups: new Map([['points', new PIXI.Container()]]),
      worldContainersIn: () => [points]
    };
    // (The constructor installs a bitmap font, which needs a canvas that draws text.)
    const install = PIXI.BitmapFont.install;
    PIXI.BitmapFont.install = () => {};
    try {
      layer = new PixiLayerLabels(scene);
    } finally {
      PIXI.BitmapFont.install = install;
    }
  });

  // Labels are placed around the points and vertices, so each of those gets a box to avoid.
  describe('gatherAvoids', () => {
    it('makes a box for each point, where the point is', () => {
      addPoint(points, 'osm-n1', 100, 50);
      layer.gatherAvoids();
      assert.deepEqual(avoidIDs(), ['osm-n1']);
      assert.lengthOf(spatial.getItemsAtBox('labels', { minX: 102, minY: 52, maxX: 104, maxY: 54 }), 1);
      assert.lengthOf(spatial.getItemsAtBox('labels', { minX: 200, minY: 52, maxX: 204, maxY: 54 }), 0);
    });

    it('finds the points in a layer\'s own containers, however deep', () => {
      // The OSM layer has a container per map tile, each inside a render group
      const group = new PIXI.Container({ isRenderGroup: true });
      const tile = new PIXI.Container();
      group.label = tile.label = '0,0,16';
      group.addChild(tile);
      points.addChild(group);
      addPoint(tile, 'osm-n1', 100, 50);
      addPoint(tile, 'osm-n2', 300, 50);
      addPoint(points, 'osm-n3', 500, 50);

      layer.gatherAvoids();
      assert.deepEqual(avoidIDs(), ['osm-n1', 'osm-n2', 'osm-n3']);     // not one box for the tile
    });

    it('leaves a point that is waiting to be drawn for later, and takes it once it is drawn', () => {
      const waiting = addPoint(points, 'osm-n1', 0, 0, true);    // not where it will be yet
      addPoint(points, 'osm-n2', 300, 50);
      layer.gatherAvoids();
      assert.deepEqual(avoidIDs(), ['osm-n2']);

      waiting.__feature__.dirty = false;
      waiting.getBounds = () => ({ rectangle: new PIXI.Rectangle(100, 50, 10, 10) });
      layer.gatherAvoids();
      assert.deepEqual(avoidIDs(), ['osm-n1', 'osm-n2']);
      assert.lengthOf(spatial.getItemsAtBox('labels', { minX: 102, minY: 52, maxX: 104, maxY: 54 }), 1);
    });

    it('skips what is hidden, and everything in a hidden container', () => {
      const hidden = new PIXI.Container();
      hidden.visible = false;
      points.addChild(hidden);
      addPoint(hidden, 'osm-n1', 100, 50);
      addPoint(points, 'osm-n2', 300, 50).visible = false;
      layer.gatherAvoids();
      assert.deepEqual(avoidIDs(), []);
    });

    it('takes back a label that a new point lands on', () => {
      spatial.addItems('labels', { id: 'osm-w1-0-0', contents: { type: 'label', featureID: 'osm-w1', labelID: 'osm-w1-rope-0' }, minX: 95, minY: 45, maxX: 115, maxY: 65 });
      layer._labeled.add('osm-w1');
      layer._featureBoxes.set('osm-w1', new Set(['osm-w1-0-0']));
      addPoint(points, 'osm-n1', 100, 50);

      layer.gatherAvoids();
      assert.isFalse(layer._labeled.has('osm-w1'));     // to be labeled again, somewhere else
      assert.isFalse(spatial.hasItem('labels', 'osm-w1-0-0'));
    });
  });
});
