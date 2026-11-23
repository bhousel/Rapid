import * as PIXI from 'pixi.js';
import { STROKE_FALLBACK_SIZE, STROKE_VERTEX_SIZE } from '../../geo/index.ts';

import type { StrokeMesh } from '../../geo/stroke.ts';


/** How one line of a batch is drawn: a casing or a stroke */
export interface LineBatchStyle {
  /** The width, in pixels, at zoom 17 and above (it's narrower below, see `LineBatch.setView`) */
  width: number;
  /** The narrowest it's drawn, in pixels */
  minWidth: number;
  /** The color, as 0xRRGGBB */
  color: number;
  /** The opacity, from 0 to 1 */
  alpha: number;
  /** The dash pattern in pixels, on and off, as two or four whole numbers up to 255 (see `LineBatch.canDraw`) */
  dash?: number[] | null;
  /** Whether it's a casing: those aren't drawn at every zoom (see `LineBatch.setView`) */
  isCasing?: boolean;
}

/**
 * One line in a batch. `LineBatch.add()` returns it, and the caller keeps it to change the line
 * or take it out. Its properties are the batch's to change.
 */
export interface LineBatchItem {
  /** The batch it's in, or `null` once it was removed */
  batch: LineBatch | null;
  /** Its first vertex in the batch's buffers */
  first: number;
  /** How many vertices it has there */
  count: number;
  /** Its triangles, as indices of its own vertices (the stroke mesh's array, which isn't changed) */
  indices: Uint16Array | Uint32Array;
  /** Where it's drawn among the others: a line with a higher number is drawn over one with a lower */
  order: number;
  /** Whether it's drawn */
  visible: boolean;
  /** Its opacity as it's in the vertices when it's drawn, from 1 to 255 (a hidden line has 0 there) */
  alpha: number;
}

/** What the view says about how the lines of every batch are drawn (see `LineBatch.setView`) */
export interface LineBatchView {
  /** How many units of the lines' coordinates a pixel is */
  pixel: number;
  /** How many pixels narrower every line is drawn at this zoom, down to its `minWidth` */
  narrow: number;
  /** Whether every line is drawn 1 pixel wide */
  wireframe: boolean;
  /** Whether casings are drawn */
  casing: boolean;
}


// A vertex is 12 floats in one buffer and 8 bytes in another (56 bytes):
//   floats  0, 1    aPosition  the point on the line that the vertex belongs to
//           2, 3    aOffset    how far the vertex is from that point, for a half width of 1
//           4, 5    aAlong     the distance along the line to that point, and how much further the vertex is for a half width of 1
//           6 - 9   aFallback  the offset and the further-along that replace those above a half width, and that half width
//           10, 11  aWidth     the width in pixels, and the least width (negative for a casing)
//   bytes   0 - 3   aColor     red, green, blue, opacity (0 for a line that's hidden)
//           4 - 7   aDash      the dash pattern, in pixels
const FLOATS = 12;
const BYTES = 8;
const FLOAT_STRIDE = FLOATS * 4;

/** The half width from which a vertex that has no second place uses it: never */
const NO_LIMIT = 3e38;

/** How many vertices a batch has room for when it's made */
const MIN_CAPACITY = 256;

/** The part of a batch's vertices that can go unused before it's packed again */
const MAX_WASTE = 0.5;

/**
 * How much larger the buffers get when they're full. (Doubling left a third of Užice's 80 MB of
 * batches unused after a load.)
 */
const GROWTH = 1.5;


const VERTEX_GLSL = `
in vec2 aPosition;
in vec2 aOffset;
in vec2 aAlong;
in vec4 aFallback;
in vec2 aWidth;
in vec4 aColor;
in vec4 aDash;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

uniform float uPixel;
uniform float uNarrow;
uniform float uWireframe;
uniform float uCasing;

out vec4 vColor;
out vec4 vDash;
out float vDistance;

void main() {
  float width = mix(max(aWidth.x - uNarrow, abs(aWidth.y)), 1.0, uWireframe);
  float halfWidth = 0.5 * width * uPixel;

  // A vertex on the inside of a corner has a second place, for when the line is too wide for the first.
  bool second = halfWidth > aFallback.w;
  vec2 offset = second ? aFallback.xy : aOffset;
  float along = second ? aFallback.z : aAlong.y;

  vec2 position = aPosition + offset * halfWidth;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(position, 1.0)).xy, 0.0, 1.0);

  // A line that's hidden, or a casing that isn't drawn at this zoom: all of its vertices in one
  // place, outside the view.
  if (aColor.a == 0.0 || (aWidth.y < 0.0 && uCasing < 0.5)) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  }

  vDistance = (aAlong.x + along * halfWidth) / uPixel;
  vDash = aDash * 255.0;
  vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor * uWorldColorAlpha;
}
`;

const FRAGMENT_GLSL = `
precision highp float;

in vec4 vColor;
in vec4 vDash;
in float vDistance;

out vec4 finalColor;

void main() {
  float alpha = 1.0;
  float total = vDash.x + vDash.y + vDash.z + vDash.w;
  if (total > 0.0) {
    // How much of this pixel is in a dash: the pattern has up to two, and then starts again.
    float t = mod(vDistance, total);
    float second = vDash.x + vDash.y;
    float a0 = clamp(min(t, vDash.x - t) + 0.5, 0.0, 1.0);
    float a1 = clamp(min(t - second, second + vDash.z - t) + 0.5, 0.0, 1.0) * step(0.5, vDash.z);
    float a2 = clamp(t - total + 0.5, 0.0, 1.0);
    alpha = max(a0, max(a1, a2));
  }
  finalColor = vColor * alpha;
}
`;

const SOURCE_WGSL = `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
}

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
}

struct LineUniforms {
  uPixel: f32,
  uNarrow: f32,
  uWireframe: f32,
  uCasing: f32,
}

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> lineUniforms: LineUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vColor: vec4<f32>,
  @location(1) vDash: vec4<f32>,
  @location(2) vDistance: f32,
}

@vertex
fn mainVert(
  @location(0) aPosition: vec2<f32>,
  @location(1) aOffset: vec2<f32>,
  @location(2) aAlong: vec2<f32>,
  @location(3) aFallback: vec4<f32>,
  @location(4) aWidth: vec2<f32>,
  @location(5) aColor: vec4<f32>,
  @location(6) aDash: vec4<f32>,
) -> VSOutput {
  let width = mix(max(aWidth.x - lineUniforms.uNarrow, abs(aWidth.y)), 1.0, lineUniforms.uWireframe);
  let halfWidth = 0.5 * width * lineUniforms.uPixel;

  let second = halfWidth > aFallback.w;
  let offset = select(aOffset, aFallback.xy, second);
  let along = select(aAlong.y, aFallback.z, second);

  let position = aPosition + offset * halfWidth;
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;

  var out: VSOutput;
  out.position = vec4<f32>((mvp * vec3<f32>(position, 1.0)).xy, 0.0, 1.0);
  if (aColor.a == 0.0 || (aWidth.y < 0.0 && lineUniforms.uCasing < 0.5)) {
    out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  }
  out.vDistance = (aAlong.x + along * halfWidth) / lineUniforms.uPixel;
  out.vDash = aDash * 255.0;
  out.vColor = vec4<f32>(aColor.rgb * aColor.a, aColor.a) * localUniforms.uColor * globalUniforms.uWorldColorAlpha;
  return out;
}

@fragment
fn mainFrag(
  @location(0) vColor: vec4<f32>,
  @location(1) vDash: vec4<f32>,
  @location(2) vDistance: f32,
) -> @location(0) vec4<f32> {
  var alpha = 1.0;
  let total = vDash.x + vDash.y + vDash.z + vDash.w;
  if (total > 0.0) {
    let t = vDistance - total * floor(vDistance / total);
    let second = vDash.x + vDash.y;
    let a0 = clamp(min(t, vDash.x - t) + 0.5, 0.0, 1.0);
    let a1 = clamp(min(t - second, second + vDash.z - t) + 0.5, 0.0, 1.0) * step(0.5, vDash.z);
    let a2 = clamp(t - total + 0.5, 0.0, 1.0);
    alpha = max(a0, max(a1, a2));
  }
  return vColor * alpha;
}
`;


// Every batch draws with the same shader, and the same numbers about the view.
let _shader: PIXI.Shader | null = null;
let _uniforms: PIXI.UniformGroup | null = null;
const _state = PIXI.State.for2d();

/**
 * Returns the uniforms that say how the lines of every batch are drawn for the current view.
 * @return The uniform group
 */
function lineUniforms(): PIXI.UniformGroup {
  _uniforms ??= new PIXI.UniformGroup({
    uPixel: { value: 1, type: 'f32' },
    uNarrow: { value: 0, type: 'f32' },
    uWireframe: { value: 0, type: 'f32' },
    uCasing: { value: 1, type: 'f32' }
  });
  return _uniforms;
}

/**
 * Returns the shader that every batch draws with, making it the first time.
 * @return The shader
 */
function lineShader(): PIXI.Shader {
  _shader ??= PIXI.Shader.from({
    gl: { vertex: VERTEX_GLSL, fragment: FRAGMENT_GLSL, name: 'line-batch' },
    gpu: {
      vertex: { entryPoint: 'mainVert', source: SOURCE_WGSL },
      fragment: { entryPoint: 'mainFrag', source: SOURCE_WGSL }
    },
    resources: { lineUniforms: lineUniforms() }
  });
  return _shader;
}


/**
 * A `LineBatch` draws many lines as one mesh, in one draw call: the casings and strokes of the
 * lines of one tile and road class, for example. Each line is a run of vertices in the batch's
 * buffers, copied from its stroke mesh (see `geomStrokeMesh()`), with how it's drawn (its width
 * in pixels, color, opacity and dashes) in every vertex.
 *
 * The shader puts each vertex where the line's width at the current zoom says, so a zoom changes
 * four numbers (`LineBatch.setView()`) and nothing in any batch. A line that changes is written
 * again where it was, if it has as many vertices as before; otherwise at the end, and the batch
 * packs itself when half of it is unused. The lines are drawn in the order of their `order`.
 * A hidden line stays where it is, with an opacity of 0 in its vertices, which the shader takes
 * as "draw nothing": hiding and showing lines (as a pan does at the edge of what's drawn) writes
 * a byte per vertex, and builds nothing.
 *
 * The batch's coordinates are the lines' own, plus what `add()` is told each line is offset by.
 * Keep them small (put the batch near its lines): the buffers hold 32-bit floats.
 *
 * What changed is sent to the GPU when the batch is next rendered, once, however many lines changed.
 *
 * See `design/graphics-system.md` section 15.
 */
export class LineBatch extends PIXI.Mesh<PIXI.Geometry, PIXI.Shader> {

  /**
   * How many features were given this batch to draw in (`PixiFeatureLine.batch`). A feature may
   * be drawn some frames after it gets its batch, so a batch with no lines in it yet can still
   * be one that's about to get some: its owner destroys it only when this is 0 too.
   */
  public users: number;

  /**
   * The lines in the batch, in the order they're drawn once `_sortDirty` is `false`, and the
   * ones that were removed since the index buffer was last built (their `batch` is `null`)
   */
  protected _items: LineBatchItem[];
  /** How many of `_items` were removed */
  protected _removed: number;
  /** How many of the batch's lines are visible */
  protected _numVisible: number;
  /** The vertices' floats (see the layout above) */
  protected _floats: Float32Array;
  /** The vertices' bytes */
  protected _bytes: Uint8Array;
  /** The lines' triangles, in drawing order, as indices of the batch's vertices */
  protected _indices: Uint32Array;
  /** How many vertices the buffers have room for */
  protected _capacity: number;
  /** One past the last vertex in use */
  protected _end: number;
  /** How many of the vertices before `_end` belong to no line anymore */
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


  /** Makes a batch with no lines in it. It draws nothing until one is added. */
  public constructor() {
    const floats = new Float32Array(MIN_CAPACITY * FLOATS);
    const bytes = new Uint8Array(MIN_CAPACITY * BYTES);
    const indices = new Uint32Array(MIN_CAPACITY * 3);

    const usage = PIXI.BufferUsage.VERTEX | PIXI.BufferUsage.COPY_DST;
    const floatBuffer = new PIXI.Buffer({ data: floats, usage: usage, label: 'line-batch-floats' });
    const byteBuffer = new PIXI.Buffer({ data: bytes, usage: usage, label: 'line-batch-bytes' });
    const indexBuffer = new PIXI.Buffer({ data: indices, usage: PIXI.BufferUsage.INDEX | PIXI.BufferUsage.COPY_DST, label: 'line-batch-indices' });

    const geometry = new PIXI.Geometry({
      attributes: {
        aPosition: { buffer: floatBuffer, format: 'float32x2', stride: FLOAT_STRIDE, offset: 0 },
        aOffset: { buffer: floatBuffer, format: 'float32x2', stride: FLOAT_STRIDE, offset: 8 },
        aAlong: { buffer: floatBuffer, format: 'float32x2', stride: FLOAT_STRIDE, offset: 16 },
        aFallback: { buffer: floatBuffer, format: 'float32x4', stride: FLOAT_STRIDE, offset: 24 },
        aWidth: { buffer: floatBuffer, format: 'float32x2', stride: FLOAT_STRIDE, offset: 40 },
        aColor: { buffer: byteBuffer, format: 'unorm8x4', stride: BYTES, offset: 0 },
        aDash: { buffer: byteBuffer, format: 'unorm8x4', stride: BYTES, offset: 4 }
      },
      indexBuffer: indexBuffer
    });

    super({ geometry: geometry, shader: lineShader(), state: _state });

    this.users = 0;
    this._items = [];
    this._removed = 0;
    this._numVisible = 0;
    this._floats = floats;
    this._bytes = bytes;
    this._indices = indices;
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
   * Says how the lines of every batch are drawn for the current view. Call it when the zoom or
   * the fill mode changes: nothing else has to be done to a batch for those.
   * @param view - What a pixel is in the lines' coordinates, and what the zoom does to widths and casings
   */
  public static setView(view: LineBatchView): void {
    const uniforms = lineUniforms().uniforms;
    uniforms.uPixel = view.pixel;
    uniforms.uNarrow = view.narrow;
    uniforms.uWireframe = view.wireframe ? 1 : 0;
    uniforms.uCasing = view.casing ? 1 : 0;
  }


  /**
   * Whether a batch can draw a line with the given dashes. A vertex has four bytes for them: up
   * to two dashes and two gaps, each a whole number of pixels up to 255. Every pattern Rapid's
   * styles have fits. A line with another pattern is drawn by a `LineMesh`, with a texture.
   * @param dash - The dash pattern, in pixels (nothing for a line that isn't dashed)
   * @return `true` if a batch can draw it
   */
  public static canDraw(dash: Nullable<number[]>): boolean {
    if (!dash?.length) return true;
    if (dash.length !== 2 && dash.length !== 4) return false;
    for (const part of dash) {
      if (!Number.isInteger(part) || part < 0 || part > 255) return false;
    }
    return true;
  }


  /**
   * Destroys the batch and its buffers. (A `Mesh` doesn't destroy its geometry, and Pixi keeps
   * what it built for one until it's destroyed.) The lines that were in it are in no batch then.
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
   * How many lines are in the batch
   * @return The number of lines
   */
  public get size(): number {
    return this._items.length - this._removed;
  }


  /**
   * How many vertices the batch's lines have, and how many its buffers have room for
   * @return `[used, capacity]`
   */
  public get vertexUse(): [number, number] {
    return [this._end - this._wasted, this._capacity];
  }


  /**
   * Adds a line to the batch.
   * @param stroke - The line's stroke mesh. Its vertices are copied; its `indices` are kept, and must not change.
   * @param dx - Where the line's coordinates start, in the batch's
   * @param dy - The same, for y
   * @param style - How it's drawn
   * @param order - Where it's drawn among the others (higher is on top; lines with the same number in the order they were added)
   * @return The line in the batch, to change or remove it with
   */
  public add(stroke: StrokeMesh, dx: number, dy: number, style: LineBatchStyle, order: number = 0): LineBatchItem {
    const item: LineBatchItem = { batch: this, first: 0, count: 0, indices: stroke.indices, order: order, visible: true, alpha: 255 };
    this._place(item, stroke.vertexCount);
    this._writeStroke(item, stroke, dx, dy);
    this._writeStyle(item, style);
    this._items.push(item);
    this._numVisible++;
    this._sortDirty = true;
    this._indexDirty = true;
    return item;
  }


  /**
   * Takes a line out of the batch. The item can't be used again.
   * @param item - The line
   */
  public remove(item: LineBatchItem): void {
    if (item.batch !== this) return;

    // (It leaves the list when the index buffer is next built: looking for it now would make
    // taking every line out of a large batch slow.)
    this._removed++;
    if (item.visible) this._numVisible--;
    this._wasted += item.count;
    item.batch = null;
    item.count = 0;
    this._indexDirty = true;
  }


  /**
   * Gives a line of the batch another shape. If it has as many vertices as before, they're
   * written where the old ones were (as when a vertex of the line was moved).
   * @param item - The line
   * @param stroke - Its new stroke mesh
   * @param dx - Where the line's coordinates start, in the batch's
   * @param dy - The same, for y
   */
  public setStroke(item: LineBatchItem, stroke: StrokeMesh, dx: number, dy: number): void {
    if (item.batch !== this) return;

    if (stroke.vertexCount !== item.count) {
      // The style goes along: it's the same in all of a line's vertices.
      const from = item.first;
      const style = (item.count > 0) ? this._readStyle(from, item.alpha) : null;
      this._wasted += item.count;
      this._place(item, stroke.vertexCount);
      if (style) this._writeStyle(item, style);
    }
    if (item.indices !== stroke.indices) {
      item.indices = stroke.indices;
      this._indexDirty = true;
    }
    this._writeStroke(item, stroke, dx, dy);
  }


  /**
   * Changes how a line of the batch is drawn.
   * @param item - The line
   * @param style - How it's drawn
   */
  public setStyle(item: LineBatchItem, style: LineBatchStyle): void {
    if (item.batch !== this) return;
    this._writeStyle(item, style);
  }


  /**
   * Changes where a line is drawn among the others.
   * @param item - The line
   * @param order - Higher is on top
   */
  public setOrder(item: LineBatchItem, order: number): void {
    if (item.batch !== this || item.order === order) return;
    item.order = order;
    this._sortDirty = true;
    this._indexDirty = true;
  }


  /**
   * Shows or hides a line of the batch. A hidden line keeps its vertices and its place among
   * the triangles: its opacity there is 0, which the shader draws nothing for.
   * @param item - The line
   * @param visible - Whether it's drawn
   */
  public setVisible(item: LineBatchItem, visible: boolean): void {
    if (item.batch !== this || item.visible === visible) return;
    item.visible = visible;
    this._numVisible += visible ? 1 : -1;

    const bytes = this._bytes;
    const alpha = visible ? item.alpha : 0;
    for (let i = 0, p = item.first * BYTES + 3; i < item.count; i++, p += BYTES) {
      bytes[p] = alpha;
    }
    this._markBytesDirty(item);
  }


  /**
   * Brings the buffers up to date with the lines, and marks what changed to be sent to the GPU.
   * Pixi calls this before it renders the batch; there's no need to call it otherwise.
   */
  public flush(): void {
    if (this._wasted > MIN_CAPACITY && this._wasted > this._end * MAX_WASTE) {
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
        this._floatBuffer.update((this._dirtyEnd - first) * FLOAT_STRIDE, first * FLOAT_STRIDE);
      }
      if (this._dirtyBytesEnd > this._dirtyBytesFirst) {
        const first = this._dirtyBytesFirst;
        this._byteBuffer.update((this._dirtyBytesEnd - first) * BYTES, first * BYTES);
      }
    }
    this._resized = false;
    this._dirtyFirst = Infinity;
    this._dirtyEnd = 0;
    this._dirtyBytesFirst = Infinity;
    this._dirtyBytesEnd = 0;
  }


  /**
   * Finds room for a line's vertices at the end of the buffers, making room if there's none:
   * by packing the batch if enough of it is unused, otherwise with larger buffers.
   * @param item - The line. Its `first` and `count` are set.
   * @param count - How many vertices it needs
   */
  protected _place(item: LineBatchItem, count: number): void {
    if (this._end + count > this._capacity) {
      const needed = this._end - this._wasted + count;
      const capacity = (needed <= this._capacity * MAX_WASTE) ? this._capacity : Math.ceil(Math.max(needed, this._capacity * GROWTH));
      item.count = 0;    // (it has no vertices to keep while the batch is packed)
      this._pack(capacity);
    }
    item.first = this._end;
    item.count = count;
    this._end += count;
  }


  /**
   * Moves every line's vertices to the start of the buffers, one after the other, leaving
   * nothing unused between them.
   * @param capacity - How many vertices the buffers should have room for (new ones are made if that's not what they have)
   */
  protected _pack(capacity: number): void {
    const byFirst = this._items.slice().sort((a, b) => a.first - b.first);
    const isSameSize = (capacity === this._capacity);
    const floats = isSameSize ? this._floats : new Float32Array(capacity * FLOATS);
    const bytes = isSameSize ? this._bytes : new Uint8Array(capacity * BYTES);

    let end = 0;
    for (const item of byFirst) {
      if (!item.count) continue;
      if (!isSameSize || item.first !== end) {
        // (Within one array this moves towards the start, which `copyWithin` and `set` both get right.)
        floats.set(this._floats.subarray(item.first * FLOATS, (item.first + item.count) * FLOATS), end * FLOATS);
        bytes.set(this._bytes.subarray(item.first * BYTES, (item.first + item.count) * BYTES), end * BYTES);
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
   * Copies a stroke mesh's vertices into a line's place in the buffers.
   * @param item - The line
   * @param stroke - The stroke mesh, with as many vertices as the line has room for
   * @param dx - Where the line's coordinates start, in the batch's
   * @param dy - The same, for y
   */
  protected _writeStroke(item: LineBatchItem, stroke: StrokeMesh, dx: number, dy: number): void {
    const floats = this._floats;
    const vertices = stroke.vertices;
    const count = item.count;

    for (let i = 0, k = 0, o = item.first * FLOATS; i < count; i++, k += STROKE_VERTEX_SIZE, o += FLOATS) {
      floats[o] = vertices[k] + dx;
      floats[o + 1] = vertices[k + 1] + dy;
      floats[o + 2] = vertices[k + 2];
      floats[o + 3] = vertices[k + 3];
      floats[o + 4] = vertices[k + 4];
      floats[o + 5] = vertices[k + 5];
      floats[o + 6] = vertices[k + 2];
      floats[o + 7] = vertices[k + 3];
      floats[o + 8] = vertices[k + 5];
      floats[o + 9] = NO_LIMIT;
    }

    const fallbacks = stroke.fallbacks;
    for (let f = 0; f < fallbacks.length; f += STROKE_FALLBACK_SIZE) {
      const o = (item.first + fallbacks[f]) * FLOATS;
      floats[o + 6] = fallbacks[f + 2];
      floats[o + 7] = fallbacks[f + 3];
      floats[o + 8] = fallbacks[f + 4];
      floats[o + 9] = fallbacks[f + 1];
    }

    this._markDirty(item);
  }


  /**
   * Writes how a line is drawn into each of its vertices.
   * @param item - The line
   * @param style - How it's drawn
   */
  protected _writeStyle(item: LineBatchItem, style: LineBatchStyle): void {
    const floats = this._floats;
    const bytes = this._bytes;
    const count = item.count;

    const width = style.width;
    const minWidth = Math.max(style.minWidth, 1e-6) * (style.isCasing ? -1 : 1);   // the sign says which it is
    const color = style.color;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    // (At least 1: an opacity of 0 in a vertex means the line is hidden.)
    item.alpha = Math.max(1, Math.round(Math.min(Math.max(style.alpha, 0), 1) * 255));
    const a = item.visible ? item.alpha : 0;
    const dash = style.dash;
    const d0 = dash?.[0] ?? 0;
    const d1 = dash?.[1] ?? 0;
    const d2 = dash?.[2] ?? 0;
    const d3 = dash?.[3] ?? 0;

    for (let i = 0, o = item.first * FLOATS, p = item.first * BYTES; i < count; i++, o += FLOATS, p += BYTES) {
      floats[o + 10] = width;
      floats[o + 11] = minWidth;
      bytes[p] = r;
      bytes[p + 1] = g;
      bytes[p + 2] = b;
      bytes[p + 3] = a;
      bytes[p + 4] = d0;
      bytes[p + 5] = d1;
      bytes[p + 6] = d2;
      bytes[p + 7] = d3;
    }

    this._markDirty(item);
    this._markBytesDirty(item);
  }


  /**
   * Reads how a line is drawn back from one of its vertices.
   * @param vertex - The vertex
   * @param alpha - The line's opacity when it's drawn, from 1 to 255 (a hidden line's vertices don't have it)
   * @return The style that was written there
   */
  protected _readStyle(vertex: number, alpha: number): LineBatchStyle {
    const o = vertex * FLOATS;
    const p = vertex * BYTES;
    const floats = this._floats;
    const bytes = this._bytes;
    const dash = [bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]];
    return {
      width: floats[o + 10],
      minWidth: Math.abs(floats[o + 11]),
      color: (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2],
      alpha: alpha / 255,
      dash: (dash[0] + dash[1] + dash[2] + dash[3] > 0) ? dash : null,
      isCasing: floats[o + 11] < 0
    };
  }


  /**
   * Remembers that the floats of a line's vertices have to be sent to the GPU.
   * @param item - The line
   */
  protected _markDirty(item: LineBatchItem): void {
    if (item.first < this._dirtyFirst) this._dirtyFirst = item.first;
    if (item.first + item.count > this._dirtyEnd) this._dirtyEnd = item.first + item.count;
  }


  /**
   * Remembers that the bytes of a line's vertices have to be sent to the GPU.
   * @param item - The line
   */
  protected _markBytesDirty(item: LineBatchItem): void {
    if (item.first < this._dirtyBytesFirst) this._dirtyBytesFirst = item.first;
    if (item.first + item.count > this._dirtyBytesEnd) this._dirtyBytesEnd = item.first + item.count;
  }


  /**
   * Builds the index buffer: the lines' triangles, in the order they're drawn. (Those of the
   * hidden lines too: the shader draws nothing for them, and showing one changes nothing here.)
   */
  protected _buildIndices(): void {
    let items = this._items;
    if (this._removed) {
      items = this._items = items.filter(item => item.batch === this);
      this._removed = 0;
    }
    if (this._sortDirty) {
      items.sort((a, b) => a.order - b.order);   // (a stable sort: equal lines stay in the order they were added)
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
