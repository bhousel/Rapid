import * as PIXI from 'pixi.js';
import { AvoidGrid } from '../../../modules/pixi/lib/AvoidGrid.ts';
import { AbstractPixiLayer } from '../../../modules/pixi/AbstractPixiLayer.ts';
import { PixiFeaturePoint } from '../../../modules/pixi/PixiFeaturePoint.ts';


// A point always has a marker. Its icon sprite is made only when the style has an icon: most
// vertices have none.
describe('PixiFeaturePoint', () => {
  let feature, haloParent;
  const dashTexture = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 16, height: 1 }) });
  const viewport = { transform: { zoom: 17, rotation: 0 } };

  function draw(style) {
    feature.style = style;
    feature.update(viewport);
  }

  beforeEach(() => {
    const context = new Rapid.MockContext();
    const gfx = { textureManager: { getTexture: () => PIXI.Texture.WHITE, getDashTexture: () => dashTexture } };
    const scene = { context: context, gfx: gfx, layers: new Map(), addFeature: () => {}, removeFeature: () => {}, featureChanged: () => {}, avoidFreed: () => {} };
    haloParent = new PIXI.Container();
    scene.layers.set('map-ui', { halo: haloParent });
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

  describe('the select halo', () => {
    // How far a mesh's vertices are from a point, at the least and at the most
    function reachOf(mesh, x, y) {
      const positions = mesh.geometry.positions;
      let min = Infinity;
      let max = 0;
      for (let i = 0; i < positions.length; i += 2) {
        const reach = Math.hypot(positions[i] - x, positions[i + 1] - y);
        min = Math.min(min, reach);
        max = Math.max(max, reach);
      }
      return [min, max];
    }

    it('is a dashed line around the edge of the point\'s hit area', () => {
      feature.setClass('select');
      draw({ marker: { image: 'pin' } });
      const rect = feature.container.hitArea;
      assert.instanceOf(rect, PIXI.Rectangle);
      // The furthest the point can be hit from where it is, in pixels: the rectangle's far corner.
      // (The marker is drawn at its own size here, so the rectangle's units are pixels.)
      const corner = Math.hypot(Math.max(-rect.left, rect.right), Math.max(-rect.top, rect.bottom));
      assert.closeTo(feature.hitReach, corner, 1e-9);
      assert.isAtLeast(feature.hitReach, 14);

      const halo = feature.halo;
      assert.strictEqual(halo.parent, haloParent);
      assert.strictEqual(halo.children.length, 1);
      const ring = halo.children[0];
      assert.strictEqual(ring.texture, dashTexture);
      assert.strictEqual(ring.strokeMesh.length, 2 * (rect.width + rect.height));

      // The line is 2 wide, half of it either side of the rectangle's edge.
      const xs = [];
      for (let i = 0; i < ring.geometry.positions.length; i += 2) xs.push(ring.geometry.positions[i]);
      assert.closeTo(Math.min(...xs), rect.left - 1, 1e-4);
      assert.closeTo(Math.max(...xs), rect.right + 1, 1e-4);
    });

    it('is a circle around a point that is circular', () => {
      feature.props.isCircular = true;
      feature.setClass('select');
      draw({ marker: { image: 'smallCircle' } });
      const circle = feature.container.hitArea;
      assert.instanceOf(circle, PIXI.Circle);
      assert.closeTo(feature.hitReach, circle.radius, 1e-9);    // in pixels

      const [min, max] = reachOf(feature.halo.children[0], circle.x, circle.y);
      assert.isAbove(min, circle.radius - 1.05);    // (the corners of a ring of 20 points go a little past its width)
      assert.isBelow(max, circle.radius + 1.05);
    });

    it('is destroyed, with its mesh, when the point isn\'t selected', () => {
      feature.setClass('select');
      draw({ marker: { image: 'pin' } });
      const halo = feature.halo;
      const ring = halo.children[0];

      feature.unsetClass('select');
      draw({ marker: { image: 'pin' } });
      assert.isNull(feature.halo);
      assert.isTrue(halo.destroyed);
      assert.isTrue(ring.destroyed);
    });
  });

  it('shares the default style until one is assigned', () => {
    const other = new PixiFeaturePoint(feature.layer, 'n2');
    assert.strictEqual(other.style, feature.style);
    draw({ marker: { image: 'pin' } });
    assert.notStrictEqual(other.style, feature.style);
  });
});
