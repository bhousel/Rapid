import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from '../../../modules/pixi/AbstractPixiLayer.ts';
import { PixiFeaturePolygon } from '../../../modules/pixi/PixiFeaturePolygon.ts';


// A polygon is drawn at one of three levels of detail, by its size on screen: not at all, as a
// `lowRes` sprite, or in full (a fill, its mask, strokes). The Pixi objects for a level are made
// when it's first needed and destroyed when it isn't: most polygons around a view are small.
describe('PixiFeaturePolygon', () => {
  let layer, feature, haloParent, map;

  // A square about 26 world units wide: 26 px on screen at zoom 16, 13 px at 15, 1.6 px at 12
  const SQUARE = { type: 'Polygon', coordinates: [[[0, 0], [0.0005, 0], [0.0005, 0.0005], [0, 0.0005], [0, 0]]] };
  const viewportAt = zoom => ({ transform: { zoom: zoom, rotation: 0 } });
  const dashTexture = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 16, height: 1 }) });

  function drawAt(zoom) {
    feature.dirty = true;
    feature.update(viewportAt(zoom));
  }

  beforeEach(() => {
    const context = new Rapid.MockContext();
    context.viewport = { transform: { rotation: 0 } };
    map = { wireframeMode: false };
    context.systems.map = map;
    const gfx = {
      textureManager: { getTexture: () => null, getPatternTexture: () => null, getDashTexture: () => dashTexture },
      pixi: { renderer: { type: 0 } }
    };
    const scene = { context: context, gfx: gfx, layers: new Map(), addFeature: () => {}, removeFeature: () => {}, featureChanged: () => {}, avoidFreed: () => {} };
    haloParent = new PIXI.Container();
    scene.layers.set('map-ui', { halo: haloParent });
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

  it('keeps a ring\'s outline through a zoom, and moves the vertices it has', () => {
    drawAt(17);
    const outline = feature.strokes.children[0];
    const strokeMesh = outline.strokeMesh;
    const positions = outline.geometry.positions;
    const box = () => {
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < positions.length; i += 2) { min = Math.min(min, positions[i]); max = Math.max(max, positions[i]); }
      return max - min;
    };
    assert.isTrue(strokeMesh.closed);
    assert.strictEqual(strokeMesh.cap, 'butt');
    assert.strictEqual(strokeMesh.join, 'miter');
    assert.strictEqual(outline.tint, 0xff0000);
    const wide = box();   // the square, and a line 2 px wide around it

    drawAt(18);
    assert.strictEqual(feature.strokes.children.length, 1);
    assert.strictEqual(feature.strokes.children[0], outline);
    assert.isFalse(outline.destroyed);
    assert.strictEqual(outline.strokeMesh, strokeMesh);
    assert.strictEqual(outline.geometry.positions, positions, 'the same array');
    assert.closeTo(wide - box(), 2 * (1 / 2 - 1 / 4), 1e-4, 'half as wide in world units');
  });

  it('builds new outlines when the polygon changes, and destroys the ones of rings that are gone', () => {
    const context = feature.context;
    const withHole = new Rapid.GeometryPart(context);
    withHole.setData({ type: 'Polygon', coordinates: [
      SQUARE.coordinates[0],
      [[0.0001, 0.0001], [0.0001, 0.0004], [0.0004, 0.0004], [0.0004, 0.0001], [0.0001, 0.0001]]
    ] });
    feature.geometry = withHole;
    drawAt(17);
    assert.deepEqual(feature.strokes.children.map(child => child.label), ['stroke0', 'stroke1']);
    const [outer, hole] = feature.strokes.children;
    const strokeMesh = outer.strokeMesh;

    const square = new Rapid.GeometryPart(context);
    square.setData(SQUARE);
    feature.geometry = square;
    drawAt(17);
    assert.strictEqual(feature.strokes.children.length, 1);
    assert.strictEqual(feature.strokes.children[0], outer);
    assert.notStrictEqual(outer.strokeMesh, strokeMesh);
    assert.isTrue(hole.destroyed);
  });

  // The square's outline is 2 pixels wide, and a hit is good 5 pixels around it: 6 pixels from the ring.
  describe('the outline\'s hit area', () => {
    it('is the ring with a few pixels around it', () => {
      drawAt(17);    // a pixel is half a unit of the ring's coordinates: 3 units
      const ring = feature.geometry.local.flat[0];
      const [x, y] = [(ring[0] + ring[2]) / 2, (ring[1] + ring[3]) / 2];    // the middle of the first edge
      const hitArea = feature.strokes.children[0].hitArea;
      assert.isTrue(hitArea.contains(x, y), 'on the edge');
      assert.isTrue(hitArea.contains(x, y + 2.9), 'beside it');
      assert.isTrue(hitArea.contains(x, y - 2.9), 'on its other side');
      assert.isFalse(hitArea.contains(x, y + 3.1));
      assert.isFalse(hitArea.contains(x, y - 3.1));
      assert.isFalse(hitArea.contains(0, 0), 'the middle of the square');
      assert.isFalse(hitArea.contains(1e6, 1e6));
    });

    it('is kept through a zoom, with the distance of the new zoom', () => {
      drawAt(17);
      const ring = feature.geometry.local.flat[0];
      const [x, y] = [(ring[0] + ring[2]) / 2, (ring[1] + ring[3]) / 2];
      const hitArea = feature.strokes.children[0].hitArea;

      drawAt(18);    // a pixel is a quarter of a unit: 1.5 units
      assert.strictEqual(feature.strokes.children[0].hitArea, hitArea);
      assert.isFalse(hitArea.contains(x, y + 2.9));
      assert.isTrue(hitArea.contains(x, y + 1.4));
    });
  });

  describe('the select halo', () => {
    // How far a ring's vertices are from the middle of the square, at the least and at the most
    function reachOf(mesh) {
      const positions = mesh.geometry.positions;
      let min = Infinity;
      let max = 0;
      for (let i = 0; i < positions.length; i += 2) {
        const reach = Math.max(Math.abs(positions[i]), Math.abs(positions[i + 1]));
        min = Math.min(min, reach);
        max = Math.max(max, reach);
      }
      return [min, max];
    }

    it('is a dashed ring outside the outer ring', () => {
      feature.setClass('select');
      drawAt(17);
      const halo = feature.halo;
      assert.strictEqual(halo.parent, haloParent);
      assert.strictEqual(halo.children.length, 1);
      assert.strictEqual(halo.children[0].texture, dashTexture);

      // The ring is 3 units outside the square, and its own line is 1 unit wide.
      const ring = feature.geometry.local.flat[0];
      const half = Math.abs(ring[0]);
      const [, max] = reachOf(halo.children[0]);
      assert.closeTo(max, half + 3 + 0.5, 1e-3);
    });

    it('has a ring inside the outer ring too, in wireframe', () => {
      map.wireframeMode = true;
      feature.setClass('select');
      drawAt(17);
      assert.strictEqual(feature.halo.children.length, 2);

      // The outline is 1 pixel wide there: the rings are 2.75 units either side of the square.
      const half = Math.abs(feature.geometry.local.flat[0][0]);
      assert.closeTo(reachOf(feature.halo.children[0])[1], half + 2.75 + 0.5, 1e-3);
      assert.closeTo(reachOf(feature.halo.children[1])[1], half - 2.75 + 0.5, 1e-3);
    });

    it('is drawn around a polygon that is only a sprite', () => {
      feature.setClass('select');
      drawAt(15);
      assert.strictEqual(feature.lod, 1);
      assert.strictEqual(feature.halo.children.length, 1);
    });

    it('is destroyed, with its meshes, when the polygon isn\'t selected', () => {
      feature.setClass('select');
      drawAt(17);
      const halo = feature.halo;
      const ring = halo.children[0];

      feature.unsetClass('select');
      drawAt(17);
      assert.isNull(feature.halo);
      assert.isTrue(halo.destroyed);
      assert.isTrue(ring.destroyed);
    });
  });

  it('frees everything when destroyed, at any level of detail', () => {
    drawAt(17);
    const fill = feature.fill;
    feature.destroy();
    assert.isTrue(fill.destroyed);
    assert.isNull(feature.fill);
  });
});
