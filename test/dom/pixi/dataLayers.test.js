import * as PIXI from 'pixi.js';
import { PixiLayerGeoScribble } from '../../../modules/pixi/PixiLayerGeoScribble.ts';
import { PixiLayerKartaPhotos } from '../../../modules/pixi/PixiLayerKartaPhotos.ts';
import { PixiLayerKeepRight } from '../../../modules/pixi/PixiLayerKeepRight.ts';
import { PixiLayerMapillaryDetections } from '../../../modules/pixi/PixiLayerMapillaryDetections.ts';
import { PixiLayerMapillaryPhotos } from '../../../modules/pixi/PixiLayerMapillaryPhotos.ts';
import { PixiLayerMapillarySigns } from '../../../modules/pixi/PixiLayerMapillarySigns.ts';
import { PixiLayerMapRoulette } from '../../../modules/pixi/PixiLayerMapRoulette.ts';
import { PixiLayerOsmNotes } from '../../../modules/pixi/PixiLayerOsmNotes.ts';
import { PixiLayerOsmose } from '../../../modules/pixi/PixiLayerOsmose.ts';
import { PixiLayerStreetsidePhotos } from '../../../modules/pixi/PixiLayerStreetsidePhotos.ts';


// The layers that draw data from a service keep their features while only the view moves, as
// the OSM layer does (see "The cull box" in `design/graphics-system.md`): on every frame they
// ask for the tiles that cover the view, and only on a frame that does their pass do they ask
// for the data, in the frame's cull box.
describe('the data layers', () => {
  const LAYERS = [
    { Layer: PixiLayerKeepRight, serviceID: 'keepright', load: 'loadTiles', gets: ['getData'] },
    { Layer: PixiLayerOsmose, serviceID: 'osmose', load: 'loadTiles', gets: ['getData'] },
    { Layer: PixiLayerMapRoulette, serviceID: 'maproulette', load: 'loadTiles', gets: ['getData'] },
    { Layer: PixiLayerOsmNotes, serviceID: 'osm', load: 'loadNotes', gets: ['getNotes'] },
    { Layer: PixiLayerGeoScribble, serviceID: 'geoscribble', load: 'loadTiles', gets: ['getData'] },
    { Layer: PixiLayerMapillaryPhotos, serviceID: 'mapillary', load: 'loadTiles', gets: ['getSequences', 'getData'] },
    { Layer: PixiLayerMapillaryDetections, serviceID: 'mapillary', load: 'loadTiles', gets: ['getData'] },
    { Layer: PixiLayerMapillarySigns, serviceID: 'mapillary', load: 'loadTiles', gets: ['getData'] },
    { Layer: PixiLayerKartaPhotos, serviceID: 'kartaview', load: 'loadTiles', gets: ['getImages', 'getSequences'] },
    { Layer: PixiLayerStreetsidePhotos, serviceID: 'streetside', load: 'loadTiles', gets: ['getImages', 'getSequences'] }
  ];
  const viewport = { transform: { zoom: 17, rotation: 0 } };

  LAYERS.forEach(({ Layer, serviceID, load, gets }) => {
    describe(Layer.name, () => {
      let layer, calls, frame;

      beforeEach(() => {
        const context = new Rapid.MockContext();
        calls = [];
        const service = { started: true, on: () => {} };
        service[load] = () => calls.push(load);
        gets.forEach(get => {
          service[get] = (...args) => { calls.push([get, args.at(-1)]); return []; };
        });
        context.services = { [serviceID]: service };
        context.systems.photos = { fromDate: null, toDate: null, usernames: null, showsPhotoType: () => true };
        const scene = {
          context: context, gfx: {}, layers: new Map(), groups: new Map(),
          getSpatialContainer: () => new PIXI.Container(),
          worldContainer: () => new PIXI.Container(),
          setHitTester: () => {}
        };
        layer = new Layer(scene);
        layer._enabled = true;
        frame = { cullBox: { the: 'cull box' } };
      });

      it('asks for the tiles, and not the data, on a frame where it keeps its features', () => {
        layer.keepFeatures = () => true;
        layer.render(frame, viewport);
        assert.deepEqual(calls, [load]);
      });

      it('asks for the data in the frame\'s cull box on a frame that does its pass', () => {
        layer.keepFeatures = () => false;
        layer.render(frame, viewport);
        assert.strictEqual(calls[0], load);
        assert.deepEqual(calls.slice(1).map(call => call[0]).sort(), [...gets].sort());
        for (const call of calls.slice(1)) {
          assert.strictEqual(call[1], frame.cullBox);
        }
      });
    });
  });
});
