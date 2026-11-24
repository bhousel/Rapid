import * as PIXI from 'pixi.js';
import { STROKE_FALLBACK_SIZE, STROKE_VERTEX_SIZE } from '../../geo/index.ts';
import { BatchMesh } from './BatchMesh.ts';

import type { BatchMeshItem, BatchMeshLayout } from './BatchMesh.ts';
import type { StrokeMesh } from '../../geo/stroke.ts';


/** How one line of a batch is drawn: a casing or a stroke */
export interface LineBatchMeshStyle {
  /** The width, in pixels, at zoom 17 and above (it's narrower below, see `LineBatchShader.setView`) */
  width: number;
  /** The narrowest it's drawn, in pixels */
  minWidth: number;
  /** The color, as 0xRRGGBB */
  color: number;
  /** The opacity, from 0 to 1 */
  alpha: number;
  /** The dash pattern in pixels, on and off, as two or four whole numbers up to 255 (see `LineBatchMesh.canDraw`) */
  dash?: number[] | null;
  /** Whether it's a casing: those aren't drawn at every zoom (see `LineBatchShader.setView`) */
  isCasing?: boolean;
  /**
   * Whether it marches: its dashes move along it (see `LineBatchShader.setTime`), and it's drawn as
   * wide as `width` says at every zoom and in wireframe mode. The halo of a selection does.
   */
  marches?: boolean;
}

/** The glow around one line of a batch: of a hover or a highlight (see `LineBatchMesh.addGlow`) */
export interface LineBatchMeshGlow {
  /** The width of the line that the glow is around, in pixels, at zoom 17 and above: the glow starts at its edge */
  width: number;
  /** The narrowest that line is drawn, in pixels */
  minWidth: number;
  /** The glow's color, as 0xRRGGBB */
  color: number;
  /** Its opacity where it's brightest, from 0 to 1 */
  alpha: number;
}

/** What the clock says about how the things that move in every batch are drawn (see `LineBatchShader.setTime`) */
export interface LineBatchShaderTime {
  /** How bright a glow is now, from 0 to 1: it breathes */
  pulse: number;
  /** How far the dashes of a line that marches have moved along it, in pixels */
  shift: number;
}

/** The kinds of marker that a batch can draw along a line (see `LineBatchMesh.addMarkers`) */
export type LineMarkerKind = 'oneway' | 'twoway' | 'sided';

/** The markers drawn along one line of a batch */
export interface LineBatchMeshMarkers {
  /** Which marker: an arrow along the line, an arrow at both ends, or a triangle on the line's right side */
  kind: LineMarkerKind;
  /** The color, as 0xRRGGBB */
  color: number;
  /** The opacity, from 0 to 1 */
  alpha: number;
  /** Whether a `oneway` arrow points back along the line, towards its start */
  reversed?: boolean;
}

/** How a kind of marker is laid out along a line, in pixels */
export interface LineMarkerLayout {
  /** How far apart the markers are, from middle to middle. The first is this far from the line's start. */
  spacing: number;
  /** How wide the strip along the line has to be for the markers to fit in it */
  width: number;
  /** The kind's number in a vertex */
  code: number;
}

/**
 * The markers a batch can draw. Their shapes are in the fragment shaders below, in pixels:
 * - `oneway`: an arrow 10 long and 5 across, in the middle of the line, pointing along it (or
 *   back along it, which is one more number in a vertex: `REVERSED_CODE`)
 * - `twoway`: an arrow 15 long with a head at both ends
 * - `sided`: a triangle with a base of 10 along the line, 4.5 to its right (as it's drawn on
 *   screen, going from its first point to its last), and its point 9.5 to its right
 */
export const LINE_MARKERS: Record<LineMarkerKind, LineMarkerLayout> = {
  oneway: { spacing: 35, width: 7, code: 1 },
  twoway: { spacing: 35, width: 7, code: 2 },
  sided: { spacing: 30, width: 21, code: 3 }
};

/** The kind's number in a vertex for a `oneway` arrow that points back along the line */
const REVERSED_CODE = 4;

/** The number in a vertex that says it's a glow's, where a marker's kind would be */
const GLOW_CODE = 5;

/** How far a glow reaches beyond the line it's around, in pixels. (The shaders have the same number.) */
export const LINE_GLOW = 12;

/**
 * One line in a batch (a casing, a stroke, or the markers along a line). `LineBatchMesh.add()` and
 * `addMarkers()` return it, and the caller keeps it to change the line or take it out.
 */
export type LineBatchMeshItem = BatchMeshItem;

/** What the view says about how the lines of every batch are drawn (see `LineBatchShader.setView`) */
export interface LineBatchShaderView {
  /** How many units of the lines' coordinates a pixel is */
  pixel: number;
  /** How many pixels narrower every line is drawn at this zoom, down to its `minWidth` */
  narrow: number;
  /** Whether every line is drawn 1 pixel wide */
  wireframe: boolean;
  /** Whether casings are drawn */
  casing: boolean;
  /** Whether the markers along lines are drawn */
  markers: boolean;
}


// A vertex is 12 floats in one buffer and 8 bytes in another (56 bytes):
//   floats  0, 1    aPosition  the point on the line that the vertex belongs to
//           2, 3    aOffset    how far the vertex is from that point, for a half width of 1
//           4, 5    aAlong     the distance along the line to that point, and how much further the vertex is for a half width of 1
//           6 - 9   aFallback  the offset and the further-along that replace those above a half width, and that half width
//           10, 11  aWidth     the width in pixels (negative for a line that marches), and the
//                              least width (negative for a casing, 0 for markers and a glow)
//   bytes   0 - 3   aColor     red, green, blue, opacity (0 for a line that's hidden)
//           4 - 7   aDash      the dash pattern, in pixels
//                              For markers: the kind of marker, their spacing in pixels, and the
//                              side of the line the vertex is on as its stroke mesh has it, plus 1
//                              (0, 1 on the line, or 2), at its first place and at its second
//                              For a glow: 5, and the least width of the line it's around in
//                              sixteenths of a pixel. (And `aAlong` is where the vertex is from
//                              the nearest point of the line, for a half width of 1.)
const FLOATS = 12;
const BYTES = 8;

const LAYOUT: BatchMeshLayout = {
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
uniform float uMarkers;
uniform float uGlow;
uniform float uShift;

out vec4 vColor;
out vec4 vDash;
out float vDistance;
out vec2 vMarker;

const float GLOW = 12.0;

void main() {
  vec4 dash = aDash * 255.0;

  // A least width of 0: not a line's casing or stroke, but something drawn along it in a strip
  // of its own. A glow (around the line, GLOW pixels beyond its edge) or its markers.
  bool strip = (aWidth.y == 0.0);
  bool glow = strip && dash.x > 4.5;
  bool markers = strip && !glow;
  // A negative width: a line that marches. It's as wide as it says, whatever the zoom.
  bool marches = (aWidth.x < 0.0);

  // The line's own width at this zoom (for a glow: of the line it's around)
  float least = glow ? dash.y / 16.0 : abs(aWidth.y);
  float own = mix(max(abs(aWidth.x) - uNarrow, least), 1.0, uWireframe);
  float width = (markers || marches) ? abs(aWidth.x) : (glow ? own + 2.0 * GLOW : own);
  float halfWidth = 0.5 * width * uPixel;

  // A vertex on the inside of a corner has a second place, for when the line is too wide for the first.
  bool second = halfWidth > aFallback.w;
  vec2 offset = second ? aFallback.xy : aOffset;
  float along = second ? aFallback.z : aAlong.y;

  vec2 position = aPosition + offset * halfWidth;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(position, 1.0)).xy, 0.0, 1.0);

  // A line that's hidden, or a casing or markers that aren't drawn at this zoom: all of its
  // vertices in one place, outside the view.
  if (aColor.a == 0.0 || (aWidth.y < 0.0 && uCasing < 0.5) || (markers && uMarkers < 0.5)) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  }

  vDistance = (aAlong.x + along * halfWidth) / uPixel;
  vDash = dash;
  vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor * uWorldColorAlpha;

  // What the fragment shader needs to know about a strip, or about a line that marches:
  //   a line:    0, and how far its dashes have moved
  //   markers:   which kind, and how many pixels the vertex is to the side of the line (the
  //              side that the stroke mesh calls 1)
  //   a glow:    5, and where the vertex is from the nearest point of the line, in pixels
  //              (x here, y in vDistance: aAlong holds that for a glow, in half widths); and
  //              in vDash.y, how many pixels from the line its edge is, where the glow starts
  float side = second ? dash.w : dash.z;
  vMarker = vec2(0.0, marches ? uShift : 0.0);
  if (markers) {
    vMarker = vec2(dash.x, (side - 1.0) * 0.5 * width);
  }
  if (glow) {
    vec2 away = (second ? aFallback.xy : aAlong) * 0.5 * width;
    vMarker = vec2(dash.x, away.x);
    vDistance = away.y;
    vDash.y = 0.5 * own;
    vColor *= uGlow;
  }
}
`;

const FRAGMENT_GLSL = `
precision highp float;

in vec4 vColor;
in vec4 vDash;
in float vDistance;
in vec2 vMarker;

out vec4 finalColor;

const float GLOW = 12.0;

void main() {
  float alpha = 1.0;
  float total = vDash.x + vDash.y + vDash.z + vDash.w;
  if (vMarker.x > 4.5) {
    // A glow: brightest at the edge of the line it's around, gone GLOW pixels further out,
    // and nothing over the line itself.
    float beyond = length(vec2(vMarker.y, vDistance)) - vDash.y;
    float fade = clamp(1.0 - beyond / GLOW, 0.0, 1.0);
    alpha = clamp(beyond + 0.5, 0.0, 1.0) * fade * fade;
  } else if (vMarker.x > 0.5) {
    // Markers: where this pixel is from the middle of the nearest one, along the line (u) and
    // to the side that the stroke mesh calls 1 (v): the line's right on screen, where y is
    // down. The line's start has none. Then how far inside the marker's shape that
    // is, in pixels (negative outside): half a pixel either side of its edge is the smooth part.
    float spacing = vDash.y;
    float u = vDistance - max(1.0, floor(vDistance / spacing + 0.5)) * spacing;
    float v = vMarker.y;
    float kind = vMarker.x;
    if (kind > 3.5) {   // a oneway arrow that points back along the line
      u = -u;
      kind = 1.0;
    }
    float inside;
    if (kind < 1.5) {
      // oneway: a shaft 5 long and 1 across, then a head 5 long and 5 across at its base
      float shaft = min(min(u + 5.0, 1.0 - u), 0.5 - abs(v));
      float head = min(u, (2.5 - 0.5 * u - abs(v)) / 1.118);
      inside = max(shaft, head);
    } else if (kind < 2.5) {
      // twoway: a shaft 5 long, and a head at each end
      float w = abs(u);
      float shaft = min(3.5 - w, 0.5 - abs(v));
      float head = min(w - 2.5, (3.75 - 0.5 * w - abs(v)) / 1.118);
      inside = max(shaft, head);
    } else {
      // sided: a triangle on that side, its base 4.5 from the line and its point 9.5 from it
      float q = v - 4.5;
      inside = min(q, (5.0 - q - abs(u)) / 1.414);
    }
    alpha = clamp(inside + 0.5, 0.0, 1.0);
  } else if (total > 0.0) {
    // How much of this pixel is in a dash: the pattern has up to two, and then starts again.
    // (The dashes of a line that marches have moved along it.)
    float t = mod(vDistance - vMarker.y, total);
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
  uMarkers: f32,
  uGlow: f32,
  uShift: f32,
}

const GLOW: f32 = 12.0;

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> lineUniforms: LineUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vColor: vec4<f32>,
  @location(1) vDash: vec4<f32>,
  @location(2) vDistance: f32,
  @location(3) vMarker: vec2<f32>,
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
  let dash = aDash * 255.0;
  let strip = (aWidth.y == 0.0);
  let glow = strip && dash.x > 4.5;
  let markers = strip && !glow;
  let marches = (aWidth.x < 0.0);

  let least = select(abs(aWidth.y), dash.y / 16.0, glow);
  let own = mix(max(abs(aWidth.x) - lineUniforms.uNarrow, least), 1.0, lineUniforms.uWireframe);
  var width = own;
  if (markers || marches) {
    width = abs(aWidth.x);
  }
  if (glow) {
    width = own + 2.0 * GLOW;
  }
  let halfWidth = 0.5 * width * lineUniforms.uPixel;

  let second = halfWidth > aFallback.w;
  let offset = select(aOffset, aFallback.xy, second);
  let along = select(aAlong.y, aFallback.z, second);

  let position = aPosition + offset * halfWidth;
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;

  var out: VSOutput;
  out.position = vec4<f32>((mvp * vec3<f32>(position, 1.0)).xy, 0.0, 1.0);
  if (aColor.a == 0.0 || (aWidth.y < 0.0 && lineUniforms.uCasing < 0.5) || (markers && lineUniforms.uMarkers < 0.5)) {
    out.position = vec4<f32>(2.0, 2.0, 0.0, 1.0);
  }
  out.vDistance = (aAlong.x + along * halfWidth) / lineUniforms.uPixel;
  out.vDash = dash;
  out.vColor = vec4<f32>(aColor.rgb * aColor.a, aColor.a) * localUniforms.uColor * globalUniforms.uWorldColorAlpha;

  let side = select(dash.z, dash.w, second);
  out.vMarker = vec2<f32>(0.0, select(0.0, lineUniforms.uShift, marches));
  if (markers) {
    out.vMarker = vec2<f32>(dash.x, (side - 1.0) * 0.5 * width);
  }
  if (glow) {
    let away = select(aAlong, aFallback.xy, second) * 0.5 * width;
    out.vMarker = vec2<f32>(dash.x, away.x);
    out.vDistance = away.y;
    out.vDash.y = 0.5 * own;
    out.vColor = out.vColor * lineUniforms.uGlow;
  }
  return out;
}

@fragment
fn mainFrag(
  @location(0) vColor: vec4<f32>,
  @location(1) vDash: vec4<f32>,
  @location(2) vDistance: f32,
  @location(3) vMarker: vec2<f32>,
) -> @location(0) vec4<f32> {
  var alpha = 1.0;
  let total = vDash.x + vDash.y + vDash.z + vDash.w;
  if (vMarker.x > 4.5) {
    let beyond = length(vec2<f32>(vMarker.y, vDistance)) - vDash.y;
    let fade = clamp(1.0 - beyond / GLOW, 0.0, 1.0);
    alpha = clamp(beyond + 0.5, 0.0, 1.0) * fade * fade;
  } else if (vMarker.x > 0.5) {
    let spacing = vDash.y;
    var u = vDistance - max(1.0, floor(vDistance / spacing + 0.5)) * spacing;
    let v = vMarker.y;
    var kind = vMarker.x;
    if (kind > 3.5) {
      u = -u;
      kind = 1.0;
    }
    var inside = 0.0;
    if (kind < 1.5) {
      let shaft = min(min(u + 5.0, 1.0 - u), 0.5 - abs(v));
      let head = min(u, (2.5 - 0.5 * u - abs(v)) / 1.118);
      inside = max(shaft, head);
    } else if (kind < 2.5) {
      let w = abs(u);
      let shaft = min(3.5 - w, 0.5 - abs(v));
      let head = min(w - 2.5, (3.75 - 0.5 * w - abs(v)) / 1.118);
      inside = max(shaft, head);
    } else {
      let q = v - 4.5;
      inside = min(q, (5.0 - q - abs(u)) / 1.414);
    }
    alpha = clamp(inside + 0.5, 0.0, 1.0);
  } else if (total > 0.0) {
    let moved = vDistance - vMarker.y;
    let t = moved - total * floor(moved / total);
    let second = vDash.x + vDash.y;
    let a0 = clamp(min(t, vDash.x - t) + 0.5, 0.0, 1.0);
    let a1 = clamp(min(t - second, second + vDash.z - t) + 0.5, 0.0, 1.0) * step(0.5, vDash.z);
    let a2 = clamp(t - total + 0.5, 0.0, 1.0);
    alpha = max(a0, max(a1, a2));
  }
  return vColor * alpha;
}
`;


/**
 * The shader that every `LineBatchMesh` of a scene draws with (see `BatchShaders`). Its uniforms
 * say how lines are drawn for the current view, and where the things that move are at this
 * moment: a zoom or a rotation changes them, and nothing in any batch.
 */
export class LineBatchShader extends PIXI.Shader {

  /** Makes the shader, with lines drawn as at zoom 17 until it's told about a view. */
  public constructor() {
    super({
      glProgram: PIXI.GlProgram.from({ vertex: VERTEX_GLSL, fragment: FRAGMENT_GLSL, name: 'line-batch' }),
      gpuProgram: PIXI.GpuProgram.from({
        vertex: { entryPoint: 'mainVert', source: SOURCE_WGSL },
        fragment: { entryPoint: 'mainFrag', source: SOURCE_WGSL }
      }),
      resources: {
        lineUniforms: new PIXI.UniformGroup({
          uPixel: { value: 1, type: 'f32' },
          uNarrow: { value: 0, type: 'f32' },
          uWireframe: { value: 0, type: 'f32' },
          uCasing: { value: 1, type: 'f32' },
          uMarkers: { value: 1, type: 'f32' },
          uGlow: { value: 1, type: 'f32' },
          uShift: { value: 0, type: 'f32' }
        })
      }
    });
  }


  /**
   * Says how the lines of every batch are drawn for the current view. Call it when the zoom or
   * the fill mode changes: nothing else has to be done to a batch for those.
   * @param view - What a pixel is in the lines' coordinates, and what the zoom does to widths and casings
   */
  public setView(view: LineBatchShaderView): void {
    const uniforms = this.resources.lineUniforms.uniforms;
    uniforms.uPixel = view.pixel;
    uniforms.uNarrow = view.narrow;
    uniforms.uWireframe = view.wireframe ? 1 : 0;
    uniforms.uCasing = view.casing ? 1 : 0;
    uniforms.uMarkers = view.markers ? 1 : 0;
  }


  /**
   * Says how the things that move are drawn at this moment, in every batch: how bright the
   * glows are, and how far the dashes of the lines that march have moved. Call it before a
   * frame is drawn; nothing in any batch changes for it.
   * @param time - What the clock says
   */
  public setTime(time: LineBatchShaderTime): void {
    const uniforms = this.resources.lineUniforms.uniforms;
    uniforms.uGlow = time.pulse;
    uniforms.uShift = time.shift;
  }
}


/**
 * A `LineBatchMesh` draws many lines as one mesh, in one draw call: every casing of a level's lines,
 * for example, or every stroke. Each line is a run of vertices in the batch's buffers, copied
 * from its stroke mesh (see `geomStrokeMesh()`), with how it's drawn (its width in pixels,
 * color, opacity and dashes) in every vertex.
 *
 * The shader puts each vertex where the line's width at the current zoom says, so a zoom changes
 * five numbers (`LineBatchShader.setView()`) and nothing in any batch. Two more numbers follow the
 * clock (`LineBatchShader.setTime()`): they make the glow around a hovered line breathe
 * (`addGlow()`), and move the dashes of a line that marches, like a selection's halo. The markers along a line (oneway
 * arrows, the triangles of a line with sides) are a strip in the batch too, and the shader
 * draws them in it (`addMarkers()`). What the batch does with its
 * buffers (a line that changes, hiding, order, the place its coordinates start at) is
 * `BatchMesh`'s.
 *
 * See `design/graphics-system.md` section 15.
 */
export class LineBatchMesh extends BatchMesh {

  /**
   * The batch that the glows of this batch's lines are drawn in, if its owner made one: a
   * small batch, drawn after this one. A glow comes and goes with every move of the pointer,
   * and each one that joined or left this batch would have its index buffer built again and
   * its vertices sent to the GPU again: 9 ms where a batch holds a town's roads. It's
   * destroyed with this batch. (`null`: glows are drawn in this batch.)
   */
  public glows: LineBatchMesh | null;

  /**
   * Makes a batch with no lines in it. It draws nothing until one is added.
   * @param shader - The shader it draws with: its scene's, which every line batch there shares (`BatchShaders.lines`)
   */
  public constructor(shader: LineBatchShader) {
    super(LAYOUT, shader);
    this.glows = null;
  }


  /**
   * Destroys the batch, and the batch of its lines' glows with it.
   * @param options - Pixi's options for destroying a display object
   */
  public override destroy(options?: PIXI.DestroyOptions): void {
    const glows = this.glows;
    this.glows = null;
    if (glows && !glows.destroyed) glows.destroy(options);
    super.destroy(options);
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
  public add(stroke: StrokeMesh, dx: number, dy: number, style: LineBatchMeshStyle, order: number = 0): LineBatchMeshItem {
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
  public setStroke(item: LineBatchMeshItem, stroke: StrokeMesh, dx: number, dy: number): void {
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
  public setStyle(item: LineBatchMeshItem, style: LineBatchMeshStyle): void {
    if (item.batch !== this) return;
    this._writeStyle(item, style);
  }


  /**
   * Adds the markers along a line to the batch: oneway arrows, or the triangles on the side of
   * a line that has sides. They're a strip along the line, as wide as the markers need, that
   * the shader draws the markers in from the distance along the line: so many pixels apart at
   * every zoom, with nothing to build when the zoom changes.
   * @param stroke - The line's stroke mesh. Its vertices are copied; its `indices` are kept, and must not change.
   * @param dx - Where the line's coordinates start, in the batch's
   * @param dy - The same, for y
   * @param markers - Which markers, and their color
   * @param order - Where they're drawn among the others (higher is on top)
   * @return The markers in the batch, to change or remove them with
   */
  public addMarkers(stroke: StrokeMesh, dx: number, dy: number, markers: LineBatchMeshMarkers, order: number = 0): LineBatchMeshItem {
    const item = this._addItem(stroke.vertexCount, stroke.indices, order);
    this._writeStroke(item, stroke, dx, dy);
    this._writeMarkers(item, markers);
    this._writeSides(item, stroke);
    return item;
  }


  /**
   * Gives the markers along a line another line to go along, another kind or another color.
   * If the line has as many vertices as before, they're written where the old ones were.
   * @param item - The markers (from `addMarkers`)
   * @param stroke - The line's stroke mesh now
   * @param dx - Where the line's coordinates start, in the batch's
   * @param dy - The same, for y
   * @param markers - Which markers, and their color
   */
  public setMarkers(item: LineBatchMeshItem, stroke: StrokeMesh, dx: number, dy: number, markers: LineBatchMeshMarkers): void {
    if (item.batch !== this) return;
    this._resizeItem(item, stroke.vertexCount, stroke.indices);
    this._writeStroke(item, stroke, dx, dy);
    this._writeMarkers(item, markers);
    this._writeSides(item, stroke);
  }


  /**
   * Changes the kind or the color of the markers along a line, on the line they're on.
   * @param item - The markers (from `addMarkers`)
   * @param markers - Which markers, and their color
   */
  public setMarkerStyle(item: LineBatchMeshItem, markers: LineBatchMeshMarkers): void {
    if (item.batch !== this) return;
    this._writeMarkers(item, markers);
  }


  /**
   * Adds the glow around a line to the batch: of a hover or a highlight. It's a strip along
   * the line, as wide as the line and `LINE_GLOW` pixels more on each side, in which the shader
   * draws a color that's brightest at the line's edge and fades out. Give it a stroke mesh
   * with round caps and joins, so that the glow goes around the line's ends and corners.
   * How bright every glow is changes with the clock (`LineBatchShader.setTime`).
   * @param stroke - The line's stroke mesh. Its vertices are copied; its `indices` are kept, and must not change.
   * @param dx - Where the line's coordinates start, in the batch's
   * @param dy - The same, for y
   * @param glow - How wide the line is that the glow is around, and the glow's color
   * @param order - Where it's drawn among the others (higher is on top)
   * @return The glow in the batch, to change or remove it with
   */
  public addGlow(stroke: StrokeMesh, dx: number, dy: number, glow: LineBatchMeshGlow, order: number = 0): LineBatchMeshItem {
    const item = this._addItem(stroke.vertexCount, stroke.indices, order);
    this._writeStroke(item, stroke, dx, dy);
    this._writeGlow(item, glow);
    this._writeAround(item, stroke);
    return item;
  }


  /**
   * Puts the glow around a line around another line, or changes its color.
   * If the line has as many vertices as before, they're written where the old ones were.
   * @param item - The glow (from `addGlow`)
   * @param stroke - The line's stroke mesh now
   * @param dx - Where the line's coordinates start, in the batch's
   * @param dy - The same, for y
   * @param glow - How wide the line is, and the glow's color
   */
  public setGlow(item: LineBatchMeshItem, stroke: StrokeMesh, dx: number, dy: number, glow: LineBatchMeshGlow): void {
    if (item.batch !== this) return;
    this._resizeItem(item, stroke.vertexCount, stroke.indices);
    this._writeStroke(item, stroke, dx, dy);
    this._writeGlow(item, glow);
    this._writeAround(item, stroke);
  }


  /**
   * Changes the color of a glow, or the width of the line it's around, on the line it's on.
   * @param item - The glow (from `addGlow`)
   * @param glow - How wide the line is, and the glow's color
   */
  public setGlowStyle(item: LineBatchMeshItem, glow: LineBatchMeshGlow): void {
    if (item.batch !== this) return;
    this._writeGlow(item, glow);
  }


  /**
   * Copies a stroke mesh's vertices into a line's place in the buffers.
   * @param item - The line
   * @param stroke - The stroke mesh, with as many vertices as the line has room for
   * @param dx - Where the line's coordinates start, in the batch's
   * @param dy - The same, for y
   */
  protected _writeStroke(item: LineBatchMeshItem, stroke: StrokeMesh, dx: number, dy: number): void {
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
  protected _writeStyle(item: LineBatchMeshItem, style: LineBatchMeshStyle): void {
    const floats = this._floats;
    const bytes = this._bytes;
    const count = item.count;

    const width = Math.max(style.width, 1e-6) * (style.marches ? -1 : 1);            // the sign says whether it marches
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
   * Writes which markers a strip draws, and their color, into each of its vertices.
   * @param item - The markers
   * @param markers - Which markers, and their color
   */
  protected _writeMarkers(item: LineBatchMeshItem, markers: LineBatchMeshMarkers): void {
    const floats = this._floats;
    const bytes = this._bytes;
    const count = item.count;
    const layout = LINE_MARKERS[markers.kind];
    const code = (markers.kind === 'oneway' && markers.reversed) ? REVERSED_CODE : layout.code;

    const color = markers.color;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    // (At least 1: an opacity of 0 in a vertex means the markers are hidden.)
    item.alpha = Math.max(1, Math.round(Math.min(Math.max(markers.alpha, 0), 1) * 255));
    const a = item.visible ? item.alpha : 0;

    for (let i = 0, o = item.first * FLOATS, p = item.first * BYTES; i < count; i++, o += FLOATS, p += BYTES) {
      floats[o + 10] = layout.width;
      floats[o + 11] = 0;     // a least width of 0 says it's markers
      bytes[p] = r;
      bytes[p + 1] = g;
      bytes[p + 2] = b;
      bytes[p + 3] = a;
      bytes[p + 4] = code;
      bytes[p + 5] = layout.spacing;
    }

    this._markDirty(item);
    this._markBytesDirty(item);
  }


  /**
   * Writes which side of the line each vertex of a strip of markers is on: at its own place,
   * and at the second place of a vertex that has one. (A casing and a stroke don't need to
   * know: they're the same color all the way across.)
   * @param item - The markers
   * @param stroke - The stroke mesh that the strip was copied from
   */
  protected _writeSides(item: LineBatchMeshItem, stroke: StrokeMesh): void {
    const bytes = this._bytes;
    const vertices = stroke.vertices;
    const count = item.count;

    for (let i = 0, k = 6, p = item.first * BYTES; i < count; i++, k += STROKE_VERTEX_SIZE, p += BYTES) {
      const side = vertices[k] + 1;
      bytes[p + 6] = side;
      bytes[p + 7] = side;
    }

    const fallbacks = stroke.fallbacks;
    for (let f = 0; f < fallbacks.length; f += STROKE_FALLBACK_SIZE) {
      bytes[(item.first + fallbacks[f]) * BYTES + 7] = fallbacks[f + 5] + 1;
    }

    this._markBytesDirty(item);
  }


  /**
   * Writes what a glow is around, and its color, into each of its vertices.
   * @param item - The glow
   * @param glow - How wide the line is that it's around, and the glow's color
   */
  protected _writeGlow(item: LineBatchMeshItem, glow: LineBatchMeshGlow): void {
    const floats = this._floats;
    const bytes = this._bytes;
    const count = item.count;

    const width = Math.max(glow.width, 1e-6);
    const least = Math.min(255, Math.round(Math.max(glow.minWidth, 0) * 16));   // in sixteenths of a pixel
    const color = glow.color;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    // (At least 1: an opacity of 0 in a vertex means the glow is hidden.)
    item.alpha = Math.max(1, Math.round(Math.min(Math.max(glow.alpha, 0), 1) * 255));
    const a = item.visible ? item.alpha : 0;

    for (let i = 0, o = item.first * FLOATS, p = item.first * BYTES; i < count; i++, o += FLOATS, p += BYTES) {
      floats[o + 10] = width;
      floats[o + 11] = 0;     // a least width of 0 says it's a strip
      bytes[p] = r;
      bytes[p + 1] = g;
      bytes[p + 2] = b;
      bytes[p + 3] = a;
      bytes[p + 4] = GLOW_CODE;
      bytes[p + 5] = least;
    }

    this._markDirty(item);
    this._markBytesDirty(item);
  }


  /**
   * Writes where each vertex of a glow's strip is from the nearest point of the line, in half
   * widths of the strip, where a line's vertices have their distance along the line (a glow
   * has no dashes). The fragment shader fades the glow with the length of that. It's the
   * vertex's own offset, without the part of it that's along the line (the tip of a miter is
   * further from the corner than from the line): across a segment that goes from one side's
   * normal to the other's, through 0 on the line, and around a round end or corner it turns
   * with the vertices. (A vertex's second place is beside its segment, so its offset there is
   * what the shader wants as it is.)
   * @param item - The glow
   * @param stroke - The stroke mesh that the strip was copied from
   */
  protected _writeAround(item: LineBatchMeshItem, stroke: StrokeMesh): void {
    const floats = this._floats;
    const vertices = stroke.vertices;
    const count = item.count;

    for (let i = 0, k = 0, o = item.first * FLOATS; i < count; i++, k += STROKE_VERTEX_SIZE, o += FLOATS) {
      const ex = vertices[k + 2];
      const ey = vertices[k + 3];
      const turn = vertices[k + 5] * vertices[k + 6];    // how far along the line, on which side
      const scale = 1 / (1 + turn * turn);
      floats[o + 4] = (ex - turn * ey) * scale;
      floats[o + 5] = (ey + turn * ex) * scale;
    }

    this._markDirty(item);
  }


  /**
   * Reads how a line is drawn back from one of its vertices.
   * @param vertex - The vertex
   * @param alpha - The line's opacity when it's drawn, from 1 to 255 (a hidden line's vertices don't have it)
   * @return The style that was written there
   */
  protected _readStyle(vertex: number, alpha: number): LineBatchMeshStyle {
    const o = vertex * FLOATS;
    const p = vertex * BYTES;
    const floats = this._floats;
    const bytes = this._bytes;
    const dash = [bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]];
    return {
      width: Math.abs(floats[o + 10]),
      minWidth: Math.abs(floats[o + 11]),
      color: (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2],
      alpha: alpha / 255,
      dash: (dash[0] + dash[1] + dash[2] + dash[3] > 0) ? dash : null,
      isCasing: floats[o + 11] < 0,
      marches: floats[o + 10] < 0
    };
  }

}
