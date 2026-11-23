import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from '../../../modules/pixi/AbstractPixiLayer.ts';
import { FillBatch } from '../../../modules/pixi/lib/FillBatch.ts';
import { LineBatch } from '../../../modules/pixi/lib/LineBatch.ts';
import { PixiFeaturePolygon } from '../../../modules/pixi/PixiFeaturePolygon.ts';


// A polygon is drawn at one of three levels of detail, by its size on screen: not at all, as a
// `lowRes` sprite, or in full (a fill and strokes). The Pixi objects for a level are made
// when it's first needed and destroyed when it isn't: most polygons around a view are small.
describe('PixiFeaturePolygon', () => {
  let layer, feature, haloParent, map;

  // A square about 26 world units wide: 26 px on screen at zoom 16, 13 px at 15, 1.6 px at 12
  const SQUARE = { type: 'Polygon', coordinates: [[[0, 0], [0.0005, 0], [0.0005, 0.0005], [0, 0.0005], [0, 0]]] };
  const viewportAt = zoom => ({ transform: { zoom: zoom, rotation: 0 } });
  const dashTexture = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 16, height: 1 }) });
  const PATTERN_TEXTURE = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 32, height: 32 }) });

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
      textureManager: {
        getTexture: () => null, getDashTexture: () => dashTexture,
        getPatternTexture: name => (name ? PATTERN_TEXTURE : null), getPatternNumber: name => (name === 'forest' ? 11 : 0)
      },
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

  it('makes the fill and the strokes for a polygon drawn in full', () => {
    drawAt(17);
    assert.strictEqual(feature.lod, 2);
    assert.isNull(feature.lowRes);
    assert.isTrue(feature.fill.visible);
    assert.strictEqual(feature.strokes.children.length, 1);     // one ring
    assert.deepEqual(feature.container.children.map(child => child.label), ['fill', 'strokes']);
  });

  it('destroys what the level of detail no longer shows', () => {
    drawAt(17);
    const fill = feature.fill;
    const stroke = feature.strokes.children[0];

    drawAt(15);
    assert.isTrue(fill.destroyed);
    assert.isTrue(stroke.destroyed);
    assert.isNull(feature.fill);
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

  // A partial fill fills a band 32 pixels wide along the inside of the edge. The band is geometry
  // (`geomAreaBand`), drawn by the fill itself: there's no mask.
  describe('a partial fill', () => {
    // A square about 186 world units wide: at zoom 16, a band of 32 leaves a middle of 122.
    const BIG = { type: 'Polygon', coordinates: [[[0, 0], [0.004, 0], [0.004, 0.004], [0, 0.004], [0, 0]]] };
    // A cross as wide, with arms about 40 units wide: nowhere in it is 32 from its edge.
    const CROSS = { type: 'Polygon', coordinates: [[
      [0.00157, 0], [0.00243, 0], [0.00243, 0.00157], [0.004, 0.00157], [0.004, 0.00243], [0.00243, 0.00243],
      [0.00243, 0.004], [0.00157, 0.004], [0.00157, 0.00243], [0, 0.00243], [0, 0.00157], [0.00157, 0.00157], [0.00157, 0]
    ]] };

    function use(geojson, style = { fill: { color: 0x00ff00 } }) {
      const part = new Rapid.GeometryPart(feature.context);
      part.setData(geojson);
      feature.geometry = part;
      feature.style = style;
      return Math.abs(part.local.flat[0][0]);    // half the shape's width: its coordinates are around its middle
    }

    // The rings that are cut out of the fill
    const cuts = () => feature.fill.context.instructions[0].data.hole?.shapePath.shapePrimitives ?? [];

    it('fills the band along the edge and leaves the middle, with no mask', () => {
      const half = use(BIG);
      drawAt(16);
      assert.deepEqual(feature.container.children.map(child => child.label), ['fill', 'strokes']);
      assert.isNotOk(feature.fill.mask);

      const context = feature.fill.context;
      assert.strictEqual(context.instructions.length, 1);
      assert.strictEqual(cuts().length, 1);    // the middle
      assert.isTrue(context.containsPoint({ x: half - 5, y: 0 }), 'near the edge');
      assert.isTrue(context.containsPoint({ x: half - 30, y: half - 30 }), 'in a corner');
      assert.isFalse(context.containsPoint({ x: half - 34, y: 0 }), 'past the band');
      assert.isFalse(context.containsPoint({ x: 0, y: 0 }), 'the middle');
    });

    it('fills a polygon whole that has no middle at that width, though its box is wide', () => {
      use(CROSS);
      drawAt(16);
      assert.strictEqual(feature.lod, 2);
      assert.strictEqual(feature.fill.context.instructions.length, 1);
      assert.strictEqual(cuts().length, 0);
      assert.isTrue(feature.fill.context.containsPoint({ x: 0, y: 0 }));
    });

    it('gives the same polygon a middle where the band is narrow enough for one', () => {
      use(CROSS);
      drawAt(18);    // the band is 8 units wide there, the arms 40
      assert.strictEqual(cuts().length, 1);
      assert.isFalse(feature.fill.context.containsPoint({ x: 0, y: 0 }));
    });

    it('fills a polygon whole when its style says so', () => {
      use(BIG, { fill: { color: 0x00ff00, type: 'full' } });
      drawAt(16);
      assert.strictEqual(cuts().length, 0);
      assert.isTrue(feature.fill.context.containsPoint({ x: 0, y: 0 }));
    });

    it('cuts the polygon\'s holes out of the band too', () => {
      const half = use({ type: 'Polygon', coordinates: [BIG.coordinates[0], [[0.0019, 0.0019], [0.0021, 0.0019], [0.0021, 0.0021], [0.0019, 0.0021], [0.0019, 0.0019]]] });
      drawAt(17);    // the band is 16 units wide: one along the outer edge, and one around the hole in the middle
      const context = feature.fill.context;
      assert.strictEqual(context.instructions.length, 2);
      assert.isTrue(context.containsPoint({ x: half - 5, y: 0 }), 'along the outer edge');
      assert.isFalse(context.containsPoint({ x: half / 2, y: 0 }), 'between the two');
      assert.isTrue(context.containsPoint({ x: 10, y: 0 }), 'beside the hole');
      assert.isFalse(context.containsPoint({ x: 0, y: 0 }), 'in the hole');
    });

    it('keeps the band while the polygon and the zoom are the same', () => {
      use(BIG);
      drawAt(16);
      const band = feature._band;
      assert.isOk(band);

      drawAt(16);    // as for a hover, or a new style
      assert.strictEqual(feature._band, band);
    });

    it('works the band out again for another zoom, at the width of that zoom', () => {
      const half = use(BIG);
      drawAt(16);
      const band = feature._band;
      assert.isTrue(feature.fill.context.containsPoint({ x: half - 30, y: 0 }));

      drawAt(16.5);    // 32 pixels are 22.6 units there
      assert.notStrictEqual(feature._band, band);
      assert.isFalse(feature.fill.context.containsPoint({ x: half - 30, y: 0 }));
      assert.isTrue(feature.fill.context.containsPoint({ x: half - 20, y: 0 }));
    });

    it('works the band out again for a polygon that changed', () => {
      use(BIG);
      drawAt(16);
      const band = feature._band;
      use(BIG);    // the same shape, in a new part
      drawAt(16);
      assert.notStrictEqual(feature._band, band);
      assert.deepEqual(feature._band, band);
    });

    it('holds no fill in wireframe', () => {
      use(BIG);
      drawAt(16);
      map.wireframeMode = true;
      drawAt(16);
      assert.isFalse(feature.fill.visible);
      assert.strictEqual(feature.fill.context.instructions.length, 0);
    });
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
      assert.strictEqual(feature.hitReach, 6);    // ..which is this many pixels from the ring
    });

    it('reaches to the corners of the lowRes sprite, which can be outside the polygon\'s box', () => {
      drawAt(15);
      assert.strictEqual(feature.lod, 1);
      const [width, height] = feature.geometry.local.surround.dimensions;   // in the ring's coordinates: 2 to a pixel
      assert.closeTo(feature.hitReach, Math.hypot(width, height) / 2 / 2, 1e-9);
      assert.isAbove(feature.hitReach, 0);
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

  // A layer that draws many polygons gives each two batches: a `FillBatch` for its fill and a
  // `LineBatch` for its outlines. The polygon has nothing of its own then, at any size.
  describe('in batches', () => {
    // A square 400 world units wide (400 px at zoom 16), with a hole in it
    const BIG = { type: 'Polygon', coordinates: [
      [[0, 0], [0.008, 0], [0.008, 0.008], [0, 0.008], [0, 0]],
      [[0.003, 0.003], [0.005, 0.003], [0.005, 0.005], [0.003, 0.005], [0.003, 0.003]]
    ] };
    let fills, outlines, calls, context;

    function watch(target, name) {
      ['add', 'remove', 'setFill', 'setStroke', 'setStyle'].forEach(method => {
        if (!target[method]) return;
        const original = target[method].bind(target);
        target[method] = (...args) => {
          calls.push(`${name}.${method}`);
          return original(...args);
        };
      });
    }

    function setShape(shape) {
      const part = new Rapid.GeometryPart(context);
      part.setData(shape);
      feature.geometry = part;
    }

    // A point in the world, by its place in the polygon's own coordinates
    const worldAt = (x, y) => ({ x: feature.container.position.x + x, y: feature.container.position.y + y });
    const STAGE = { x: 0, y: 0 };    // not looked at

    beforeEach(() => {
      context = layer.context;
      context.viewport = { transform: { rotation: 0, zoom: 16 } };
      fills = new FillBatch();
      outlines = new LineBatch();
      for (const each of [fills, outlines]) {
        each.position.set(8388608, 8388608);    // the world's middle, where the polygon is
      }
      calls = [];
      watch(fills, 'fills');
      watch(outlines, 'outlines');
      feature.fillBatch = fills;
      feature.strokeBatch = outlines;
    });
    afterEach(() => {
      for (const each of [fills, outlines]) {
        if (!each.destroyed) each.destroy();
      }
    });

    it('draws the fill in one and each ring\'s outline in the other, and has nothing of its own', () => {
      setShape(BIG);
      feature.container.zIndex = -160000;
      drawAt(16);
      assert.isNull(feature.fill);
      assert.isNull(feature.strokes);
      assert.isNull(feature.lowRes);
      assert.lengthOf(feature.container.children, 0);
      assert.deepEqual(calls, ['fills.add', 'outlines.add', 'outlines.add']);

      const { fillItem, ringItems } = feature;
      assert.strictEqual(fillItem.batch, fills);
      assert.strictEqual(fillItem.count, 10, 'the corners are the rings\' own points');
      assert.strictEqual(fillItem.order, -160000);
      assert.lengthOf(ringItems, 2);
      assert.strictEqual(ringItems[0].batch, outlines);
      assert.strictEqual(ringItems[1].order, -160000);
      assert.isTrue(feature.visible);
    });

    it('writes its fill near the batch\'s origin, in its color and opacity', () => {
      feature.style = { fill: { color: 0x112233, opacity: 0.4, type: 'full' } };
      drawAt(16);
      const item = feature.fillItem;
      const [x, y] = feature.geometry.world.origin;
      const local = feature.geometry.local.flat[0];
      assert.closeTo(fills._floats[item.first * 2], local[0] + x - 8388608, 1e-3);
      assert.closeTo(fills._floats[item.first * 2 + 1], local[1] + y - 8388608, 1e-3);
      assert.deepEqual(Array.from(fills._bytes.subarray(item.first * 8, item.first * 8 + 5)), [0x11, 0x22, 0x33, 102, 0]);

      // the outline has the fill's color, at its own width at every zoom
      const ring = feature.ringItems[0];
      assert.deepEqual(Array.from(outlines._floats.subarray(ring.first * 12 + 10, ring.first * 12 + 12)), [2, 2]);
      assert.deepEqual(Array.from(outlines._bytes.subarray(ring.first * 8, ring.first * 8 + 4)), [0x11, 0x22, 0x33, 255]);
    });

    // An outline is three triangles a corner, and a rectangle's fill is two: under 20 pixels a
    // polygon is its fill alone. (Its own shape, not a sprite's.)
    it('draws a small polygon as its fill, with no outline and no sprite in its place', () => {
      drawAt(15);    // 13 pixels wide
      assert.strictEqual(feature.lod, 1);
      assert.isNull(feature.lowRes);
      assert.isTrue(feature.fillItem.visible);
      assert.lengthOf(feature.ringItems, 0);
      assert.strictEqual(outlines.size, 0);
      assert.deepEqual(calls, ['fills.add']);
    });

    it('gives a polygon its outline when a zoom makes it large enough, and takes it away again', () => {
      drawAt(15);
      const { fillItem } = feature;
      calls = [];

      feature.dirtyTransform();
      feature.update(viewportAt(16));    // 26 pixels
      assert.strictEqual(feature.lod, 2);
      assert.lengthOf(feature.ringItems, 1);
      assert.strictEqual(feature.fillItem, fillItem);
      assert.deepEqual(calls, ['outlines.add']);

      calls = [];
      feature.dirtyTransform();
      feature.update(viewportAt(15));
      assert.lengthOf(feature.ringItems, 0);
      assert.strictEqual(outlines.size, 0);
      assert.deepEqual(calls, ['outlines.remove']);
    });

    it('keeps a small polygon\'s outline in wireframe mode, where no fill is drawn', () => {
      context.systems.map = { wireframeMode: true, effectiveZoom: () => 15 };
      drawAt(15);
      assert.strictEqual(feature.lod, 1);
      assert.lengthOf(feature.ringItems, 1);
      assert.isTrue(feature.ringItems[0].visible);
    });

    it('shows a small polygon\'s outline while it is hovered, drawn by the polygon itself', () => {
      drawAt(15);
      feature.setClass('hover');
      feature.update(viewportAt(15));
      assert.lengthOf(feature.ringItems, 0);
      assert.isOk(feature.strokes);
      assert.isAbove(feature.strokes.children[0].strokeMesh.vertexCount, 0);

      feature.unsetClass('hover');
      feature.update(viewportAt(15));
      assert.isNull(feature.strokes);
      assert.lengthOf(feature.ringItems, 0);
    });

    it('is hit in its fill and near its edge when it is small, though it has no outline', () => {
      drawAt(15);
      assert.isTrue(feature.hitTest(STAGE, worldAt(0, 0)));
      const edge = feature.geometry.local.extent.max[0];
      assert.isTrue(feature.hitTest(STAGE, worldAt(edge + 4, 0)));     // 2 pixels outside it, at zoom 15
      assert.isFalse(feature.hitTest(STAGE, worldAt(edge + 30, 0)));
    });

    it('destroys the sprite that the polygon had before it got its batches', () => {
      feature.fillBatch = null;
      drawAt(15);
      const sprite = feature.lowRes;
      assert.isOk(sprite);

      feature.fillBatch = fills;
      drawAt(15);
      assert.isNull(feature.lowRes);
      assert.isTrue(sprite.destroyed);
      assert.lengthOf(feature.container.children, 0);
    });

    it('hides a polygon that\'s too small to draw, and shows it again when it isn\'t', () => {
      drawAt(16);
      drawAt(12);    // under 4 pixels
      assert.isFalse(feature.visible);
      assert.isFalse(feature.fillItem.visible);
      assert.isFalse(feature.ringItems[0].visible);
      drawAt(16);
      assert.isTrue(feature.fillItem.visible);
      assert.isTrue(feature.ringItems[0].visible);
    });

    it('does nothing to the batches for a zoom', () => {
      drawAt(16);
      calls = [];
      for (const zoom of [17, 15.8, 18.5]) {    // (22 pixels wide at the least: not small)
        feature.dirtyTransform();
        feature.update(viewportAt(zoom));
      }
      assert.deepEqual(calls, []);
      assert.isFalse(feature.dirty);
    });

    it('writes a polygon that changed where it was', () => {
      drawAt(16);
      const { fillItem } = feature;
      const ring = feature.ringItems[0];
      calls = [];
      setShape({ type: 'Polygon', coordinates: [[[0, 0], [0.0006, 0], [0.0006, 0.0005], [0, 0.0005], [0, 0]]] });    // a corner moved
      drawAt(16);
      assert.strictEqual(feature.fillItem, fillItem);
      assert.strictEqual(feature.ringItems[0], ring);
      assert.deepEqual(calls, ['fills.setFill', 'fills.setStyle', 'outlines.setStroke', 'outlines.setStyle']);
    });

    it('takes the outline of a ring that\'s gone out of its batch', () => {
      setShape(BIG);
      drawAt(16);
      assert.strictEqual(outlines.size, 2);
      setShape(SQUARE);
      drawAt(16);
      assert.lengthOf(feature.ringItems, 1);
      assert.strictEqual(outlines.size, 1);
    });

    it('writes a new style, and nothing else', () => {
      drawAt(16);
      calls = [];
      feature.style = { fill: { color: 0x00ff00, type: 'full' } };
      feature.update(viewportAt(16));
      assert.deepEqual(calls, ['fills.setStyle', 'outlines.setStyle']);
      const item = feature.fillItem;
      assert.deepEqual(Array.from(fills._bytes.subarray(item.first * 8, item.first * 8 + 3)), [0, 255, 0]);
    });

    // The band of a partial fill is triangles in the batch too, worked out again when its width changes.
    describe('a partial fill', () => {
      beforeEach(() => {
        setShape(BIG);
        feature.style = { fill: { color: 0xff0000 } };
        layer.context.systems.settings = { get: () => 'partial' };
      });

      it('fills the band along the edge, and a click in the middle misses it', () => {
        drawAt(16);
        const local = feature.geometry.local;
        const [minX, minY] = local.extent.min;
        assert.isOk(feature._batchBand);
        assert.isAbove(feature.fillItem.count, 10, 'more corners than the polygon has');
        assert.isTrue(feature.hitTest(STAGE, worldAt(minX + 20, minY + 200)), '20 pixels in from the edge');
        assert.isFalse(feature.hitTest(STAGE, worldAt(minX + 80, minY + 200)), '80 pixels in');
      });

      it('works the band out again for another zoom, and not when the zoom is the same', () => {
        drawAt(16);
        calls = [];
        feature.dirtyTransform();
        feature.update(viewportAt(16));
        assert.deepEqual(calls, []);

        feature.dirtyTransform();
        feature.update(viewportAt(17));
        assert.deepEqual(calls, ['fills.setFill', 'fills.setStyle']);
      });

      it('fills the polygon whole where it has no middle, and gives it a band where it gets one', () => {
        setShape(SQUARE);    // 26 units wide
        drawAt(16);
        assert.isNull(feature._batchBand);
        assert.strictEqual(feature.fillItem.count, 5);
        calls = [];
        feature.dirtyTransform();
        feature.update(viewportAt(19));    // 208 pixels wide
        assert.isOk(feature._batchBand);
        assert.deepEqual(calls, ['fills.setFill', 'fills.setStyle']);
      });
    });

    it('fills with its pattern where the polygon is large enough to show one, and plain where it isn\'t', () => {
      feature.style = { fill: { color: 0x00ff00, type: 'full', pattern: 'forest' } };
      drawAt(16);    // 26 pixels: too small for a pattern
      const item = feature.fillItem;
      assert.strictEqual(fills._bytes[item.first * 8 + 4], 0);
      calls = [];
      feature.dirtyTransform();
      feature.update(viewportAt(18));    // 104 pixels
      assert.strictEqual(fills._bytes[item.first * 8 + 4], 11);
      assert.deepEqual(calls, ['fills.setStyle']);
    });

    describe('hitTest', () => {
      beforeEach(() => {
        setShape(BIG);
        drawAt(16);
      });

      it('hits inside the fill, within a few pixels of a ring, and not in a hole or far outside', () => {
        const [minX, minY] = feature.geometry.local.extent.min;
        assert.isTrue(feature.hitTest(STAGE, worldAt(minX + 50, minY + 50)), 'in the fill');
        assert.isFalse(feature.hitTest(STAGE, worldAt(0, 0)), 'in the hole');
        assert.isTrue(feature.hitTest(STAGE, worldAt(minX - 5, minY + 50)), '5 pixels outside the edge');
        assert.isFalse(feature.hitTest(STAGE, worldAt(minX - 8, minY + 50)), '8 pixels outside');
        assert.strictEqual(feature.hitReach, 6);
      });

      it('hits only the rings in wireframe', () => {
        map.wireframeMode = true;
        const [minX, minY] = feature.geometry.local.extent.min;
        assert.isFalse(feature.hitTest(STAGE, worldAt(minX + 50, minY + 50)));
        assert.isTrue(feature.hitTest(STAGE, worldAt(minX + 2, minY + 50)));
      });

      it('never hits a polygon that\'s hidden, not allowed to be interactive, or being drawn', () => {
        const [minX, minY] = feature.geometry.local.extent.min;
        const inside = worldAt(minX + 50, minY + 50);
        feature.visible = false;
        assert.isFalse(feature.hitTest(STAGE, inside));
        feature.visible = true;
        feature.allowInteraction = false;
        assert.isFalse(feature.hitTest(STAGE, inside));
        feature.allowInteraction = true;
        feature.setClass('drawing');
        assert.isFalse(feature.hitTest(STAGE, inside));
      });
    });

    // The glow of a hovered or highlighted polygon is a filter on its container, so its
    // outlines are drawn there while it glows. Its fill stays in the batch.
    describe('a polygon that glows', () => {
      it('draws its outlines itself meanwhile, and goes back to the batch after', () => {
        drawAt(16);
        const { fillItem } = feature;
        const ring = feature.ringItems[0];
        assert.isFalse(feature.drawsInContainer());

        feature.setClass('hover');
        assert.isTrue(feature.drawsInContainer());
        feature.update(viewportAt(16));
        assert.isOk(feature.strokes);
        assert.isAbove(feature.strokes.children[0].strokeMesh.vertexCount, 0);
        assert.isFalse(feature.fill.visible, 'no fill of its own');
        assert.lengthOf(feature.container.filters, 1);
        assert.isTrue(fillItem.visible, 'the fill stays in its batch');
        assert.isFalse(ring.visible);

        feature.unsetClass('hover');
        feature.update(viewportAt(16));
        assert.isNull(feature.strokes);
        assert.isNull(feature.fill);
        assert.isTrue(ring.visible);
        assert.strictEqual(feature.ringItems[0], ring);
        assert.isFalse(feature.drawsInContainer());
      });

      it('has a fill tinted with the glow\'s color in the batch meanwhile, and twice as opaque', () => {
        const opacityOf = item => item.batch._bytes[item.first * 8 + 3];
        const colorOf = item => Array.from(item.batch._bytes.subarray(item.first * 8, item.first * 8 + 3));
        feature.style = { fill: { color: 0x204060, opacity: 0.3 } };
        drawAt(16);
        const { fillItem } = feature;
        const first = fillItem.first;
        const plain = opacityOf(fillItem);
        assert.closeTo(plain, 0.3 * 255, 1);
        assert.deepEqual(colorOf(fillItem), [0x20, 0x40, 0x60]);

        // Halfway to the hover's yellow, or the highlight's blue
        const tinted = { hover: [0x90, 0xa0, 0x30], highlight: [0x48, 0x69, 0xb0] };
        for (const classID of ['hover', 'highlight']) {
          feature.setClass(classID);
          feature.update(viewportAt(16));
          assert.strictEqual(feature.fillItem, fillItem);
          assert.strictEqual(fillItem.first, first, 'written where it was');
          assert.closeTo(opacityOf(fillItem), 0.6 * 255, 1);
          assert.deepEqual(colorOf(fillItem), tinted[classID], classID);

          feature.unsetClass(classID);
          feature.update(viewportAt(16));
          assert.strictEqual(opacityOf(fillItem), plain);
          assert.deepEqual(colorOf(fillItem), [0x20, 0x40, 0x60]);
        }

        // (never more than opaque)
        feature.style = { fill: { color: 0x336699, opacity: 0.8 } };
        feature.setClass('hover');
        feature.update(viewportAt(16));
        assert.strictEqual(opacityOf(feature.fillItem), 255);
      });

      it('doesn\'t show its outlines in the batch when it\'s hidden and shown while it glows', () => {
        drawAt(16);
        feature.setClass('highlight');
        feature.update(viewportAt(16));
        feature.visible = false;
        feature.visible = true;
        assert.isFalse(feature.ringItems[0].visible);
        assert.isTrue(feature.fillItem.visible);
      });
    });

    it('says where it\'s drawn: its fill\'s batch and its order there, or its own container', () => {
      feature.container.zIndex = -676;
      assert.strictEqual(feature.sceneContainer, feature.container);    // not drawn yet
      drawAt(16);
      assert.strictEqual(feature.sceneContainer, fills);
      assert.strictEqual(feature.sceneOrder, -676);
    });

    it('draws itself again without batches, or with dashes that a batch can\'t draw', () => {
      drawAt(16);
      feature.fillBatch = null;
      assert.isTrue(feature.drawsInContainer());
      drawAt(16);
      assert.strictEqual(fills.size, 0);
      assert.strictEqual(outlines.size, 0);
      assert.isOk(feature.fill);
      assert.isOk(feature.strokes);

      feature.fillBatch = fills;
      drawAt(16);
      assert.isNull(feature.fill);
      assert.strictEqual(fills.size, 1);

      feature.style = { fill: { color: 0xff0000, type: 'full' }, stroke: { dash: [1, 2, 3, 4, 5, 6] } };
      assert.isTrue(feature.drawsInContainer());
      feature.update(viewportAt(16));
      assert.strictEqual(fills.size, 0);
      assert.isOk(feature.fill);
    });

    it('tells its batches that it will draw in them, and leaves them when it\'s destroyed', () => {
      assert.strictEqual(fills.users, 1);
      assert.strictEqual(outlines.users, 1);
      drawAt(16);
      feature.destroy();
      assert.strictEqual(fills.size, 0);
      assert.strictEqual(outlines.size, 0);
      assert.strictEqual(fills.users, 0);
      assert.strictEqual(outlines.users, 0);
    });

    it('gets its halo as without batches', () => {
      feature.setClass('select');
      drawAt(16);
      assert.isOk(feature.halo);
      assert.isAbove(feature.halo.children.length, 0);
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
