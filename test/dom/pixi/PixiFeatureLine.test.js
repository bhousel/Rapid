import { AbstractPixiLayer } from '../../../modules/pixi/AbstractPixiLayer.ts';
import { PixiFeatureLine } from '../../../modules/pixi/PixiFeatureLine.ts';


// A line always has a stroke. Its casing is drawn from zoom 16, if the style has one that can
// be seen, and the `Graphics` for it exists only then.
describe('PixiFeatureLine', () => {
  let feature, effectiveZoom;
  const viewportAt = zoom => ({ transform: { zoom: zoom, rotation: 0 } });

  function drawAt(zoom, style) {
    effectiveZoom = zoom;
    if (style) {
      feature.style = style;
    } else {
      feature.dirty = true;
    }
    feature.update(viewportAt(zoom));
  }

  beforeEach(() => {
    const context = new Rapid.MockContext();
    effectiveZoom = 17;
    context.systems.map = { effectiveZoom: () => effectiveZoom, wireframeMode: false };
    const gfx = { textureManager: { getTexture: () => null } };
    const scene = { context: context, gfx: gfx, layers: new Map(), addFeature: () => {}, removeFeature: () => {}, featureChanged: () => {}, avoidFreed: () => {} };
    const layer = new AbstractPixiLayer(scene);

    const part = new Rapid.GeometryPart(context);
    part.setData({ type: 'LineString', coordinates: [[0, 0], [0.001, 0], [0.001, 0.001]] });
    feature = new PixiFeatureLine(layer, 'w1');
    feature.geometry = part;
  });

  it('makes no casing until it is drawn', () => {
    assert.isNull(feature.casing);
    assert.isOk(feature.stroke);
  });

  it('makes the casing from zoom 16, below the stroke', () => {
    drawAt(17, { casing: { width: 5, color: 0x444444 }, stroke: { width: 3, color: 0xffffff } });
    assert.strictEqual(feature.lod, 2);
    assert.isOk(feature.casing);
    assert.deepEqual(feature.container.children.map(child => child.label), ['casing', 'stroke']);
    assert.isFalse(feature.dirty);
  });

  it('destroys the casing below zoom 16, and makes it again above', () => {
    drawAt(17, { casing: { width: 5 }, stroke: { width: 3 } });
    const casing = feature.casing;

    drawAt(15.5);
    assert.strictEqual(feature.lod, 1);
    assert.isTrue(casing.destroyed);
    assert.isNull(feature.casing);
    assert.deepEqual(feature.container.children.map(child => child.label), ['stroke']);

    drawAt(16.5);
    assert.isOk(feature.casing);
    assert.deepEqual(feature.container.children.map(child => child.label), ['casing', 'stroke']);
  });

  it('makes no casing for a style whose casing can\'t be seen', () => {
    drawAt(17, { casing: { opacity: 0 }, stroke: { width: 4 } });
    assert.isNull(feature.casing);
  });

  it('works out the hit buffer only when the pointer comes near', () => {
    drawAt(17, { casing: { width: 5 }, stroke: { width: 3 } });
    const hitArea = feature.container.hitArea;
    assert.isFalse(hitArea.contains(1e6, 1e6));
    assert.isNull(hitArea._buffer);
  });
});
