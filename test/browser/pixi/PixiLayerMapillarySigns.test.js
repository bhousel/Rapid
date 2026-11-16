import { PixiLayerMapillaryDetections } from '../../../modules/pixi/PixiLayerMapillaryDetections.ts';
import { PixiLayerMapillarySigns } from '../../../modules/pixi/PixiLayerMapillarySigns.ts';


describe('PixiLayerMapillarySigns', () => {
  // A link's `id=` turns on the layer that draws the data. Traffic signs have their own cache,
  // so a link to a sign turns on the signs layer, not the other detections.
  it('draws the traffic signs, and the detections layer draws the other detections', () => {
    const scene = { context: new Rapid.MockContext(), gfx: {} };
    const signs = new PixiLayerMapillarySigns(scene);
    const detections = new PixiLayerMapillaryDetections(scene);

    assert.isTrue(signs.drawsData('mapillary-signs:s1'));
    assert.isFalse(signs.drawsData('mapillary-detections:d1'));
    assert.isTrue(detections.drawsData('mapillary-detections:d1'));
    assert.isFalse(detections.drawsData('mapillary-signs:s1'));
  });
});
