import * as PIXI from 'pixi.js';
import { STROKE_FALLBACK_SIZE, STROKE_VERTEX_SIZE } from '../../geo/index.ts';
import { VertexBatch } from './VertexBatch.ts';

import type { BatchItem, BatchLayout } from './VertexBatch.ts';
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
 * One line in a batch (a casing or a stroke). `LineBatch.add()` returns it, and the caller keeps
 * it to change the line or take it out.
 */
export type LineBatchItem = BatchItem;

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

const LAYOUT: BatchLayout = {
  floats: FLOATS,
  bytes: BYTES,
  alphaByte: 3,
  attributes: {
    aPosition: { buffer: 'floats', format: 'float32x2', offset: 0 },
    aOffset: { buffer: 'floats', format: 'float32x2', offset: 8 },
    aAlong: { buffer: 'floats', format: 'float32x2', offset: 16 },
    aFallback: { buffer: 'floats', format: 'float32x4', offset: 24 },
    aWidth: { buffer: 'floats', format: 'float32x2', offset: 40 },
    aColor: { buffer: 'bytes', format: 'unorm8x4', offset: 0 },
    aDash: { buffer: 'bytes', format: 'unorm8x4', offset: 4 }
  }
};

/** The half width from which a vertex that has no second place uses it: never */
const NO_LIMIT = 3e38;


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
 * A `LineBatch` draws many lines as one mesh, in one draw call: every casing of a level's lines,
 * for example, or every stroke. Each line is a run of vertices in the batch's buffers, copied
 * from its stroke mesh (see `geomStrokeMesh()`), with how it's drawn (its width in pixels,
 * color, opacity and dashes) in every vertex.
 *
 * The shader puts each vertex where the line's width at the current zoom says, so a zoom changes
 * four numbers (`LineBatch.setView()`) and nothing in any batch. What the batch does with its
 * buffers (a line that changes, hiding, order, the place its coordinates start at) is
 * `VertexBatch`'s.
 *
 * See `design/graphics-system.md` section 15.
 */
export class LineBatch extends VertexBatch {

  /** Makes a batch with no lines in it. It draws nothing until one is added. */
  public constructor() {
    super(LAYOUT, lineShader());
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
   * Adds a line to the batch.
   * @param stroke - The line's stroke mesh. Its vertices are copied; its `indices` are kept, and must not change.
   * @param dx - Where the line's coordinates start, in the batch's
   * @param dy - The same, for y
   * @param style - How it's drawn
   * @param order - Where it's drawn among the others (higher is on top; lines with the same number in the order they were added)
   * @return The line in the batch, to change or remove it with
   */
  public add(stroke: StrokeMesh, dx: number, dy: number, style: LineBatchStyle, order: number = 0): LineBatchItem {
    const item = this._addItem(stroke.vertexCount, stroke.indices, order);
    this._writeStroke(item, stroke, dx, dy);
    this._writeStyle(item, style);
    return item;
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

    // The style goes along if the line moves: it's the same in all of a line's vertices.
    const style = (item.count > 0 && item.count !== stroke.vertexCount) ? this._readStyle(item.first, item.alpha) : null;
    if (this._resizeItem(item, stroke.vertexCount, stroke.indices) && style) {
      this._writeStyle(item, style);
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

}
