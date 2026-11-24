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

  // The glow behind a hovered point is a picture in the symbol atlas: a white disc that fades
  // out towards its edge, which the point tints.
  describe('_cacheGlow', () => {
    const cacheGlow = (manager, context) => {
      const createElement = document.createElement;
      const canvas = { width: 0, height: 0, getContext: () => context };
      document.createElement = tag => (tag === 'canvas') ? canvas : createElement.call(document, tag);
      try {
        PixiTextures.prototype._cacheGlow.call(manager);
      } finally {
        document.createElement = createElement;
      }
      return canvas;
    };

    it('draws a disc that\'s solid in the middle and nothing at its edge, and puts it in the symbol atlas', () => {
      const stops = [];
      const calls = [];
      const gradient = { addColorStop: (offset, color) => stops.push([offset, color]) };
      const context = {
        createRadialGradient: (...args) => { calls.push(['gradient', ...args]); return gradient; },
        fillRect: (...args) => calls.push(['fillRect', ...args, context.fillStyle])
      };
      const allocated = [];
      const canvas = cacheGlow({ allocate: (...args) => allocated.push(args) }, context);

      assert.deepEqual(allocated, [['symbol', 'glow', 64, 64, canvas]]);
      assert.deepEqual([canvas.width, canvas.height], [64, 64]);
      assert.deepEqual(calls[0], ['gradient', 32, 32, 0, 32, 32, 32]);     // from the middle to the edge
      assert.deepEqual(calls[1], ['fillRect', 0, 0, 64, 64, gradient]);

      const alphaAt = offset => {
        const stop = stops.find(s => s[0] === offset);
        return stop && Number(/rgba\(255, 255, 255, ([\d.e-]+)\)/.exec(stop[1])[1]);
      };
      assert.strictEqual(alphaAt(0), 1);
      assert.strictEqual(alphaAt(0.5), 1, 'solid out to half its radius');
      assert.strictEqual(alphaAt(1), 0);
      const fading = stops.filter(s => s[0] > 0.5).sort((a, b) => a[0] - b[0]).map(s => alphaAt(s[0]));
      assert.isAbove(fading.length, 3);
      for (let i = 1; i < fading.length; i++) {
        assert.isBelow(fading[i], fading[i - 1], 'fainter further out');
      }
    });

    it('makes no texture where a canvas can\'t be drawn on', () => {
      const allocated = [];
      cacheGlow({ allocate: (...args) => allocated.push(args) }, null);
      assert.deepEqual(allocated, []);
    });
  });
});
