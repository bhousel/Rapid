import * as PIXI from 'pixi.js';
import { PixiLayerKeepRight } from '../../../modules/pixi/PixiLayerKeepRight.ts';
import { PixiLayerOsm } from '../../../modules/pixi/PixiLayerOsm.ts';
import { PixiLayerOsmNotes } from '../../../modules/pixi/PixiLayerOsmNotes.ts';
import { PixiLayerRapid } from '../../../modules/pixi/PixiLayerRapid.ts';
import { PixiScene } from '../../../modules/pixi/PixiScene.ts';


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
        _interactiveSpatialIDs: null
      };
      for (const name of ['getSpatialContainer', 'releaseSpatialContainers', '_isInteractive', '_modeChanged']) {
        scene[name] = PixiScene.prototype[name];
      }
    });

    it('makes one container per spatial ID in a group, and returns the same one again', () => {
      const osm = scene.getSpatialContainer('basemap', 'osm');
      assert.strictEqual(osm.label, 'osm');
      assert.strictEqual(osm.parent, scene.groups.get('basemap'));
      assert.isTrue(osm.sortableChildren);
      assert.strictEqual(scene.getSpatialContainer('basemap', 'osm'), osm);
      assert.notStrictEqual(scene.getSpatialContainer('points', 'osm'), osm);   // another group
      assert.strictEqual(scene.groups.get('basemap').children.length, 1);
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
});
