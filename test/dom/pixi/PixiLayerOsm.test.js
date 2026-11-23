import * as PIXI from 'pixi.js';
import { PixiLayerOsm } from '../../../modules/pixi/PixiLayerOsm.ts';
import { PixiScene } from '../../../modules/pixi/PixiScene.ts';
import { RenderFrame } from '../../../modules/pixi/RenderFrame.ts';


describe('PixiLayerOsm', () => {

  // Rendering needs WebGL, so this drives `renderMidpoints` on a layer with stubbed Pixi parts:
  // the features already exist, and `_gatherMidpoints` returns the midpoints for each frame.
  function makeLayer(context, framesOfMidpoints) {
    const scene = { context: context, gfx: {}, layers: new Map([['map-ui', { selected: null }]]) };
    const layer = new PixiLayerOsm(scene);
    layer.syncFeatureClasses = () => {};
    layer.retainFeature = () => {};

    // One stand-in feature per midpoint, with what `renderMidpoints` uses
    const features = new Map();
    layer.features = {
      get: featureID => {
        if (!features.has(featureID)) {
          features.set(featureID, {
            data: null, geometry: null, dirty: false, update: () => {},
            labelAvoid: false, updateAvoid: function() { this.avoidUpdates = (this.avoidUpdates ?? 0) + 1; },
            addChildData: (parentID, childIDs) => layer.addChildData(parentID, childIDs)
          });
        }
        return features.get(featureID);
      }
    };

    let frame = 0;
    layer._gatherMidpoints = () => framesOfMidpoints[frame++];
    return layer;
  }

  // What's related to the selection: nothing is selected, so nothing is there to be grabbed
  const RELATED = { descendantIDs: new Set(), siblingIDs: new Set(), handleIDs: new Set() };

  function midpointProps(id, loc, wayID = 'w1', edge = ['n1', 'n2']) {
    return { type: 'midpoint', serviceID: 'osm', isNew: true, id: id, wayID: wayID, edge: edge,
      dist: Infinity, rotation: 0, coord: Rapid.sdk.projWgs84ToWorld(loc), loc: loc };
  }

  // Pixi's hit test asks every feature in the scene. The layer asks the editor's spatial index
  // which entities are near the pointer, and then only their features.
  describe('hitTest', () => {
    let context, layer, boxes, nearby, stage;

    // A stand-in feature: it's hit or it isn't, and it's drawn in the order it was added.
    function addFeature(featureID, dataID, isHit) {
      const container = new PIXI.Container();
      stage.addChild(container);
      const feature = { id: featureID, container: container, asked: 0, hitTest: () => { feature.asked++; return isHit; } };
      layer.features.set(featureID, feature);
      layer.bindData(featureID, dataID);
      layer._numVisible++;
      return feature;
    }

    beforeEach(() => {
      context = new Rapid.MockContext();
      boxes = [];
      nearby = [];
      context.systems = {
        editor: {
          staging: { graph: {} },
          entitiesInBox: box => { boxes.push(box); return nearby.map(id => ({ dataID: id })); }
        }
      };
      layer = new PixiLayerOsm({ context: context, gfx: {}, layers: new Map() });
      stage = new PIXI.Container();
    });

    it('asks the index for the entities within reach of the pointer, in world coordinates', () => {
      addFeature('osm-w1-0', 'w1', true);
      context.viewport.transform = { x: 0, y: 0, z: 18 };

      layer._hitReach = 28;   // the furthest a feature drawn so far can be hit from its geometry: a pin's height

      layer.hitTest({ x: 300, y: 200 }, { x: 1000, y: 2000 });
      assert.lengthOf(boxes, 1);
      const reach = (28 + 4) / 4;   // that and a margin, in pixels, at two zooms above the world's
      assert.deepEqual(boxes[0], { minX: 1000 - reach, minY: 2000 - reach, maxX: 1000 + reach, maxY: 2000 + reach });
    });

    it('asks only the features of those entities, and returns the one that\'s hit', () => {
      const near = addFeature('osm-w1-0', 'w1', true);
      const far = addFeature('osm-w2-0', 'w2', true);
      nearby = ['w1', 'n5'];    // n5 is a vertex with no feature

      assert.strictEqual(layer.hitTest({ x: 0, y: 0 }, { x: 0, y: 0 }), near);
      assert.strictEqual(near.asked, 1);
      assert.strictEqual(far.asked, 0);
    });

    it('returns the feature drawn on top when several are hit', () => {
      const area = addFeature('osm-w1-0', 'w1', true);
      const pin = addFeature('osm-w1-poi-0', 'w1', false);    // the same entity's pin, not under the pointer
      const road = addFeature('osm-w2-0', 'w2', true);
      const missed = addFeature('osm-w3-0', 'w3', false);     // drawn last, but not hit
      nearby = ['w2', 'w3', 'w1'];

      assert.strictEqual(layer.hitTest({ x: 0, y: 0 }, { x: 0, y: 0 }), road);
      assert.strictEqual(area.asked + pin.asked + road.asked + missed.asked, 4);

      stage.addChild(area.container);   // now the area is drawn last
      assert.strictEqual(layer.hitTest({ x: 0, y: 0 }, { x: 0, y: 0 }), area);
    });

    it('returns null when nothing near the pointer is hit, and doesn\'t ask the index when nothing is shown', () => {
      nearby = ['w1'];
      assert.isNull(layer.hitTest({ x: 0, y: 0 }, { x: 0, y: 0 }));
      assert.lengthOf(boxes, 0);    // no features are visible

      addFeature('osm-w1-0', 'w1', false);
      assert.isNull(layer.hitTest({ x: 0, y: 0 }, { x: 0, y: 0 }));
      assert.lengthOf(boxes, 1);
    });
  });


  it('reuses the midpoints it drew last frame and forgets the ones it no longer draws', () => {
    const context = new Rapid.MockContext();
    const viewport = new Rapid.sdk.Viewport();
    const a = midpointProps('a', [0, 0]);
    const b = midpointProps('b', [0.001, 0]);
    const c = midpointProps('c', [0.002, 0]);
    const layer = makeLayer(context, [[a, b], [a, c]]);

    layer.renderMidpoints(1, viewport, {}, RELATED);
    const first = layer._midpoints.get('a');
    assert.isOk(first);
    assert.sameMembers([...layer._midpoints.keys()], ['a', 'b']);

    layer.renderMidpoints(2, viewport, {}, RELATED);
    assert.strictEqual(layer._midpoints.get('a'), first);   // same MarkerData reused
    assert.sameMembers([...layer._midpoints.keys()], ['a', 'c']);   // 'b' dropped, map stays bounded
    assert.sameMembers([...layer.getSelfAndDescendants('w1')], ['w1', 'a', 'c']);   // and unlinked from its way
  });

  it('makes a new midpoint when its segment now belongs to another way (after a merge or split)', () => {
    const context = new Rapid.MockContext();
    const viewport = new Rapid.sdk.Viewport();
    const before = midpointProps('a', [0, 0], 'w1');
    const after = midpointProps('a', [0, 0], 'w2');   // same segment, same key
    const layer = makeLayer(context, [[before], [after]]);

    layer.renderMidpoints(1, viewport, {}, RELATED);
    const first = layer._midpoints.get('a');
    layer.renderMidpoints(2, viewport, {}, RELATED);
    const second = layer._midpoints.get('a');

    assert.notStrictEqual(second, first);
    assert.strictEqual(second.props.wayID, 'w2');
    assert.strictEqual(layer.features.get('osm-midpoint-a').data, second);   // dragging it finds w2
    assert.sameMembers([...layer.getSelfAndAncestors('a')], ['a', 'w2']);
  });

  it('makes a new midpoint when its segment has other nodes', () => {
    const context = new Rapid.MockContext();
    const viewport = new Rapid.sdk.Viewport();
    const layer = makeLayer(context, [
      [midpointProps('a', [0, 0], 'w1', ['n1', 'n2'])],
      [midpointProps('a', [0, 0], 'w1', ['n1', 'n3'])]
    ]);

    layer.renderMidpoints(1, viewport, {}, RELATED);
    layer.renderMidpoints(2, viewport, {}, RELATED);
    assert.deepEqual(layer._midpoints.get('a').props.edge, ['n1', 'n3']);
  });

  it('links a midpoint to its way again after the way\'s redraw replaced its links', () => {
    const context = new Rapid.MockContext();
    const viewport = new Rapid.sdk.Viewport();
    const a = midpointProps('a', [0, 0]);
    const layer = makeLayer(context, [[a], [a]]);

    layer.renderMidpoints(1, viewport, {}, RELATED);
    layer.clearChildData('w1');                     // what `renderLines` does when the way changes
    layer.addChildData('w1', ['n1', 'n2']);
    layer.renderMidpoints(2, viewport, {}, RELATED);

    assert.sameMembers([...layer.getSelfAndDescendants('w1')], ['w1', 'n1', 'n2', 'a']);
  });


  // Polygons are split into containers by map tile, so a change to one polygon makes Pixi rebuild
  // one tile's instructions (see "Render groups" in `design/scene.md`).
  describe('polygon tiles', () => {
    let layer;

    beforeEach(() => {
      const context = new Rapid.MockContext();
      const scene = { context: context, gfx: {}, _anchor: [0, 0], _worldContainers: new Set() };
      for (const name of ['worldContainer', 'worldContainersIn', 'destroyWorldContainer']) {
        scene[name] = PixiScene.prototype[name];
      }
      layer = new PixiLayerOsm(scene);
      layer.polygonContainer = scene.worldContainer(new PIXI.Container(), 'polygons');
    });

    // A polygon's geometry, as far as `_polygonTileContainer` looks: its extent in world coordinates
    const part = (min, max) => ({ world: { extent: new Rapid.sdk.Extent(min, max) } });

    it('puts polygons whose centers are in the same tile in one container', () => {
      // At zoom 16 a tile is 256 world units wide
      const a = layer._polygonTileContainer(part([10, 10], [20, 20]), 16);
      const b = layer._polygonTileContainer(part([200, 100], [250, 140]), 16);
      const c = layer._polygonTileContainer(part([260, 10], [270, 20]), 16);   // the next tile east
      assert.strictEqual(a, b);
      assert.notStrictEqual(a, c);
      assert.strictEqual(a.label, '0,0,16');
      assert.strictEqual(c.label, '1,0,16');
      assert.isTrue(a.parent.isRenderGroup);
    });

    it('goes by the center of a polygon that crosses a tile edge', () => {
      const container = layer._polygonTileContainer(part([200, 10], [290, 20]), 16);   // center x = 245
      assert.strictEqual(container.label, '0,0,16');
    });

    it('uses smaller tiles at a higher zoom', () => {
      const a = layer._polygonTileContainer(part([10, 10], [20, 20]), 17);     // 128 units wide
      const b = layer._polygonTileContainer(part([200, 100], [250, 120]), 17);
      assert.strictEqual(a.label, '0,0,17');
      assert.strictEqual(b.label, '1,0,17');
    });

    it('puts a polygon bigger than a tile in the `large` container, drawn below the tiles', () => {
      const wide = layer._polygonTileContainer(part([0, 0], [300, 20]), 16);
      const tall = layer._polygonTileContainer(part([0, 0], [20, 300]), 16);
      const small = layer._polygonTileContainer(part([0, 0], [20, 20]), 16);
      assert.strictEqual(wide.label, 'large');
      assert.strictEqual(tall, wide);
      assert.isBelow(wide.parent.zIndex, small.parent.zIndex);
    });

    it('orders the tiles by row and then by column, whatever order they were made in', () => {
      const southEast = layer._polygonTileContainer(part([260, 260], [270, 270]), 16);   // made first
      const northEast = layer._polygonTileContainer(part([260, 10], [270, 20]), 16);
      const northWest = layer._polygonTileContainer(part([10, 10], [20, 20]), 16);
      assert.isBelow(northWest.parent.zIndex, northEast.parent.zIndex);
      assert.isBelow(northEast.parent.zIndex, southEast.parent.zIndex);
    });
  });


  // Lines and points are split the same way, without changing the order they're drawn in:
  // lines by road class first, points from north to south.
  describe('line and point tiles', () => {
    let layer, level;

    beforeEach(() => {
      const context = new Rapid.MockContext();
      const scene = { context: context, gfx: {}, _anchor: [0, 0], _worldContainers: new Set() };
      for (const name of ['worldContainer', 'worldContainersIn', 'destroyWorldContainer']) {
        scene[name] = PixiScene.prototype[name];
      }
      layer = new PixiLayerOsm(scene);
      level = scene.worldContainer(new PIXI.Container(), '0');
      layer.pointContainer = scene.worldContainer(new PIXI.Container(), 'points');
    });

    const part = (min, max) => ({ world: { extent: new Rapid.sdk.Extent(min, max) } });
    const pointAt = (x, y) => part([x, y], [x, y]);

    it('puts lines of one road class whose centers are in the same tile in one container', () => {
      const a = layer._lineTileContainer(level, -9, part([10, 10], [20, 20]), 16);
      const b = layer._lineTileContainer(level, -9, part([200, 100], [250, 140]), 16);
      const otherTile = layer._lineTileContainer(level, -9, part([260, 10], [270, 20]), 16);
      const otherClass = layer._lineTileContainer(level, -8, part([10, 10], [20, 20]), 16);
      assert.strictEqual(a, b);
      assert.notStrictEqual(a, otherTile);
      assert.notStrictEqual(a, otherClass);
      assert.strictEqual(a.label, '-9/0,0,16');
      assert.strictEqual(a.parent.parent, level);
      assert.isTrue(a.parent.isRenderGroup);
    });

    it('keeps the order between road classes, wherever their tiles are', () => {
      const footwayFarSouth = layer._lineTileContainer(level, -20, part([900, 900], [910, 910]), 16);
      const residential = layer._lineTileContainer(level, -9, part([10, 10], [20, 20]), 16);
      const residentialLong = layer._lineTileContainer(level, -9, part([0, 0], [600, 20]), 16);
      const tertiary = layer._lineTileContainer(level, -8, part([10, 10], [20, 20]), 16);
      const fence = layer._lineTileContainer(level, 0, part([10, 10], [20, 20]), 16);
      const order = [footwayFarSouth, residentialLong, residential, tertiary, fence].map(c => c.parent.zIndex);
      assert.deepEqual(order, order.slice().sort((a, b) => a - b));
      assert.strictEqual(new Set(order).size, 5);
      assert.strictEqual(residentialLong.label, '-9/large');   // below the tiles of its class, above the class below
    });

    // The casings and strokes of lines are drawn in batches (`LineBatch`): one for a road class
    // and a map tile of zoom 14, which is 1,024 world units wide, whatever the view's zoom.
    describe('line batches', () => {
      const lineAt = (min, max) => ({ world: { extent: new Rapid.sdk.Extent(min, max), origin: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2] } });

      it('puts lines of one road class whose centers are in the same zoom 14 tile in one batch, in the level\'s container', () => {
        const a = layer._lineBatch(level, -9, lineAt([10, 10], [20, 20]));
        const b = layer._lineBatch(level, -9, lineAt([900, 100], [950, 140]));    // four of the lines' own tiles away
        const otherTile = layer._lineBatch(level, -9, lineAt([1030, 10], [1040, 20]));
        const otherClass = layer._lineBatch(level, -8, lineAt([10, 10], [20, 20]));
        const otherLevel = layer._lineBatch(new PIXI.Container(), -9, lineAt([10, 10], [20, 20]));
        assert.strictEqual(a, b);
        assert.notStrictEqual(a, otherTile);
        assert.notStrictEqual(a, otherClass);
        assert.notStrictEqual(a, otherLevel);
        assert.strictEqual(a.label, 'batch/-9/0,0');
        assert.strictEqual(a.parent, level);
      });

      it('starts a batch\'s coordinates near its lines: the middle of its tile, or the first of the large lines', () => {
        const inTile = layer._lineBatch(level, -9, lineAt([1030, 2050], [1040, 2060]));
        assert.deepEqual([inTile.position.x, inTile.position.y], [1536, 2560]);

        const large = layer._lineBatch(level, -9, lineAt([5000, 5000], [7000, 5100]));
        const alsoLarge = layer._lineBatch(level, -9, lineAt([100, 100], [1200, 200]));
        assert.strictEqual(large, alsoLarge);
        assert.strictEqual(large.label, 'batch/-9/large');
        assert.deepEqual([large.position.x, large.position.y], [6000, 5050]);
      });

      it('draws a class\'s batches below its containers and above everything of the class below, the large one first', () => {
        const footwayTile = layer._lineTileContainer(level, -20, part([900, 900], [910, 910]), 16).parent.zIndex;
        const below = layer._lineTileContainer(level, -10, part([65000, 65000], [65010, 65010]), 16).parent.zIndex;   // the last tile there is
        const large = layer._lineBatch(level, -9, lineAt([0, 0], [3000, 20])).zIndex;
        const first = layer._lineBatch(level, -9, lineAt([10, 10], [20, 20])).zIndex;
        const second = layer._lineBatch(level, -9, lineAt([1030, 10], [1040, 20])).zIndex;
        const ownLarge = layer._lineTileContainer(level, -9, part([0, 0], [600, 20]), 16).parent.zIndex;
        const ownTile = layer._lineTileContainer(level, -9, part([10, 10], [20, 20]), 16).parent.zIndex;

        const order = [footwayTile, below, large, first, second, ownLarge, ownTile];
        assert.deepEqual(order, order.slice().sort((a, b) => a - b));
        assert.strictEqual(new Set(order).size, order.length);
      });

      it('destroys a batch that has no lines and no feature waiting to draw in it', () => {
        const stroke = Rapid.geomStrokeMesh([0, 0, 10, 0]);
        const style = { width: 3, minWidth: 2, color: 0xffffff, alpha: 1 };

        const used = layer._lineBatch(level, -9, lineAt([10, 10], [20, 20]));
        used.add(stroke, 0, 0, style);
        const waitedFor = layer._lineBatch(level, -8, lineAt([10, 10], [20, 20]));
        waitedFor.users = 1;    // a feature got it, and isn't drawn yet
        const empty = layer._lineBatch(level, -7, lineAt([10, 10], [20, 20]));

        layer._removeEmptyContainers();
        assert.isFalse(used.destroyed);
        assert.isFalse(waitedFor.destroyed);
        assert.isTrue(empty.destroyed);
        assert.strictEqual(layer._lineBatch(level, -9, lineAt([10, 10], [20, 20])), used);
        const again = layer._lineBatch(level, -7, lineAt([10, 10], [20, 20]));
        assert.notStrictEqual(again, empty);    // a new one
        assert.isFalse(again.destroyed);
      });

      it('makes another batch in place of one that was destroyed with its container', () => {
        const batch = layer._lineBatch(level, -9, lineAt([10, 10], [20, 20]));
        batch.destroy();
        const next = layer._lineBatch(level, -9, lineAt([10, 10], [20, 20]));
        assert.notStrictEqual(next, batch);
        assert.isFalse(next.destroyed);
      });
    });

    it('puts points in the container of their tile, the rows from north to south', () => {
      const north = layer._pointTileContainer(pointAt(300, 10), false, 16);
      const same = layer._pointTileContainer(pointAt(400, 200), false, 16);
      const south = layer._pointTileContainer(pointAt(10, 300), false, 16);
      const west = layer._pointTileContainer(pointAt(10, 10), false, 16);
      assert.strictEqual(north, same);
      assert.strictEqual(north.label, '1,0,16');
      assert.isBelow(north.parent.zIndex, south.parent.zIndex);   // a pin overlaps the ones north of it
      assert.isBelow(west.parent.zIndex, north.parent.zIndex);    // side by side: the same order on every load
    });

    // When the view crosses a whole zoom level, every feature belongs in another tile's container.
    // They move a whole old tile at a time, over several frames.
    describe('after a whole zoom level', () => {
      let frame;

      // A stand-in feature in a tile's container (tiles of 256 at zoom 16, of 128 at 17)
      function addFeature(id, container, min, max = min) {
        const feature = { id: id, geometry: part(min, max), container: new PIXI.Container(), visible: true, style: {} };
        feature.container.label = id;
        Object.defineProperty(feature, 'parentContainer', {
          get: () => feature.container.parent,
          set: parent => { parent.addChild(feature.container); }
        });
        container.addChild(feature.container);
        layer.features.set(id, feature);
        return feature;
      }

      beforeEach(() => {
        frame = new RenderFrame(1, 17.2);
        frame.viewBox = new Rapid.sdk.Extent([0, 0], [200, 200]);
        frame.deadline = Infinity;
        layer._tileFloor = 16;
      });

      it('lists the tiles of another zoom, the ones in view first', () => {
        const far = layer._lineTileContainer(level, -9, part([900, 900], [910, 910]), 16);
        const near = layer._lineTileContainer(level, -9, part([10, 10], [20, 20]), 16);
        const points = layer._pointTileContainer(pointAt(10, 10), false, 16);
        layer._lineTileContainer(level, -9, part([0, 0], [600, 20]), 16);   // large: not a tile
        layer._pointTileContainer(pointAt(10, 10), true, 16);               // viewfields: not a tile

        layer._tileFloor = 17;
        layer._lineTileContainer(level, -9, part([10, 10], [20, 20]), 17);   // of the new zoom already
        layer._findOldTiles(frame);
        assert.sameMembers([...layer._oldTiles], [near, points, far]);
        assert.strictEqual([...layer._oldTiles].at(-1), far);
        assert.strictEqual(layer.numWaiting, 3);     // so more frames follow
      });

      it('moves a whole tile at a time to the new zoom\'s tiles, and removes the old one', () => {
        const old = layer._lineTileContainer(level, -9, part([10, 10], [20, 20]), 16);
        const a = addFeature('a', old, [10, 10], [20, 20]);
        const b = addFeature('b', old, [200, 200], [210, 210]);
        const c = addFeature('c', old, [0, 100], [250, 110]);    // bigger than a tile of the new zoom

        layer._tileFloor = 17;
        layer._findOldTiles(frame);
        layer._retile(frame);
        assert.strictEqual(a.container.parent.label, '-9/0,0,17');
        assert.strictEqual(b.container.parent.label, '-9/1,1,17');
        assert.strictEqual(c.container.parent.label, '-9/large');
        assert.strictEqual(a.container.parent.parent.parent, level);
        assert.isTrue(old.destroyed);
        assert.strictEqual(layer._oldTiles.size, 0);
        assert.isAbove(frame.drawDebt, 0);           // Pixi rebuilds what changed, and that counts
      });

      it('takes a few tiles in a frame with no time, and the rest in later frames', () => {
        for (let i = 0; i < 10; i++) {
          const old = layer._pointTileContainer(pointAt(i * 256 + 10, 10), false, 16);
          addFeature(`n${i}`, old, [i * 256 + 10, 10]);
        }
        layer._tileFloor = 17;
        layer._findOldTiles(frame);

        frame.deadline = -Infinity;
        layer._retile(frame);
        assert.strictEqual(layer._oldTiles.size, 6);
        layer._retile(frame);
        layer._retile(frame);
        assert.strictEqual(layer._oldTiles.size, 0);
        assert.strictEqual(layer.features.get('n9').container.parent.label, '18,0,17');
      });

      it('leaves a feature in a tile that is about to move, when it is drawn again', () => {
        const old = layer._lineTileContainer(level, -9, part([10, 10], [20, 20]), 16);
        const a = addFeature('a', old, [10, 10], [20, 20]);
        layer._tileFloor = 17;
        layer._findOldTiles(frame);

        layer._setTile(a, layer._lineTileContainer(level, -9, a.geometry, 17));
        assert.strictEqual(a.container.parent, old);         // its whole tile moves soon

        layer._setTile(a, layer._lineTileContainer(level, -8, a.geometry, 17));
        assert.strictEqual(a.container.parent.label, '-8/0,0,17');   // another road class: that can't wait
      });

      it('moves a feature at once when it is bigger than a tile at one zoom only', () => {
        const old = layer._lineTileContainer(level, -9, part([10, 10], [20, 20]), 16);
        const small = addFeature('small', old, [10, 10], [20, 20]);
        const big = addFeature('big', old, [0, 100], [250, 110]);

        layer._tileFloor = 17;
        layer._placeLarge(small);
        layer._placeLarge(big);
        assert.strictEqual(small.container.parent, old);
        assert.strictEqual(big.container.parent.label, '-9/large');

        layer._tileFloor = 16;
        layer._placeLarge(big);
        assert.strictEqual(big.container.parent.label, '-9/0,0,16');
      });
    });

    it('puts a point with viewfields above every tile', () => {
      const south = layer._pointTileContainer(pointAt(10, 100000), false, 16);
      const withViewfields = layer._pointTileContainer(pointAt(10, 10), true, 16);
      assert.strictEqual(withViewfields.label, 'viewfields');
      assert.isAbove(withViewfields.parent.zIndex, south.parent.zIndex);
    });

    it('removes the containers that have emptied, and makes them again when asked', () => {
      const a = layer._lineTileContainer(level, -9, part([10, 10], [20, 20]), 16);
      const b = layer._pointTileContainer(pointAt(10, 10), false, 16);
      b.addChild(new PIXI.Container());   // a feature

      layer._removeEmptyContainers();
      assert.isTrue(a.destroyed);
      assert.isFalse(b.destroyed);
      assert.isNull(level.getChildByLabel('-9/0,0,16'));
      assert.strictEqual(layer._pointTileContainer(pointAt(10, 10), false, 16), b);

      const again = layer._lineTileContainer(level, -9, part([10, 10], [20, 20]), 16);
      assert.notStrictEqual(again, a);
      assert.isFalse(again.destroyed);
    });
  });


  // Making a feature is the most expensive thing the layer does per feature, and after a load
  // there are thousands. An entity whose feature isn't needed at once waits, and its feature is
  // made in a later frame (see "A deadline on the frame" in `design/graphics-system.md`).
  describe('features that wait to be made', () => {
    let layer, entities, made;

    const VIEW = new Rapid.sdk.Extent([0, 0], [50, 50]);
    const IN_VIEW = new Rapid.sdk.Extent([10, 10], [11, 11]);
    const OUTSIDE = new Rapid.sdk.Extent([80, 10], [81, 11]);

    // A frame whose view is `VIEW` (the left half of its cull box), with or without time left
    function makeFrame(hasTime, props = {}) {
      const frame = new RenderFrame(1, 17);
      frame.cullBox = new Rapid.sdk.Extent([0, 0], [100, 100]);
      frame.viewBox = VIEW;
      frame.deadline = hasTime ? Infinity : -Infinity;
      return Object.assign(frame, props);
    }

    // A stand-in entity of the given kind, at the given place
    function addEntity(id, geometry, extent) {
      entities.set(id, { id: id, extent: extent, geometry: () => geometry });
    }

    beforeEach(() => {
      const context = new Rapid.MockContext();
      entities = new Map();
      made = [];
      const graph = {
        hasEntity: id => entities.get(id),
        geometry: entity => ({ world: { extent: entity.extent } })
      };
      context.systems.editor = { staging: { graph: graph } };

      layer = new PixiLayerOsm({ context: context, gfx: {} });

      // Stand-ins for the layer's `render…()` functions: each asks whether to make a feature for
      // each entity it's given, as the real ones do for an entity that has none.
      const renderKind = kind => (frame, viewport, data) => {
        for (const [entityID, entity] of data[kind]) {
          if (!layer._waitToMake(kind, entityID, entity.extent, frame, false)) {
            made.push(entityID);
          }
        }
      };
      layer.renderPolygons = renderKind('polygons');
      layer.renderLines = renderKind('lines');
      layer.renderPoints = renderKind('points');
      layer.renderVertices = renderKind('vertices');
    });


    describe('_waitToMake', () => {
      it('makes a feature in view while the frame has time', () => {
        assert.isFalse(layer._waitToMake('lines', 'w1', IN_VIEW, makeFrame(true), false));
        assert.strictEqual(layer.numWaiting, 0);
      });

      it('puts off a feature in view when the frame is out of time', () => {
        assert.isTrue(layer._waitToMake('lines', 'w1', IN_VIEW, makeFrame(false), false));
        assert.strictEqual(layer.numWaiting, 1);
        assert.strictEqual(layer.numWaitingInView, 1);
      });

      it('always puts off a feature outside the view during a pass', () => {
        assert.isTrue(layer._waitToMake('polygons', 'w1', OUTSIDE, makeFrame(true), false));
        assert.isTrue(layer._waitToMake('polygons', 'w2', OUTSIDE, makeFrame(true, { urgent: true }), true));
        assert.strictEqual(layer.numWaiting, 2);
        assert.strictEqual(layer.numWaitingInView, 0);
      });

      it('in a frame the user asked for, makes what the user needs at once, and nothing else', () => {
        const frame = makeFrame(false, { urgent: true });
        assert.isFalse(layer._waitToMake('lines', 'drawn-just-now', IN_VIEW, frame, true));
        assert.isTrue(layer._waitToMake('lines', 'loaded-earlier', IN_VIEW, frame, false));
        // ..and what the user needs still waits in a frame nobody asked for
        assert.isTrue(layer._waitToMake('lines', 'another', IN_VIEW, makeFrame(false), true));
      });

      it('remembers an entity once, however often it is asked about', () => {
        layer._waitToMake('lines', 'w1', IN_VIEW, makeFrame(false), false);
        layer._waitToMake('lines', 'w1', IN_VIEW, makeFrame(false), false);
        assert.strictEqual(layer.numWaiting, 1);
      });
    });


    describe('continueWaiting', () => {
      // Puts `count` lines in view and `countOutside` polygons outside it, all waiting
      function addWaiting(count, countOutside = 0) {
        for (let i = 0; i < count; i++) {
          addEntity(`w${i}`, 'line', IN_VIEW);
          layer._waitToMake('lines', `w${i}`, IN_VIEW, makeFrame(false), false);
        }
        for (let i = 0; i < countOutside; i++) {
          addEntity(`far${i}`, 'area', OUTSIDE);
          layer._waitToMake('polygons', `far${i}`, OUTSIDE, makeFrame(false), false);
        }
      }

      it('makes everything that waited in view when the frame has time', () => {
        addWaiting(200);
        layer.continueWaiting(makeFrame(true), {});
        assert.strictEqual(made.length, 200);
        assert.strictEqual(layer.numWaiting, 0);
      });

      it('makes one batch when the frame has no time, and keeps the rest waiting', () => {
        addWaiting(200);
        layer.continueWaiting(makeFrame(false), {});
        assert.strictEqual(made.length, 64);
        assert.strictEqual(layer.numWaiting, 136);
        assert.strictEqual(layer.numWaitingInView, 136);

        let calls = 1;
        while (layer.numWaiting && calls < 20) {
          layer.continueWaiting(makeFrame(false), {});
          calls++;
        }
        assert.strictEqual(made.length, 200);
        assert.sameMembers(made, [...entities.keys()]);   // each one once
        assert.strictEqual(calls, 4);
      });

      it('takes them in the order they waited, and leaves the rest where it is', () => {
        addWaiting(200);
        const waiting = layer._unmadeInView;
        layer.continueWaiting(makeFrame(false), {});
        assert.deepEqual(made.slice(0, 3), ['w0', 'w1', 'w2']);
        assert.strictEqual(layer._unmadeInView, waiting);            // not a copy of what's left
        assert.strictEqual([...waiting.lines][0], 'w64');
      });

      it('puts an entity that still can\'t be made back with the ones waiting, after the others', () => {
        addWaiting(200);
        const renderLines = layer.renderLines;
        layer.renderLines = (frame, viewport, data) => {
          layer._madeCount = 64;          // as when the features made before it used up the batch
          renderLines(frame, viewport, data);
        };
        layer.continueWaiting(makeFrame(false), {});
        assert.strictEqual(made.length, 0);
        assert.strictEqual(layer.numWaitingInView, 200);
        assert.strictEqual([...layer._unmadeInView.lines][0], 'w64');   // the first batch went to the back
        assert.strictEqual([...layer._unmadeInView.lines].at(-1), 'w63');
      });

      it('does not look at the ones outside the view again while the view stays where it is', () => {
        addWaiting(10, 30);
        const graph = layer.context.systems.editor.staging.graph;
        const geometry = graph.geometry;
        let lookups = 0;
        graph.geometry = entity => {
          if (entity.id.startsWith('far')) lookups++;   // (the ones outside the view)
          return geometry(entity);
        };

        layer.continueWaiting(makeFrame(false, { time: 1000 }), {});   // the first look sorts them
        assert.strictEqual(lookups, 30);
        layer.continueWaiting(makeFrame(false, { time: 2000 }), {});
        layer.continueWaiting(makeFrame(false, { time: 3000 }), {});
        assert.strictEqual(lookups, 30);
        assert.strictEqual(layer.numWaitingInView, 0);

        const moved = makeFrame(false, { time: 4000, viewBox: new Rapid.sdk.Extent([60, 0], [100, 50]) });
        layer.continueWaiting(moved, {});
        assert.isAtLeast(lookups, 60);   // looked at again (and once more each as they're made)
        assert.isAbove(made.filter(id => id.startsWith('far')).length, 0);
      });

      it('leaves the ones outside the view until it is asked to go on to them', () => {
        addWaiting(10, 30);
        layer.continueWaiting(makeFrame(true), {});          // the layer's own call
        assert.strictEqual(made.length, 10);
        assert.strictEqual(layer.numWaiting, 30);
        assert.strictEqual(layer.numWaitingInView, 0);

        layer.continueWaiting(makeFrame(true), {}, true);    // the scene's, after every layer
        assert.strictEqual(made.length, 40);
        assert.strictEqual(layer.numWaiting, 0);
      });

      it('makes the ones in view first, and none outside it in a frame with no time to spare', () => {
        addWaiting(100, 30);
        layer.continueWaiting(makeFrame(false), {}, true);
        assert.strictEqual(made.length, 64);
        assert.isTrue(made.every(id => id.startsWith('w')));
        assert.strictEqual(layer.numWaiting, 66);
      });

      it('makes a batch outside the view even with no time, once nothing in view is waiting', () => {
        addWaiting(0, 100);
        layer.continueWaiting(makeFrame(false), {}, true);
        assert.strictEqual(made.length, 64);
        assert.strictEqual(layer.numWaiting, 36);
      });

      it('takes an entity first once the view has moved over it', () => {
        addWaiting(0, 30);
        const frame = makeFrame(true);
        frame.viewBox = new Rapid.sdk.Extent([60, 0], [100, 50]);   // the view moved over them
        frame.time = 1000;
        layer.continueWaiting(frame, {});   // not asked to go on to the ones outside
        assert.strictEqual(made.length, 30);
      });

      it('forgets an entity that is gone, or is another kind of thing now', () => {
        addWaiting(3);
        entities.delete('w0');
        entities.get('w1').geometry = () => 'area';   // the way was closed and tagged as an area
        layer.continueWaiting(makeFrame(true), {});
        assert.deepEqual(made, ['w2']);
        assert.strictEqual(layer.numWaiting, 0);
      });

      it('starts over when the layer is reset', () => {
        addWaiting(10, 10);
        layer._spatialContainer = () => new PIXI.Container();
        layer._childContainer = () => new PIXI.Container();
        const hitTesters = [];
        layer.scene.setHitTester = (spatialID, tester) => hitTesters.push([spatialID, tester]);
        layer.reset();
        assert.strictEqual(layer.numWaiting, 0);
        assert.deepEqual(hitTesters, [['osm', layer]]);   // the layer finds its own features under the pointer
      });
    });
  });


  // A hover or a selection changes the classes of a little data. The layer draws that data's
  // features again on a frame where it keeps the rest, in place of a pass over everything.
  describe('data whose classes changed', () => {
    let layer, frame, entities, classes, hidden, interesting, calls, selected, tile;

    const viewport = { transform: { zoom: 17 } };
    const BOX = new Rapid.sdk.Extent([0, 0], [100, 100]);
    const INSIDE = new Rapid.sdk.Extent([10, 10], [11, 11]);
    const OUTSIDE = new Rapid.sdk.Extent([500, 10], [501, 11]);

    function addEntity(id, geometry, extent = INSIDE) {
      entities.set(id, { id: id, extent: extent, geometry: () => geometry });
    }

    // A node on a way, of one of the kinds that `OsmNode.vertexKind()` returns
    function addVertex(id, kind, extent = INSIDE) {
      entities.set(id, { id: id, type: 'node', extent: extent, geometry: () => 'vertex', vertexKind: () => kind });
    }

    // A stand-in feature for some data, in one of the two containers
    function addFeature(dataID, parent = tile) {
      const feature = {
        id: `osm-${dataID}`,
        lod: 2,
        visible: true,
        destroyed: false,
        container: { parent: parent },
        destroy: () => {
          feature.destroyed = true;
          feature.container = null;
          layer.removeFeature(feature);
        }
      };
      layer.addFeature(feature);
      layer.bindData(feature.id, dataID);
      return feature;
    }

    beforeEach(() => {
      const context = new Rapid.MockContext();
      entities = new Map();
      classes = { hover: [], select: [], drawing: [] };
      hidden = new Set();
      interesting = new Set();
      calls = [];
      selected = { label: 'selected' };
      tile = { label: '0,0,16' };

      const graph = {
        hasEntity: id => entities.get(id),
        geometry: entity => ({ world: { extent: entity.extent } }),
        parentWays: () => []
      };
      context.systems.editor = { staging: { graph: graph } };
      context.systems.filters = { isHidden: entity => (hidden.has(entity.id) ? 'hidden' : null) };
      context.mode = { id: 'browse' };

      const scene = {
        context: context,
        gfx: {},
        layers: new Map([['map-ui', { selected: selected }]]),
        getDataWithClass: classID => new Set(classes[classID])
      };
      layer = new PixiLayerOsm(scene);

      // Stand-ins for the `render…()` functions: they see their data, and retain its features.
      // (A vertex is only wanted if it's related to what's hovered, or interesting.)
      const renderKind = kind => (f, viewport, data, related) => {
        for (const entityID of data[kind].keys()) {
          calls.push(`${kind} ${entityID}${f.urgent ? '' : ' (not urgent)'}`);
          const feature = layer.features.get(`osm-${entityID}`);
          const wanted = (kind !== 'vertices') || related.descendantIDs.has(entityID) || interesting.has(entityID);
          if (feature && wanted) {
            layer.retainFeature(feature, f);
          }
        }
      };
      layer.renderPolygons = renderKind('polygons');
      layer.renderLines = renderKind('lines');
      layer.renderPoints = renderKind('points');
      layer.renderVertices = renderKind('vertices');

      frame = new RenderFrame(1, 17);
      frame.cullBox = BOX;
      layer._currentBox = BOX;   // as after a pass for this box

      // Two ways and their nodes. `w1` was hovered at the last pass, so its vertices are on top.
      // (The ways are big enough on screen for their vertices to be shown.)
      const WAY = new Rapid.sdk.Extent([10, 10], [60, 60]);
      addEntity('w1', 'line', WAY);
      addEntity('w2', 'line', WAY);
      for (const nodeID of ['n1', 'n2', 'n3']) {
        addEntity(nodeID, 'vertex');
      }
      layer.addChildData('w1', ['n1', 'n2']);
      layer.addChildData('w2', ['n3']);
      layer._lastRelated = { descendantIDs: new Set(['w1', 'n1', 'n2']), siblingIDs: new Set() };
    });

    it('remembers the data the scene says changed class, until it has drawn it again', () => {
      layer.classChanged('w1');
      layer.classChanged('w1');
      layer.classChanged('fbRoads:w-1');   // another layer's: it's told too
      assert.deepEqual([...layer._changedIDs], ['w1', 'fbRoads:w-1']);

      layer.continueWaiting(frame, viewport);
      assert.strictEqual(layer._changedIDs.size, 0);
      assert.notInclude(calls.join(), 'fbRoads');
    });

    it('draws again what changed class and what was or is related to it, at once', () => {
      const line1 = addFeature('w1');
      const line2 = addFeature('w2');
      const plain = addFeature('n1', selected);
      const junction = addFeature('n2', selected);
      interesting.add('n2');

      // The hover moves from `w1` to `w2`
      classes.hover = ['w2'];
      layer.classChanged('w1');
      layer.classChanged('w2');
      layer.continueWaiting(frame, viewport);

      assert.sameMembers(calls, ['lines w1', 'lines w2', 'vertices n1', 'vertices n2', 'vertices n3']);
      assert.isFalse(frame.urgent);                 // ..only while they were drawn
      assert.isTrue(line1.visible);
      assert.isTrue(line2.visible);
      assert.isTrue(junction.visible);              // it's drawn whatever is hovered
      assert.isTrue(plain.destroyed);               // it was only there for the hover
      assert.isFalse(layer.features.has('osm-n1'));
      assert.sameMembers([...layer._lastRelated.descendantIDs], ['w2', 'n3']);
    });

    it('leaves out what a pass would not have gathered, and hides its features', () => {
      addEntity('w3', 'line');
      addEntity('w4', 'line', OUTSIDE);
      const hiddenLine = addFeature('w3');
      const farLine = addFeature('w4');
      const gone = addFeature('w5');   // no such entity anymore
      hidden.add('w3');

      for (const dataID of ['w3', 'w4', 'w5']) {
        layer.classChanged(dataID);
      }
      layer.continueWaiting(frame, viewport);

      assert.notInclude(calls.join(), 'w3');
      assert.notInclude(calls.join(), 'w4');
      for (const feature of [hiddenLine, farLine, gone]) {
        assert.isFalse(feature.visible);
        assert.isFalse(feature.destroyed);   // a pass decides when to let go of these
      }
    });

    it('does nothing on a frame where no class changed', () => {
      addFeature('n1', selected);
      layer.continueWaiting(frame, viewport);
      assert.deepEqual(calls, []);
      assert.isTrue(layer.features.has('osm-n1'));
    });

    it('draws again the entities that an edit affects, with their styles worked out again', () => {
      const line1 = addFeature('w1');
      const junction = addFeature('n2');
      interesting.add('n2');
      addEntity('n9', 'point');   // the edit added it: no feature yet

      layer.dataChanged(['w1', 'n2', 'n9', 'n404']);
      assert.isTrue(line1.dirty);
      assert.isTrue(junction.dirty);
      assert.strictEqual(layer._currentBox, BOX);   // no pass asked for

      layer.continueWaiting(frame, viewport);
      assert.includeMembers(calls, ['lines w1', 'vertices n2', 'points n9']);
      assert.notInclude(calls.join(), 'n404');
      assert.strictEqual(layer._changedIDs.size, 0);
    });

    it('hides the features of an entity that an edit deleted', () => {
      const line2 = addFeature('w2');
      const vertex = addFeature('n3');
      entities.delete('w2');
      entities.delete('n3');

      layer.dataChanged(['w2', 'n3']);
      layer.continueWaiting(frame, viewport);
      assert.isFalse(line2.visible);
      assert.isFalse(vertex.visible);
    });

    it('does its pass instead when an edit affects thousands of entities', () => {
      const ids = [];
      for (let i = 0; i < 6000; i++) {
        ids.push(`n${1000 + i}`);
      }
      layer.dataChanged(ids);
      assert.isNull(layer._currentBox);   // so `keepFeatures()` says no

      layer.continueWaiting(frame, viewport);   // (a held frame, while that pass waits its turn)
      assert.deepEqual(calls, []);
      assert.strictEqual(layer._changedIDs.size, 6000);   // the pass clears them
    });

    // A tile that loads brings thousands of entities. They're sorted and drawn like the ones
    // above, but when the frames have time: nobody is waiting for any one of them.
    describe('data that arrived', () => {
      it('remembers what arrived, and marks its features to be styled again', () => {
        const line1 = addFeature('w1');
        layer.dataArrived(new Set(['w1', 'n9']));
        assert.isTrue(line1.dirty);
        assert.strictEqual(layer._currentBox, BOX);   // no pass asked for
        assert.strictEqual(layer.numWaiting, 2);      // ..but more frames, until it's looked at
      });

      it('draws it when a frame comes, not urgently, and without working out what is related again', () => {
        addFeature('w1');
        addEntity('n9', 'point');
        const related = layer._lastRelated;
        layer.dataArrived(['w2', 'n9']);              // (not `w1`, which is hovered)

        layer.continueWaiting(frame, viewport);
        assert.sameMembers(calls, ['lines w2 (not urgent)', 'points n9 (not urgent)']);
        assert.strictEqual(layer._lastRelated, related);
        assert.isFalse(layer._modeDirty);
        assert.strictEqual(layer.numWaiting, 0);
      });

      it('works out what is related again on the next frame, when some of what arrived is', () => {
        layer.dataArrived(['n1']);                    // a vertex of the hovered way
        layer.continueWaiting(frame, viewport);
        assert.isTrue(layer._modeDirty);
      });

      it('takes a batch at a time when frames have no time, and all of it when they do', () => {
        const ids = [];
        for (let i = 0; i < 2500; i++) {
          addEntity(`n${1000 + i}`, 'point');
          ids.push(`n${1000 + i}`);
        }
        layer.dataArrived(ids);

        frame.deadline = -Infinity;
        layer.continueWaiting(frame, viewport);
        assert.strictEqual(calls.length, 1000);
        assert.strictEqual(layer.numWaiting, 1500);

        frame.deadline = Infinity;
        layer.continueWaiting(frame, viewport);
        assert.strictEqual(calls.length, 2500);
        assert.strictEqual(layer.numWaiting, 0);
      });

      it('hides the features of what arrived and is hidden by a filter, or gone', () => {
        const line2 = addFeature('w2');
        hidden.add('w2');
        layer.dataArrived(['w2']);
        layer.continueWaiting(frame, viewport);
        assert.isFalse(line2.visible);
      });

      // Most of what arrives in a dense place is vertices that only shape their way.
      it('passes by the vertices that only shape their way', () => {
        addVertex('n10', 'shape');
        addVertex('n11', 'structural');
        addVertex('n12', 'tagged');
        layer.dataArrived(['n10', 'n11', 'n12']);

        layer.continueWaiting(frame, viewport);
        assert.sameMembers(calls, ['vertices n11 (not urgent)', 'vertices n12 (not urgent)']);
        assert.strictEqual(layer.numWaiting, 0);
      });

      it('..unless one is related to what is hovered, or has a feature from before', () => {
        addVertex('n1', 'shape');                     // a vertex of the hovered way
        addVertex('n10', 'shape');                    // it was a point before its way arrived
        const point = addFeature('n10');
        layer.dataArrived(['n1', 'n10']);

        layer.continueWaiting(frame, viewport);
        assert.sameMembers(calls, ['vertices n1 (not urgent)', 'vertices n10 (not urgent)']);
        assert.isFalse(point.visible);                // nothing wanted it anymore
      });

      it('looks at a limited number of them in a frame with no time', () => {
        const ids = [];
        for (let i = 0; i < 20000; i++) {
          addVertex(`n${1000 + i}`, 'shape');
          ids.push(`n${1000 + i}`);
        }
        layer.dataArrived(ids);

        frame.deadline = -Infinity;
        layer.continueWaiting(frame, viewport);
        assert.strictEqual(layer.numWaiting, 12000);
        assert.deepEqual(calls, []);

        frame.deadline = Infinity;
        layer.continueWaiting(frame, viewport);
        assert.strictEqual(layer.numWaiting, 0);
        assert.deepEqual(calls, []);
      });
    });


    // The whole pass: everything in the cull box, through the filter and the `render…()` functions.
    describe('the pass', () => {
      let asked, effectiveZoom;

      beforeEach(() => {
        const context = layer.context;
        asked = [];
        effectiveZoom = 17;
        context.services.osm = { started: true };
        context.loadTiles = () => {};
        context.systems.map = { effectiveZoom: () => effectiveZoom };
        context.systems.editor.entitiesInBox = () => [...entities.values()];
        context.systems.filters.filterScene = list => {
          asked = list.map(entity => entity.id);
          return list.filter(entity => !hidden.has(entity.id));
        };
        layer.renderMidpoints = () => {};
        layer._currentBox = null;   // nothing is current, so the layer does its pass
        layer._lastRelated = { descendantIDs: new Set(), siblingIDs: new Set() };

        // (replaces the vertices of the ways above, which had no kind)
        addVertex('n1', 'shape');
        addVertex('n2', 'shape');
        addVertex('n3', 'structural');
        addVertex('n4', 'tagged');
        addEntity('n5', 'point');
        entities.get('n5').type = 'node';
        entities.get('n5').vertexKind = () => null;
      });

      it('leaves out the vertices that only shape their way, before asking the filter', () => {
        layer.render(frame, viewport);
        assert.sameMembers(asked, ['w1', 'w2', 'n3', 'n4', 'n5']);
        assert.sameMembers(calls, ['lines w1 (not urgent)', 'lines w2 (not urgent)', 'points n5 (not urgent)',
          'vertices n3 (not urgent)', 'vertices n4 (not urgent)']);
        assert.isTrue(layer._showsVertices);
      });

      it('below the zoom for vertices, keeps only the tagged ones (the filter counts them)', () => {
        effectiveZoom = 15.9;
        layer.render(frame, viewport);
        assert.sameMembers(asked, ['w1', 'w2', 'n4', 'n5']);
        assert.isFalse(layer._showsVertices);
      });

      it('adds the vertices of what is hovered, whatever kind they are', () => {
        classes.hover = ['w1'];
        layer.render(frame, viewport);
        assert.sameMembers(asked, ['w1', 'w2', 'n3', 'n4', 'n5']);
        assert.includeMembers(calls, ['vertices n1 (not urgent)', 'vertices n2 (not urgent)']);
      });

      it('..but not the ones a filter hides, or outside the cull box', () => {
        classes.hover = ['w1'];
        hidden.add('n1');
        addVertex('n2', 'shape', OUTSIDE);
        layer.render(frame, viewport);
        assert.notInclude(calls, 'vertices n1 (not urgent)');
        assert.notInclude(calls, 'vertices n2 (not urgent)');
      });

      // The zoom for vertices is the map's effective zoom, which grows with the latitude.
      it('remembers the vertices as arrived when the view crosses the zoom for them without a pass', () => {
        effectiveZoom = 15.9;
        layer.render(frame, viewport);
        calls.length = 0;

        effectiveZoom = 16.1;
        const next = new RenderFrame(2, 17);
        next.cullBox = BOX;                     // only the view moved, inside the cull box
        next.contentChanged = false;
        next.deadline = -Infinity;
        layer._changedIDs.clear();
        layer.render(next, viewport);
        assert.isTrue(layer.keptFeatures(next));
        assert.isTrue(layer._showsVertices);
        assert.sameMembers(calls, ['vertices n3 (not urgent)', 'vertices n4 (not urgent)']);
      });

      it('leaves that for the pass in a held frame', () => {
        effectiveZoom = 15.9;
        layer.render(frame, viewport);

        effectiveZoom = 16.1;
        const next = new RenderFrame(2, 17);
        next.cullBox = BOX;
        next.contentChanged = false;
        next.held = true;
        layer.render(next, viewport);
        assert.isFalse(layer._showsVertices);
        assert.strictEqual(layer.numWaiting, 0);
      });
    });


    // When the view leaves the cull box, the frame has a new one. The layer follows it there
    // without a pass: what's in both boxes stays as it is.
    describe('a cull box that moved', () => {
      const NEW_BOX = new Rapid.sdk.Extent([60, 0], [160, 100]);    // 60 to the east
      const BOTH = new Rapid.sdk.Extent([70, 10], [71, 11]);
      const LEFT_BEHIND = new Rapid.sdk.Extent([20, 10], [21, 11]);
      const MOVED_OVER = new Rapid.sdk.Extent([130, 10], [131, 11]);

      beforeEach(() => {
        // The spatial index: what touches a box
        layer.context.systems.editor.entitiesInBox = bbox => {
          const box = new Rapid.sdk.Extent([bbox.minX, bbox.minY], [bbox.maxX, bbox.maxY]);
          return [...entities.values()].filter(entity => entity.extent.intersects(box));
        };
        frame.cullBox = NEW_BOX;
        frame.viewBox = new Rapid.sdk.Extent([110, 0], [160, 100]);
      });

      it('hides what the box left behind, and leaves alone what is in both boxes', () => {
        addEntity('n20', 'point', LEFT_BEHIND);
        addEntity('n70', 'point', BOTH);
        addEntity('w50', 'line', new Rapid.sdk.Extent([20, 10], [70, 11]));   // reaches into the new box
        const gone = addFeature('n20');
        const stays = addFeature('n70');
        const reaches = addFeature('w50');

        layer._moveBox(frame, BOX);
        assert.isFalse(gone.visible);
        assert.isFalse(gone.destroyed);     // kept for a while, in case the view comes back
        assert.isTrue(stays.visible);
        assert.isTrue(reaches.visible);
        assert.deepEqual(calls, []);        // nothing was drawn again for it
      });

      it('remembers what the box moved over as having arrived, what is in view first', () => {
        addEntity('n140', 'point', new Rapid.sdk.Extent([105, 10], [106, 11]));   // new, not in view yet
        addEntity('n130', 'point', MOVED_OVER);                                   // new, and in view
        addEntity('n70', 'point', BOTH);                                          // was there already
        addEntity('w90', 'line', new Rapid.sdk.Extent([90, 10], [130, 11]));      // reached into the old box

        layer._moveBox(frame, BOX);
        assert.deepEqual([...layer._arrivedIDs], ['n130', 'n140']);
      });

      it('asks a node it moves over for its location, not its geometry', () => {
        // (Asking for a node's geometry builds and keeps one, and most nodes are never drawn.)
        const node = { id: 'n130', type: 'node', extent: MOVED_OVER, worldCoord: () => [130, 10], geometry: () => 'vertex' };
        entities.set('n130', node);
        layer.context.systems.editor.staging.graph.geometry = entity => {
          if (entity === node) throw new Error('asked for the geometry of a node');
          return { world: { extent: entity.extent } };
        };
        layer._moveBox(frame, BOX);
        assert.deepEqual([...layer._arrivedIDs], ['n130']);
      });

      it('finds what the box left behind through the index, without looking at every feature', () => {
        addEntity('n20', 'point', LEFT_BEHIND);
        addEntity('n70', 'point', BOTH);
        const gone = addFeature('n20');
        const stays = addFeature('n70');
        let walked = 0;
        const features = layer.features;
        layer.features = new Proxy(features, { get: (target, key) => {
          if (key === 'values') walked++;
          const value = Reflect.get(target, key);
          return (typeof value === 'function') ? value.bind(target) : value;
        } });
        layer._moveBox(frame, BOX);
        assert.isFalse(gone.visible);
        assert.isTrue(stays.visible);
        assert.strictEqual(walked, 0);
      });

      it('destroys what has been hidden for more than 20 moves, unless it was shown again', () => {
        addEntity('n20', 'point', LEFT_BEHIND);
        addEntity('n21', 'point', LEFT_BEHIND);
        const gone = addFeature('n20');
        const back = addFeature('n21');
        // (a real feature tells its layer when it's hidden or shown)
        const hide = feature => { feature.visible = false; layer.visibilityChanged(feature, false); };
        const show = feature => { feature.visible = true; layer.visibilityChanged(feature, true); };
        hide(gone);
        hide(back);

        for (let i = 0; i < 20; i++) {
          layer._moves++;
          layer._forgetHidden();
        }
        assert.isFalse(gone.destroyed);
        show(back);

        layer._moves++;
        layer._forgetHidden();
        assert.isTrue(gone.destroyed);
        assert.isFalse(back.destroyed);
        assert.isFalse(layer.features.has('osm-n20'));
      });

      // A zoom or a rotation changes how features are drawn, not which ones there are.
      describe('after a zoom', () => {
        beforeEach(() => {
          const context = layer.context;
          context.services.osm = { started: true };
          context.loadTiles = () => {};
          context.systems.filters.filterScene = list => list;
          frame.contentChanged = true;      // as `GraphicsSystem` says for a new zoom..
          frame.requested = false;          // ..when nothing asked for a redraw
          frame.deadline = -Infinity;
        });

        it('keeps the cull box when the features are marked for a new zoom', () => {
          const feature = addFeature('n70');
          feature.dirtyTransform = () => { feature.dirty = true; };
          layer.dirtyTransform();
          assert.isTrue(feature.dirty);
          assert.strictEqual(layer._currentBox, BOX);
          layer.dirtyLayer();
          assert.isNull(layer._currentBox);   // anything else still means a pass
        });

        it('follows the box, and remembers what stays as having arrived, also what hid itself', () => {
          addEntity('n20', 'point', LEFT_BEHIND);
          addEntity('n70', 'point', BOTH);
          addEntity('n71', 'point', BOTH);
          addEntity('n130', 'point', MOVED_OVER);
          const gone = addFeature('n20');
          const stays = addFeature('n70');
          const tooSmall = addFeature('n71');
          tooSmall.visible = false;
          for (const feature of [gone, stays, tooSmall]) feature.dirtyTransform = () => {};

          layer.dirtyTransform();
          layer.render(frame, viewport);
          assert.isTrue(layer.keptFeatures(frame));     // no pass
          assert.isFalse(gone.visible);
          assert.isTrue(stays.visible);
          assert.strictEqual(layer._currentBox, NEW_BOX);
          // one batch was looked at already, in this frame without time
          // (and what's related to the hovered way is worked out again: it depends on the zoom)
          assert.includeMembers(calls, ['points n130 (not urgent)', 'points n70 (not urgent)', 'points n71 (not urgent)']);
        });

        it('does its pass when a redraw was asked for too', () => {
          addEntity('n70', 'point', BOTH);
          layer.dirtyTransform();
          frame.requested = true;
          layer.render(frame, viewport);
          assert.isFalse(layer.keptFeatures(frame));
        });

        it('lists the tiles of the old zoom when the view crosses a whole zoom level', () => {
          addEntity('n70', 'point', BOTH);
          addFeature('n70').dirtyTransform = () => {};
          let listed = 0;
          layer._findOldTiles = () => listed++;
          layer._tileFloor = 17;

          layer.dirtyTransform();
          layer.render(frame, viewport);          // still zoom 17
          assert.strictEqual(listed, 0);

          const next = new RenderFrame(2, 18.2);
          next.cullBox = new Rapid.sdk.Extent([65, 5], [150, 95]);
          next.viewBox = next.cullBox;
          next.requested = false;
          next.deadline = -Infinity;
          layer.dirtyTransform();
          layer.render(next, { transform: { zoom: 18.2 } });
          assert.strictEqual(listed, 1);
          assert.strictEqual(layer._tileFloor, 18);
        });
      });

      it('does not make a feature for an entity that waited and is outside the box now', () => {
        addEntity('w20', 'line', LEFT_BEHIND);
        addEntity('w70', 'line', BOTH);
        layer._unmadeInView.lines.add('w20');
        layer._unmadeInView.lines.add('w70');

        frame.deadline = Infinity;
        layer.continueWaiting(frame, viewport);
        assert.deepEqual(calls, ['lines w70 (not urgent)']);
        assert.strictEqual(layer.numWaiting, 0);
      });
    });


    it('draws the midpoints again after a change of mode, with nothing else changed', () => {
      let midpoints = 0;
      layer.renderMidpoints = () => midpoints++;

      layer.continueWaiting(frame, viewport);
      assert.strictEqual(midpoints, 0);

      layer.context.mode = { id: 'select' };
      layer.modeChanged();
      layer.continueWaiting(frame, viewport);
      assert.strictEqual(midpoints, 1);

      layer.continueWaiting(frame, viewport);   // once
      assert.strictEqual(midpoints, 1);
    });
  });


  it('has labels keep clear of the midpoints of a selected way, and not of a hovered one', () => {
    const context = new Rapid.MockContext();
    const viewport = new Rapid.sdk.Viewport();
    const a = midpointProps('a', [0, 0]);
    const layer = makeLayer(context, [[a], [a], [a]]);
    const feature = layer.features.get('osm-midpoint-a');

    layer.renderMidpoints(1, viewport, {}, RELATED);     // its way is only hovered
    assert.isFalse(feature.labelAvoid);

    const selected = { descendantIDs: new Set(['w1']), siblingIDs: new Set(), handleIDs: new Set(['w1']) };
    layer.renderMidpoints(2, viewport, {}, selected);    // now it's selected
    assert.isTrue(feature.labelAvoid);
    assert.strictEqual(feature.avoidUpdates, 1);         // it marked its place

    layer.renderMidpoints(3, viewport, {}, selected);    // nothing new
    assert.strictEqual(feature.avoidUpdates, 1);
  });
});
