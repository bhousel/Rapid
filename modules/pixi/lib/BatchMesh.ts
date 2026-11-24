import * as PIXI from 'pixi.js';


/**
 * One thing in a batch: a line's casing or stroke, an area's fill, a point. The batch's `add()` returns
 * it, and the caller keeps it to change the thing or take it out. Its properties are the
 * batch's to change.
 */
export interface BatchMeshItem {
  /** The batch it's in, or `null` once it was removed */
  batch: BatchMesh | null;
  /** Its first vertex in the batch's buffers */
  first: number;
  /** How many vertices it has there */
  count: number;
  /** Its triangles, as indices of its own vertices (the array isn't copied, and must not change) */
  indices: ArrayLike<number>;
  /** Where it's drawn among the others: one with a higher number is drawn over one with a lower */
  order: number;
  /** Whether it's drawn */
  visible: boolean;
  /** What its vertices have in the batch's `alphaByte` when it's drawn, from 1 to 255 (a hidden one has 0 there) */
  alpha: number;
}

/** A vertex attribute of a batch: which of its two buffers it's in, and where */
export interface BatchMeshAttribute {
  /** The buffer: the vertices' floats, or their bytes */
  buffer: 'floats' | 'bytes';
  /** Pixi's name for the format, e.g. `'float32x2'` or `'unorm8x4'` */
  format: PIXI.VertexFormat;
  /** Where in a vertex of that buffer it starts, in bytes */
  offset: number;
}

/** What a vertex of a batch is made of (see `BatchMesh`) */
export interface BatchMeshLayout {
  /** How many floats a vertex has. The first two are its position. */
  floats: number;
  /** How many bytes a vertex has besides */
  bytes: number;
  /**
   * Which of those bytes is 0 in a hidden thing's vertices, where the shader has to draw nothing.
   * (The opacity in a `LineBatchMesh` and a `FillBatchMesh`; a byte of its own in a `PointBatchMesh`, whose
   * things have several opacities.)
   */
  alphaByte: number;
  /** The attributes that the shader reads, by name */
  attributes: Record<string, BatchMeshAttribute>;
}


/** How many vertices a batch has room for when it's made */
const MIN_CAPACITY = 256;

/** The part of a batch's vertices that can go unused before it's packed again */
const MAX_WASTE = 0.5;

/**
 * How much larger the buffers get when they're full. (Doubling left a third of Užice's 80 MB of
 * batches unused after a load.)
 */
const GROWTH = 1.5;

/**
 * When the buffers are full: if what's in use would fill no more than this part of them, the
 * batch packs itself and keeps the buffers it has; otherwise it gets larger ones.
 * (At a half, a batch whose things come and go kept getting larger buffers: Užice's outlines had
 * room for three times their vertices after two zooms in and out.)
 */
const MAX_FILL = 0.75;

/** A batch with less than this part of its buffers in use gets smaller ones (when it's flushed) */
const MIN_FILL = 0.3;

// A mesh with a shader of its own is never batched by Pixi, and never reads more of its `State`.
const _state = PIXI.State.for2d();


/**
 * A `BatchMesh` draws many things as one mesh, in one draw call, with a shader of its own.
 * Each thing is a run of vertices in the batch's buffers, and its triangles a run of indices.
 * `LineBatchMesh` (casings and strokes), `FillBatchMesh` (the fills of areas) and
 * `PointBatchMesh` (markers and icons) say what a vertex holds and how it's written; this class
 * keeps the buffers. (It's not one of Pixi's batches: Pixi draws it on its own.)
 *
 * - **A vertex is some floats in one buffer and some bytes in another.** The first two floats
 *   are its position, relative to the batch's own `position` in the world. Keep them small
 *   (put the batch near its things, and `moveOrigin()` when the view has gone far from there):
 *   they're 32-bit floats.
 * - **Things are drawn in the order of their `order`.** The index buffer is built again when
 *   one joins, leaves or changes its order.
 * - **A hidden thing stays where it is, with a 0 in one byte of its vertices** (its opacity,
 *   in most batches), which the shader has to draw nothing for. Hiding and showing (as a pan does at the edge of what's
 *   drawn) writes a byte per vertex, and builds nothing.
 * - **A thing that changes is written where it was** if it has as many vertices as before;
 *   otherwise at the end, and the batch packs itself when half of it is unused. Its buffers
 *   get larger when they're three quarters full of what's in use, and smaller when less than
 *   a third of them is.
 * - **What changed is sent to the GPU when the batch is next rendered,** once, however much
 *   changed (`flush()`, which Pixi calls through `onRender`).
 *
 * See `design/graphics-system.md` section 15.
 */
export abstract class BatchMesh extends PIXI.Mesh<PIXI.Geometry, PIXI.Shader> {

  /**
   * How many features were given this batch to draw in. A feature may be drawn some frames
   * after it gets its batch, so a batch with nothing in it yet can still be one that's about to
   * get something: its owner destroys it only when this is 0 too.
   */
  public users: number;

  /**
   * The things in the batch, in the order they're drawn once `_sortDirty` is `false`, and the
   * ones that were removed since the index buffer was last built (their `batch` is `null`)
   */
  protected _items: BatchMeshItem[];
  /** How many of `_items` were removed */
  protected _removed: number;
  /** How many of the batch's things are visible */
  protected _numVisible: number;
  /** The vertices' floats */
  protected _floats: Float32Array;
  /** The vertices' bytes */
  protected _bytes: Uint8Array;
  /** The things' triangles, in drawing order, as indices of the batch's vertices */
  protected _indices: Uint32Array;
  /** How many floats a vertex has */
  protected _floatsPer: number;
  /** How many bytes a vertex has */
  protected _bytesPer: number;
  /** Which byte of a vertex is its opacity */
  protected _alphaByte: number;
  /** How many vertices the buffers have room for */
  protected _capacity: number;
  /** One past the last vertex in use */
  protected _end: number;
  /** How many of the vertices before `_end` belong to nothing anymore */
  protected _wasted: number;
  /** Whether `_items` needs sorting */
  protected _sortDirty: boolean;
  /** Whether the index buffer needs building again */
  protected _indexDirty: boolean;
  /** The first vertex whose floats changed since the buffers were sent to the GPU, `Infinity` if none did */
  protected _dirtyFirst: number;
  /** One past the last vertex whose floats changed since then */
  protected _dirtyEnd: number;
  /** The first vertex whose bytes changed since then, `Infinity` if none did */
  protected _dirtyBytesFirst: number;
  /** One past the last vertex whose bytes changed since then */
  protected _dirtyBytesEnd: number;
  /** Whether the buffers were replaced by larger ones since then */
  protected _resized: boolean;
  protected _floatBuffer: PIXI.Buffer;
  protected _byteBuffer: PIXI.Buffer;
  protected _indexBuffer: PIXI.Buffer;


  /**
   * Makes a batch with nothing in it. It draws nothing until something is added.
   * @param layout - What a vertex is made of
   * @param shader - The shader that draws it. Every batch of one kind shares one.
   */
  public constructor(layout: BatchMeshLayout, shader: PIXI.Shader) {
    const floats = new Float32Array(MIN_CAPACITY * layout.floats);
    const bytes = new Uint8Array(MIN_CAPACITY * layout.bytes);
    const indices = new Uint32Array(MIN_CAPACITY * 3);

    const usage = PIXI.BufferUsage.VERTEX | PIXI.BufferUsage.COPY_DST;
    const floatBuffer = new PIXI.Buffer({ data: floats, usage: usage, label: 'batch-floats' });
    const byteBuffer = new PIXI.Buffer({ data: bytes, usage: usage, label: 'batch-bytes' });
    const indexBuffer = new PIXI.Buffer({ data: indices, usage: PIXI.BufferUsage.INDEX | PIXI.BufferUsage.COPY_DST, label: 'batch-indices' });

    const attributes: Record<string, PIXI.AttributeOption> = {};
    for (const [name, attribute] of Object.entries(layout.attributes)) {
      const isFloats = (attribute.buffer === 'floats');
      attributes[name] = {
        buffer: isFloats ? floatBuffer : byteBuffer,
        format: attribute.format,
        stride: isFloats ? layout.floats * 4 : layout.bytes,
        offset: attribute.offset
      };
    }
    const geometry = new PIXI.Geometry({ attributes: attributes, indexBuffer: indexBuffer });

    super({ geometry: geometry, shader: shader, state: _state });

    this.users = 0;
    this._items = [];
    this._removed = 0;
    this._numVisible = 0;
    this._floats = floats;
    this._bytes = bytes;
    this._indices = indices;
    this._floatsPer = layout.floats;
    this._bytesPer = layout.bytes;
    this._alphaByte = layout.alphaByte;
    this._capacity = MIN_CAPACITY;
    this._end = 0;
    this._wasted = 0;
    this._sortDirty = false;
    this._indexDirty = false;
    this._dirtyFirst = Infinity;
    this._dirtyEnd = 0;
    this._dirtyBytesFirst = Infinity;
    this._dirtyBytesEnd = 0;
    this._resized = false;
    this._floatBuffer = floatBuffer;
    this._byteBuffer = byteBuffer;
    this._indexBuffer = indexBuffer;

    this.eventMode = 'none';
    this.renderable = false;   // nothing to draw yet

    // Pixi calls this before it renders, on every frame the batch is in the scene.
    this.onRender = () => this.flush();
  }


  /**
   * Destroys the batch and its buffers. (A `Mesh` doesn't destroy its geometry, and Pixi keeps
   * what it built for one until it's destroyed.) What was in it is in no batch then.
   * @param options - Pixi's options for destroying a display object
   */
  public override destroy(options?: PIXI.DestroyOptions): void {
    const geometry = this.geometry;
    this.onRender = null!;
    super.destroy(options);
    geometry?.destroy(true);

    for (const item of this._items) {
      item.batch = null;
    }
    this._items = [];
    this._removed = 0;
  }


  /**
   * How many things are in the batch
   * @return The number of them
   */
  public get size(): number {
    return this._items.length - this._removed;
  }


  /**
   * How many vertices the batch's things have, and how many its buffers have room for
   * @return `[used, capacity]`
   */
  public get vertexUse(): [number, number] {
    return [this._end - this._wasted, this._capacity];
  }


  /**
   * Takes something out of the batch. The item can't be used again.
   * @param item - The thing
   */
  public remove(item: BatchMeshItem): void {
    if (item.batch !== this) return;

    // (It leaves the list when the index buffer is next built: looking for it now would make
    // taking everything out of a large batch slow.)
    this._removed++;
    if (item.visible) this._numVisible--;
    this._wasted += item.count;
    item.batch = null;
    item.count = 0;
    this._indexDirty = true;
  }


  /**
   * Changes where something is drawn among the others.
   * @param item - The thing
   * @param order - Higher is on top
   */
  public setOrder(item: BatchMeshItem, order: number): void {
    if (item.batch !== this || item.order === order) return;
    item.order = order;
    this._sortDirty = true;
    this._indexDirty = true;
  }


  /**
   * Shows or hides something in the batch. Hidden, it keeps its vertices and its place among
   * the triangles: its opacity there is 0, which the shader draws nothing for.
   * @param item - The thing
   * @param visible - Whether it's drawn
   */
  public setVisible(item: BatchMeshItem, visible: boolean): void {
    if (item.batch !== this || item.visible === visible) return;
    item.visible = visible;
    this._numVisible += visible ? 1 : -1;

    const bytes = this._bytes;
    const bytesPer = this._bytesPer;
    const alpha = visible ? item.alpha : 0;
    for (let i = 0, p = item.first * bytesPer + this._alphaByte; i < item.count; i++, p += bytesPer) {
      bytes[p] = alpha;
    }
    this._markBytesDirty(item);
  }


  /**
   * Moves the place that the batch's coordinates start at, and the batch with it, so that
   * everything stays where it is in the world. The buffers hold 32-bit floats, which are only
   * fine enough near that place: move it when the view is far from it (and before adding
   * things, which are written relative to it).
   * @param x - The new place in the world, where the batch's own `position` goes
   * @param y - The same, for y
   */
  public moveOrigin(x: number, y: number): void {
    const dx = this.position.x - x;
    const dy = this.position.y - y;
    this.position.set(x, y);
    if (!dx && !dy) return;

    const floats = this._floats;
    const floatsPer = this._floatsPer;
    const end = this._end * floatsPer;
    for (let o = 0; o < end; o += floatsPer) {
      floats[o] += dx;
      floats[o + 1] += dy;
    }
    if (this._end > 0) {
      this._dirtyFirst = 0;
      this._dirtyEnd = this._end;
    }
  }


  /**
   * Brings the buffers up to date with what's in the batch, and marks what changed to be sent
   * to the GPU. Pixi calls this before it renders the batch; there's no need to call it otherwise.
   */
  public flush(): void {
    // Smaller buffers when most of their room has gone unused (the view moved somewhere with
    // less in it, or zoomed out to where areas have no outlines), with room to grow again.
    const used = this._end - this._wasted;
    if (this._capacity > MIN_CAPACITY && used < this._capacity * MIN_FILL) {
      this._pack(Math.max(MIN_CAPACITY, Math.ceil(used * GROWTH)));
    } else if (this._wasted > MIN_CAPACITY && this._wasted > this._end * MAX_WASTE) {
      this._pack(this._capacity);
    }
    if (this._indexDirty) {
      this._buildIndices();
    }
    // (An `indexCount` of 0 would draw the whole buffer, so a batch with nothing to draw isn't rendered.)
    this.renderable = (this._numVisible > 0 && this.geometry.indexCount > 0);

    if (this._resized) {
      this._floatBuffer.data = this._floats;   // a larger array: Pixi makes the GPU's buffer again
      this._byteBuffer.data = this._bytes;
    } else {
      if (this._dirtyEnd > this._dirtyFirst) {
        const first = this._dirtyFirst;
        const stride = this._floatsPer * 4;
        this._floatBuffer.update((this._dirtyEnd - first) * stride, first * stride);
      }
      if (this._dirtyBytesEnd > this._dirtyBytesFirst) {
        const first = this._dirtyBytesFirst;
        this._byteBuffer.update((this._dirtyBytesEnd - first) * this._bytesPer, first * this._bytesPer);
      }
    }
    this._resized = false;
    this._dirtyFirst = Infinity;
    this._dirtyEnd = 0;
    this._dirtyBytesFirst = Infinity;
    this._dirtyBytesEnd = 0;
  }


  /**
   * Puts a new thing in the batch, with room for its vertices. The caller writes them.
   * @param count - How many vertices it has
   * @param indices - Its triangles, as indices of its own vertices
   * @param order - Where it's drawn among the others (higher is on top; equal ones in the order they were added)
   * @return The thing in the batch
   */
  protected _addItem(count: number, indices: ArrayLike<number>, order: number): BatchMeshItem {
    const item: BatchMeshItem = { batch: this, first: 0, count: 0, indices: indices, order: order, visible: true, alpha: 255 };
    this._place(item, count);
    this._items.push(item);
    this._numVisible++;
    this._sortDirty = true;
    this._indexDirty = true;
    return item;
  }


  /**
   * Gives something in the batch another number of vertices, and other triangles. With as many
   * vertices as before it stays where it is; otherwise it gets room at the end, and the caller
   * writes all of its vertices again.
   * @param item - The thing
   * @param count - How many vertices it has now
   * @param indices - Its triangles now
   * @return `true` if it moved
   */
  protected _resizeItem(item: BatchMeshItem, count: number, indices: ArrayLike<number>): boolean {
    if (item.indices !== indices) {
      item.indices = indices;
      this._indexDirty = true;
    }
    if (count === item.count) return false;

    this._wasted += item.count;
    this._place(item, count);
    this._indexDirty = true;
    return true;
  }


  /**
   * Finds room for a thing's vertices at the end of the buffers, making room if there's none:
   * by packing the batch if enough of it is unused, otherwise with larger buffers.
   * @param item - The thing. Its `first` and `count` are set.
   * @param count - How many vertices it needs
   */
  protected _place(item: BatchMeshItem, count: number): void {
    if (this._end + count > this._capacity) {
      const needed = this._end - this._wasted + count;
      const capacity = (needed <= this._capacity * MAX_FILL) ? this._capacity : Math.ceil(Math.max(needed, this._capacity * GROWTH));
      item.count = 0;    // (it has no vertices to keep while the batch is packed)
      this._pack(capacity);
    }
    item.first = this._end;
    item.count = count;
    this._end += count;
  }


  /**
   * Moves every thing's vertices to the start of the buffers, one after the other, leaving
   * nothing unused between them.
   * @param capacity - How many vertices the buffers should have room for (new ones are made if that's not what they have)
   */
  protected _pack(capacity: number): void {
    const floatsPer = this._floatsPer;
    const bytesPer = this._bytesPer;
    const byFirst = this._items.slice().sort((a, b) => a.first - b.first);
    const isSameSize = (capacity === this._capacity);
    const floats = isSameSize ? this._floats : new Float32Array(capacity * floatsPer);
    const bytes = isSameSize ? this._bytes : new Uint8Array(capacity * bytesPer);

    let end = 0;
    for (const item of byFirst) {
      if (!item.count) continue;
      if (!isSameSize || item.first !== end) {
        // (Within one array this moves towards the start, which `set` gets right.)
        floats.set(this._floats.subarray(item.first * floatsPer, (item.first + item.count) * floatsPer), end * floatsPer);
        bytes.set(this._bytes.subarray(item.first * bytesPer, (item.first + item.count) * bytesPer), end * bytesPer);
        item.first = end;
      }
      end += item.count;
    }

    this._floats = floats;
    this._bytes = bytes;
    this._capacity = capacity;
    this._end = end;
    this._wasted = 0;
    this._indexDirty = true;
    this._dirtyFirst = 0;
    this._dirtyEnd = end;
    this._dirtyBytesFirst = 0;
    this._dirtyBytesEnd = end;
    if (!isSameSize) this._resized = true;
  }


  /**
   * Remembers that the floats of a thing's vertices have to be sent to the GPU.
   * @param item - The thing
   */
  protected _markDirty(item: BatchMeshItem): void {
    if (item.first < this._dirtyFirst) this._dirtyFirst = item.first;
    if (item.first + item.count > this._dirtyEnd) this._dirtyEnd = item.first + item.count;
  }


  /**
   * Remembers that the bytes of a thing's vertices have to be sent to the GPU.
   * @param item - The thing
   */
  protected _markBytesDirty(item: BatchMeshItem): void {
    if (item.first < this._dirtyBytesFirst) this._dirtyBytesFirst = item.first;
    if (item.first + item.count > this._dirtyBytesEnd) this._dirtyBytesEnd = item.first + item.count;
  }


  /**
   * Builds the index buffer: every thing's triangles, in the order they're drawn. (Those of
   * the hidden ones too: the shader draws nothing for them, and showing one changes nothing here.)
   */
  protected _buildIndices(): void {
    let items = this._items;
    if (this._removed) {
      items = this._items = items.filter(item => item.batch === this);
      this._removed = 0;
    }
    if (this._sortDirty) {
      items.sort((a, b) => a.order - b.order);   // (a stable sort: equal ones stay in the order they were added)
      this._sortDirty = false;
    }

    let total = 0;
    for (const item of items) {
      total += item.indices.length;
    }

    let indices = this._indices;
    if (indices.length < total) {
      indices = this._indices = new Uint32Array(PIXI.nextPow2(total));
    }

    let k = 0;
    for (const item of items) {
      const own = item.indices;
      const count = own.length;
      const first = item.first;
      for (let i = 0; i < count; i++) {
        indices[k + i] = own[i] + first;
      }
      k += count;
    }

    this.geometry.indexCount = total;
    if (this._indexBuffer.data !== indices) {
      this._indexBuffer.data = indices;
    } else if (total > 0) {
      this._indexBuffer.update(total * 4, 0);
    }
    this._indexDirty = false;
  }

}
