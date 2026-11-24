import { FillBatchShader } from './FillBatchMesh.ts';
import { LineBatchShader } from './LineBatchMesh.ts';
import { PointBatchShader } from './PointBatchMesh.ts';


/**
 * The `BatchShaders` are the shaders that a scene's batches draw with, one for each kind of
 * batch. Every batch of a kind shares its kind's shader, so the view, the clock and the
 * textures are told to it once, and nothing in any batch changes for them. `PixiScene` owns
 * them (`scene.batchShaders`): it gives them the view and the clock, and `PixiTextures` gives
 * them the textures.
 *
 * See `design/graphics-system.md` section 15.
 */
export class BatchShaders {
  /** The shader of every `LineBatchMesh`: casings, strokes, outlines, glows and halos */
  public lines: LineBatchShader;
  /** The shader of every `FillBatchMesh` */
  public fills: FillBatchShader;
  /** The shader of every `PointBatchMesh` */
  public points: PointBatchShader;


  /** Makes the shaders. They draw as at zoom 17, with no textures, until they're told otherwise. */
  public constructor() {
    this.lines = new LineBatchShader();
    this.fills = new FillBatchShader();
    this.points = new PointBatchShader();
  }


  /**
   * Destroys the shaders. Destroy the batches that draw with them first.
   */
  public destroy(): void {
    this.lines.destroy();
    this.fills.destroy();
    this.points.destroy();
    this.lines = null!;
    this.fills = null!;
    this.points = null!;
  }
}
