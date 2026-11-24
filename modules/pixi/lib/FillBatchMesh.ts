import * as PIXI from 'pixi.js';
import { BatchMesh } from './BatchMesh.ts';

import type { BatchMeshItem, BatchMeshLayout } from './BatchMesh.ts';


/** How one fill of a batch is drawn */
export interface FillBatchMeshStyle {
  /** The color, as 0xRRGGBB */
  color: number;
  /** The opacity, from 0 to 1 */
  alpha: number;
  /** Which pattern it's filled with: its number in the pattern atlas (`FillBatchShader.setPatterns`), or 0 for none */
  pattern?: number;
}

/** One fill in a batch. `FillBatchMesh.add()` returns it, and the caller keeps it to change the fill or take it out. */
export type FillBatchMeshItem = BatchMeshItem;

/** What the view says about how the fills of every batch are drawn (see `FillBatchShader.setView`) */
export interface FillBatchShaderView {
  /** How many units of the fills' coordinates a pixel is */
  pixel: number;
  /** The map's rotation, in radians: patterns stay upright on screen */
  rotation: number;
  /** Whether no fill is drawn (wireframe mode) */
  wireframe: boolean;
}

/** The patterns that fills can have, as one texture (see `FillBatchShader.setPatterns`) */
export interface FillPatternAtlas {
  /** The texture: a grid of cells, each a pattern's tile with a border of the texels that wrap around to it */
  texture: PIXI.Texture;
  /** How many cells a row of the grid has */
  columns: number;
  /** The size of a cell, in texels */
  cell: number;
  /** The size of a pattern's tile within its cell, in texels, which is also its size on screen in pixels */
  tile: number;
}


// A vertex is 2 floats in one buffer and 8 bytes in another (16 bytes):
//   floats  0, 1    aPosition  where the vertex is
//   bytes   0 - 3   aColor     red, green, blue, opacity (0 for a fill that's hidden)
//           4       aPattern   the pattern's number in the atlas, 0 for none
//           5 - 7              not used
const FLOATS = 2;
const BYTES = 8;

const LAYOUT: BatchMeshLayout = {
  floats: FLOATS,
  bytes: BYTES,
  alphaByte: 3,
  attributes: {
    aPosition: { buffer: 'floats', format: 'float32x2', offset: 0 },
    aColor: { buffer: 'bytes', format: 'unorm8x4', offset: 0 },
    aPattern: { buffer: 'bytes', format: 'unorm8x4', offset: 4 }
  }
};


const VERTEX_GLSL = `
in vec2 aPosition;
in vec4 aColor;
in vec4 aPattern;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

uniform vec4 uAtlas;
uniform vec2 uRotation;
uniform vec2 uAtlasSize;
uniform float uPixel;
uniform float uWireframe;

out vec4 vColor;
out vec2 vTile;
out float vPattern;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);

  // A fill that's hidden, or any fill in wireframe mode: all of its vertices in one place,
  // outside the view.
  if (aColor.a == 0.0 || uWireframe > 0.5) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  }

  // Where the vertex is in the pattern: a tile is uAtlas.z pixels wide on screen, whatever the
  // zoom, and upright, however the map is turned.
  vec2 pixels = aPosition / uPixel;
  vTile = vec2(pixels.x * uRotation.x - pixels.y * uRotation.y, pixels.x * uRotation.y + pixels.y * uRotation.x) / uAtlas.z;
  vPattern = aPattern.x * 255.0;
  vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor * uWorldColorAlpha;
}
`;

const FRAGMENT_GLSL = `
precision highp float;

in vec4 vColor;
in vec2 vTile;
in float vPattern;

uniform sampler2D uPatterns;
uniform vec4 uAtlas;
uniform vec2 uAtlasSize;

out vec4 finalColor;

void main() {
  vec4 color = vColor;
  if (vPattern > 0.5) {
    // The pattern's cell in the atlas, and the place in its tile. (The cell has a border of the
    // texels that wrap around, so that smoothing at the tile's edge takes the right ones.)
    float index = floor(vPattern + 0.5) - 1.0;
    vec2 cell = vec2(mod(index, uAtlas.x), floor(index / uAtlas.x));
    vec2 uv = (cell * uAtlas.y + 0.5 * (uAtlas.y - uAtlas.z) + fract(vTile) * uAtlas.z) / uAtlasSize;
    color *= texture(uPatterns, uv);
  }
  finalColor = color;
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

struct FillUniforms {
  uAtlas: vec4<f32>,
  uRotation: vec2<f32>,
  uAtlasSize: vec2<f32>,
  uPixel: f32,
  uWireframe: f32,
}

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> fillUniforms: FillUniforms;
@group(2) @binding(1) var uPatterns: texture_2d<f32>;
@group(2) @binding(2) var uPatternsSampler: sampler;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vColor: vec4<f32>,
  @location(1) vTile: vec2<f32>,
  @location(2) vPattern: f32,
}

@vertex
fn mainVert(
  @location(0) aPosition: vec2<f32>,
  @location(1) aColor: vec4<f32>,
  @location(2) aPattern: vec4<f32>,
) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;

  var out: VSOutput;
  out.position = vec4<f32>((mvp * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0);
  if (aColor.a == 0.0 || fillUniforms.uWireframe > 0.5) {
    out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  }

  let pixels = aPosition / fillUniforms.uPixel;
  let rotation = fillUniforms.uRotation;
  out.vTile = vec2<f32>(pixels.x * rotation.x - pixels.y * rotation.y, pixels.x * rotation.y + pixels.y * rotation.x) / fillUniforms.uAtlas.z;
  out.vPattern = aPattern.x * 255.0;
  out.vColor = vec4<f32>(aColor.rgb * aColor.a, aColor.a) * localUniforms.uColor * globalUniforms.uWorldColorAlpha;
  return out;
}

@fragment
fn mainFrag(
  @location(0) vColor: vec4<f32>,
  @location(1) vTile: vec2<f32>,
  @location(2) vPattern: f32,
) -> @location(0) vec4<f32> {
  let atlas = fillUniforms.uAtlas;
  let index = floor(vPattern + 0.5) - 1.0;
  let cell = vec2<f32>(index - atlas.x * floor(index / atlas.x), floor(index / atlas.x));
  let uv = (cell * atlas.y + 0.5 * (atlas.y - atlas.z) + fract(vTile) * atlas.z) / fillUniforms.uAtlasSize;
  let pattern = textureSample(uPatterns, uPatternsSampler, uv);
  return select(vColor, vColor * pattern, vPattern > 0.5);
}
`;


/**
 * The shader that every `FillBatchMesh` of a scene draws with (see `BatchShaders`). Its uniforms
 * say how fills are drawn for the current view, and it holds the texture of every pattern.
 */
export class FillBatchShader extends PIXI.Shader {

  /** Makes the shader, with no patterns (a fill with one is drawn in its plain color until it has them). */
  public constructor() {
    super({
      glProgram: PIXI.GlProgram.from({ vertex: VERTEX_GLSL, fragment: FRAGMENT_GLSL, name: 'fill-batch' }),
      gpuProgram: PIXI.GpuProgram.from({
        vertex: { entryPoint: 'mainVert', source: SOURCE_WGSL },
        fragment: { entryPoint: 'mainFrag', source: SOURCE_WGSL }
      }),
      resources: {
        // (In the order of the shader's `FillUniforms`.)
        fillUniforms: new PIXI.UniformGroup({
          uAtlas: { value: new Float32Array([1, 1, 1, 0]), type: 'vec4<f32>' },   // columns, a cell's size, a tile's size (in texels), not used
          uRotation: { value: new Float32Array([1, 0]), type: 'vec2<f32>' },      // the cosine and the sine of the map's rotation
          uAtlasSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },     // the atlas texture's size, in texels
          uPixel: { value: 1, type: 'f32' },
          uWireframe: { value: 0, type: 'f32' }
        }),
        uPatterns: PIXI.Texture.WHITE.source,
        uPatternsSampler: PIXI.Texture.WHITE.source.style
      }
    });
  }


  /**
   * Says how the fills of every batch are drawn for the current view. Call it when the zoom,
   * the rotation or the fill mode changes: nothing else has to be done to a batch for those.
   * @param view - What a pixel is in the fills' coordinates, how the map is turned, and whether fills are drawn
   */
  public setView(view: FillBatchShaderView): void {
    const uniforms = this.resources.fillUniforms.uniforms;
    uniforms.uPixel = view.pixel;
    uniforms.uWireframe = view.wireframe ? 1 : 0;
    uniforms.uRotation[0] = Math.cos(view.rotation);
    uniforms.uRotation[1] = Math.sin(view.rotation);
  }


  /**
   * Gives every batch the patterns that fills can have. Until then, a fill with a pattern is
   * drawn in its plain color.
   * @param atlas - The patterns in one texture, and how they're laid out in it
   */
  public setPatterns(atlas: FillPatternAtlas): void {
    const source = atlas.texture.source;
    this.resources.uPatterns = source;
    this.resources.uPatternsSampler = source.style;

    const uniforms = this.resources.fillUniforms.uniforms;
    uniforms.uAtlas[0] = atlas.columns;
    uniforms.uAtlas[1] = atlas.cell;
    uniforms.uAtlas[2] = atlas.tile;
    uniforms.uAtlasSize[0] = source.pixelWidth;
    uniforms.uAtlasSize[1] = source.pixelHeight;
  }
}


/**
 * A `FillBatchMesh` draws the fills of many areas as one mesh, in one draw call. Each fill is a run
 * of vertices in the batch's buffers (the corners of its triangles), with its color, opacity
 * and pattern in every vertex.
 *
 * A fill's triangles are worked out once, for any zoom. Its pattern is laid out by the shader:
 * tiles of the same size on screen at every zoom, upright however the map is turned, from one
 * texture that holds every pattern (`FillBatchShader.setPatterns()`). So a zoom changes a few numbers
 * (`FillBatchShader.setView()`) and nothing in any batch. What the batch does with its buffers (a
 * fill that changes, hiding, order, the place its coordinates start at) is `BatchMesh`'s.
 *
 * See `design/graphics-system.md` section 15.
 */
export class FillBatchMesh extends BatchMesh {

  /**
   * Makes a batch with no fills in it. It draws nothing until one is added.
   * @param shader - The shader it draws with: its scene's, which every fill batch there shares (`BatchShaders.fills`)
   */
  public constructor(shader: FillBatchShader) {
    super(LAYOUT, shader);
  }


  /**
   * Adds a fill to the batch.
   * @param positions - The corners of its triangles, as `[x, y, x, y, …]`. They're copied.
   * @param indices - Its triangles, as indices of those corners. The array is kept, and must not change.
   * @param dx - Where the fill's coordinates start, in the batch's
   * @param dy - The same, for y
   * @param style - How it's drawn
   * @param order - Where it's drawn among the others (higher is on top; fills with the same number in the order they were added)
   * @return The fill in the batch, to change or remove it with
   */
  public add(positions: ArrayLike<number>, indices: ArrayLike<number>, dx: number, dy: number, style: FillBatchMeshStyle, order: number = 0): FillBatchMeshItem {
    const item = this._addItem(positions.length >> 1, indices, order);
    this._writePositions(item, positions, dx, dy);
    this._writeStyle(item, style);
    return item;
  }


  /**
   * Gives a fill of the batch another shape. If it has as many corners as before, they're
   * written where the old ones were.
   * @param item - The fill
   * @param positions - The corners of its triangles now
   * @param indices - Its triangles now
   * @param dx - Where the fill's coordinates start, in the batch's
   * @param dy - The same, for y
   */
  public setFill(item: FillBatchMeshItem, positions: ArrayLike<number>, indices: ArrayLike<number>, dx: number, dy: number): void {
    if (item.batch !== this) return;

    // The style goes along if the fill moves: it's the same in all of a fill's vertices.
    const count = positions.length >> 1;
    const style = (item.count > 0 && item.count !== count) ? this._readStyle(item.first, item.alpha) : null;
    if (this._resizeItem(item, count, indices) && style) {
      this._writeStyle(item, style);
    }
    this._writePositions(item, positions, dx, dy);
  }


  /**
   * Changes how a fill of the batch is drawn.
   * @param item - The fill
   * @param style - How it's drawn
   */
  public setStyle(item: FillBatchMeshItem, style: FillBatchMeshStyle): void {
    if (item.batch !== this) return;
    this._writeStyle(item, style);
  }


  /**
   * Copies a fill's corners into its place in the buffers.
   * @param item - The fill
   * @param positions - Its corners, as many as the fill has room for
   * @param dx - Where the fill's coordinates start, in the batch's
   * @param dy - The same, for y
   */
  protected _writePositions(item: FillBatchMeshItem, positions: ArrayLike<number>, dx: number, dy: number): void {
    const floats = this._floats;
    const count = item.count;
    for (let i = 0, o = item.first * FLOATS; i < count; i++, o += FLOATS) {
      floats[o] = positions[i * 2] + dx;
      floats[o + 1] = positions[i * 2 + 1] + dy;
    }
    this._markDirty(item);
  }


  /**
   * Writes how a fill is drawn into each of its vertices.
   * @param item - The fill
   * @param style - How it's drawn
   */
  protected _writeStyle(item: FillBatchMeshItem, style: FillBatchMeshStyle): void {
    const bytes = this._bytes;
    const count = item.count;

    const color = style.color;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    // (At least 1: an opacity of 0 in a vertex means the fill is hidden.)
    item.alpha = Math.max(1, Math.round(Math.min(Math.max(style.alpha, 0), 1) * 255));
    const a = item.visible ? item.alpha : 0;
    const pattern = style.pattern ?? 0;

    for (let i = 0, p = item.first * BYTES; i < count; i++, p += BYTES) {
      bytes[p] = r;
      bytes[p + 1] = g;
      bytes[p + 2] = b;
      bytes[p + 3] = a;
      bytes[p + 4] = pattern;
    }
    this._markBytesDirty(item);
  }


  /**
   * Reads how a fill is drawn back from one of its vertices.
   * @param vertex - The vertex
   * @param alpha - The fill's opacity when it's drawn, from 1 to 255 (a hidden fill's vertices don't have it)
   * @return The style that was written there
   */
  protected _readStyle(vertex: number, alpha: number): FillBatchMeshStyle {
    const p = vertex * BYTES;
    const bytes = this._bytes;
    return {
      color: (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2],
      alpha: alpha / 255,
      pattern: bytes[p + 4]
    };
  }

}
