import * as PIXI from 'pixi.js';
import { BatchMesh } from './BatchMesh.ts';

import type { BatchMeshItem, BatchMeshLayout } from './BatchMesh.ts';


/**
 * One of the pictures that a point is drawn with: its marker, its icon, a viewfield.
 * It says what a `PIXI.Sprite` would: a texture, where its anchor is, how big it is and how
 * it's turned. Everything is in pixels, whatever the zoom.
 */
export interface PointBatchMeshQuad {
  /** The picture. It has to be in the texture that the batches draw from (`PointBatchMesh.canDraw`). */
  texture: PIXI.Texture;
  /** Where its anchor is, in pixels to the right of the point */
  x: number;
  /** Where its anchor is, in pixels below the point */
  y: number;
  /** How wide it's drawn, in pixels (negative to flip it) */
  width: number;
  /** How tall it's drawn, in pixels (negative to flip it) */
  height: number;
  /** The place in the picture that's put at `x`, from 0 (its left edge) to 1 (its right edge) */
  anchorX: number;
  /** The same, from 0 (its top) to 1 (its bottom) */
  anchorY: number;
  /** How it's turned around its anchor, in radians */
  rotation: number;
  /** The color it's tinted with, as 0xRRGGBB */
  color: number;
  /** The opacity, from 0 to 1 */
  alpha: number;
  /** Whether it turns with the map (a viewfield: it points somewhere on the ground), not staying upright on screen */
  turns: boolean;
  /** Whether its opacity follows the clock (the glow of a hovered point breathes: see `PointBatchShader.setTime`) */
  pulses?: boolean;
}

/** One point in a batch. `PointBatchMesh.add()` returns it, and the caller keeps it to change the point or take it out. */
export type PointBatchMeshItem = BatchMeshItem;


// A vertex is 6 floats in one buffer and 8 bytes in another (32 bytes), and a picture is 4 of them:
//   floats  0, 1    aPosition  where the point is (the same in every vertex of its pictures)
//           2, 3    aOffset    where this corner of the picture is, in pixels from the point
//           4, 5    aUV        where this corner is in the texture
//   bytes   0 - 3   aColor     red, green, blue, opacity
//           4       aFlags.x   255 if the picture turns with the map
//           5       aFlags.y   255 if the point is shown, 0 if it's hidden
//           6       aFlags.z   255 if the picture pulses (a glow: see `PointBatchShader.setTime`)
//           7                  not used
const FLOATS = 6;
const BYTES = 8;
const SHOWN_BYTE = 5;

const LAYOUT: BatchMeshLayout = {
  floats: FLOATS,
  bytes: BYTES,
  alphaByte: SHOWN_BYTE,
  attributes: {
    aPosition: { buffer: 'floats', format: 'float32x2', offset: 0 },
    aOffset: { buffer: 'floats', format: 'float32x2', offset: 8 },
    aUV: { buffer: 'floats', format: 'float32x2', offset: 16 },
    aColor: { buffer: 'bytes', format: 'unorm8x4', offset: 0 },
    aFlags: { buffer: 'bytes', format: 'unorm8x4', offset: 4 }
  }
};


const VERTEX_GLSL = `
in vec2 aPosition;
in vec2 aOffset;
in vec2 aUV;
in vec4 aColor;
in vec4 aFlags;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

uniform float uPulse;

out vec4 vColor;
out vec2 vUV;

void main() {
  // Where the point is on screen, in pixels. Its pictures are that many pixels from it at any
  // zoom, and upright however the map is turned..
  mat3 toScreen = uWorldTransformMatrix * uTransformMatrix;
  vec2 offset = aOffset;
  if (aFlags.x > 0.5) {
    // ..except one that turns with the map: it's laid out along the map's axes, as they are on screen.
    offset = normalize(toScreen[0].xy) * aOffset.x + normalize(toScreen[1].xy) * aOffset.y;
  }
  vec2 screen = (toScreen * vec3(aPosition, 1.0)).xy + offset;
  gl_Position = vec4((uProjectionMatrix * vec3(screen, 1.0)).xy, 0.0, 1.0);

  // A point that's hidden: all of its vertices in one place, outside the view.
  if (aFlags.y == 0.0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  }

  vUV = aUV;
  vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor * uWorldColorAlpha;

  // A picture that pulses (a glow) is as bright as the clock says.
  if (aFlags.z > 0.5) {
    vColor *= uPulse;
  }
}
`;

const FRAGMENT_GLSL = `
precision highp float;

in vec4 vColor;
in vec2 vUV;

uniform sampler2D uTexture;

out vec4 finalColor;

void main() {
  finalColor = texture(uTexture, vUV) * vColor;
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

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
struct PointUniforms {
  uPulse: f32,
}

@group(2) @binding(0) var uTexture: texture_2d<f32>;
@group(2) @binding(1) var uSampler: sampler;
@group(2) @binding(2) var<uniform> pointUniforms: PointUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vColor: vec4<f32>,
  @location(1) vUV: vec2<f32>,
}

@vertex
fn mainVert(
  @location(0) aPosition: vec2<f32>,
  @location(1) aOffset: vec2<f32>,
  @location(2) aUV: vec2<f32>,
  @location(3) aColor: vec4<f32>,
  @location(4) aFlags: vec4<f32>,
) -> VSOutput {
  let toScreen = globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  var offset = aOffset;
  if (aFlags.x > 0.5) {
    offset = normalize(toScreen[0].xy) * aOffset.x + normalize(toScreen[1].xy) * aOffset.y;
  }
  let screen = (toScreen * vec3<f32>(aPosition, 1.0)).xy + offset;

  var out: VSOutput;
  out.position = vec4<f32>((globalUniforms.uProjectionMatrix * vec3<f32>(screen, 1.0)).xy, 0.0, 1.0);
  if (aFlags.y == 0.0) {
    out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  }
  out.vUV = aUV;
  out.vColor = vec4<f32>(aColor.rgb * aColor.a, aColor.a) * localUniforms.uColor * globalUniforms.uWorldColorAlpha;
  if (aFlags.z > 0.5) {
    out.vColor = out.vColor * pointUniforms.uPulse;
  }
  return out;
}

@fragment
fn mainFrag(
  @location(0) vColor: vec4<f32>,
  @location(1) vUV: vec2<f32>,
) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, vUV) * vColor;
}
`;


/**
 * The shader that every `PointBatchMesh` of a scene draws with (see `BatchShaders`). It holds the
 * texture that the points' pictures are in, and a uniform for how bright the pictures that pulse
 * are at this moment.
 */
export class PointBatchShader extends PIXI.Shader {

  /** The texture that the batches draw from, or `null` before there's one (see `setTexture`) */
  protected _source: PIXI.TextureSource | null;


  /** Makes the shader, with no texture: a batch can draw nothing until it has one. */
  public constructor() {
    super({
      glProgram: PIXI.GlProgram.from({ vertex: VERTEX_GLSL, fragment: FRAGMENT_GLSL, name: 'point-batch' }),
      gpuProgram: PIXI.GpuProgram.from({
        vertex: { entryPoint: 'mainVert', source: SOURCE_WGSL },
        fragment: { entryPoint: 'mainFrag', source: SOURCE_WGSL }
      }),
      resources: {
        uTexture: PIXI.Texture.WHITE.source,
        uSampler: PIXI.Texture.WHITE.source.style,
        pointUniforms: new PIXI.UniformGroup({
          uPulse: { value: 1, type: 'f32' }
        })
      }
    });
    this._source = null;
  }


  /**
   * Gives every batch the texture that the points' pictures are in. A batch can draw only
   * what's in that one.
   * @param source - The texture, or `null` for none
   */
  public setTexture(source: PIXI.TextureSource | null): void {
    const used = source ?? PIXI.Texture.WHITE.source;
    this.resources.uTexture = used;
    this.resources.uSampler = used.style;
    this._source = source;
  }


  /**
   * Says how bright the pictures that pulse are at this moment, in every batch (a glow
   * breathes). Call it before a frame is drawn; nothing in any batch changes for it.
   * @param pulse - How bright, from 0 to 1
   */
  public setTime(pulse: number): void {
    this.resources.pointUniforms.uniforms.uPulse = pulse;
  }


  /**
   * Whether a batch can draw a picture: it has to be in the texture that the batches draw from.
   * (An icon that hasn't loaded isn't, nor is anything in a second slab of the atlas.)
   * @param texture - The picture
   * @return `true` if a batch can draw it
   */
  public canDraw(texture: PIXI.Texture): boolean {
    return !!this._source && texture.source === this._source;
  }
}


// The triangles of a point with a given number of pictures: two for each, in the order the
// pictures were given. (One array for every point with that many: a batch keeps it, and never changes it.)
const _quadIndices: Uint16Array[] = [];

/**
 * Returns the triangles of a number of pictures, as indices of their corners.
 * @param count - How many pictures
 * @return The indices: `[0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, …]`
 */
function quadIndices(count: number): Uint16Array {
  let indices = _quadIndices[count];
  if (!indices) {
    indices = new Uint16Array(count * 6);
    for (let i = 0; i < count; i++) {
      const v = i * 4;
      indices.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    _quadIndices[count] = indices;
  }
  return indices;
}


/**
 * A `PointBatchMesh` draws many points as one mesh, in one draw call. A point is a few pictures
 * (a marker, perhaps an icon over it and viewfields under it), each a rectangle of one texture
 * that holds them all: the symbol atlas of `PixiTextures` (`PointBatchShader.setTexture()`).
 *
 * The shader puts each picture a number of pixels from where its point is on screen. So the
 * pictures are the same size at every zoom and stay upright when the map is turned (or turn
 * with it, for a viewfield), and neither a zoom nor a rotation changes anything in a batch.
 * What the batch does with its buffers (a point that changes, hiding, order, the place its
 * coordinates start at) is `BatchMesh`'s.
 *
 * See "Batches" in `design/graphics-system.md`.
 */
export class PointBatchMesh extends BatchMesh {

  /**
   * The batch that the glows of this batch's points are drawn in, if its owner made one: a
   * small batch, drawn before this one. A glow comes and goes with every move of the pointer,
   * and a point that got one picture more in this batch would have the batch's index buffer
   * built again: 7 ms where the batch holds a town's points. It's destroyed with this batch.
   * (`null`: a point's glow is the lowest of its pictures in this batch.)
   */
  public glows: PointBatchMesh | null;

  /** The shader it draws with (the same object as `shader`, with its own type) */
  protected _pointShader: PointBatchShader;


  /**
   * Makes a batch with no points in it. It draws nothing until one is added.
   * @param shader - The shader it draws with: its scene's, which every point batch there shares (`BatchShaders.points`)
   */
  public constructor(shader: PointBatchShader) {
    super(LAYOUT, shader);
    this._pointShader = shader;
    this.glows = null;
  }


  /**
   * Destroys the batch, and the batch of its points' glows with it.
   * @param options - Pixi's options for destroying a display object
   */
  public override destroy(options?: PIXI.DestroyOptions): void {
    const glows = this.glows;
    this.glows = null;
    if (glows && !glows.destroyed) glows.destroy(options);
    super.destroy(options);
  }


  /**
   * Whether the batch can draw a picture: it has to be in the texture that its shader draws
   * from (see `PointBatchShader.canDraw`).
   * @param texture - The picture
   * @return `true` if the batch can draw it
   */
  public canDraw(texture: PIXI.Texture): boolean {
    return this._pointShader.canDraw(texture);
  }


  /**
   * Adds a point to the batch.
   * @param quads - Its pictures, the lowest first. Nothing of them is kept.
   * @param count - How many of `quads` to use, from the first
   * @param x - Where the point is, in the batch's coordinates
   * @param y - The same, for y
   * @param scale - How much larger than the pictures say everything is drawn (1 for as they say)
   * @param order - Where it's drawn among the others (higher is on top; points with the same number in the order they were added)
   * @param start - Which of `quads` is the first to use
   * @return The point in the batch, to change or remove it with
   */
  public add(quads: PointBatchMeshQuad[], count: number, x: number, y: number, scale: number = 1, order: number = 0, start: number = 0): PointBatchMeshItem {
    const item = this._addItem(count * 4, quadIndices(count), order);
    this._write(item, quads, count, x, y, scale, start);
    return item;
  }


  /**
   * Gives a point of the batch other pictures, or another place. If it has as many pictures as
   * before, they're written where the old ones were.
   * @param item - The point
   * @param quads - Its pictures now, the lowest first
   * @param count - How many of `quads` to use, from the first
   * @param x - Where the point is, in the batch's coordinates
   * @param y - The same, for y
   * @param scale - How much larger than the pictures say everything is drawn
   * @param start - Which of `quads` is the first to use
   */
  public set(item: PointBatchMeshItem, quads: PointBatchMeshQuad[], count: number, x: number, y: number, scale: number = 1, start: number = 0): void {
    if (item.batch !== this) return;
    this._resizeItem(item, count * 4, quadIndices(count));
    this._write(item, quads, count, x, y, scale, start);
  }


  /**
   * Writes a point's pictures into its place in the buffers: four corners each.
   * @param item - The point
   * @param quads - Its pictures
   * @param count - How many of them
   * @param x - Where the point is, in the batch's coordinates
   * @param y - The same, for y
   * @param scale - How much larger than the pictures say everything is drawn
   * @param start - Which of `quads` is the first of them
   */
  protected _write(item: PointBatchMeshItem, quads: PointBatchMeshQuad[], count: number, x: number, y: number, scale: number, start: number): void {
    const floats = this._floats;
    const bytes = this._bytes;
    const shown = item.visible ? item.alpha : 0;
    let o = item.first * FLOATS;
    let p = item.first * BYTES;

    for (let i = 0; i < count; i++) {
      const quad = quads[start + i];
      const uvs = quad.texture.uvs;
      const cos = Math.cos(quad.rotation);
      const sin = Math.sin(quad.rotation);

      // The picture's edges, from its anchor
      const left = -quad.anchorX * quad.width;
      const right = left + quad.width;
      const top = -quad.anchorY * quad.height;
      const bottom = top + quad.height;

      const color = quad.color;
      const r = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const b = color & 0xff;
      const a = Math.round(Math.min(Math.max(quad.alpha, 0), 1) * 255);
      const turns = quad.turns ? 255 : 0;
      const pulses = quad.pulses ? 255 : 0;

      // Its corners: top left, top right, bottom right, bottom left (as a texture's `uvs` has them)
      for (let corner = 0; corner < 4; corner++) {
        const cx = (corner === 0 || corner === 3) ? left : right;
        const cy = (corner < 2) ? top : bottom;
        floats[o] = x;
        floats[o + 1] = y;
        floats[o + 2] = (quad.x + cx * cos - cy * sin) * scale;
        floats[o + 3] = (quad.y + cx * sin + cy * cos) * scale;
        if (corner === 0) {
          floats[o + 4] = uvs.x0;
          floats[o + 5] = uvs.y0;
        } else if (corner === 1) {
          floats[o + 4] = uvs.x1;
          floats[o + 5] = uvs.y1;
        } else if (corner === 2) {
          floats[o + 4] = uvs.x2;
          floats[o + 5] = uvs.y2;
        } else {
          floats[o + 4] = uvs.x3;
          floats[o + 5] = uvs.y3;
        }
        bytes[p] = r;
        bytes[p + 1] = g;
        bytes[p + 2] = b;
        bytes[p + 3] = a;
        bytes[p + 4] = turns;
        bytes[p + 5] = shown;
        bytes[p + 6] = pulses;
        o += FLOATS;
        p += BYTES;
      }
    }
    this._markDirty(item);
    this._markBytesDirty(item);
  }

}
