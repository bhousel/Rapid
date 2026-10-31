import { PixiLayerOsm } from '../../../modules/pixi/PixiLayerOsm.ts';


describe('PixiLayerOsm', () => {

  // Rendering needs WebGL, so this drives `renderMidpoints` on a layer with stubbed Pixi parts:
  // the features already exist, and `_gatherMidpoints` returns the midpoints for each frame.
  function makeLayer(context, framesOfMidpoints) {
    const scene = { context: context, gfx: {}, layers: new Map([['map-ui', { selected: null }]]) };
    const layer = new PixiLayerOsm(scene);
    layer.syncFeatureClasses = () => {};
    layer.retainFeature = () => {};

    const fakeFeature = { dirty: false, update: () => {} };
    layer.features = { get: () => fakeFeature };

    let frame = 0;
    layer._gatherMidpoints = () => framesOfMidpoints[frame++];
    return layer;
  }

  function midpointProps(id, loc) {
    return { type: 'midpoint', serviceID: 'osm', isNew: true, id: id, wayID: 'w1', edge: ['n1', 'n2'],
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
  });

});
