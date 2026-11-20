import { AvoidGrid } from '../../../modules/pixi/lib/AvoidGrid.ts';


describe('AvoidGrid', () => {
  it('throws for a cell size that is not positive', () => {
    assert.throws(() => new AvoidGrid(0), /cell size/);
    assert.throws(() => new AvoidGrid(NaN), /cell size/);
  });

  describe('cellsOf', () => {
    const grid = new AvoidGrid(4);

    it('returns the cells a box touches', () => {
      assert.deepEqual(grid.cellsOf(0, 0, 4, 4), [0, 0, 0, 0]);        // exactly one cell
      assert.deepEqual(grid.cellsOf(1, 1, 9, 5), [0, 0, 2, 1]);
      assert.deepEqual(grid.cellsOf(4, 4, 8, 8), [1, 1, 1, 1]);        // only reaches the edges of its neighbors
    });

    it('works left of and above zero', () => {
      assert.deepEqual(grid.cellsOf(-9, -1, -5, 3), [-3, -1, -2, 0]);
    });

    it('returns null for a box with no area, or without numbers', () => {
      assert.isNull(grid.cellsOf(5, 5, 5, 9));
      assert.isNull(grid.cellsOf(5, 5, 3, 9));
      assert.isNull(grid.cellsOf(NaN, 0, 4, 4));
    });
  });

  describe('mark, unmark, isTaken', () => {
    it('takes the cells under what is marked, and no others', () => {
      const grid = new AvoidGrid(4);
      grid.mark('avoid', grid.cellsOf(10, 10, 30, 30));
      assert.isTrue(grid.isTaken('avoid', grid.cellsOf(20, 20, 22, 22)));
      assert.isTrue(grid.isTaken('avoid', grid.cellsOf(0, 0, 9, 9)));          // shares the cell at [2,2]
      assert.isFalse(grid.isTaken('avoid', grid.cellsOf(0, 0, 8, 8)));
      assert.isFalse(grid.isTaken('avoid', grid.cellsOf(32, 10, 60, 30)));     // beside it
    });

    it('frees the cells again when unmarked', () => {
      const grid = new AvoidGrid(4);
      const cells = grid.cellsOf(10, 10, 30, 30);
      grid.mark('avoid', cells);
      grid.unmark('avoid', cells);
      assert.isFalse(grid.isTaken('avoid', cells));
    });

    it('keeps a cell taken while one of two things still covers it', () => {
      const grid = new AvoidGrid(4);
      const a = grid.cellsOf(10, 10, 30, 30);
      const b = grid.cellsOf(20, 20, 40, 40);
      grid.mark('avoid', a);
      grid.mark('avoid', b);
      grid.unmark('avoid', a);
      assert.isTrue(grid.isTaken('avoid', grid.cellsOf(24, 24, 26, 26)));      // still under b
      assert.isFalse(grid.isTaken('avoid', grid.cellsOf(10, 10, 18, 18)));     // was only under a
    });

    it('does not go below zero when something is unmarked that was never marked', () => {
      const grid = new AvoidGrid(4);
      const cells = grid.cellsOf(10, 10, 30, 30);
      grid.unmark('avoid', cells);
      assert.strictEqual(grid.numBlocks, 0);     // and makes no block for it
      grid.mark('avoid', cells);
      grid.unmark('avoid', cells);
      grid.unmark('avoid', cells);
      grid.mark('avoid', cells);
      assert.isTrue(grid.isTaken('avoid', cells));
    });

    it('handles a box across several blocks, and coordinates below zero', () => {
      const grid = new AvoidGrid(4);
      const big = grid.cellsOf(-300, -300, 600, 300);      // blocks are 256 px wide here
      grid.mark('avoid', big);
      assert.isAbove(grid.numBlocks, 5);
      for (const [x, y] of [[-299, -299], [-1, -1], [0, 0], [255, 255], [257, 0], [599, 299]]) {
        assert.isTrue(grid.isTaken('avoid', grid.cellsOf(x, y, x + 1, y + 1)), `at ${x},${y}`);
      }
      for (const [x, y] of [[-305, 0], [601, 0], [0, -305], [0, 301]]) {
        assert.isFalse(grid.isTaken('avoid', grid.cellsOf(x, y, x + 1, y + 1)), `at ${x},${y}`);
      }
      grid.unmark('avoid', big);
      assert.isFalse(grid.isTaken('avoid', big));
    });

    it('agrees with a plain list of boxes for random marks and unmarks', () => {
      const grid = new AvoidGrid(4);
      let seed = 12345;
      const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const boxes = [];
      for (let i = 0; i < 300; i++) {
        if (boxes.length && random() < 0.3) {
          const [gone] = boxes.splice(Math.floor(random() * boxes.length), 1);
          grid.unmark('avoid', gone);
        } else {
          const x = Math.floor(random() * 2000) - 1000;
          const y = Math.floor(random() * 2000) - 1000;
          const cells = grid.cellsOf(x, y, x + 1 + random() * 60, y + 1 + random() * 60);
          boxes.push(cells);
          grid.mark('avoid', cells);
        }
      }
      const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
      for (let i = 0; i < 500; i++) {
        const x = Math.floor(random() * 2200) - 1100;
        const y = Math.floor(random() * 2200) - 1100;
        const probe = grid.cellsOf(x, y, x + 1 + random() * 40, y + 1 + random() * 40);
        assert.strictEqual(grid.isTaken('avoid', probe), boxes.some(box => overlaps(box, probe)), `probe ${probe}`);
      }
    });
  });

  describe('labels', () => {
    it('counts labels apart from avoids, and a label needs cells free of both', () => {
      const grid = new AvoidGrid(4);
      const pin = grid.cellsOf(0, 0, 20, 20);
      const label = grid.cellsOf(40, 0, 100, 12);
      grid.mark('avoid', pin);
      grid.mark('label', label);

      assert.isFalse(grid.isTaken('label', pin));
      assert.isFalse(grid.isTaken('avoid', label));
      assert.isFalse(grid.isFree(grid.cellsOf(10, 10, 30, 30)));      // on the pin
      assert.isFalse(grid.isFree(grid.cellsOf(90, 4, 130, 16)));      // on the other label
      assert.isTrue(grid.isFree(grid.cellsOf(40, 20, 100, 32)));
    });
  });

  it('forgets everything when cleared', () => {
    const grid = new AvoidGrid(4);
    const cells = grid.cellsOf(0, 0, 20, 20);
    grid.mark('avoid', cells);
    grid.mark('label', cells);
    grid.clear();
    assert.isTrue(grid.isFree(cells));
    assert.strictEqual(grid.numBlocks, 0);
  });
});
