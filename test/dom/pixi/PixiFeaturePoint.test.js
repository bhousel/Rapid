import * as PIXI from 'pixi.js';
import { AvoidGrid } from '../../../modules/pixi/lib/AvoidGrid.ts';
import { AbstractPixiLayer } from '../../../modules/pixi/AbstractPixiLayer.ts';
import { PixiFeaturePoint } from '../../../modules/pixi/PixiFeaturePoint.ts';
import { PointBatch } from '../../../modules/pixi/lib/PointBatch.ts';


// A point that draws itself has a marker sprite. Its icon sprite is made only when the style
// has an icon: most vertices have none. A point that a batch draws has no sprites at all.
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

  it('makes no sprites until it is drawn', () => {
    assert.isNull(feature.marker);
    assert.isNull(feature.icon);
    assert.isNull(feature.viewfields);
    assert.lengthOf(feature.container.children, 0);
    assert.isTrue(feature.drawsInContainer());    // no batch draws it
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

  it('draws its marker, its icon and its viewfields at the sizes the style says', () => {
    draw({
      marker: { image: 'pin', size: 20, color: 0x336699, opacity: 0.5 },
      icon: { image: 'maki-cafe', size: 8, scale: [1, 2] },
      viewfield: { angles: [90, 180], image: 'viewfield', size: 30 }
    });
    const { marker, icon, viewfields } = feature;
    assert.deepEqual([marker.width, marker.height], [20, 20]);
    assert.strictEqual(marker.tint, 0x336699);
    assert.strictEqual(marker.alpha, 0.5);
    assert.deepEqual([marker.anchor.x, marker.anchor.y], [0.5, 0.5]);    // (a pin with viewfields is drawn as a circle)
    assert.deepEqual([icon.width, icon.height], [8, 16]);
    assert.strictEqual(icon.tint, 0x111111);
    assert.lengthOf(viewfields.children, 2);
    assert.deepEqual(viewfields.children.map(sprite => Math.round(sprite.angle)), [90, 180]);
    assert.deepEqual([viewfields.children[0].width, viewfields.children[0].height].map(Math.round), [30, 30]);
    assert.strictEqual(feature.container.zIndex, feature.container.position.y + 1000);    // above the points without
  });

  it('draws an icon 11 pixels across when the style gives it no size', () => {
    draw({ marker: { image: 'pin' }, icon: { image: 'maki-cafe', size: 0 } });
    assert.deepEqual([feature.icon.width, feature.icon.height], [11, 11]);
  });

  it('turns the viewfields with the map, while the marker stays upright', () => {
    feature.style = { marker: { image: 'smallCircle' }, viewfield: { angles: [90], image: 'viewfield' } };
    feature.update({ transform: { zoom: 17, rotation: 0.3 } });
    assert.closeTo(feature.container.rotation, -0.3, 1e-9);
    assert.closeTo(feature.viewfields.rotation, 0.3, 1e-9);     // back where the map is
    assert.closeTo(feature.viewfields.children[0].rotation, Math.PI / 2, 1e-9);
  });

  it('anchors a pin at its tip, and turns a marker as it is told', () => {
    draw({ marker: { image: 'pin' } });
    assert.deepEqual([feature.marker.anchor.x, feature.marker.anchor.y], [0.5, 1]);

    feature.markerRotation = 0.5;
    draw({ marker: { image: 'midpoint' } });
    assert.deepEqual([feature.marker.anchor.x, feature.marker.anchor.y], [0.5, 0.5]);
    assert.strictEqual(feature.marker.rotation, 0.5);
  });

  it('keeps what it draws the same size on screen and upright, at any zoom and rotation', () => {
    feature.style = { marker: { image: 'pin' } };
    feature.update({ transform: { zoom: 18, rotation: 0.3 } });
    assert.closeTo(feature.container.scale.x, 0.25, 1e-9);    // the world is four times its size at zoom 18
    assert.closeTo(feature.container.rotation, -0.3, 1e-9);

    feature.dirtyTransform();
    feature.update({ transform: { zoom: 16.5, rotation: 0 } });
    assert.closeTo(feature.container.scale.x, 0.8 / Math.SQRT2, 1e-9);    // and smaller below zoom 17
    assert.strictEqual(feature.lod, 1);
  });

  it('is hidden below zoom 16, and shown again above', () => {
    feature.style = { marker: { image: 'pin' } };
    feature.update({ transform: { zoom: 15.9, rotation: 0 } });
    assert.isFalse(feature.visible);
    assert.strictEqual(feature.lod, 0);
    assert.isFalse(feature.dirty);
    assert.isNull(feature.marker, 'nothing is made for a point that is not drawn');

    feature.dirtyTransform();
    feature.update(viewport);
    assert.isTrue(feature.visible);
    assert.isOk(feature.marker);
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

  // A layer that draws many points gives each a batch. The point is then a few rectangles in
  // the batch's buffers, and has no sprites and nothing in its container.
  describe('in a batch', () => {
    const source = new PIXI.TextureSource({ width: 64, height: 64 });
    const TEXTURES = {
      pin: new PIXI.Texture({ source: source, frame: new PIXI.Rectangle(0, 0, 16, 24) }),
      largeCircle: new PIXI.Texture({ source: source, frame: new PIXI.Rectangle(16, 0, 12, 12) }),
      smallCircle: new PIXI.Texture({ source: source, frame: new PIXI.Rectangle(28, 0, 8, 8) }),
      'maki-cafe': new PIXI.Texture({ source: source, frame: new PIXI.Rectangle(36, 0, 10, 10) }),
      viewfield: new PIXI.Texture({ source: source, frame: new PIXI.Rectangle(0, 24, 20, 20) })
    };
    const PIN = { marker: { image: 'pin' }, icon: { image: 'maki-cafe' } };
    const FLOATS = 6;
    const BYTES = 8;
    let batch, calls, missing, origin;

    function drawAt(zoom, rotation = 0) {
      // The world on screen, as it was last drawn: twice its size at zoom 17, turned with the map
      const scale = 2 ** (zoom - 16);
      origin.worldTransform.identity().scale(scale, scale).rotate(rotation).translate(-3000, 500);
      feature.update({ transform: { zoom: zoom, rotation: rotation } });
    }

    // One of the point's pictures in the batch: the corners' offsets in pixels, and the bytes of its first vertex
    const cornersOf = picture => {
      const item = feature.item;
      const corners = [];
      for (let i = 0; i < 4; i++) {
        const o = (item.first + picture * 4 + i) * FLOATS;
        corners.push([batch._floats[o + 2], batch._floats[o + 3]]);
      }
      return corners;
    };
    const bytesOf = picture => {
      const p = (feature.item.first + picture * 4) * BYTES;
      return Array.from(batch._bytes.subarray(p, p + BYTES));
    };
    const uvOf = picture => {
      const o = (feature.item.first + picture * 4) * FLOATS;
      return [batch._floats[o + 4], batch._floats[o + 5]];
    };
    const closeTo = (actual, expected) => {
      actual.forEach((corner, i) => {
        assert.closeTo(corner[0], expected[i][0], 1e-4, `corner ${i}, x`);
        assert.closeTo(corner[1], expected[i][1], 1e-4, `corner ${i}, y`);
      });
    };
    // A place in the world that's a number of pixels from the point on screen
    const worldAt = (dx, dy) => {
      const at = origin.worldTransform.apply(feature.container.position);
      return origin.worldTransform.applyInverse({ x: at.x + dx, y: at.y + dy });
    };
    const STAGE = { x: 0, y: 0 };    // not looked at

    beforeEach(() => {
      PointBatch.setTexture(source);
      missing = new Set();
      feature.gfx.textureManager.getTexture = (atlasID, textureID) => missing.has(textureID) ? PIXI.Texture.EMPTY : (TEXTURES[textureID] ?? null);
      origin = { worldTransform: new PIXI.Matrix() };    // (Pixi works a container's out when it renders)
      feature.gfx.origin = origin;

      batch = new PointBatch();
      batch.position.set(8388000, 8388000);    // near the world's middle, where the point is
      calls = [];
      ['add', 'set', 'remove', 'setOrder', 'setVisible'].forEach(method => {
        const original = batch[method].bind(batch);
        batch[method] = (...args) => {
          calls.push(method);
          return original(...args);
        };
      });
      feature.batch = batch;
    });
    afterEach(() => {
      if (!batch.destroyed) batch.destroy();
      PointBatch.setTexture(null);
    });

    it('draws its pictures there, and has no sprites and nothing in its container', () => {
      feature.style = PIN;
      assert.isFalse(feature.drawsInContainer());
      drawAt(17);

      assert.deepEqual(calls, ['add']);
      assert.strictEqual(feature.item.batch, batch);
      assert.strictEqual(feature.item.count, 8);    // a marker and an icon
      assert.isNull(feature.marker);
      assert.isNull(feature.icon);
      assert.lengthOf(feature.container.children, 0);
      assert.isFalse(feature.drawsInContainer());
      assert.isFalse(feature.dirty);
      assert.isTrue(feature.visible);

      // The pin's tip is at the point, and the icon is in its head
      closeTo(cornersOf(0), [[-8, -24], [8, -24], [8, 0], [-8, 0]]);
      closeTo(cornersOf(1), [[-5.5, -19.5], [5.5, -19.5], [5.5, -8.5], [-5.5, -8.5]]);
      assert.deepEqual(uvOf(0), [0, 0]);
      assert.closeTo(uvOf(1)[0], 36 / 64, 1e-6);
      assert.deepEqual(bytesOf(0).slice(0, 6), [255, 255, 255, 255, 0, 255]);
      assert.deepEqual(bytesOf(1).slice(0, 6), [0x11, 0x11, 0x11, 255, 0, 255]);
    });

    it('is where it is in the world, in the batch\'s coordinates, in the order of its place from north to south', () => {
      feature.style = PIN;
      drawAt(17);
      const position = feature.container.position;
      const o = feature.item.first * FLOATS;
      assert.closeTo(batch._floats[o], position.x - 8388000, 1e-3);
      assert.closeTo(batch._floats[o + 1], position.y - 8388000, 1e-3);
      assert.strictEqual(feature.item.order, position.y);
      assert.strictEqual(feature.sceneContainer, batch);
      assert.strictEqual(feature.sceneOrder, position.y);
    });

    it('draws viewfields under the marker, turning with the map, and the point over the ones without', () => {
      feature.style = { marker: { image: 'pin' }, viewfield: { angles: [0, 90], image: 'viewfield', color: 0x333333, opacity: 0.5 } };
      drawAt(17);
      assert.strictEqual(feature.item.count, 12);
      assert.strictEqual(bytesOf(0)[4], 255);    // the viewfields turn
      assert.strictEqual(bytesOf(1)[4], 255);
      assert.strictEqual(bytesOf(2)[4], 0);      // the marker doesn't
      closeTo(cornersOf(0), [[-10, -10], [10, -10], [10, 10], [-10, 10]]);
      closeTo(cornersOf(1), [[10, -10], [10, 10], [-10, 10], [-10, -10]]);    // a quarter turn
      closeTo(cornersOf(2), [[-6, -6], [6, -6], [6, 6], [-6, 6]]);            // the pin, as a circle
      assert.deepEqual(bytesOf(0).slice(0, 4), [0x33, 0x33, 0x33, 128]);
      assert.strictEqual(feature.item.order, feature.container.position.y + 2 ** 25);
    });

    it('draws a pin as a circle below zoom 17, everything smaller, without viewfields', () => {
      feature.style = { ...PIN, viewfield: { angles: [0], image: 'viewfield' } };
      drawAt(16.5);
      assert.strictEqual(feature.lod, 1);
      assert.strictEqual(feature.item.count, 8);
      closeTo(cornersOf(0), [[-4.8, -4.8], [4.8, -4.8], [4.8, 4.8], [-4.8, 4.8]]);    // the large circle, at 0.8
      closeTo(cornersOf(1), [[-4.4, -4.4], [4.4, -4.4], [4.4, 4.4], [-4.4, 4.4]]);    // the icon in its middle
      assert.closeTo(uvOf(0)[0], 16 / 64, 1e-6);
      assert.isTrue(feature.props.isCircular);
    });

    it('is hidden in the batch below zoom 16, and when the layer hides it', () => {
      feature.style = PIN;
      drawAt(17);
      feature.dirtyTransform();
      drawAt(15.5);
      assert.isFalse(feature.visible);
      assert.isFalse(feature.item.visible);
      assert.strictEqual(bytesOf(0)[5], 0);
      assert.strictEqual(feature.sceneContainer, feature.container);

      feature.dirtyTransform();
      drawAt(17);
      assert.isTrue(feature.item.visible);
      assert.strictEqual(bytesOf(0)[5], 255);

      feature.visible = false;
      assert.isFalse(feature.item.visible);
      feature.visible = true;
      assert.isTrue(feature.item.visible);
    });

    it('writes nothing when only the zoom or the rotation changed', () => {
      feature.style = PIN;
      drawAt(17);
      const item = feature.item;
      calls.length = 0;

      feature.dirtyTransform();
      drawAt(18.5, 0.6);
      assert.deepEqual(calls, []);
      assert.strictEqual(feature.item, item);
      assert.isFalse(feature.dirty);

      feature.visible = false;      // (the layer hid it meanwhile: a redraw shows it, as before)
      calls.length = 0;
      feature.dirtyTransform();
      drawAt(19);
      assert.isTrue(feature.visible);
      assert.deepEqual(calls, ['setVisible']);
    });

    it('writes it again when the zoom changes how it is drawn', () => {
      feature.style = PIN;
      drawAt(17);
      const item = feature.item;
      const first = item.first;
      calls.length = 0;

      feature.dirtyTransform();
      drawAt(16.5);     // a circle now, smaller
      assert.deepEqual(calls, ['set', 'setOrder', 'setVisible']);    // (the last two change nothing)
      assert.strictEqual(feature.item, item);
      assert.strictEqual(item.first, first, 'in place: it has as many pictures');
    });

    it('works its box out again after a rotation if it has viewfields, which turn', () => {
      feature.style = { marker: { image: 'smallCircle' }, viewfield: { angles: [0], image: 'viewfield' } };
      feature.scene.worldToLabel = (x, y, out) => { out[0] = 500; out[1] = 300; return out; };
      drawAt(17);
      assert.deepEqual(feature.labelBox([0, 0, 0, 0]).map(Math.round), [490, 290, 510, 310]);

      calls.length = 0;
      feature.dirtyTransform();
      drawAt(17, Math.PI / 4);
      assert.include(calls, 'set');
      const half = 10 * Math.SQRT2;
      const box = feature.labelBox([0, 0, 0, 0]);
      assert.closeTo(box[0], 500 - half, 1e-6);
      assert.closeTo(box[3], 300 + half, 1e-6);
    });

    it('says where it is drawn, for labels: the box of its pictures around its place', () => {
      feature.scene.worldToLabel = (x, y, out) => { out[0] = 500; out[1] = 300; return out; };
      feature.style = PIN;
      drawAt(17);
      assert.deepEqual(feature.labelBox([0, 0, 0, 0]), [492, 276, 508, 300]);    // the pin, above its tip

      feature.dirtyTransform();
      drawAt(16.5);
      const box = feature.labelBox([0, 0, 0, 0]);
      assert.closeTo(box[0], 500 - 4.8, 1e-9);     // the circle, smaller
      assert.closeTo(box[3], 300 + 4.8, 1e-9);

      feature.dirtyTransform();
      drawAt(15);
      assert.isTrue(feature.labelBox([0, 0, 0, 0]) !== null);    // (as it was last drawn; the labels layer skips a hidden point)
    });

    it('has no box, and marks nothing, when it draws nothing', () => {
      const grid = new AvoidGrid(2);
      const scene = feature.scene;
      scene.avoidGrid = grid;
      scene.worldToLabel = (x, y, out) => { out[0] = 500; out[1] = 300; return out; };
      scene.avoidHit = () => {};
      feature.labelAvoid = true;
      feature.style = { marker: { image: '' } };
      drawAt(17);
      assert.isNull(feature.item);
      assert.strictEqual(batch.size, 0);
      assert.isNull(feature.labelBox([0, 0, 0, 0]));
      assert.isNull(feature.avoidCells);
      assert.strictEqual(grid.numBlocks, 0);
    });

    it('marks its box for labels to avoid, again after a zoom that changed nothing else', () => {
      const grid = new AvoidGrid(2);
      const scene = feature.scene;
      scene.avoidGrid = grid;
      scene.worldToLabel = (x, y, out) => { out[0] = 500; out[1] = 300; return out; };
      scene.avoidHit = () => {};
      feature.labelAvoid = true;
      feature.style = PIN;
      drawAt(17);
      assert.isTrue(grid.isTaken('avoid', grid.cellsOf(493, 277, 507, 299)));
      assert.isFalse(grid.isTaken('avoid', grid.cellsOf(493, 304, 507, 320)));

      grid.clear();                 // a new zoom: label space is another one
      feature.dirtyTransform();
      drawAt(18);
      assert.isTrue(grid.isTaken('avoid', grid.cellsOf(493, 277, 507, 299)));
    });

    it('is written where it was when it moves', () => {
      feature.style = PIN;
      drawAt(17);
      const item = feature.item;
      const first = item.first;
      const before = feature.container.position.y;

      const part = new Rapid.GeometryPart(feature.context);
      part.setData({ type: 'Point', coordinates: [0.001, -0.001] });
      feature.geometry = part;     // (a layer sets the data too; the shape alone is enough to draw it again)
      drawAt(17);

      const position = feature.container.position;
      assert.isAbove(position.y, before);
      assert.strictEqual(feature.item, item);
      assert.strictEqual(item.first, first);
      assert.closeTo(batch._floats[first * FLOATS], position.x - 8388000, 1e-2);
      assert.closeTo(batch._floats[first * FLOATS + 1], position.y - 8388000, 1e-2);
      assert.strictEqual(item.order, position.y);
    });

    it('is drawn without an icon that has not loaded, and stays dirty until it has', () => {
      missing.add('maki-cafe');
      feature.style = PIN;
      drawAt(17);
      assert.strictEqual(feature.item.count, 4);
      assert.isTrue(feature.dirty);
      assert.isFalse(feature.drawsInContainer());

      missing.clear();
      drawAt(17);
      assert.strictEqual(feature.item.count, 8);
      assert.isFalse(feature.dirty);
    });

    it('draws itself, with sprites, when a picture is not in the batch\'s texture', () => {
      TEXTURES.elsewhere = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 8, height: 8 }) });
      feature.style = { marker: { image: 'pin' }, icon: { image: 'elsewhere' } };
      assert.isFalse(feature.drawsInContainer());    // (it can't know before it's drawn)
      drawAt(17);
      assert.isNull(feature.item);
      assert.isOk(feature.marker);
      assert.isOk(feature.icon);
      assert.isTrue(feature.drawsInContainer());     // its layer puts it in the scene
      assert.strictEqual(batch.size, 0);

      feature.style = PIN;
      drawAt(17);
      assert.isOk(feature.item);
      assert.isNull(feature.marker);
      assert.isFalse(feature.drawsInContainer());
    });

    it('draws itself under a glow while it is hovered or highlighted, hidden in the batch', () => {
      feature.style = PIN;
      drawAt(17);
      const item = feature.item;

      for (const classID of ['hover', 'highlight']) {
        feature.setClass(classID);
        assert.isTrue(feature.drawsInContainer());
        drawAt(17);
        assert.strictEqual(feature.item, item, 'it keeps its place in the batch');
        assert.isFalse(item.visible);
        assert.isOk(feature.marker);
        assert.isOk(feature.icon);
        assert.lengthOf(feature.container.filters, 1);
        assert.strictEqual(feature.sceneContainer, feature.container);
        assert.strictEqual(feature.sceneOrder, 0);

        feature.visible = false;
        feature.visible = true;
        assert.isFalse(item.visible, 'showing the feature doesn\'t show it in the batch meanwhile');

        const marker = feature.marker;
        feature.unsetClass(classID);
        assert.isFalse(feature.drawsInContainer());
        drawAt(17);
        assert.isTrue(item.visible);
        assert.isNull(feature.marker);
        assert.isTrue(marker.destroyed);
        assert.isNotOk(feature.container.filters?.length);
        assert.lengthOf(feature.container.children, 0);
      }
    });

    it('is hit around where it is on screen, at any zoom and rotation, without Pixi', () => {
      feature.style = PIN;
      for (const [zoom, rotation] of [[17, 0], [19.3, 0], [18, 0.6], [17.5, -2]]) {
        feature.dirtyTransform();
        drawAt(zoom, rotation);
        assert.isNull(feature.container.parent);
        assert.isTrue(feature.hitTest(STAGE, worldAt(0, -12)), `in the pin, at zoom ${zoom}`);
        assert.isTrue(feature.hitTest(STAGE, worldAt(11, -27)), 'a few pixels beyond its corner');
        assert.isTrue(feature.hitTest(STAGE, worldAt(0, 13)), 'and a little below its tip');
        assert.isFalse(feature.hitTest(STAGE, worldAt(0, 16)));
        assert.isFalse(feature.hitTest(STAGE, worldAt(0, -30)));
        assert.isFalse(feature.hitTest(STAGE, worldAt(16, -12)));
      }
    });

    it('is hit in a circle when its marker is one, smaller below zoom 17', () => {
      feature.style = { marker: { image: 'largeCircle' } };
      drawAt(17);
      assert.closeTo(feature.hitReach, 14, 1e-9);
      assert.isTrue(feature.hitTest(STAGE, worldAt(9.5, 9.5)));       // 13.4 px from it
      assert.isFalse(feature.hitTest(STAGE, worldAt(10.5, 10.5)));    // 14.8

      feature.dirtyTransform();
      drawAt(16.5);
      assert.closeTo(feature.hitReach, 14 * 0.8, 1e-9);
      assert.isTrue(feature.hitTest(STAGE, worldAt(0, 11)));
      assert.isFalse(feature.hitTest(STAGE, worldAt(0, 12)));
    });

    it('is not hit when it is hidden, not interactive, or being drawn', () => {
      feature.style = PIN;
      drawAt(17);
      const inside = worldAt(0, -12);
      assert.isTrue(feature.hitTest(STAGE, inside));

      feature.allowInteraction = false;
      assert.isFalse(feature.hitTest(STAGE, inside));
      feature.allowInteraction = true;

      feature.visible = false;
      assert.isFalse(feature.hitTest(STAGE, inside));
      feature.visible = true;
      assert.isTrue(feature.hitTest(STAGE, inside));

      feature.setClass('drawing');     // Rapid#648
      drawAt(17);
      assert.isFalse(feature.hitTest(STAGE, inside));
    });

    it('keeps the same hit area object from one draw to the next', () => {
      feature.style = PIN;
      drawAt(17);
      const rect = feature.container.hitArea;
      assert.instanceOf(rect, PIXI.Rectangle);
      assert.deepEqual([rect.x, rect.y, rect.width, rect.height], [-14, -28, 28, 42]);

      feature.dirtyTransform();
      drawAt(18);
      assert.strictEqual(feature.container.hitArea, rect);

      feature.dirtyTransform();
      drawAt(16.5);      // a circle now
      assert.instanceOf(feature.container.hitArea, PIXI.Circle);
    });

    it('has a halo when selected, the size on screen that the zoom makes it', () => {
      feature.setClass('select');
      feature.style = PIN;
      drawAt(17);
      assert.isOk(feature.item, 'the batch still draws the point');
      assert.strictEqual(feature.halo.parent, haloParent);
      assert.closeTo(feature.halo.scale.x, 0.5, 1e-9);

      feature.dirtyTransform();
      drawAt(18, 0.3);
      assert.closeTo(feature.halo.scale.x, 0.25, 1e-9);
      assert.closeTo(feature.halo.rotation, -0.3, 1e-9);
    });

    it('is hit the same way while it draws itself, in the scene or not', () => {
      feature.style = PIN;
      feature.setClass('hover');
      drawAt(18, 0.6);
      assert.isOk(feature.marker);
      assert.isFalse(feature.item?.visible ?? false);
      assert.isTrue(feature.hitTest(STAGE, worldAt(0, -12)));
      assert.isTrue(feature.hitTest(STAGE, worldAt(11, -27)));
      assert.isFalse(feature.hitTest(STAGE, worldAt(16, -12)));
    });

    it('counts as a user of its batch, and leaves the batch when it gets another, or none', () => {
      feature.style = PIN;
      assert.strictEqual(batch.users, 1);
      drawAt(17);
      assert.strictEqual(batch.size, 1);

      const other = new PointBatch();
      other.position.set(8388000, 8388000);
      feature.batch = other;
      assert.strictEqual(batch.users, 0);
      assert.strictEqual(other.users, 1);
      assert.isTrue(feature.dirty, 'it is drawn again');
      drawAt(17);
      assert.strictEqual(batch.size, 0);
      assert.strictEqual(other.size, 1);

      feature.batch = null;
      assert.isTrue(feature.drawsInContainer());
      drawAt(17);
      assert.strictEqual(other.size, 0);
      assert.strictEqual(other.users, 0);
      assert.isNull(feature.item);
      assert.isOk(feature.marker);
      other.destroy();
    });

    it('draws itself when its batch was destroyed', () => {
      feature.style = PIN;
      drawAt(17);
      batch.destroy();
      assert.isTrue(feature.drawsInContainer());
      feature.dirty = true;
      feature.style = PIN;
      drawAt(17);
      assert.isOk(feature.marker);
      assert.isNull(feature.item);
    });

    it('takes its point out of the batch when it is destroyed', () => {
      feature.style = PIN;
      drawAt(17);
      feature.destroy();
      assert.strictEqual(batch.size, 0);
      assert.strictEqual(batch.users, 0);
    });
  });

  it('shares the default style until one is assigned', () => {
    const other = new PixiFeaturePoint(feature.layer, 'n2');
    assert.strictEqual(other.style, feature.style);
    draw({ marker: { image: 'pin' } });
    assert.notStrictEqual(other.style, feature.style);
  });
});
