import * as PIXI from 'pixi.js';
import { PixiLayerBackgroundTiles } from '../../../modules/pixi/PixiLayerBackgroundTiles.ts';


describe('PixiLayerBackgroundTiles', () => {

  // A filter on the imagery costs a full-screen pass on every frame (see `design/graphics-system.md`,
  // section 6), so there should be none until a display setting is changed.
  describe('applyFilters', () => {
    function makeLayer() {
      const context = new Rapid.MockContext();
      return new PixiLayerBackgroundTiles({ context: context, gfx: {} });
    }

    it('adds no filter at the default settings', () => {
      const layer = makeLayer();
      const container = new PIXI.Container();
      layer.applyFilters(container);
      assert.isEmpty(container.filters ?? []);
    });

    it('adds a filter when a setting is changed, and removes it at the default again', () => {
      const layer = makeLayer();
      const container = new PIXI.Container();

      layer.setBrightness(0.5);
      layer.applyFilters(container);
      assert.lengthOf(container.filters, 1);

      layer.setBrightness(1);
      layer.applyFilters(container);
      assert.isEmpty(container.filters ?? []);
    });

    it('sharpens or blurs without the adjustment filter', () => {
      const layer = makeLayer();
      const container = new PIXI.Container();

      layer.setSharpness(1.5);
      layer.applyFilters(container);
      assert.lengthOf(container.filters, 1);
      assert.strictEqual(container.filters[0], layer.convolutionFilter);
      assert.isNull(layer.blurFilter);

      layer.setSharpness(0.5);
      layer.applyFilters(container);
      assert.lengthOf(container.filters, 1);
      assert.strictEqual(container.filters[0], layer.blurFilter);
      assert.isNull(layer.convolutionFilter);
    });

    it('keeps the same filters while nothing changes', () => {
      const layer = makeLayer();
      const container = new PIXI.Container();

      layer.setContrast(1.2);
      layer.applyFilters(container);
      const filters = container.filters;

      layer.applyFilters(container);   // as the next frame does
      assert.strictEqual(container.filters, filters);
    });

    it('moves the filters when the base imagery changes', () => {
      const layer = makeLayer();
      const first = new PIXI.Container();
      const second = new PIXI.Container();

      layer.setSaturation(0.8);
      layer.applyFilters(first);
      layer.applyFilters(second);
      assert.isEmpty(first.filters ?? []);
      assert.lengthOf(second.filters, 1);
    });
  });

});
