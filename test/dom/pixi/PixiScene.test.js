import * as PIXI from 'pixi.js';
import 'pixi.js/events';   // gives containers `eventMode`, as a renderer does in the app
import { PixiLayerKeepRight } from '../../../modules/pixi/PixiLayerKeepRight.ts';
import { PixiLayerOsm } from '../../../modules/pixi/PixiLayerOsm.ts';
import { PixiLayerOsmNotes } from '../../../modules/pixi/PixiLayerOsmNotes.ts';
import { PixiLayerRapid } from '../../../modules/pixi/PixiLayerRapid.ts';
import { FillBatchMesh } from '../../../modules/pixi/lib/FillBatchMesh.ts';
import { LineBatchMesh } from '../../../modules/pixi/lib/LineBatchMesh.ts';
import { PointBatchMesh } from '../../../modules/pixi/lib/PointBatchMesh.ts';
import { PixiScene } from '../../../modules/pixi/PixiScene.ts';
import { RenderFrame } from '../../../modules/pixi/RenderFrame.ts';
import { BatchShaders } from '../../../modules/pixi/lib/BatchShaders.ts';

// The shaders that a scene's batches draw with (every batch of a kind shares its kind's shader)
const batchShaders = new BatchShaders();


describe('PixiScene', () => {

  // A real scene needs WebGL, so `showData` runs on a stand-in scene that has real layers.
  describe('showData', () => {
    let context, scene, changes, enabledDatasetIDs;

    beforeEach(() => {
      context = new Rapid.MockContext();
      changes = 0;
      enabledDatasetIDs = [];

      const startAsync = () => Promise.resolve();
      context.services = { osm: { startAsync }, keepright: { startAsync }, mapwithai: { startAsync } };
      const rapid = {
        catalog: new Map([['fbRoads', { id: 'fbRoads', spatialID: 'fbRoads' }]]),
        enabledDatasetIDs: new Set(),
        enableDatasets: datasetID => {
          rapid.enabledDatasetIDs.add(datasetID);
          enabledDatasetIDs.push(datasetID);
        }
      };
      context.systems = { rapid: rapid };

      const gfx = { immediateRedraw: () => {} };
      scene = { context: context, gfx: gfx, layers: new Map(), _layerChanged: () => changes++ };
      for (const Layer of [PixiLayerOsm, PixiLayerRapid, PixiLayerOsmNotes, PixiLayerKeepRight]) {
        const layer = new Layer(scene);
        layer.enabled = false;
        scene.layers.set(layer.id, layer);
      }
    });

    const enabledLayerIDs = () => [...scene.layers.values()].filter(layer => layer.enabled).map(layer => layer.id);

    it('turns on the layer that draws each datum, whose ID is its spatial ID', () => {
      PixiScene.prototype.showData.call(scene, ['w1', 'osm-notes:123', 'keepright:4']);
      assert.sameMembers(enabledLayerIDs(), ['osm', 'osm-notes', 'keepright']);
      assert.strictEqual(changes, 1);
    });

    it('turns on a Rapid dataset along with its layer, for its data or a piece of one of its lines', () => {
      PixiScene.prototype.showData.call(scene, ['fbRoads.pieces:w-1@0-0.5']);
      assert.deepEqual(enabledLayerIDs(), ['rapid']);
      assert.deepEqual(enabledDatasetIDs, ['fbRoads']);

      PixiScene.prototype.showData.call(scene, ['fbRoads:w-2']);
      assert.deepEqual(enabledDatasetIDs, ['fbRoads']);   // already on
    });

    it('leaves the layers alone for data no layer draws, and doesn\'t say the layers changed', () => {
      PixiScene.prototype.showData.call(scene, ['nowhere:1']);
      assert.deepEqual(enabledLayerIDs(), []);
      assert.strictEqual(changes, 0);
    });
  });


  // The containers for each spatial ID under the groups, and which of them the pointer can reach
  // (see `design/scene.md`). Plain containers need no WebGL, so this runs on a stand-in scene too.
  describe('spatial containers', () => {
    let scene;

    beforeEach(() => {
      scene = {
        groups: new Map(['basemap', 'points'].map(id => {
          const group = new PIXI.Container();
          group.label = id;
          return [id, group];
        })),
        _spatialContainers: new Map(),
        _interactiveSpatialIDs: null,
        _hitTesters: new Map(),
        _hitWorld: new PIXI.Point(),
        _anchor: [0, 0],
        _worldContainers: new Set(),
        layers: new Map(),
        gfx: { origin: new PIXI.Container() }
      };
      const names = [
        'getSpatialContainer', 'releaseSpatialContainers', '_isInteractive', '_modeChanged',
        '_eventMode', 'setHitTester', 'hitTest',
        'worldContainer', 'worldContainersIn', 'destroyWorldContainer', 'setAnchor'
      ];
      for (const name of names) {
        scene[name] = PixiScene.prototype[name];
      }
    });

    it('makes one container per spatial ID in a group, and returns the same one again', () => {
      const osm = scene.getSpatialContainer('basemap', 'osm');
      assert.strictEqual(osm.label, 'osm');
      assert.isTrue(osm.sortableChildren);
      assert.strictEqual(scene.getSpatialContainer('basemap', 'osm'), osm);
      assert.notStrictEqual(scene.getSpatialContainer('points', 'osm'), osm);   // another group
      assert.strictEqual(scene.groups.get('basemap').children.length, 1);
    });

    it('puts each container in its own render group, under the group', () => {
      const osm = scene.getSpatialContainer('basemap', 'osm');
      const renderGroup = osm.parent;
      assert.isTrue(renderGroup.isRenderGroup);
      assert.isFalse(osm.isRenderGroup);
      assert.strictEqual(renderGroup.label, 'osm');
      assert.strictEqual(renderGroup.parent, scene.groups.get('basemap'));
      assert.deepEqual(scene.worldContainersIn(scene.groups.get('basemap')), [osm]);
    });

    it('stacks OSM lowest and the other spatial IDs above it in the order they were made', () => {
      scene.getSpatialContainer('basemap', 'fbRoads');
      scene.getSpatialContainer('basemap', 'osm');
      scene.getSpatialContainer('basemap', 'msBuildings');
      const zIndexes = Object.fromEntries(scene.groups.get('basemap').children.map(c => [c.label, c.zIndex]));
      assert.deepEqual(zIndexes, { osm: 0, fbRoads: 1, msBuildings: 2 });
    });

    it('throws for a group that doesn\'t exist', () => {
      assert.throws(() => scene.getSpatialContainer('nowhere', 'osm'), /no group/);
    });

    it('lets the pointer reach only the spatial IDs the mode lists, in every group', () => {
      const basemapOsm = scene.getSpatialContainer('basemap', 'osm');
      const basemapRapid = scene.getSpatialContainer('basemap', 'fbRoads');
      const pointsRapid = scene.getSpatialContainer('points', 'fbRoads');
      assert.strictEqual(basemapRapid.eventMode, 'passive');   // no mode yet: everything

      scene._modeChanged({ interactiveSpatialIDs: new Set(['osm']) });
      assert.strictEqual(basemapOsm.eventMode, 'passive');
      assert.strictEqual(basemapRapid.eventMode, 'none');
      assert.strictEqual(pointsRapid.eventMode, 'none');

      // a container made while the mode is active gets the same answer
      const pointsOsm = scene.getSpatialContainer('points', 'osm');
      const pointsNotes = scene.getSpatialContainer('points', 'osm-notes');
      assert.strictEqual(pointsOsm.eventMode, 'passive');
      assert.strictEqual(pointsNotes.eventMode, 'none');

      scene._modeChanged({ interactiveSpatialIDs: null });   // browse: everything again
      assert.strictEqual(basemapRapid.eventMode, 'passive');
      assert.strictEqual(pointsNotes.eventMode, 'passive');

      // ..and the layers hear of each change of mode
      let told = 0;
      scene.layers.set('osm', { modeChanged: () => told++ });
      scene._modeChanged(null);   // no mode at all
      assert.strictEqual(told, 1);
      assert.strictEqual(pointsNotes.eventMode, 'passive');
    });

    // A layer that keeps its data in a spatial index finds its own features under the pointer,
    // and Pixi's hit test (which asks every container in the scene) leaves its containers out.
    describe('hit testing', () => {
      // A stand-in feature with a container in the scene
      function featureIn(parent, id) {
        const container = new PIXI.Container();
        const feature = { id: id, container: container, sceneContainer: container, sceneOrder: 0 };
        container.__feature__ = feature;
        parent.addChild(container);
        return feature;
      }

      it('keeps Pixi out of the containers of a spatial ID whose layer finds its own features', () => {
        const before = scene.getSpatialContainer('basemap', 'osm');
        const rapid = scene.getSpatialContainer('basemap', 'fbRoads');
        assert.strictEqual(before.eventMode, 'passive');

        scene.setHitTester('osm', { hitTest: () => null });
        const after = scene.getSpatialContainer('points', 'osm');   // made afterwards
        assert.strictEqual(before.eventMode, 'none');
        assert.strictEqual(after.eventMode, 'none');
        assert.strictEqual(rapid.eventMode, 'passive');

        scene._modeChanged({ interactiveSpatialIDs: new Set(['osm']) });   // whatever the mode says
        assert.strictEqual(before.eventMode, 'none');
        scene._modeChanged(null);
        assert.strictEqual(before.eventMode, 'none');

        scene.setHitTester('osm', null);   // back to Pixi
        assert.strictEqual(before.eventMode, 'passive');
        assert.strictEqual(after.eventMode, 'passive');
      });

      it('returns the feature that Pixi\'s target belongs to when no layer finds its own', () => {
        const feature = featureIn(scene.getSpatialContainer('basemap', 'fbRoads'), 'a');
        const child = new PIXI.Container();
        feature.container.addChild(child);
        assert.strictEqual(scene.hitTest({ x: 1, y: 2 }, child), feature);
        assert.strictEqual(scene.hitTest({ x: 1, y: 2 }, feature.container), feature);
        assert.isNull(scene.hitTest({ x: 1, y: 2 }, scene.groups.get('basemap')));   // no feature there
        assert.isNull(scene.hitTest({ x: 1, y: 2 }, null));
        assert.isNull(scene.hitTest({ x: 1, y: 2 }));
      });

      it('asks the layer, with the point on the stage and in the world', () => {
        const feature = featureIn(scene.getSpatialContainer('basemap', 'osm'), 'w1');
        const asked = [];
        scene.setHitTester('osm', { hitTest: (point, world) => { asked.push([point.x, point.y, world.x, world.y]); return feature; } });

        // `origin` is at 100,50 and draws the world at twice its size
        const origin = scene.gfx.origin;
        const stage = new PIXI.Container({ isRenderGroup: true });
        stage.addChild(origin);
        origin.position.set(100, 50);
        origin.scale.set(2);
        origin.updateLocalTransform();
        origin.relativeGroupTransform.copyFrom(origin.localTransform);   // as a render would

        assert.strictEqual(scene.hitTest({ x: 120, y: 60 }), feature);
        assert.deepEqual(asked, [[120, 60, 10, 5]]);
      });

      it('takes whichever is drawn on top: the layer\'s feature, or Pixi\'s', () => {
        const line = featureIn(scene.getSpatialContainer('basemap', 'osm'), 'w1');
        const rapidLine = featureIn(scene.getSpatialContainer('basemap', 'fbRoads'), 'fbRoads:w-1');
        const point = featureIn(scene.getSpatialContainer('points', 'osm'), 'n1');
        scene.groups.get('basemap').sortChildren();

        // the groups are children of `origin`, basemap under points
        const origin = scene.gfx.origin;
        origin.addChild(scene.groups.get('basemap'), scene.groups.get('points'));

        let found = line;
        scene.setHitTester('osm', { hitTest: () => found });
        assert.strictEqual(scene.hitTest({ x: 0, y: 0 }, null), line);                   // nothing else there
        assert.strictEqual(scene.hitTest({ x: 0, y: 0 }, rapidLine.container), rapidLine);   // Rapid's data is above OSM's lines

        found = point;
        assert.strictEqual(scene.hitTest({ x: 0, y: 0 }, rapidLine.container), point);   // ..and below OSM's points

        found = null;
        assert.strictEqual(scene.hitTest({ x: 0, y: 0 }, rapidLine.container), rapidLine);
        assert.isNull(scene.hitTest({ x: 0, y: 0 }, null));
      });

      it('goes by where a feature is drawn, which needn\'t be its own container', () => {
        // A line that a batch draws: its container isn't in the scene, the batch is
        const batch = new PIXI.Container();
        scene.getSpatialContainer('basemap', 'osm').addChild(batch);
        const line = { id: 'w1', container: new PIXI.Container(), sceneContainer: batch, sceneOrder: 0 };
        const rapidLine = featureIn(scene.getSpatialContainer('basemap', 'fbRoads'), 'fbRoads:w-1');
        scene.groups.get('basemap').sortChildren();
        scene.gfx.origin.addChild(scene.groups.get('basemap'));

        scene.setHitTester('osm', { hitTest: () => line });
        assert.strictEqual(scene.hitTest({ x: 0, y: 0 }, null), line);
        assert.strictEqual(scene.hitTest({ x: 0, y: 0 }, rapidLine.container), rapidLine);
      });

      it('doesn\'t ask a layer whose data the mode keeps from the pointer', () => {
        let asked = 0;
        scene.setHitTester('fbRoads', { hitTest: () => { asked++; return null; } });
        scene._modeChanged({ interactiveSpatialIDs: new Set(['osm']) });
        assert.isNull(scene.hitTest({ x: 0, y: 0 }, null));
        assert.strictEqual(asked, 0);

        scene._modeChanged({ interactiveSpatialIDs: null });
        scene.hitTest({ x: 0, y: 0 }, null);
        assert.strictEqual(asked, 1);
      });
    });


    it('releases a spatial ID\'s containers from every group, and forgets them', () => {
      const basemapRapid = scene.getSpatialContainer('basemap', 'fbRoads');
      const pointsRapid = scene.getSpatialContainer('points', 'fbRoads');
      const osm = scene.getSpatialContainer('basemap', 'osm');

      scene.releaseSpatialContainers('fbRoads');
      assert.isTrue(basemapRapid.destroyed);
      assert.isTrue(pointsRapid.destroyed);
      assert.isFalse(osm.destroyed);
      assert.deepEqual(scene.groups.get('basemap').children.map(c => c.label), ['osm']);
      assert.deepEqual(scene.groups.get('points').children, []);
      assert.isFalse(scene._spatialContainers.has('fbRoads'));

      scene.releaseSpatialContainers('fbRoads');   // nothing to do, no error
      assert.notStrictEqual(scene.getSpatialContainer('basemap', 'fbRoads'), basemapRapid);   // a new one
    });
  });


  // A render group keeps its vertices as 32-bit floats relative to itself, and world coordinates are
  // too big for that. So each render group sits at the anchor (a world coordinate near the view), and
  // the container in it sits at minus the anchor (see "Render groups" in `design/scene.md`).
  describe('world containers', () => {
    let scene, origin;

    beforeEach(() => {
      origin = new PIXI.Container();
      scene = { _anchor: [0, 0], _worldContainers: new Set() };
      for (const name of ['worldContainer', 'worldContainersIn', 'setAnchor']) {
        scene[name] = PixiScene.prototype[name];
      }
    });

    // Where a child at the given world coordinate ends up, relative to the container's render group
    function fromRenderGroup(container, world) {
      const group = container.parent;
      return [world[0] + container.x, world[1] + container.y, group.x, group.y];
    }

    it('makes a container once, with the given label and zIndex on its render group', () => {
      const lines = scene.worldContainer(origin, 'lines', 3);
      assert.strictEqual(lines.label, 'lines');
      assert.strictEqual(lines.parent.label, 'lines');
      assert.strictEqual(lines.parent.zIndex, 3);
      assert.strictEqual(lines.parent.parent, origin);
      assert.strictEqual(scene.worldContainer(origin, 'lines', 99), lines);   // found, not made again
      assert.strictEqual(lines.parent.zIndex, 3);
    });

    it('keeps what is in a container a small distance from its render group', () => {
      scene.setAnchor([8725231.4, 5581026.2]);   // Bochum
      const lines = scene.worldContainer(origin, 'lines');
      const level = scene.worldContainer(lines, '0');   // one inside another

      // a feature 100 world units from the anchor is 100 units from its render group, wherever that is
      assert.deepEqual(fromRenderGroup(lines, [8725331, 5581026]), [100, 0, 8725231, 5581026]);
      assert.deepEqual(fromRenderGroup(level, [8725331, 5581026]), [100, 0, 8725231, 5581026]);
    });

    it('moves every container when the anchor moves, and a feature stays where it was in the world', () => {
      const lines = scene.worldContainer(origin, 'lines');
      const level = scene.worldContainer(lines, '0');
      const feature = new PIXI.Container();
      feature.position.set(2748500, 5712300);   // Seattle
      level.addChild(feature);
      origin.updateLocalTransform();

      const before = feature.toGlobal({ x: 0, y: 0 });
      scene.setAnchor([2748421, 5712345]);
      const after = feature.toGlobal({ x: 0, y: 0 });

      assert.deepEqual([after.x, after.y], [before.x, before.y]);
      assert.deepEqual(fromRenderGroup(level, [2748500, 5712300]), [79, -45, 2748421, 5712345]);
    });

    it('forgets containers that were destroyed along with their parent', () => {
      const lines = scene.worldContainer(origin, 'lines');
      scene.worldContainer(lines, '0');
      lines.parent.destroy({ children: true });

      scene.setAnchor([100, 100]);   // no error
      assert.strictEqual(scene._worldContainers.size, 0);
    });
  });


  // Label space is the scene's (`scene.labelSpace`, see `LabelSpace.test.js`): it's a new one for
  // a new zoom or rotation.
  describe('dirtyTransform', () => {
    it('starts a new label space, and tells every layer', () => {
      const told = [];
      const scene = Object.create(PixiScene.prototype);
      scene.labelSpace = { reset: () => told.push('label space') };
      scene.layers = new Map([['osm', { dirtyTransform: () => told.push('osm') }]]);
      scene.dirtyTransform();
      assert.deepEqual(told, ['label space', 'osm']);
    });
  });


  describe('render', () => {
    it('renders and culls each layer with the frame, and records its stats on the frame', () => {
      const calls = [];
      const makeLayer = (id, enabled, visibility, kept) => ({
        id: id,
        enabled: enabled,
        features: new Map(visibility.map((visible, i) => [`${id}-${i}`, { visible: visible }])),
        numVisible: visibility.filter(Boolean).length,
        render: (frame, viewport) => calls.push(`render ${id} ${frame.id} ${viewport}`),
        cull: frame => calls.push(`cull ${id} ${frame.id}`),
        keptFeatures: () => kept,
        numWaiting: 0,
        numWaitingInView: 0,
        takeWork: () => ({ created: 1, destroyed: 0, updated: 2, shown: 0, hidden: 0, steps: { gather: 0.5 } })
      });
      const scene = {
        gfx: { origin: 'origin' },
        labelSpace: { update: (origin, viewport) => calls.push(`label space ${origin} ${viewport}`) },
        setBatchViews: viewport => calls.push(`batch views ${viewport}`),
        layers: new Map([
          ['osm', makeLayer('osm', true, [true, true, false], true)],
          ['keepright', makeLayer('keepright', false, [false], false)]
        ])
      };
      const frame = new RenderFrame(7, 17);

      PixiScene.prototype.render.call(scene, frame, 'viewport');

      // (The batches' shaders hear about the view before any layer draws into a batch.)
      assert.deepEqual(calls, [
        'label space origin viewport', 'batch views viewport',
        'render osm 7 viewport', 'cull osm 7', 'render keepright 7 viewport', 'cull keepright 7'
      ]);
      const osm = frame.layers.get('osm');
      assert.include(osm, { enabled: true, kept: true, features: 3, visible: 2, created: 1, updated: 2 });
      assert.deepEqual(osm.steps, { gather: 0.5 });
      assert.isAtLeast(osm.renderMs, 0);
      assert.isAtLeast(osm.cullMs, 0);
      assert.include(frame.layers.get('keepright'), { enabled: false, kept: false, features: 1, visible: 0 });
    });

    it('lets layers go on with work they put off once every layer has rendered, and says if more is left', () => {
      const calls = [];
      let seenByLabels = null;
      const makeLayer = (id, waitingInView, waitingOutside, leftAfter) => {
        const layer = {
          id: id,
          enabled: true,
          features: new Map(),
          numWaiting: waitingInView + waitingOutside,
          numWaitingInView: waitingInView,
          render: frame => {
            calls.push(`render ${id}`);
            if (id === 'labels') seenByLabels = frame.waitingInView;
          },
          cull: () => {},
          continueWaiting: (frame, viewport, outside) => {
            calls.push(`continue ${id} ${outside}`);
            layer.numWaiting = leftAfter;
          },
          keptFeatures: () => false,
          takeWork: () => ({ created: 0, destroyed: 0, updated: 0, shown: 0, hidden: 0, steps: {} })
        };
        return layer;
      };

      const scene = {
        gfx: { origin: null },
        labelSpace: { update: () => {} },
        setBatchViews: () => {},
        layers: new Map([
          ['osm', makeLayer('osm', 40, 100, 60)],
          ['rapid', makeLayer('rapid', 0, 0, 0)],
          ['labels', makeLayer('labels', 0, 0, 0)]
        ])
      };
      const frame = new RenderFrame(7, 17);
      PixiScene.prototype.render.call(scene, frame, 'viewport');

      // every layer renders first, then the ones with work waiting go on with it
      assert.deepEqual(calls, ['render osm', 'render rapid', 'render labels', 'continue osm true']);
      assert.strictEqual(seenByLabels, 40);   // the labels can tell that features in view are still to come
      assert.strictEqual(frame.layers.get('osm').waiting, 60);
      assert.strictEqual(frame.layers.get('rapid').waiting, 0);
      assert.isTrue(frame.unfinished);

      // ..and once nothing is left, no further frame is asked for
      scene.layers.get('osm').numWaitingInView = 0;
      scene.layers.get('osm').continueWaiting = (f, v, outside) => { scene.layers.get('osm').numWaiting = 0; };
      const next = new RenderFrame(8, 17);
      PixiScene.prototype.render.call(scene, next, 'viewport');
      assert.isFalse(next.unfinished);
      assert.strictEqual(next.layers.get('osm').waiting, 0);
    });
  });


  // Every batch of a kind draws with the same few numbers about the view, which the scene sets
  // before the layers render. Nothing in a batch changes for a zoom.
  describe('setBatchViews', () => {
    let lineBatch, fillBatch, lines, fills, scene, map;

    const viewportAt = (zoom, rotation = 0) => ({ transform: { zoom: zoom, rotation: rotation } });
    const lineView = () => [lines.uPixel, lines.uNarrow, lines.uWireframe, lines.uCasing, lines.uMarkers];

    beforeEach(() => {
      lineBatch = new LineBatchMesh(batchShaders.lines);
      fillBatch = new FillBatchMesh(batchShaders.fills);
      lines = lineBatch.shader.resources.lineUniforms.uniforms;
      fills = fillBatch.shader.resources.fillUniforms.uniforms;
      map = { wireframeMode: false, effectiveZoom: () => 17 };
      scene = { context: { systems: { map: map } }, batchShaders: batchShaders };
    });
    afterEach(() => {
      batchShaders.lines.setView({ pixel: 1, narrow: 0, wireframe: false, casing: true, markers: true });
      batchShaders.fills.setView({ pixel: 1, rotation: 0, wireframe: false });
      lineBatch.destroy();
      fillBatch.destroy();
    });

    it('says what a pixel is in world coordinates at the view\'s zoom', () => {
      PixiScene.prototype.setBatchViews.call(scene, viewportAt(16));
      assert.strictEqual(lines.uPixel, 1);
      assert.strictEqual(fills.uPixel, 1);

      PixiScene.prototype.setBatchViews.call(scene, viewportAt(18));
      assert.strictEqual(lines.uPixel, 0.25);
      assert.strictEqual(fills.uPixel, 0.25);

      PixiScene.prototype.setBatchViews.call(scene, viewportAt(14.5));
      assert.closeTo(lines.uPixel, 2 * Math.SQRT2, 1e-6);
      assert.closeTo(fills.uPixel, 2 * Math.SQRT2, 1e-6);
    });

    it('draws lines as they are from zoom 17, narrower below, and without casings or markers below 16', () => {
      const expected = [
        [19, [0, 1, 1]],
        [17, [0, 1, 1]],
        [16.99, [2, 1, 1]],
        [16, [2, 1, 1]],
        [15.99, [4, 0, 0]],
        [12, [4, 0, 0]]
      ];
      for (const [zoom, numbers] of expected) {
        map.effectiveZoom = () => zoom;
        PixiScene.prototype.setBatchViews.call(scene, viewportAt(zoom));
        assert.deepEqual(lineView().slice(1), [numbers[0], 0, numbers[1], numbers[2]], `at zoom ${zoom}`);
      }
    });

    it('takes what the zoom does to the styles from the map, and a pixel from the view', () => {
      map.effectiveZoom = () => 15;        // the map says how far along a zoom the styles are
      PixiScene.prototype.setBatchViews.call(scene, viewportAt(17));
      assert.deepEqual(lineView(), [0.5, 4, 0, 0, 0]);
    });

    it('says when the map is in wireframe mode, and how it\'s turned', () => {
      map.wireframeMode = true;
      PixiScene.prototype.setBatchViews.call(scene, viewportAt(17, Math.PI / 2));
      assert.strictEqual(lines.uWireframe, 1);
      assert.strictEqual(fills.uWireframe, 1);
      assert.closeTo(fills.uRotation[0], 0, 1e-6);    // the cosine and the sine of the map's rotation
      assert.closeTo(fills.uRotation[1], 1, 1e-6);

      map.wireframeMode = false;
      PixiScene.prototype.setBatchViews.call(scene, viewportAt(17, 0));
      assert.strictEqual(lines.uWireframe, 0);
      assert.strictEqual(fills.uWireframe, 0);
      assert.deepEqual([fills.uRotation[0], fills.uRotation[1]], [1, 0]);
    });

    it('goes by the view\'s zoom alone where there is no map', () => {
      scene.context.systems = {};
      PixiScene.prototype.setBatchViews.call(scene, viewportAt(15.5));
      assert.closeTo(lines.uPixel, Math.SQRT2, 1e-6);
      assert.deepEqual(lineView().slice(1), [4, 0, 0, 0]);
      assert.strictEqual(fills.uWireframe, 0);

      PixiScene.prototype.setBatchViews.call(scene, viewportAt(16.5));
      assert.deepEqual(lineView().slice(1), [2, 0, 1, 1]);
    });
  });


  // The glow of what's hovered or highlighted breathes, and the dashes around what's selected
  // march. Nothing in a batch is written for that: the scene tells the batches' shaders what the
  // clock says before a frame is drawn, and `GraphicsSystem` keeps frames coming while
  // `animated` is true.
  describe('what moves by itself', () => {
    let lineBatch, pointBatch, lines, points, scene;

    beforeEach(() => {
      lineBatch = new LineBatchMesh(batchShaders.lines);
      pointBatch = new PointBatchMesh(batchShaders.points);
      lines = lineBatch.shader.resources.lineUniforms.uniforms;
      points = pointBatch.shader.resources.pointUniforms.uniforms;
      scene = {
        _dataHasClass: new Map(),
        _classHasData: new Map(),
        _pulsing: new Map(),
        _reducedMotion: { matches: false },
        layers: new Map(),
        gfx: { requestFrame: () => {} },
        batchShaders: batchShaders
      };
      const names = ['setClass', 'unsetClass', 'clearClass', '_classChanged', 'animate', 'addPulsing', 'removePulsing'];
      for (const name of names) {
        scene[name] = PixiScene.prototype[name];
      }
      Object.defineProperty(scene, 'animated', Object.getOwnPropertyDescriptor(PixiScene.prototype, 'animated'));
    });
    afterEach(() => {
      batchShaders.lines.setTime({ pulse: 1, shift: 0 });
      batchShaders.points.setTime(1);
      lineBatch.destroy();
      pointBatch.destroy();
    });

    describe('animated', () => {
      it('is false while nothing is hovered, highlighted or selected', () => {
        assert.isFalse(scene.animated);
        scene.setClass('drawing', 'w1');
        scene.setClass('selectphoto', 'photo1');
        assert.isFalse(scene.animated);
      });

      it('is true while some data has one of those classes, and false again after', () => {
        for (const classID of ['hover', 'highlight', 'select']) {
          scene.setClass(classID, 'w1');
          assert.isTrue(scene.animated, classID);
          scene.unsetClass(classID, 'w1');
          assert.isFalse(scene.animated, `after ${classID}`);
        }

        scene.setClass('select', 'w1');
        scene.setClass('select', 'w2');
        scene.unsetClass('select', 'w1');
        assert.isTrue(scene.animated, 'something is still selected');
        scene.clearClass('select');
        assert.isFalse(scene.animated);
      });

      it('is never true for a user who asked for less motion', () => {
        scene._reducedMotion = { matches: true };
        scene.setClass('hover', 'w1');
        scene.setClass('select', 'w2');
        assert.isFalse(scene.animated);
      });

      it('is true where the browser can\'t say what the user asked for', () => {
        scene._reducedMotion = null;
        scene.setClass('hover', 'w1');
        assert.isTrue(scene.animated);
      });
    });

    describe('animate', () => {
      it('makes every glow breathe: brightest, 0.45 less, and brightest again in 1.6 seconds', () => {
        scene.animate(0);
        assert.closeTo(lines.uGlow, 1, 1e-9);
        assert.closeTo(points.uPulse, 1, 1e-9);

        scene.animate(400);      // a quarter of the way
        assert.closeTo(lines.uGlow, 1 - 0.45 / 2, 1e-6);
        assert.closeTo(points.uPulse, 1 - 0.45 / 2, 1e-6);

        scene.animate(800);
        assert.closeTo(lines.uGlow, 0.55, 1e-6);
        assert.closeTo(points.uPulse, 0.55, 1e-6);

        scene.animate(1600);
        assert.closeTo(lines.uGlow, 1, 1e-6);

        for (let now = 0; now < 5000; now += 37) {
          scene.animate(now);
          assert.isAtLeast(lines.uGlow, 0.55 - 1e-6);
          assert.isAtMost(lines.uGlow, 1 + 1e-6);
          assert.closeTo(points.uPulse, lines.uGlow, 1e-6, 'points and lines breathe together');
        }
      });

      it('moves the dashes of the lines that march 20 pixels a second', () => {
        scene.animate(0);
        assert.strictEqual(lines.uShift, 0);
        scene.animate(1000);
        assert.closeTo(lines.uShift, 20, 1e-4);
        scene.animate(2500);
        assert.closeTo(lines.uShift, 50, 1e-4);
      });

      it('starts the dashes\' distance again after a whole number of their patterns, so nothing jumps', () => {
        const wrap = 9 * 4096;                       // pixels: a halo's dashes repeat every 9
        const msToWrap = wrap / 20 * 1000;
        scene.animate(msToWrap - 1000);
        assert.closeTo(lines.uShift, wrap - 20, 1e-2);
        scene.animate(msToWrap + 1000);
        assert.closeTo(lines.uShift, 20, 1e-2);
        assert.strictEqual(wrap % 9, 0);
      });

      it('moves nothing for a user who asked for less motion: glows at their brightest, dashes where they are', () => {
        scene._reducedMotion = { matches: true };
        for (const now of [0, 800, 123456]) {
          scene.animate(now);
          assert.strictEqual(lines.uGlow, 1);
          assert.strictEqual(points.uPulse, 1);
          assert.strictEqual(lines.uShift, 0);
        }
      });

      it('leaves the glows at their brightest in the last frame before a rest, with the dashes where they\'d be', () => {
        scene.animate(800, true);
        assert.strictEqual(lines.uGlow, 1);
        assert.strictEqual(points.uPulse, 1);
        assert.closeTo(lines.uShift, 16, 1e-4);

        scene.animate(800, false);
        assert.closeTo(lines.uGlow, 0.55, 1e-6);
      });

      it('gives the sprites that pulse their opacity at this moment', () => {
        const glow = new PIXI.Sprite();
        const dimmer = new PIXI.Sprite();
        scene.addPulsing(glow, 0.9);
        scene.addPulsing(dimmer, 0.5);

        scene.animate(0);
        assert.closeTo(glow.alpha, 0.9, 1e-6);
        assert.closeTo(dimmer.alpha, 0.5, 1e-6);

        scene.animate(800);
        assert.closeTo(glow.alpha, 0.9 * 0.55, 1e-6);
        assert.closeTo(dimmer.alpha, 0.5 * 0.55, 1e-6);

        scene.animate(800, true);
        assert.closeTo(glow.alpha, 0.9, 1e-6);
      });

      it('leaves a sprite alone once it was taken back', () => {
        const glow = new PIXI.Sprite();
        scene.addPulsing(glow, 0.9);
        scene.animate(800);
        scene.removePulsing(glow);
        assert.strictEqual(scene._pulsing.size, 0);

        glow.alpha = 0.25;
        scene.animate(0);
        assert.strictEqual(glow.alpha, 0.25);
        scene.removePulsing(glow);      // again: nothing to do
      });

      it('keeps one opacity for a sprite that says so twice: the last', () => {
        const glow = new PIXI.Sprite();
        scene.addPulsing(glow, 0.9);
        scene.addPulsing(glow, 0.4);
        assert.strictEqual(scene._pulsing.size, 1);
        scene.animate(0);
        assert.closeTo(glow.alpha, 0.4, 1e-6);
      });
    });
  });


  // A layer that keeps its features hears which data changed class, so it can draw that data's
  // features again without its pass (a hover).
  describe('classes', () => {
    let scene, told;

    beforeEach(() => {
      told = [];
      scene = {
        _dataHasClass: new Map(),
        _classHasData: new Map(),
        layers: new Map([
          ['osm', { classChanged: dataID => told.push(`osm ${dataID}`) }],
          ['rapid', { classChanged: dataID => told.push(`rapid ${dataID}`) }]
        ]),
        gfx: {
          requestFrame: () => told.push('frame'),
          deferredRedraw: () => told.push('redraw'),
          immediateRedraw: () => told.push('redraw')
        }
      };
      for (const name of ['setClass', 'unsetClass', 'clearClass', 'getDataWithClass', 'getClasses', '_classChanged']) {
        scene[name] = PixiScene.prototype[name];
      }
    });

    it('tells every layer when a class is set on some data, once, and asks for a frame (not a redraw)', () => {
      scene.setClass('hover', 'w1');
      assert.deepEqual(told, ['osm w1', 'rapid w1', 'frame']);
      assert.deepEqual([...scene.getClasses('w1')], ['hover']);

      scene.setClass('hover', 'w1');   // it has it already
      assert.strictEqual(told.length, 3);
    });

    it('tells every layer when a class is unset, and not when the data never had it', () => {
      scene.setClass('hover', 'w1');
      told.length = 0;

      scene.unsetClass('select', 'w1');
      scene.unsetClass('hover', 'w2');
      assert.deepEqual(told, []);

      scene.unsetClass('hover', 'w1');
      assert.deepEqual(told, ['osm w1', 'rapid w1', 'frame']);
      assert.strictEqual(scene.getDataWithClass('hover').size, 0);
    });

    it('tells the layers about each data that a cleared class was on', () => {
      scene.setClass('hover', 'w1');
      scene.setClass('hover', 'n1');
      scene.setClass('select', 'w2');
      told.length = 0;

      scene.clearClass('hover');
      assert.sameMembers(told.filter(what => what !== 'frame'), ['osm w1', 'rapid w1', 'osm n1', 'rapid n1']);
      assert.include(told, 'frame');
      assert.notInclude(told, 'redraw');

      told.length = 0;
      scene.clearClass('hover');   // nothing has it now
      assert.deepEqual(told, []);
      assert.deepEqual([...scene.getDataWithClass('select')], ['w2']);
    });
  });


  describe('dataChanged', () => {
    it('tells the one layer which data changed, and asks for a frame (not a redraw)', () => {
      const told = [];
      const scene = {
        layers: new Map([
          ['osm', { dataChanged: dataIDs => told.push(['osm', ...dataIDs]) }],
          ['rapid', { dataChanged: dataIDs => told.push(['rapid', ...dataIDs]) }]
        ]),
        gfx: {
          requestFrame: () => told.push('frame'),
          deferredRedraw: () => told.push('redraw'),
          immediateRedraw: () => told.push('redraw')
        }
      };
      PixiScene.prototype.dataChanged.call(scene, 'osm', ['w1', 'n1']);
      assert.deepEqual(told, [['osm', 'w1', 'n1'], 'frame']);

      told.length = 0;
      PixiScene.prototype.dataChanged.call(scene, 'no-such-layer', ['w1']);
      assert.deepEqual(told.filter(Array.isArray), []);   // no other layer is told
    });
  });


  describe('dataArrived', () => {
    it('tells the one layer which data arrived, and asks for a frame (not a redraw)', () => {
      const told = [];
      const scene = {
        layers: new Map([
          ['osm', { dataArrived: dataIDs => told.push(['osm', ...dataIDs]) }],
          ['rapid', { dataArrived: dataIDs => told.push(['rapid', ...dataIDs]) }]
        ]),
        gfx: {
          requestFrame: () => told.push('frame'),
          deferredRedraw: () => told.push('redraw'),
          immediateRedraw: () => told.push('redraw')
        }
      };
      PixiScene.prototype.dataArrived.call(scene, 'osm', new Set(['w1', 'n1']));
      assert.deepEqual(told, [['osm', 'w1', 'n1'], 'frame']);

      told.length = 0;
      PixiScene.prototype.dataArrived.call(scene, 'no-such-layer', ['w1']);
      assert.deepEqual(told.filter(Array.isArray), []);   // no other layer is told
    });
  });


  describe('texturesLoaded', () => {
    it('tells every layer, and asks for a frame that goes on with waiting work, not for a redraw', () => {
      const calls = [];
      const scene = {
        layers: new Map([
          ['osm', { texturesLoaded: () => calls.push('osm') }],
          ['rapid', { texturesLoaded: () => calls.push('rapid') }]
        ]),
        gfx: {
          requestFrame: () => calls.push('requestFrame'),
          deferredRedraw: () => calls.push('deferredRedraw'),
          immediateRedraw: () => calls.push('immediateRedraw')
        }
      };
      PixiScene.prototype.texturesLoaded.call(scene);
      assert.deepEqual(calls, ['osm', 'rapid', 'requestFrame']);
    });
  });


  // The part of the world layers have features ready for: the view and some padding, kept while
  // the view stays inside it (see "The cull box" in `design/graphics-system.md`).
  describe('updateCullBox', () => {
    let scene;

    // A 1000×800 view at the given zoom, with the given world coordinate at its top left
    function viewportAt(zoom, [x, y]) {
      const viewport = new Rapid.sdk.Viewport({ x: 0, y: 0, z: zoom }, [1000, 800]);
      const [x0, y0] = viewport.worldToScreen([x, y]);
      viewport.transform.translation = [-x0, -y0];
      return viewport;
    }

    beforeEach(() => {
      scene = { _cullBox: null, _cullZoom: 0, cullBoxCovers: PixiScene.prototype.cullBoxCovers };
    });

    it('pads the view by 256 pixels on each side', () => {
      const viewport = viewportAt(16, [10000, 20000]);   // at z16 a pixel is one world unit
      const box = PixiScene.prototype.updateCullBox.call(scene, viewport);
      const view = viewport.visibleWorldExtent();

      assert.closeTo(view.min[0] - box.min[0], 256, 1e-6);
      assert.closeTo(view.min[1] - box.min[1], 256, 1e-6);
      assert.closeTo(box.max[0] - view.max[0], 256, 1e-6);
      assert.closeTo(box.max[1] - view.max[1], 256, 1e-6);
    });

    it('pads by the same number of pixels at another zoom', () => {
      const viewport = viewportAt(18, [10000, 20000]);   // at z18 a pixel is a quarter of a world unit
      const box = PixiScene.prototype.updateCullBox.call(scene, viewport);
      const view = viewport.visibleWorldExtent();
      assert.closeTo(view.min[0] - box.min[0], 64, 1e-6);
    });

    it('returns the same box while the view moves around inside it', () => {
      const box = PixiScene.prototype.updateCullBox.call(scene, viewportAt(16, [10000, 20000]));
      assert.strictEqual(PixiScene.prototype.updateCullBox.call(scene, viewportAt(16, [10200, 19800])), box);
      assert.strictEqual(PixiScene.prototype.updateCullBox.call(scene, viewportAt(16, [9750, 20250])), box);
    });

    it('makes a new box around the view once the view leaves the box', () => {
      const box = PixiScene.prototype.updateCullBox.call(scene, viewportAt(16, [10000, 20000]));
      const viewport = viewportAt(16, [10300, 20000]);
      const moved = PixiScene.prototype.updateCullBox.call(scene, viewport);

      assert.notStrictEqual(moved, box);
      assert.closeTo(viewport.visibleWorldExtent().min[0] - moved.min[0], 256, 1e-6);
      // and coming part of the way back stays inside the new one
      assert.strictEqual(PixiScene.prototype.updateCullBox.call(scene, viewportAt(16, [10100, 20000])), moved);
    });

    it('makes a new box when the zoom changes, even inside the old one', () => {
      const box = PixiScene.prototype.updateCullBox.call(scene, viewportAt(16, [10000, 20000]));
      const zoomed = PixiScene.prototype.updateCullBox.call(scene, viewportAt(16.5, [10100, 20100]));
      assert.notStrictEqual(zoomed, box);
    });

    it('says whether the current box covers a view, without changing it', () => {
      assert.isFalse(scene.cullBoxCovers(viewportAt(16, [10000, 20000])));   // no box yet

      const box = PixiScene.prototype.updateCullBox.call(scene, viewportAt(16, [10000, 20000]));
      assert.isTrue(scene.cullBoxCovers(viewportAt(16, [10200, 19800])));     // inside the padding
      assert.isFalse(scene.cullBoxCovers(viewportAt(16, [10300, 20000])));    // past it
      assert.isFalse(scene.cullBoxCovers(viewportAt(16.5, [10100, 20100])));  // another zoom
      assert.strictEqual(scene._cullBox, box);
    });
  });
});
