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
});
