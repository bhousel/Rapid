import { afterEach, beforeEach, describe, it, mock, spyOn } from 'bun:test';
import { assert } from 'chai';
import * as PIXI from 'pixi.js';
import { projWgs84ToWorld } from '@rapid-sdk/math';
import { PixiLayerOverlay } from '../../../modules/pixi/PixiLayerOverlay.ts';


describe('PixiLayerOverlay', () => {
  const ring = [[-77.02, 38.90], [-77.01, 38.90], [-77.01, 38.91], [-77.02, 38.91]];
  const viewport = { transform: { zoom: 16 } };
  let scene, layer, consoleError;

  beforeEach(() => {
    consoleError = spyOn(console, 'error').mockImplementation(() => {});   // DashLine notes the missing texture cache
    scene = {
      context: {},
      gfx: { immediateRedraw: mock() },   // no texture manager, so dashes draw untextured
      groups: new Map([['debug-under', new PIXI.Container()], ['ui', new PIXI.Container()]])
    };
    layer = new PixiLayerOverlay(scene);
    layer.reset();
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  const drawn = (groupID) => scene.groups.get(groupID).children[0].children;

  it('is always enabled', () => {
    layer.enabled = false;
    assert.isTrue(layer.enabled);
  });

  it('draws an owner\'s shapes over the map by default, and under it when asked', () => {
    layer.setShapes('review', [
      { id: 'tile', coordinates: ring, closed: true, label: 'Tile Extent' },
      { id: 'hint', coordinates: ring.slice(0, 2), placement: 'under' }
    ]);
    layer.render(1, viewport);

    assert.deepEqual(drawn('ui').map(c => c.label), ['tile']);
    assert.deepEqual(drawn('debug-under').map(c => c.label), ['hint']);
    assert.isOk(scene.gfx.immediateRedraw.mock.calls.length);
  });

  it('places a shape at its first point in world coordinates', () => {
    layer.setShapes('review', [{ id: 'tile', coordinates: ring, closed: true }]);
    layer.render(1, viewport);

    const [x, y] = projWgs84ToWorld(ring[0]);
    const shape = drawn('ui')[0];
    assert.closeTo(shape.position.x, x, 1e-6);
    assert.closeTo(shape.position.y, y, 1e-6);
  });

  it('adds a fill only for closed shapes that ask for one, and a label when given', () => {
    layer.setShapes('review', [
      { id: 'filled', coordinates: ring, closed: true, fill: { color: 0xff0000 }, label: 'Tile Extent' },
      { id: 'open', coordinates: ring, fill: { color: 0xff0000 }, stroke: { dash: [6, 3] } }
    ]);
    layer.render(1, viewport);

    const [filled, open] = drawn('ui');
    assert.lengthOf(filled.children, 3);   // fill, line, label
    assert.strictEqual(filled.getChildByLabel('label').text, 'Tile Extent');
    assert.lengthOf(open.children, 1);     // line only
  });

  it('keeps label sizes constant on screen', () => {
    layer.setShapes('review', [{ id: 'tile', coordinates: ring, closed: true, label: 'Tile Extent' }]);
    layer.render(1, { transform: { zoom: 18 } });
    assert.closeTo(drawn('ui')[0].getChildByLabel('label').scale.x, 0.25, 1e-9);
  });

  it('replaces and clears shapes per owner', () => {
    layer.setShapes('review', [{ id: 'a', coordinates: ring }]);
    layer.setShapes('levels', [{ id: 'b', coordinates: ring }]);
    layer.setShapes('review', [{ id: 'c', coordinates: ring }]);
    layer.render(1, viewport);
    assert.sameMembers(drawn('ui').map(c => c.label), ['b', 'c']);

    layer.clearShapes('review');
    layer.render(2, viewport);
    assert.deepEqual(drawn('ui').map(c => c.label), ['b']);
    assert.deepEqual(layer.getShapes('review'), []);
  });

  // The stroke styles a Pixi Graphics was drawn with.
  const strokes = (graphics) => graphics.context.instructions
    .filter(i => i.action === 'stroke')
    .map(i => i.data.style);

  it('builds shapes only when they change; a zoom change restrokes scaled lines and rescales labels', () => {
    layer.setShapes('review', [{ id: 'tile', coordinates: ring, label: 'Tile Extent' }]);
    layer.render(1, viewport);
    const shape = drawn('ui')[0];
    const line = shape.children[0];
    assert.closeTo(strokes(line)[0].width, 2, 1e-9);   // 2px at zoom 16 (1 world unit per px)

    layer.render(2, viewport);
    layer.render(3, { transform: { zoom: 17 } });

    assert.strictEqual(drawn('ui')[0], shape);   // not rebuilt
    assert.closeTo(strokes(line)[0].width, 1, 1e-9);   // still 2px on screen
    assert.closeTo(shape.getChildByLabel('label').scale.x, 0.5, 1e-9);
  });

  it('draws hairlines 1px at any zoom, built once', () => {
    layer.setShapes('drawing', [{ id: 'walls', coordinates: ring, stroke: { color: 0xe040fb, hairline: true } }]);
    layer.render(1, viewport);
    const hairline = drawn('ui')[0].children[0];
    assert.deepInclude(strokes(hairline)[0], { width: 1, pixelLine: true, color: 0xe040fb });
    const instructions = hairline.context.instructions.length;

    layer.render(2, { transform: { zoom: 19 } });

    assert.strictEqual(drawn('ui')[0].children[0], hairline);
    assert.lengthOf(hairline.context.instructions, instructions);   // not restroked
  });

  it('draws several paths in one shape', () => {
    const other = ring.map(([lon, lat]) => [lon + 0.1, lat]);
    layer.setShapes('drawing', [{ id: 'walls', coordinates: [ring, other, [ring[0]]], stroke: { hairline: true } }]);
    layer.render(1, viewport);

    assert.lengthOf(drawn('ui'), 1);
    assert.lengthOf(strokes(drawn('ui')[0].children[0]), 2);   // the single-point path draws nothing
  });

  it('draws a fill only when the stroke is null', () => {
    layer.setShapes('station', [{ id: 'extent', coordinates: ring, closed: true, fill: { color: 0x000000, opacity: 0.5 }, stroke: null }]);
    layer.render(1, viewport);

    const children = drawn('ui')[0].children;
    assert.lengthOf(children, 1);
    assert.lengthOf(strokes(children[0]), 0);
    assert.isTrue(children[0].context.instructions.some(i => i.action === 'fill'));
  });

  it('orders shapes with the same placement by zIndex', () => {
    layer.setShapes('drawing', [{ id: 'walls', coordinates: ring, placement: 'under', zIndex: 1 }]);
    layer.setShapes('station', [{ id: 'extent', coordinates: ring, placement: 'under' }]);
    layer.render(1, viewport);

    const container = scene.groups.get('debug-under').children[0];
    assert.isTrue(container.sortableChildren);
    container.sortChildren();
    assert.deepEqual(container.children.map(c => c.label), ['extent', 'walls']);
  });

  it('keeps its shapes across a reset', () => {
    layer.setShapes('review', [{ id: 'tile', coordinates: ring }]);
    layer.reset();
    layer.render(1, viewport);
    assert.deepEqual(scene.groups.get('ui').children.at(-1).children.map(c => c.label), ['tile']);
  });
});
