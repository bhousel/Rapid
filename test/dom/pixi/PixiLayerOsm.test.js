import { PixiLayerOsm } from '../../../modules/pixi/PixiLayerOsm.ts';


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

});
