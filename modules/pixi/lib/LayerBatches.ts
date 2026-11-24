import { FillBatchMesh } from './FillBatchMesh.ts';
import { LineBatchMesh } from './LineBatchMesh.ts';
import { PointBatchMesh } from './PointBatchMesh.ts';

import type * as PIXI from 'pixi.js';
import type { BatchMesh } from './BatchMesh.ts';
import type { BatchShaders } from './BatchShaders.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


/**
 * Where the batches are drawn in their container, by `zIndex`. They're all under the containers
 * that a layer gives its features that draw themselves (a road class, a tile: a `zIndex` of -20
 * or more), so a hovered line drawn by its feature is over the lines in batches.
 * - Lines: every casing, then every stroke, then the strokes' glows. So where two roads meet,
 *   neither's casing crosses the other's stroke.
 * - Polygons: every fill, then every outline, then the outlines' glows. So an outline is never
 *   under another polygon's fill.
 * - Points: the glows, then every point.
 */
const CASING_BATCH = -2000;
const STROKE_BATCH = -1000;
const FILL_BATCH = -2000;
const OUTLINE_BATCH = -1000;
const POINT_BATCH = -1000;
const GLOW_OVER = 1;      // a line's glow is over its batch
const GLOW_UNDER = -1;    // a point's glow is under its batch


/** The batches in one container. Lines and polygons are in containers of their own. */
interface ContainerBatches {
  casings: LineBatchMesh | null;
  strokes: LineBatchMesh | null;
  fills: FillBatchMesh | null;
  outlines: LineBatchMesh | null;
  points: PointBatchMesh | null;
}

/** The kinds of batch in a container */
type BatchKind = keyof ContainerBatches;


/**
 * `LayerBatches` makes and keeps the batches that a layer's features are drawn in: at most one
 * of each kind in each container, made when a feature first needs it, with a small batch
 * beside it for the glows of hovered things. It places them in the container (see the
 * `zIndex`es above), keeps their coordinates fine enough for the view (`followView`), and
 * destroys the ones that empty (`removeEmpty`).
 *
 * A layer gives each feature the batch it should draw in (`feature.batch = batches.lineBatch(…)`),
 * and the feature does the rest. See "Batches" in `design/graphics-system.md`.
 */
export class LayerBatches {
  /** The shaders that the batches draw with: the scene's */
  protected _shaders: BatchShaders;
  /** The batches, by the container they're in */
  protected _byContainer: Map<PIXI.Container, ContainerBatches>;


  /**
   * @param shaders - The shaders that the batches draw with (the scene's `batchShaders`)
   */
  public constructor(shaders: BatchShaders) {
    this._shaders = shaders;
    this._byContainer = new Map<PIXI.Container, ContainerBatches>();
  }


  /**
   * Returns the batch that draws the casings, or the strokes, of the lines in a container,
   * making it if there's none. In a batch the lines are in the order of their feature's
   * `zIndex` (for OSM, by road class, then by the way's ID).
   * @param parent - The container (for OSM, a level of lines: `way.layer()`)
   * @param isCasing - Whether the batch is for the casings, not the strokes
   * @param origin - Where a new batch's coordinates start, in the world: near the lines it's for (32-bit floats are fine only near there)
   * @return The batch
   */
  public lineBatch(parent: PIXI.Container, isCasing: boolean, origin: Vec2): LineBatchMesh {
    const batches = this._batchesIn(parent);
    const kind = isCasing ? 'casings' : 'strokes';
    let batch = batches[kind];
    if (!batch || batch.destroyed) {
      batch = this._place(new LineBatchMesh(this._shaders.lines), parent, kind, isCasing ? CASING_BATCH : STROKE_BATCH, origin);
      if (!isCasing) {
        batch.glows = this._place(new LineBatchMesh(this._shaders.lines), parent, 'glows', STROKE_BATCH + GLOW_OVER, origin);
      }
      batches[kind] = batch;
    }
    return batch;
  }


  /**
   * Returns the batch that draws the fills of the polygons in a container, making it if there's
   * none. In a batch the polygons are in the order of their feature's `zIndex` (for OSM, by
   * size, the largest first).
   * @param parent - The container
   * @param origin - Where a new batch's coordinates start, in the world (see `lineBatch`)
   * @return The batch
   */
  public fillBatch(parent: PIXI.Container, origin: Vec2): FillBatchMesh {
    const batches = this._batchesIn(parent);
    let batch = batches.fills;
    if (!batch || batch.destroyed) {
      batch = this._place(new FillBatchMesh(this._shaders.fills), parent, 'fills', FILL_BATCH, origin);
      batches.fills = batch;
    }
    return batch;
  }


  /**
   * Returns the batch that draws the outlines of the polygons in a container, over every fill,
   * making it if there's none.
   * @param parent - The container
   * @param origin - Where a new batch's coordinates start, in the world (see `lineBatch`)
   * @return The batch
   */
  public outlineBatch(parent: PIXI.Container, origin: Vec2): LineBatchMesh {
    const batches = this._batchesIn(parent);
    let batch = batches.outlines;
    if (!batch || batch.destroyed) {
      batch = this._place(new LineBatchMesh(this._shaders.lines), parent, 'outlines', OUTLINE_BATCH, origin);
      batch.glows = this._place(new LineBatchMesh(this._shaders.lines), parent, 'glows', OUTLINE_BATCH + GLOW_OVER, origin);
      batches.outlines = batch;
    }
    return batch;
  }


  /**
   * Returns the batch that draws the points in a container, making it if there's none. In a
   * batch the points are in the order a feature gives (for OSM, from north to south, and the
   * ones with viewfields over the others: `PixiFeaturePoint.sceneOrder`).
   * @param parent - The container
   * @param origin - Where a new batch's coordinates start, in the world (see `lineBatch`)
   * @return The batch
   */
  public pointBatch(parent: PIXI.Container, origin: Vec2): PointBatchMesh {
    const batches = this._batchesIn(parent);
    let batch = batches.points;
    if (!batch || batch.destroyed) {
      batch = this._place(new PointBatchMesh(this._shaders.points), parent, 'points', POINT_BATCH, origin);
      batch.glows = this._place(new PointBatchMesh(this._shaders.points), parent, 'glows', POINT_BATCH + GLOW_UNDER, origin);
      batches.points = batch;
    }
    return batch;
  }


  /**
   * The batches that draw lines: casings and strokes (not their glows)
   * @return The batches, in no particular order
   * @readonly
   */
  public get lines(): LineBatchMesh[] {
    return this._ofKinds('casings', 'strokes') as LineBatchMesh[];
  }


  /**
   * The batches that draw polygons: fills and outlines (not the outlines' glows)
   * @return The batches, in no particular order
   * @readonly
   */
  public get polygons(): BatchMesh[] {
    return this._ofKinds('fills', 'outlines');
  }


  /**
   * The batches that draw points (not their glows)
   * @return The batches, in no particular order
   * @readonly
   */
  public get points(): PointBatchMesh[] {
    return this._ofKinds('points') as PointBatchMesh[];
  }


  /**
   * Keeps every batch's coordinates fine enough for the view's zoom (see `BatchMesh.followView`).
   * Call it on every frame.
   * @param viewport - The viewport that's being drawn
   */
  public followView(viewport: Viewport): void {
    for (const batches of this._byContainer.values()) {
      for (const batch of Object.values(batches) as Array<BatchMesh | null>) {
        if (!batch) continue;
        batch.followView(viewport);
        (batch as LineBatchMesh | PointBatchMesh).glows?.followView(viewport);
      }
    }
  }


  /**
   * Destroys the batches that have emptied, and that no feature is waiting to be drawn in
   * (`users`: a batch is empty until its first feature is drawn). A new one is made when it's
   * needed again.
   */
  public removeEmpty(): void {
    for (const [parent, batches] of this._byContainer) {
      let any = false;
      for (const kind of Object.keys(batches) as BatchKind[]) {
        const batch = batches[kind];
        if (!batch) continue;
        if (batch.destroyed) {
          batches[kind] = null;
        } else if (!batch.size && !batch.users) {
          batch.destroy();      // (with its glows)
          batches[kind] = null;
        } else {
          any = true;
        }
      }
      if (!any) {
        this._byContainer.delete(parent);    // (deleting from a Map while iterating over it is safe)
      }
    }
  }


  /**
   * Forgets every batch, without destroying any: call it when the containers they were in have
   * been destroyed with them (a layer's `reset()`).
   */
  public forget(): void {
    this._byContainer.clear();
  }


  /**
   * Returns the batches of a container, making the entry if there's none.
   * @param parent - The container
   * @return Its batches
   */
  protected _batchesIn(parent: PIXI.Container): ContainerBatches {
    let batches = this._byContainer.get(parent);
    if (!batches) {
      batches = { casings: null, strokes: null, fills: null, outlines: null, points: null };
      this._byContainer.set(parent, batches);
    }
    return batches;
  }


  /**
   * Puts a new batch in its container.
   * @param batch - The batch
   * @param parent - The container
   * @param label - Its label there
   * @param zIndex - Where it's drawn there
   * @param origin - Where its coordinates start, in the world
   * @return The batch
   */
  protected _place<T extends BatchMesh>(batch: T, parent: PIXI.Container, label: string, zIndex: number, origin: Vec2): T {
    batch.label = label;
    batch.zIndex = zIndex;
    batch.position.set(origin[0], origin[1]);
    parent.addChild(batch);
    return batch;
  }


  /**
   * Returns the batches of some kinds, in every container.
   * @param kinds - The kinds
   * @return The batches that exist and aren't destroyed
   */
  protected _ofKinds(...kinds: BatchKind[]): BatchMesh[] {
    const result: BatchMesh[] = [];
    for (const batches of this._byContainer.values()) {
      for (const kind of kinds) {
        const batch = batches[kind];
        if (batch && !batch.destroyed) result.push(batch);
      }
    }
    return result;
  }
}
