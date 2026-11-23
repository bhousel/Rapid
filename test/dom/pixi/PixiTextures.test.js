import { PixiTextures } from '../../../modules/pixi/PixiTextures.ts';


// The texture manager needs a renderer, so these call the methods that don't.
describe('PixiTextures', () => {
  // A `FillBatch` draws fills with any mix of patterns from one atlas texture, and a fill says
  // which pattern it has by the pattern's number there.
  describe('getPatternNumber', () => {
    const numberOf = name => PixiTextures.prototype.getPatternNumber.call({}, name);

    it('numbers the patterns from 1, in the order they\'re in the atlas', () => {
      assert.strictEqual(numberOf('bushes'), 1);
      assert.strictEqual(numberOf('cemetery'), 2);
      assert.strictEqual(numberOf('forest'), 11);
      assert.strictEqual(numberOf('wetland_swamp'), 27);
    });

    it('gives every pattern another number, which fits in a byte', () => {
      const names = ['bushes', 'farmland', 'forest', 'grass', 'orchard', 'pond', 'vineyard', 'waves', 'wetland'];
      const numbers = names.map(numberOf);
      assert.strictEqual(new Set(numbers).size, names.length);
      assert.isBelow(Math.max(...numbers), 256);
      assert.isAbove(Math.min(...numbers), 0);
    });

    it('returns 0 for no pattern, and for one that doesn\'t exist', () => {
      assert.strictEqual(numberOf(null), 0);
      assert.strictEqual(numberOf(undefined), 0);
      assert.strictEqual(numberOf(''), 0);
      assert.strictEqual(numberOf('checkerboard'), 0);
    });
  });
});
