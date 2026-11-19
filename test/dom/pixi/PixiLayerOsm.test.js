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

  function midpointProps(id, loc, wayID = 'w1', edge = ['n1', 'n2']) {
    return { type: 'midpoint', serviceID: 'osm', isNew: true, id: id, wayID: wayID, edge: edge,
      dist: Infinity, rotation: 0, coord: Rapid.sdk.projWgs84ToWorld(loc), loc: loc };
  }

  it('reuses the midpoints it drew last frame and forgets the ones it no longer draws', () => {
    const context = new Rapid.MockContext();
    const viewport = new Rapid.sdk.Viewport();
    const a = midpointProps('a', [0, 0]);
    const b = midpointProps('b', [0.001, 0]);
    const c = midpointProps('c', [0.002, 0]);
    const layer = makeLayer(context, [[a, b], [a, c]]);

    layer.renderMidpoints(1, viewport, {}, {});
    const first = layer._midpoints.get('a');
    assert.isOk(first);
    assert.sameMembers([...layer._midpoints.keys()], ['a', 'b']);

    layer.renderMidpoints(2, viewport, {}, {});
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

    layer.renderMidpoints(1, viewport, {}, {});
    const first = layer._midpoints.get('a');
    layer.renderMidpoints(2, viewport, {}, {});
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

    layer.renderMidpoints(1, viewport, {}, {});
    layer.renderMidpoints(2, viewport, {}, {});
    assert.deepEqual(layer._midpoints.get('a').props.edge, ['n1', 'n3']);
  });

  it('links a midpoint to its way again after the way\'s redraw replaced its links', () => {
    const context = new Rapid.MockContext();
    const viewport = new Rapid.sdk.Viewport();
    const a = midpointProps('a', [0, 0]);
    const layer = makeLayer(context, [[a], [a]]);

    layer.renderMidpoints(1, viewport, {}, {});
    layer.clearChildData('w1');                     // what `renderLines` does when the way changes
    layer.addChildData('w1', ['n1', 'n2']);
    layer.renderMidpoints(2, viewport, {}, {});

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

    // A frame whose view is `VIEW`, with or without time left
    function makeFrame(hasTime, props = {}) {
      const frame = new RenderFrame(1, 17);
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
          lookups++;
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
        assert.strictEqual(lookups, 60);
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
        layer.reset();
        assert.strictEqual(layer.numWaiting, 0);
      });
    });
  });

});
