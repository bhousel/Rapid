import * as PIXI from 'pixi.js';
import { PixiLayerKeepRight } from '../../../modules/pixi/PixiLayerKeepRight.ts';
import { PixiLayerOsm } from '../../../modules/pixi/PixiLayerOsm.ts';
import { PixiLayerOsmNotes } from '../../../modules/pixi/PixiLayerOsmNotes.ts';
import { PixiLayerRapid } from '../../../modules/pixi/PixiLayerRapid.ts';
import { PixiScene } from '../../../modules/pixi/PixiScene.ts';
import { RenderFrame } from '../../../modules/pixi/RenderFrame.ts';


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
        _anchor: [0, 0],
        _worldContainers: new Set()
      };
      const names = [
        'getSpatialContainer', 'releaseSpatialContainers', '_isInteractive', '_modeChanged',
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

      scene._modeChanged(null);   // no mode at all
      assert.strictEqual(pointsNotes.eventMode, 'passive');
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
        layers: new Map([
          ['osm', makeLayer('osm', true, [true, true, false], true)],
          ['keepright', makeLayer('keepright', false, [false], false)]
        ])
      };
      const frame = new RenderFrame(7, 17);

      PixiScene.prototype.render.call(scene, frame, 'viewport');

      assert.deepEqual(calls, ['render osm 7 viewport', 'cull osm 7', 'render keepright 7 viewport', 'cull keepright 7']);
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


  describe('texturesLoaded', () => {
    it('tells every layer, and asks for a frame that goes on with waiting work, not for a redraw', () => {
      const calls = [];
      const scene = {
        layers: new Map([
          ['osm', { texturesLoaded: () => calls.push('osm') }],
          ['rapid', { texturesLoaded: () => calls.push('rapid') }]
        ]),
        gfx: {
          resumeWaiting: () => calls.push('resumeWaiting'),
          deferredRedraw: () => calls.push('deferredRedraw'),
          immediateRedraw: () => calls.push('immediateRedraw')
        }
      };
      PixiScene.prototype.texturesLoaded.call(scene);
      assert.deepEqual(calls, ['osm', 'rapid', 'resumeWaiting']);
    });
  });


  // The part of the world layers have features ready for: the view and some padding, kept while
  // the view stays inside it (see "A CULL pass" in `design/graphics-system.md`).
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
