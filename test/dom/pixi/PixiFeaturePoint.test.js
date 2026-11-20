import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from '../../../modules/pixi/AbstractPixiLayer.ts';
import { PixiFeaturePoint } from '../../../modules/pixi/PixiFeaturePoint.ts';


// A point always has a marker. Its icon sprite is made only when the style has an icon: most
// vertices have none.
describe('PixiFeaturePoint', () => {
  let feature;
  const viewport = { transform: { zoom: 17, rotation: 0 } };

  function draw(style) {
    feature.style = style;
    feature.update(viewport);
  }

  beforeEach(() => {
    const context = new Rapid.MockContext();
    const gfx = { textureManager: { getTexture: () => PIXI.Texture.WHITE } };
    const scene = { context: context, gfx: gfx, layers: new Map(), addFeature: () => {}, removeFeature: () => {} };
    const layer = new AbstractPixiLayer(scene);

    const part = new Rapid.GeometryPart(context);
    part.setData({ type: 'Point', coordinates: [0, 0] });
    feature = new PixiFeaturePoint(layer, 'n1');
    feature.geometry = part;
  });

  it('makes no icon sprite for a point without an icon', () => {
    draw({ marker: { image: 'smallCircle' } });
    assert.isOk(feature.marker);
    assert.isNull(feature.icon);
    assert.deepEqual(feature.container.children.map(child => child.label), ['marker']);
    assert.isFalse(feature.dirty);
  });

  it('makes the icon sprite when the style has an icon, above the marker', () => {
    draw({ marker: { image: 'pin' }, icon: { image: 'maki-cafe' } });
    assert.isOk(feature.icon);
    assert.isTrue(feature.icon.visible);
    assert.deepEqual(feature.container.children.map(child => child.label), ['marker', 'icon']);
    assert.strictEqual(feature.icon.position.y, -14);     // inside the pin
  });

  it('keeps the icon above the marker when there are viewfields below both', () => {
    draw({ marker: { image: 'smallCircle' }, viewfield: { angles: [90], image: 'viewfield' } });
    draw({ marker: { image: 'smallCircle' }, viewfield: { angles: [90], image: 'viewfield' }, icon: { image: 'maki-cafe' } });
    assert.deepEqual(feature.container.children.map(child => child.label), ['viewfields', 'marker', 'icon']);
  });

  it('destroys the icon sprite when the style loses its icon', () => {
    draw({ marker: { image: 'pin' }, icon: { image: 'maki-cafe' } });
    const icon = feature.icon;
    draw({ marker: { image: 'pin' } });
    assert.isTrue(icon.destroyed);
    assert.isNull(feature.icon);
  });

  it('shares the default style until one is assigned', () => {
    const other = new PixiFeaturePoint(feature.layer, 'n2');
    assert.strictEqual(other.style, feature.style);
    draw({ marker: { image: 'pin' } });
    assert.notStrictEqual(other.style, feature.style);
  });
});
