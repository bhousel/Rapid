/** A rectangle of cells: `[minX, minY, maxX, maxY]`, all inclusive */
export type CellRect = [number, number, number, number];

/** The two things a cell counts: what labels must keep clear of, and the labels themselves */
export type AvoidKind = 'avoid' | 'label';

/** Cells along one side of a block */
const BLOCK = 64;
const BLOCK_SHIFT = 6;         // log2(BLOCK)
const BLOCK_MASK = BLOCK - 1;
/** Blocks are keyed by one number: `(blockX + HALF) * SPAN + (blockY + HALF)` */
const SPAN = 2 ** 21;
const HALF = SPAN / 2;


/**
 * A grid over label space that says where a label can't go.
 *
 * Label space is the screen, minus an offset that moves with the map (see "Label placement" in
 * `design/graphics-system.md`). The grid cuts it into square cells a few pixels wide, and each
 * cell counts what covers it: the things labels must keep clear of (pins, vertices), and the
 * labels that have been placed. Marking a pin adds one to the cells under it, and unmarking it
 * takes that away again, so two pins on one cell leave it taken when one of them goes.
 *
 * A dense place has tens of thousands of pins and room for a hundred labels. A box for each pin
 * in a spatial index costs a few objects and an insertion per pin. Here a pin costs a dozen
 * array writes, and a cloud of pins fills the same cells over and over.
 *
 * The cells are kept in blocks of 64 by 64, made when something is first marked in them, so
 * the map can be panned any distance. There's no Pixi in this class.
 */
export class AvoidGrid {
  /** The width and height of a cell, in pixels of label space */
  public readonly cellSize: number;

  /**
   * Counts how often the grid was cleared. Whoever remembers cells it marked also remembers the
   * generation, and forgets the cells when it's another one: they were for another label space.
   */
  public generation: number;

  /** The counts of each kind, a block of cells at a time (see `_key`) */
  protected _blocks: Record<AvoidKind, Map<number, Uint16Array>>;


  /**
   * @param cellSize - The width and height of a cell, in pixels of label space
   * @throws Error if the cell size isn't a positive number
   */
  public constructor(cellSize: number = 4) {
    if (!(cellSize > 0)) {
      throw new Error(`AvoidGrid: cell size must be positive, got ${cellSize}`);
    }
    this.cellSize = cellSize;
    this.generation = 0;
    this._blocks = {
      avoid: new Map<number, Uint16Array>(),
      label: new Map<number, Uint16Array>()
    };
  }


  /**
   * Forgets everything that was marked. Label space is a new one after a zoom or a rotation.
   */
  public clear(): void {
    this._blocks.avoid.clear();
    this._blocks.label.clear();
    this.generation++;
  }


  /**
   * Forgets the labels, and keeps what they avoid: for when every label is placed again in the
   * same label space.
   */
  public clearLabels(): void {
    this._blocks.label.clear();
  }


  /**
   * Returns the cells that a box touches.
   * A box that only reaches the edge of a cell doesn't touch it.
   * @param minX - The box's left edge, in label space
   * @param minY - The box's top edge
   * @param maxX - The box's right edge
   * @param maxY - The box's bottom edge
   * @return The rectangle of cells, or `null` for a box with no area or a coordinate that isn't a number
   */
  public cellsOf(minX: number, minY: number, maxX: number, maxY: number): CellRect | null {
    if (!(maxX > minX) || !(maxY > minY)) return null;   // (also false for NaN)
    const size = this.cellSize;
    return [
      Math.floor(minX / size),
      Math.floor(minY / size),
      Math.ceil(maxX / size) - 1,
      Math.ceil(maxY / size) - 1
    ];
  }


  /**
   * Adds one to the count of every cell in a rectangle.
   * @param kind - What's there: something to avoid, or a label
   * @param cells - The cells (from `cellsOf`)
   */
  public mark(kind: AvoidKind, cells: CellRect): void {
    this._add(kind, cells, 1);
  }


  /**
   * Takes one from the count of every cell in a rectangle: the opposite of `mark`.
   * Call it with the same cells that were marked.
   * @param kind - What was there
   * @param cells - The cells that were marked
   */
  public unmark(kind: AvoidKind, cells: CellRect): void {
    this._add(kind, cells, -1);
  }


  /**
   * Whether any cell in a rectangle is covered by something of the given kind.
   * @param kind - What to look for
   * @param cells - The cells to look at
   * @return `true` if one of them has a count above zero
   */
  public isTaken(kind: AvoidKind, cells: CellRect): boolean {
    const blocks = this._blocks[kind];
    if (!blocks.size) return false;

    const [minX, minY, maxX, maxY] = cells;
    for (let by = minY >> BLOCK_SHIFT; by <= (maxY >> BLOCK_SHIFT); by++) {
      for (let bx = minX >> BLOCK_SHIFT; bx <= (maxX >> BLOCK_SHIFT); bx++) {
        const block = blocks.get(this._key(bx, by));
        if (!block) continue;

        // the part of the rectangle that's in this block, in the block's own cells
        const x0 = Math.max(minX, bx << BLOCK_SHIFT) & BLOCK_MASK;
        const x1 = Math.min(maxX, (bx << BLOCK_SHIFT) + BLOCK_MASK) & BLOCK_MASK;
        const y0 = Math.max(minY, by << BLOCK_SHIFT) & BLOCK_MASK;
        const y1 = Math.min(maxY, (by << BLOCK_SHIFT) + BLOCK_MASK) & BLOCK_MASK;
        for (let y = y0; y <= y1; y++) {
          const row = y << BLOCK_SHIFT;
          for (let x = x0; x <= x1; x++) {
            if (block[row + x]) return true;
          }
        }
      }
    }
    return false;
  }


  /**
   * Whether a label could go in a rectangle of cells: nothing to avoid is there, and no other label.
   * @param cells - The cells the label would cover
   * @return `true` if every one of them is free
   */
  public isFree(cells: CellRect): boolean {
    return !this.isTaken('avoid', cells) && !this.isTaken('label', cells);
  }


  /**
   * How many blocks of cells have been made, of both kinds. (For tests and stats.)
   * @return The number of blocks
   */
  public get numBlocks(): number {
    return this._blocks.avoid.size + this._blocks.label.size;
  }


  /**
   * Adds to the count of every cell in a rectangle, making the blocks it needs.
   * A count stays between 0 and 65,535.
   * @param kind - Which counts
   * @param cells - The cells
   * @param delta - What to add: 1 or -1
   */
  protected _add(kind: AvoidKind, cells: CellRect, delta: number): void {
    const blocks = this._blocks[kind];
    const [minX, minY, maxX, maxY] = cells;

    for (let by = minY >> BLOCK_SHIFT; by <= (maxY >> BLOCK_SHIFT); by++) {
      for (let bx = minX >> BLOCK_SHIFT; bx <= (maxX >> BLOCK_SHIFT); bx++) {
        const key = this._key(bx, by);
        let block = blocks.get(key);
        if (!block) {
          if (delta < 0) continue;   // nothing was marked here
          block = new Uint16Array(BLOCK * BLOCK);
          blocks.set(key, block);
        }

        const x0 = Math.max(minX, bx << BLOCK_SHIFT) & BLOCK_MASK;
        const x1 = Math.min(maxX, (bx << BLOCK_SHIFT) + BLOCK_MASK) & BLOCK_MASK;
        const y0 = Math.max(minY, by << BLOCK_SHIFT) & BLOCK_MASK;
        const y1 = Math.min(maxY, (by << BLOCK_SHIFT) + BLOCK_MASK) & BLOCK_MASK;
        for (let y = y0; y <= y1; y++) {
          const row = y << BLOCK_SHIFT;
          for (let x = x0; x <= x1; x++) {
            const count = block[row + x] + delta;
            if (count >= 0 && count <= 0xffff) {
              block[row + x] = count;
            }
          }
        }
      }
    }
  }


  /**
   * The key of a block in the maps.
   * @param bx - The block's column (cells divided by 64, rounded down)
   * @param by - The block's row
   * @return One number for the pair
   */
  protected _key(bx: number, by: number): number {
    return (bx + HALF) * SPAN + (by + HALF);
  }

}
