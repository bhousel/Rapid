import * as PIXI from 'pixi.js';
import { AvoidGrid } from './AvoidGrid.ts';
import { WORLD_HALF } from '@rapid-sdk/math';

import type { AbstractPixiFeature } from '../AbstractPixiFeature.ts';
import type { CellRect } from './AvoidGrid.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


/**
 * The size of the avoid grid's cells, in pixels of label space (see `LabelSpace.avoidGrid`).
 * A pin is marked in every cell it touches, so it takes up to a cell more room on each side
 * than it's drawn with, and fewer labels fit between pins. Measured Nov 2026 by the labels placed
 * after a load in downtown Seattle, where a box for each pin gave 232: cells of 4 px 104 (before
 * a point's own cells were set aside for its label), then 2 px 208 and 1 px 219. At 1 px the
 * grid is four times the blocks and the marking four times the writes.
 */
const AVOID_CELL_PX = 2;


/**
 * `LabelSpace` is what the labels layer needs from the rest of the scene: the space that labels
 * are placed in, the grid of what they must avoid there, and word of what changed. Features
 * mark the grid as they're drawn, and say when they change (`featureChanged`) or when what they
 * cover moves onto a label or off a place (`avoidHit`, `avoidFreed`). The labels layer takes
 * those, and looks at nothing else. `PixiScene` owns it (`scene.labelSpace`), and works it out
 * at the start of each frame (`update`).
 *
 * See "Label placement" in `design/graphics-system.md`.
 */
export class LabelSpace {
  /** Where labels can't go: what's drawn that they avoid, and the labels placed so far */
  public avoidGrid: AvoidGrid;
  /** The offset between the screen and label space, as of this frame (see `update`) */
  public offset: PIXI.Point;

  /** The transform from world coordinates to the screen, as of this frame (see `update`) */
  protected _toScreen: PIXI.Matrix;
  /** Cells where something to avoid was drawn over a placed label (see `avoidHit`) */
  protected _avoidHits: CellRect[];
  /** Cells that something to avoid has left (see `avoidFreed`) */
  protected _avoidFrees: CellRect[];
  /** The features that were drawn, shown, hidden or destroyed since the labels layer last asked (see `featureChanged`) */
  protected _changedFeatureIDs: Set<FeatureID>;


  /**
   * Makes an empty label space, at no offset from the screen.
   */
  public constructor() {
    this.avoidGrid = new AvoidGrid(AVOID_CELL_PX);
    this.offset = new PIXI.Point();
    this._toScreen = new PIXI.Matrix();
    this._avoidHits = [];
    this._avoidFrees = [];
    this._changedFeatureIDs = new Set<FeatureID>();
  }


  /**
   * Starts a new label space, after the zoom or the rotation changed: nothing is marked in
   * the grid, and no hits or frees are waiting. Every feature is drawn again, and marks what
   * it covers again.
   */
  public reset(): void {
    this.avoidGrid.clear();
    this._avoidHits = [];
    this._avoidFrees = [];
  }


  /**
   * Works out this frame's label space: the coordinates that labels are placed in, and that the
   * avoid grid covers (see "Label placement" in `design/graphics-system.md`).
   *
   * Label space is the screen minus `offset`, an offset that changes by exactly the pan on each
   * frame. So a feature has the same label coordinates however the map is panned, and what's
   * been placed and marked stays valid until the zoom or the rotation changes.
   *
   * `origin.toGlobal(P)` gives that for any constant P in `origin`'s coordinates, since a pan
   * only changes `origin.position`. The naive choice P = (0, 0) is world coordinate [0,0], far
   * from the viewport at high zooms: a huge offset, and GPU float32 precision loss in the rope
   * labels' vertex math (distorted text). So P is picked to map near the viewport: it takes off
   * the constant `(pixiT - WORLD_HALF * worldScale)` term that `origin.position` carries.
   * @param origin - The container that maps world coordinates to the screen (`gfx.origin`)
   * @param viewport - The Pixi viewport of the frame (see `GraphicsSystem._app`)
   */
  public update(origin: PIXI.Container, viewport: Viewport): void {
    const worldScale = origin.scale.x;
    const pixiT = viewport.transform.translation;
    origin.toGlobal({
      x: WORLD_HALF - pixiT[0] / worldScale,
      y: WORLD_HALF - pixiT[1] / worldScale
    }, this.offset);
    origin.getGlobalTransform(this._toScreen, false);   // (worked out now: the cached one is the last frame's)
  }


  /**
   * Converts a world coordinate to label space (see `update`).
   * @param x - World x
   * @param y - World y
   * @param out - Where to put the result
   * @return `out`, as `[x, y]` in label space
   */
  public worldToLabel(x: number, y: number, out: Vec2): Vec2 {
    const m = this._toScreen;
    out[0] = (m.a * x) + (m.c * y) + m.tx - this.offset.x;
    out[1] = (m.b * x) + (m.d * y) + m.ty - this.offset.y;
    return out;
  }


  /**
   * A feature says that it has been drawn again, shown, hidden or destroyed, or has another
   * label. The labels layer takes these (`takeChangedFeatures`) and looks at the labels of
   * those features only: it used to walk every feature in the scene on every frame to find the
   * ones that had changed.
   * @param feature - The feature
   */
  public featureChanged(feature: AbstractPixiFeature): void {
    this._changedFeatureIDs.add(feature.id);
  }


  /**
   * Returns the features that changed since the last call (see `featureChanged`), and forgets them.
   * @return Their IDs. A feature may be gone by now.
   */
  public takeChangedFeatures(): Set<FeatureID> {
    const changed = this._changedFeatureIDs;
    this._changedFeatureIDs = new Set<FeatureID>();
    return changed;
  }


  /**
   * A feature that labels avoid was drawn where a label is. The labels layer takes these and
   * places the labels it finds there again, somewhere else (`takeAvoidHits`).
   * @param cells - The cells of the avoid grid that the feature covers
   */
  public avoidHit(cells: CellRect): void {
    this._avoidHits.push(cells);
  }


  /**
   * How many times something was drawn over a label since the labels layer last looked.
   * @return The number of hits waiting
   */
  public get numAvoidHits(): number {
    return this._avoidHits.length;
  }


  /**
   * Returns the cells where something was drawn over a label since the last call, and forgets them.
   * @return The cells, one rectangle for each feature
   */
  public takeAvoidHits(): CellRect[] {
    const hits = this._avoidHits;
    this._avoidHits = [];
    return hits;
  }


  /**
   * A feature that labels avoid isn't where it was: it was hidden, moved or destroyed. The
   * labels layer tries the labels again that had no room there (`takeAvoidFrees`).
   * @param cells - The cells of the avoid grid that the feature covered
   */
  public avoidFreed(cells: CellRect): void {
    this._avoidFrees.push(cells);
  }


  /**
   * How many features that labels avoid have left their place since the labels layer last looked.
   * @return The number waiting
   */
  public get numAvoidFrees(): number {
    return this._avoidFrees.length;
  }


  /**
   * Returns the cells that something to avoid has left since the last call, and forgets them.
   * @return The cells, one rectangle for each feature
   */
  public takeAvoidFrees(): CellRect[] {
    const frees = this._avoidFrees;
    this._avoidFrees = [];
    return frees;
  }
}
