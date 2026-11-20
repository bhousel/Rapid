import { AbstractPixiLayer } from '../../../modules/pixi/AbstractPixiLayer.ts';
import { PixiFeaturePolygon } from '../../../modules/pixi/PixiFeaturePolygon.ts';


// A polygon is drawn at one of three levels of detail, by its size on screen: not at all, as a
// `lowRes` sprite, or in full (a fill, its mask, strokes). The Pixi objects for a level are made
// when it's first needed and destroyed when it isn't: most polygons around a view are small.
describe('PixiFeaturePolygon', () => {
  let layer, feature;

  // A square about 26 world units wide: 26 px on screen at zoom 16, 13 px at 15, 1.6 px at 12
  const SQUARE = { type: 'Polygon', coordinates: [[[0, 0], [0.0005, 0], [0.0005, 0.0005], [0, 0.0005], [0, 0]]] };
  const viewportAt = zoom => ({ transform: { zoom: zoom, rotation: 0 } });

  function drawAt(zoom) {
    feature.dirty = true;
    feature.update(viewportAt(zoom));
  }

  beforeEach(() => {
    const context = new Rapid.MockContext();
    context.viewport = { transform: { rotation: 0 } };
    const gfx = {
      textureManager: { getTexture: () => null, getPatternTexture: () => null },
      pixi: { renderer: { type: 0 } }
    };
    const scene = { context: context, gfx: gfx, layers: new Map(), addFeature: () => {}, removeFeature: () => {} };
    layer = new AbstractPixiLayer(scene);

    const part = new Rapid.GeometryPart(context);
    part.setData(SQUARE);
    feature = new PixiFeaturePolygon(layer, 'p1');
    feature.geometry = part;
    feature.style = { fill: { color: 0xff0000, type: 'full' } };
  });

  it('makes no Pixi objects until it is drawn', () => {
    assert.isNull(feature.lowRes);
    assert.isNull(feature.fill);
    assert.isNull(feature.mask);
    assert.isNull(feature.strokes);
    assert.strictEqual(feature.container.children.length, 0);
  });

  it('makes nothing for a polygon too small to draw', () => {
    drawAt(12);
    assert.strictEqual(feature.lod, 0);
    assert.isFalse(feature.visible);
    assert.isNull(feature.lowRes);
    assert.isNull(feature.fill);
  });

  it('makes only the lowRes sprite for a small polygon', () => {
    drawAt(15);
    assert.strictEqual(feature.lod, 1);
    assert.isTrue(feature.visible);
    assert.isOk(feature.lowRes);
    assert.isTrue(feature.lowRes.visible);
    assert.isNull(feature.fill);
    assert.isNull(feature.strokes);
  });

  it('makes the fill, the mask and the strokes for a polygon drawn in full', () => {
    drawAt(17);
    assert.strictEqual(feature.lod, 2);
    assert.isNull(feature.lowRes);
    assert.isTrue(feature.fill.visible);
    assert.strictEqual(feature.strokes.children.length, 1);     // one ring
    assert.deepEqual(feature.container.children.map(child => child.label), ['fill', 'strokes', 'mask']);
  });

  it('destroys what the level of detail no longer shows', () => {
    drawAt(17);
    const fill = feature.fill;
    const stroke = feature.strokes.children[0];

    drawAt(15);
    assert.isTrue(fill.destroyed);
    assert.isTrue(stroke.destroyed);
    assert.isNull(feature.fill);
    assert.isNull(feature.mask);
    assert.isNull(feature.maskSource);
    assert.isOk(feature.lowRes);

    const lowRes = feature.lowRes;
    drawAt(12);
    assert.isTrue(lowRes.destroyed);
    assert.isNull(feature.lowRes);
    assert.strictEqual(feature.container.children.length, 0);
  });

  it('destroys the strokes it replaces when it is drawn again', () => {
    drawAt(17);
    const before = feature.strokes.children[0];
    drawAt(17.5);
    assert.isTrue(before.destroyed);
    assert.strictEqual(feature.strokes.children.length, 1);
    assert.notStrictEqual(feature.strokes.children[0], before);
  });

  it('works out the hit buffer only when the pointer comes near', () => {
    drawAt(17);
    const hitArea = feature.strokes.children[0].hitArea;
    assert.isNull(hitArea._buffer);
    assert.isFalse(hitArea.contains(1e6, 1e6));
    assert.isNull(hitArea._buffer);
    hitArea.contains(0, 0);       // the middle of the square: inside the box, so now it's needed
    assert.isOk(hitArea._buffer);
  });

  it('frees everything when destroyed, at any level of detail', () => {
    drawAt(17);
    const fill = feature.fill;
    feature.destroy();
    assert.isTrue(fill.destroyed);
    assert.isNull(feature.fill);
  });
});
