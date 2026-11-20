import * as PIXI from 'pixi.js';
import { AvoidGrid } from '../../../modules/pixi/lib/AvoidGrid.ts';
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
    const scene = { context: context, gfx: gfx, layers: new Map(), addFeature: () => {}, removeFeature: () => {}, featureChanged: () => {}, avoidFreed: () => {} };
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

  // A point that labels avoid marks where it's drawn in the scene's avoid grid.
  describe('updateAvoid', () => {
    let grid, hits;

    beforeEach(() => {
      grid = new AvoidGrid(2);
      hits = [];
      const scene = feature.scene;
      scene.avoidGrid = grid;
      scene.labelOffset = new PIXI.Point(0, 0);
      scene.worldToLabel = (x, y, out) => { out[0] = 500; out[1] = 300; return out; };    // where the point is on screen
      scene.avoidHit = cells => hits.push(cells);
      feature.labelAvoid = true;
    });

    it('marks its marker\'s box around where it is drawn', () => {
      draw({ marker: { image: 'smallCircle' } });
      const cells = feature.avoidCells;
      assert.isOk(cells);
      assert.isTrue(grid.isTaken('avoid', grid.cellsOf(499.5, 299.5, 500.5, 300.5)));    // a 1 px texture, in the middle
      assert.isFalse(grid.isTaken('avoid', grid.cellsOf(520, 300, 522, 302)));
    });

    it('marks nothing for a point that labels do not avoid', () => {
      feature.labelAvoid = false;
      draw({ marker: { image: 'smallCircle' } });
      assert.isNull(feature.avoidCells);
      assert.strictEqual(grid.numBlocks, 0);
    });

    it('unmarks when it is hidden or destroyed, and marks again when shown', () => {
      draw({ marker: { image: 'smallCircle' } });
      const cells = feature.avoidCells;

      feature.visible = false;
      assert.isFalse(grid.isTaken('avoid', cells));
      feature.visible = true;
      assert.isTrue(grid.isTaken('avoid', cells));
      feature.destroy();
      assert.isFalse(grid.isTaken('avoid', cells));
    });

    it('forgets its cells when the grid was cleared, without unmarking what others marked since', () => {
      draw({ marker: { image: 'smallCircle' } });
      const cells = feature.avoidCells;
      grid.clear();                               // a new zoom
      grid.mark('avoid', cells);                  // ..and another feature is drawn there
      assert.isNull(feature.avoidCells);

      feature.visible = false;                    // must not take the other feature's mark away
      assert.isTrue(grid.isTaken('avoid', cells));
    });

    it('tells the scene when it is drawn where a label is', () => {
      grid.mark('label', grid.cellsOf(495, 295, 540, 305));
      draw({ marker: { image: 'smallCircle' } });
      assert.lengthOf(hits, 1);
    });
  });

  it('shares the default style until one is assigned', () => {
    const other = new PixiFeaturePoint(feature.layer, 'n2');
    assert.strictEqual(other.style, feature.style);
    draw({ marker: { image: 'pin' } });
    assert.notStrictEqual(other.style, feature.style);
  });
});
