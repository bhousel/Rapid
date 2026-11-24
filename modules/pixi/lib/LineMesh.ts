import * as PIXI from 'pixi.js';
import { geomStrokePositions, geomStrokeUVs } from '../../geo/index.ts';

import type { StrokeMesh } from '../../geo/stroke.ts';


const NO_FLOATS = new Float32Array(0);
const NO_INDICES = new Uint32Array(0);

// A batched mesh never reads its `State`, so the lines share one. (Pixi makes one per `Mesh` otherwise.)
const STATE = PIXI.State.for2d();

// The texture coordinates of a line that isn't dashed. They all sample the one texel of
// `Texture.WHITE`, so every such line shares one array of zeros, as long as the longest needs.
let _zeros = new Float32Array(4096);


/**
 * A `LineMesh` draws a line from its stroke mesh (see `geomStrokeMesh()`): the casing or the stroke of
 * a line feature.
 *
 * The stroke mesh has the line's triangles for any width, so a `LineMesh` keeps only the positions
 * for the width it's drawn at. When the width changes (every zoom changes it, in world units),
 * `setStroke()` works the positions out again in the array it has: nothing is built, and nothing
 * is thrown away. A casing and its stroke can be drawn from the same stroke mesh.
 *
 * It's always batched, whatever its size: its geometry changes size when the line is edited, and
 * a mesh in Pixi's `'auto'` mode that crosses 100 vertices can crash Pixi (Rapid#1636, pixijs#12437).
 * A dashed line samples a texture that repeats along the line (`PixiTextures.getDashTexture()`).
 *
 * See `design/graphics-system.md` section 15.
 */
export class LineMesh extends PIXI.Mesh<PIXI.MeshGeometry> {

  /** The stroke mesh that the positions were worked out from */
  protected _strokeMesh: StrokeMesh | null;
  /** The half width that the positions are for, in the units of the line's coordinates */
  protected _strokeHalfWidth: number;
  /** The length of the dash pattern that the texture coordinates are for, or 0 if the line isn't dashed */
  protected _dashLength: number;
  /** The texture coordinates of a dashed line (a line that isn't dashed has none of its own) */
  protected _dashUVs: Float32Array | null;


  /** Makes a mesh that draws nothing, until `setStroke()` gives it a line. */
  public constructor() {
    const geometry = new PIXI.MeshGeometry({ positions: NO_FLOATS, uvs: NO_FLOATS, indices: NO_INDICES });
    geometry.batchMode = 'batch';
    super({ geometry: geometry, texture: PIXI.Texture.WHITE, state: STATE });

    this._strokeMesh = null;
    this._strokeHalfWidth = 0;
    this._dashLength = 0;
    this._dashUVs = null;
  }


  /**
   * Destroys the mesh and its geometry. (A `Mesh` doesn't destroy its geometry, and Pixi keeps
   * what it built for one until it's destroyed.)
   * @param options - Pixi's options for destroying a display object
   */
  public override destroy(options?: PIXI.DestroyOptions): void {
    const geometry = this.geometry;
    super.destroy(options);
    geometry?.destroy(true);
    this._strokeMesh = null;
    this._dashUVs = null;
  }


  /**
   * The stroke mesh that this mesh last drew, which says what line that was, with which cap and join.
   * @return The stroke mesh, or `null` if it hasn't drawn one
   */
  public get strokeMesh(): StrokeMesh | null {
    return this._strokeMesh;
  }


  /**
   * Draws nothing again, and lets go of the line it had.
   */
  public clear(): void {
    if (!this._strokeMesh) return;

    const geometry = this.geometry;
    geometry.indices = NO_INDICES;
    geometry.positions = NO_FLOATS;
    geometry.uvs = NO_FLOATS;
    this._strokeMesh = null;
    this._strokeHalfWidth = 0;
    this._dashLength = 0;
    this._dashUVs = null;
  }


  /**
   * Draws a line at a width. Call it again whenever the line, its width or its dashes change:
   * it does only the work that the change needs.
   * @param stroke - The line's stroke mesh. Its arrays are read, never changed, so other meshes can draw from it too.
   * @param halfWidth - Half the line's width, in the units of the line's coordinates
   * @param dashTexture - The dash pattern, for a dashed line (`PixiTextures.getDashTexture()`)
   * @param dashLength - The length of one repeat of that pattern, in the units of the line's coordinates
   */
  public setStroke(stroke: StrokeMesh, halfWidth: number, dashTexture: PIXI.Texture | null = null, dashLength: number = 0): void {
    const geometry = this.geometry;
    const numFloats = stroke.vertexCount * 2;
    const isNewStroke = (stroke !== this._strokeMesh);
    const isNewWidth = (halfWidth !== this._strokeHalfWidth);
    if (!dashTexture || !(dashLength > 0)) {
      dashTexture = null;
      dashLength = 0;
    }

    if (isNewStroke) {
      // (16-bit indices work too: the batcher reads them one at a time.)
      geometry.indices = stroke.indices as Uint32Array;
      geometry.positions = geomStrokePositions(stroke, halfWidth, new Float32Array(numFloats));

    } else if (isNewWidth) {
      geomStrokePositions(stroke, halfWidth, geometry.positions);
      geometry.getBuffer('aPosition').update();
    }

    if (dashTexture) {
      if (isNewStroke || isNewWidth || dashLength !== this._dashLength) {
        let uvs = this._dashUVs;
        if (uvs?.length !== numFloats) {
          uvs = this._dashUVs = new Float32Array(numFloats);
        }
        geomStrokeUVs(stroke, halfWidth, 1 / dashLength, uvs);
        geometry.uvs = uvs;   // (the same array again tells Pixi that it changed)
      }
      this.texture = dashTexture;

    } else {
      if (isNewStroke || this._dashLength) {
        if (_zeros.length < numFloats) {
          _zeros = new Float32Array(PIXI.nextPow2(numFloats));
        }
        this._dashUVs = null;
        geometry.uvs = _zeros;
      }
      this.texture = PIXI.Texture.WHITE;
    }

    this._strokeMesh = stroke;
    this._strokeHalfWidth = halfWidth;
    this._dashLength = dashLength;
  }

}
