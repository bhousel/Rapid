import * as PIXI from 'pixi.js';
import { splitDataID } from '../data/dataID.ts';
import { type OneOrMore, utilIterable } from '../util/iterable.ts';

import type { AbstractData } from '../data/AbstractData.ts';
import type { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import type { Context } from '../Context.ts';
import type { Extent, Viewport } from '@rapid-sdk/math';
import type { GraphicsSystem } from '../core/GraphicsSystem.ts';
import type { LayerWork, RenderFrame } from './RenderFrame.ts';
import type { PixiScene } from './PixiScene.ts';


/** How many passes a feature can go unseen before `cull()` destroys it */
const KEEP_UNSEEN_PASSES = 20;

/**
 * `continueWaiting()` draws at least this many of the features that are waiting, on each call,
 * even in a frame that's out of time. So the work gets done however slow the frames are.
 */
const MIN_WAITING_PER_FRAME = 32;

/**
 * What drawing a feature costs later, in the frame's DRAW pass, in milliseconds. Pixi builds a
 * shape's geometry when it first renders it, so a feature that's new or has changed costs more
 * there than one drawn again after a zoom. Measured Nov 2026 on an M4 at Staten Island: a
 * restyle of 18,500 features took 34 ms of DRAW (2 µs each), and new features 5 µs each when a
 * few hundred were made in a frame, but 30 µs each when 7,000 were (212 ms).
 * They don't need to be exact: they keep one frame from drawing thousands of features in a few
 * milliseconds of APP pass, and then spending a quarter of a second in DRAW.
 */
const DRAW_MS_PER_REDRAW = 0.004;
const DRAW_MS_PER_NEW = 0.01;


/**
 * AbstractPixiLayer is the base class from which all rendering Layers inherit.
 * It creates a container to hold the Layer data.
 *
 * Notes on identifiers:
 * All identifiers should be strings, to avoid JavaScript comparison surprises (e.g. `'0' !== 0`)
 * - `layerID`   - A unique identifier for the layer, for example 'osm'
 * - `featureID` - A unique identifier for the feature, for example 'osm-w-123-fill'
 * - `dataID`    - A feature may have data bound to it, by its data ID, for example 'w-123' or 'fbRoads:abc'
 * - `classID`   - A pseudoclass identifier like 'hover' or 'select'
 *
 * Properties available:
 * - `id` (or `layerID`) - A unique identifier for the layer, for example 'osm'
 * - `supported`         - Is this Layer supported? (i.e. do we even show it in lists?)
 * - `zIndex`            - Where this Layer sits compared to other Layers
 * - `enabled`           - Whether the the user has chosen to see the Layer
 * - `features`          - `Map<featureID, Feature>` of all features on this Layer
 * - `retained`          - `Map<featureID, Integer pass>` last seen
 *
 * A layer's work for a frame is one "pass": `render()` gathers the data the frame needs, updates its
 * features and marks them seen (`retainFeature`), then `cull()` hides the features that weren't seen.
 * A layer whose `render()` calls `keepFeatures()` skips the pass on frames where only the view moved
 * (see "A CULL pass" in `design/graphics-system.md`).
 */
export class AbstractPixiLayer {

  /** Unique identifier for this Layer */
  public id: LayerID;
  /** The Scene that owns this Layer */
  public scene: PixiScene;
  /** Reference to the GraphicsSystem */
  public gfx: GraphicsSystem;
  /** Global shared application context */
  public context: Context;
  /** Map of featureID to Feature */
  public features: Map<FeatureID, AbstractPixiFeature>;
  /** Map of featureID to the pass it was last seen in */
  public retained: Map<FeatureID, number>;
  /** What the layer has done since `takeWork()`, for the frame's stats (its features count into it too) */
  public work: LayerWork;

  /** Whether the user has chosen to see the layer */
  protected _enabled: boolean;
  /** The number of the current pass: `retainFeature()` marks features with it, and `cull()` ends it */
  protected _pass: number;
  /** The cull box the layer's features are current for, or `null` if they need a pass (see `keepFeatures`) */
  protected _currentBox: Extent | null;
  /** The frame in which `keepFeatures()` last said to do a pass */
  protected _passFrame: number;
  /** The frame in which `keepFeatures()` last said to keep the features */
  protected _keptFrame: number;
  /** Dirty features in view that `updateFeature()` put off, to be drawn again in the coming frames */
  protected _waitingInView: Set<AbstractPixiFeature>;
  /** Dirty features outside the view (in the cull box's padding), drawn again when a frame has time to spare */
  protected _waitingOutside: Set<AbstractPixiFeature>;
  /**
   * Whether the layer is making features after its pass has ended (in a later frame, or after
   * `cull()`), for data that the pass put off. `retainFeature()` then counts them as seen by that pass.
   */
  protected _catchingUp: boolean;
  /** Map of featureID to dataID */
  protected _featureHasData: Map<FeatureID, DataID>;
  /** Map of dataID to Set of featureIDs */
  protected _dataHasFeature: Map<DataID, Set<FeatureID>>;
  /** Map of parent dataID to Set of child dataIDs */
  protected _parentHasChildren: Map<DataID, Set<DataID>>;
  /** Map of child dataID to Set of parent dataIDs */
  protected _childHasParents: Map<DataID, Set<DataID>>;
  /** Spatial IDs this layer has containers for (see `_spatialContainer`) */
  protected _spatialIDs: Set<SpatialID>;


  /**
   * @param scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    this.id = '';  // put this first so debug inspect shows it first

    this.scene = scene;
    this.gfx = scene.gfx;
    this.context = scene.context;

    this._enabled = false;  // Whether the user has chosen to see the layer

    // Collection of Features on this Layer
    this.features = new Map<FeatureID, AbstractPixiFeature>();
    this.retained = new Map<FeatureID, number>();
    this.work = { created: 0, destroyed: 0, updated: 0, shown: 0, hidden: 0, steps: {} };

    this._pass = 0;
    this._currentBox = null;
    this._passFrame = -1;
    this._keptFrame = -1;
    this._waitingInView = new Set<AbstractPixiFeature>();
    this._waitingOutside = new Set<AbstractPixiFeature>();
    this._catchingUp = false;

    // Feature <-> Data
    // These lookups capture which features are bound to which data.
    this._featureHasData = new Map<FeatureID, DataID>();
    this._dataHasFeature = new Map<DataID, Set<FeatureID>>();

    // The spatial IDs this layer has asked the scene for containers for (released in `reset()`)
    this._spatialIDs = new Set<SpatialID>();

    // Parent Data <-> Child Data
    // We establish a parent-child data hierarchy (like what the DOM used to do for us)
    // For example, we need this to know which ways make up a multipolygon relation.
    this._parentHasChildren = new Map<DataID, Set<DataID>>();
    this._childHasParents = new Map<DataID, Set<DataID>>();

    // Data <-> Class
    // The Scene holds these, by dataID (see `PixiScene.setClass`)
  }


  /**
   * Unique string to identify this render Layer.
   * @return This layer's unique id
   * @readonly
   */
  public get layerID(): LayerID {
    return this.id;
  }

  /**
   * Is this Layer supported? (i.e. do we even show it in lists?)
   * Can be overridden in a subclass with additional logic.
   * @return `true` if the layer is supported
   * @abstract
   */
  public get supported(): boolean {
    return true;
  }

  /**
   * Whether the user has chosen to see the Layer.
   * Can be overridden in a subclass with additional logic.
   * @return `true` if the user has chosen to see the layer
   * @abstract
   */
  public get enabled(): boolean {
    return this._enabled;
  }
  /** Enables or disables this layer; derived classes may override to perform additional work.
   * @param val - `true` to enable the layer, `false` to disable it
   */
  public set enabled(val: boolean) {
    if (val === this._enabled) return;  // no change
    this._enabled = val;
    this.dirtyLayer();
  }


  /**
   * Whether this Layer draws the given data, so that selecting it can turn this Layer on.
   * A Layer draws the data whose spatial ID is its own ID, unless it overrides this (see `design/data-ids.md`).
   * @param dataID - The data ID, e.g. `osm-notes:123`
   * @return `true` if this Layer draws the data
   */
  public drawsData(dataID: DataID): boolean {
    return splitDataID(dataID)[0] === this.id;
  }


  /**
   * Makes sure this Layer shows the given data, which it draws (see `drawsData`).
   * Turns the Layer on; a Layer that also chooses what it draws overrides this.
   * @param dataID - The data ID
   */
  public showData(dataID: DataID): void {
    this.enabled = true;
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   * Override in a subclass with needed logic.
   * @abstract
   */
  public reset(): void {
    this._featureHasData.clear();
    this._dataHasFeature.clear();
    this._parentHasChildren.clear();  // maybe don't clear this (should pseudo dom survive a reset?)
    this._childHasParents.clear();    // maybe don't clear this (should pseudo dom survive a reset?)

    for (const feature of this.features.values()) {
      feature.destroy();
    }

    this.features.clear();
    this.retained.clear();
    this._waitingInView.clear();
    this._waitingOutside.clear();
    this._currentBox = null;

    for (const spatialID of this._spatialIDs) {
      this.scene.releaseSpatialContainers(spatialID);
    }
    this._spatialIDs.clear();
  }


  /**
   * Returns the container this layer draws the given spatial ID's data into, in the given group
   * (see `PixiScene.getSpatialContainer` and `design/scene.md`). Features go in it, or in
   * sub-containers made under it with `_childContainer`; `reset()` releases it again.
   * @param groupID - The group, e.g. 'basemap' or 'points'
   * @param spatialID - The spatial ID of the data, e.g. 'osm' or 'fbRoads'
   * @return The container
   */
  protected _spatialContainer(groupID: GroupID, spatialID: SpatialID): PIXI.Container {
    this._spatialIDs.add(spatialID);
    return this.scene.getSpatialContainer(groupID, spatialID);
  }


  /**
   * Returns the child container with the given label, making it if needed.
   * Use this for the containers that hold a layer's features (not for a feature's own container).
   * Each has its own render group, so a change to one feature makes Pixi rebuild the instructions
   * of its siblings only (see `PixiScene.worldContainer`).
   * @param parent - The container to look in, itself from `_spatialContainer` or `_childContainer`
   * @param label - The child's label, e.g. 'polygons'
   * @param zIndex - The child's `zIndex` among its siblings, if it's made
   * @return The child container, with `sortableChildren` on
   */
  protected _childContainer(parent: PIXI.Container, label: string, zIndex = 0): PIXI.Container {
    return this.scene.worldContainer(parent, label, zIndex);
  }


  /**
   * Every Layer should have a render function that manages the Features in view.
   * Override in a subclass with needed logic. It will be passed:
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @abstract
   */
  public render(frame?: RenderFrame, viewport?: Viewport): void {
  }


  /**
   * Whether the layer can leave its features exactly as the last frame had them. That's so when
   * nothing that concerns this layer asked for the frame, only a move of the view
   * (`frame.changedFor()`), and the layer already made everything in the frame's cull box
   * (`frame.cullBox`) in an earlier pass. It's also so in a held frame (`frame.held`), where the pass
   * is put off: the layer keeps what it has until a frame that may do the pass.
   *
   * A layer that gathers its data by `frame.cullBox` calls this from `render()`, once it knows it has
   * something to draw and before it gathers anything, and returns if the answer is `true`. `cull()`
   * then leaves the features alone too. If the answer is `false`, the layer must do the whole pass.
   * (See "A CULL pass" in `design/graphics-system.md`.)
   * @param frame - The frame being rendered
   * @return `true` to skip the pass, `false` to do it
   */
  public keepFeatures(frame: RenderFrame): boolean {
    // (A held frame keeps features even if they were marked dirty since: their pass is still to come.)
    if (!frame.changedFor(this.id) && (frame.held || this._currentBox === frame.cullBox)) {
      this._keptFrame = frame.id;
      return true;
    }
    this._currentBox = frame.cullBox;
    this._passFrame = frame.id;
    return false;
  }


  /**
   * Whether the layer kept its features as they were in the given frame (see `keepFeatures`).
   * @param frame - The frame to ask about
   * @return `true` if the layer skipped its pass in that frame
   */
  public keptFeatures(frame: RenderFrame): boolean {
    return this._keptFrame === frame.id;
  }


  /**
   * Make invisible any Features that were not seen during the current pass, and end the pass.
   * Features that haven't been seen for `KEEP_UNSEEN_PASSES` passes are destroyed.
   * @param frame - The frame being rendered
   */
  public cull(frame: RenderFrame): void {
    if (this._keptFrame === frame.id) return;   // the features are as the last pass left them

    // If `render()` returned before `keepFeatures()` (the layer is off, or zoomed out too far),
    // everything gets hidden below, so the features aren't current for any box.
    if (this._passFrame !== frame.id) {
      this._currentBox = null;
    }

    const pass = this._pass++;
    for (const [featureID, feature] of this.features) {
      const seenPass = this.retained.get(featureID);
      if (seenPass === pass) continue;

      // Can't see it currently, make it invisible
      feature.visible = false;

      // Haven't seen it in a while, remove completely
      if (seenPass !== undefined && pass - seenPass > KEEP_UNSEEN_PASSES) {
        feature.destroy();
      }
    }
  }


  /**
   * Returns what the layer did since the last call, and starts recording again.
   * `PixiScene.render()` calls this after each frame's pass, to put it in the frame's stats.
   * @return The work done
   */
  public takeWork(): LayerWork {
    const work = this.work;
    this.work = { created: 0, destroyed: 0, updated: 0, shown: 0, hidden: 0, steps: {} };
    return work;
  }


  /**
   * Records the time a step of `render()` took, for the frame's stats (`LayerFrameStats.steps`).
   * Call it after each step with the time the step began; it returns the time now, for the next one.
   * ```ts
   * let t = performance.now();
   * const data = this._gatherData();
   * t = this._endStep('gather', t);
   * this._renderLines(data);
   * t = this._endStep('lines', t);
   * ```
   * @param name - The step's name
   * @param since - When the step began (`performance.now()`)
   * @return The time now
   */
  protected _endStep(name: string, since: number): number {
    const now = performance.now();
    const steps = this.work.steps;
    steps[name] = (steps[name] ?? 0) + (now - since);
    return now;
  }


  /**
   * Add a feature to the layer cache.
   * @param feature - A Feature derived from `AbstractPixiFeature` (point, line, multipolygon)
   */
  public addFeature(feature: AbstractPixiFeature): void {
    this.features.set(feature.id, feature);
    this.work.created++;
  }


  /**
   * Remove a Feature from the layer cache.
   * @param feature - A Feature derived from `AbstractPixiFeature` (point, line, multipolygon)
   */
  public removeFeature(feature: AbstractPixiFeature): void {
    this.unbindData(feature.id);
    this.retained.delete(feature.id);
    this.features.delete(feature.id);
    this._waitingInView.delete(feature);
    this._waitingOutside.delete(feature);
    this.work.destroyed++;
  }


  /**
   * Draws a feature again if it's dirty: in this frame, or in a later one if it can wait.
   * A layer calls this where it would call `feature.update(viewport)`, after assigning the
   * feature's data, style and label.
   *
   * - A feature in view is drawn now if the frame still has time (`frame.hasTime()`), or if the
   *   user asked for the frame (`frame.urgent`) and something about the feature itself changed.
   *   Otherwise it waits, and is drawn as it was meanwhile (after a zoom: at the old zoom's line
   *   widths), or not at all if it's new.
   * - A feature outside the view, in the cull box's padding, always waits: nobody sees it yet.
   *
   * `continueWaiting()` draws the ones that waited. A layer that calls this must call that too,
   * on the frames where it keeps its features (see `keepFeatures`). The scene calls it once more
   * after every layer has rendered, for the features outside the view.
   * (See "A deadline on the frame" in `design/graphics-system.md`.)
   * @param feature - The feature to draw again
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public updateFeature(feature: AbstractPixiFeature, frame: RenderFrame, viewport: Viewport): void {
    if (!feature.dirty) return;

    const extent = feature.geometry?.world?.extent;
    const inView = !extent || extent.intersects(frame.viewBox);

    const mustNow = frame.urgent && !feature.onlyTransformDirty;

    if (inView && (mustNow || frame.hasTime())) {
      this._waitingInView.delete(feature);
      this._waitingOutside.delete(feature);
      this._drawFeature(feature, frame, viewport);
    } else if (inView) {
      this._waitingOutside.delete(feature);
      this._waitingInView.add(feature);
    } else {
      this._waitingInView.delete(feature);
      this._waitingOutside.add(feature);
    }
  }


  /**
   * Draws again the features that `updateFeature()` put off, while the frame has time.
   * At least a few are drawn on every call, so the work always gets done.
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param outside - Whether to go on to the features outside the view, once the ones in view are done
   */
  public continueWaiting(frame: RenderFrame, viewport: Viewport, outside: boolean = false): void {
    const inView = this._waitingInView;
    const notInView = this._waitingOutside;
    if (!inView.size && !notInView.size) return;

    // The view may have moved since they were put off: what's in view now comes first.
    for (const feature of notInView) {
      const extent = feature.geometry?.world?.extent;
      if (!extent || extent.intersects(frame.viewBox)) {
        notInView.delete(feature);
        inView.add(feature);
      }
    }

    const lastPass = this._pass - 1;
    let count = 0;
    for (const queue of (outside ? [inView, notInView] : [inView])) {
      for (const feature of queue) {
        if (count >= MIN_WAITING_PER_FRAME && !frame.hasTime()) return;
        queue.delete(feature);   // (deleting from a Set while iterating over it is safe)

        // Skip what the last pass didn't see (it was culled since). If it comes back, it's still dirty.
        if (this.retained.get(feature.id) !== lastPass) continue;
        if (!feature.dirty) continue;

        this._drawFeature(feature, frame, viewport);
        count++;
      }
    }
  }


  /**
   * Draws a dirty feature, and counts what that will cost in the frame's DRAW pass against the
   * frame's time (see `RenderFrame.drawDebt`).
   * @param feature - The feature to draw
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  protected _drawFeature(feature: AbstractPixiFeature, frame: RenderFrame, viewport: Viewport): void {
    const drawMs = feature.onlyTransformDirty ? DRAW_MS_PER_REDRAW : DRAW_MS_PER_NEW;
    feature.update(viewport);
    frame.drawDebt += drawMs;
  }


  /**
   * How many features are waiting to be drawn again.
   * @return The number of features that `updateFeature()` put off
   */
  public get numWaiting(): number {
    return this._waitingInView.size + this._waitingOutside.size;
  }


  /**
   * How many features in view are waiting to be drawn again.
   * @return The number of features in view that `updateFeature()` put off
   */
  public get numWaitingInView(): number {
    return this._waitingInView.size;
  }


  /**
   * Retain the feature for the current pass.
   * Features that are not retained may be automatically culled (made invisible) or removed.
   * @param feature - A Feature derived from `AbstractPixiFeature` (point, line, multipolygon)
   * @param frame - The frame being rendered
   */
  public retainFeature(feature: AbstractPixiFeature, frame: RenderFrame): void {
    if (feature.lod > 0) {
      feature.visible = true;
    }
    // If in user's view, retain it regardless of whether it's actually visible.
    // We want to avoid continuously creating invisible things just to dispose of them a few frames later.
    // For example points when zoomed out far.
    // (A feature made after the pass, by a layer catching up on what waited, belongs to that pass.)
    this.retained.set(feature.id, this._catchingUp ? this._pass - 1 : this._pass);
  }


  /**
   * Adds (or replaces) a data binding from featureID to a dataID
   * @param featureID - featureID  (e.g. 'osm-w-123-fill')
   * @param dataID - dataID     (e.g. 'w-123')
   */
  public bindData(featureID: FeatureID, dataID: DataID): void {
    // Already bound to this data: done. (Unbinding first would drop the data's parent and child
    // links, when this is its only feature.)
    if (this._featureHasData.get(featureID) === dataID) return;

    this.unbindData(featureID);

    let featureSet = this._dataHasFeature.get(dataID);
    if (!featureSet) {
      featureSet = new Set<FeatureID>();
      this._dataHasFeature.set(dataID, featureSet);
    }
    featureSet.add(featureID);

    this._featureHasData.set(featureID, dataID);
  }


  /**
   * Removes the data binding for a given featureID
   * @param featureID - featureID  (e.g. 'osm-w-123-fill')
   */
  public unbindData(featureID: FeatureID): void {
    const dataID = this._featureHasData.get(featureID);
    if (!dataID) return;

    const featureSet = this._dataHasFeature.get(dataID);
    if (featureSet) {
      featureSet.delete(featureID);

      // If no features are bound to this data anymore, remove all references to it.
      if (!featureSet.size) {
        this._dataHasFeature.delete(dataID);
        this._parentHasChildren.delete(dataID);
        this._childHasParents.delete(dataID);
        // Note that we don't touch the data classes here..
        // e.g. if a selected feature leaves the scene and comes back later, it's still selected!
      }
    }

    this._featureHasData.delete(featureID);
  }


  /**
   * Adds a mapping from parent data to child data.
   * @param parentID - dataID of the parent (e.g. 'r123')
   * @param childIDs - dataIDs of the children to add (e.g. 'w123')
   */
  public addChildData(parentID: DataID, childIDs: OneOrMore<DataID>): void {
    let childSet = this._parentHasChildren.get(parentID);
    if (!childSet) {
      childSet = new Set<DataID>();
      this._parentHasChildren.set(parentID, childSet);
    }

    for (const childID of utilIterable(childIDs)) {
      childSet.add(childID);

      let parentSet = this._childHasParents.get(childID);
      if (!parentSet) {
        parentSet = new Set<DataID>();
        this._childHasParents.set(childID, parentSet);
      }
      parentSet.add(parentID);
    }
  }


  /**
   * Removes mapping from parent data to child data.
   * @param parentID - dataID of the parent (e.g. 'r123')
   * @param childIDs - dataIDs of the children to remove (e.g. 'w123')
   */
  public removeChildData(parentID: DataID, childIDs: OneOrMore<DataID>): void {
    const childSet = this._parentHasChildren.get(parentID);
    if (childSet) {
      for (const childID of utilIterable(childIDs)) {
        childSet.delete(childID);
      }
      if (!childSet.size) {
        this._parentHasChildren.delete(parentID);
      }
    }

    for (const childID of utilIterable(childIDs)) {
      const parentSet = this._childHasParents.get(childID);
      if (parentSet) {
        parentSet.delete(parentID);
        if (!parentSet.size) {
          this._childHasParents.delete(childID);
        }
      }
    }
  }


  /**
   * Removes all child dataIDs for the given parent dataID
   * @param parentID - dataID (e.g. 'r123')
   */
  public clearChildData(parentID: DataID): void {
    const childSet = this._parentHasChildren.get(parentID);
    if (childSet) {
      this.removeChildData(parentID, [...childSet]);   // a copy: removing empties the set while it's read
    }
  }


  /**
   * Recursively get a result `Set` including the given dataID and all dataIDs in the child hierarchy.
   * @param dataID - dataID (e.g. 'r123')
   * @param result - `Set` containing the results (e.g. ['r123','w123','n123'])
   * @returns `Set` including the dataID and all dataIDs in the child hierarchy
   */
  public getSelfAndDescendants(dataID: DataID, result?: Set<DataID>): Set<DataID> {
    if (result instanceof Set) {
      result.add(dataID);
    } else {
      result = new Set<DataID>([dataID]);
    }

    const childSet = this._parentHasChildren.get(dataID) ?? new Set<DataID>();
    for (const childID of childSet) {
      if (!result.has(childID)) {
        this.getSelfAndDescendants(childID, result);
      }
    }

    return result;
  }


  /**
   * Recursively get a result `Set` including the given dataID and all dataIDs in the parent hierarchy
   * @param dataID - dataID (e.g. 'n123')
   * @param result - `Set` containing the results (e.g. ['n123','w123','r123'])
   * @returns `Set` including the dataID and all dataIDs in the parent hierarchy
   */
  public getSelfAndAncestors(dataID: DataID, result?: Set<DataID>): Set<DataID> {
    if (result instanceof Set) {
      result.add(dataID);
    } else {
      result = new Set<DataID>([dataID]);
    }

    const parentSet = this._childHasParents.get(dataID) ?? new Set<DataID>();
    for (const parentID of parentSet) {
      if (!result.has(parentID)) {
        this.getSelfAndAncestors(parentID, result);
      }
    }

    return result;
  }


  /**
   * Get a result `Set` including the dataID and all sibling dataIDs in the parent-child hierarchy
   * @param dataID - `String` dataID (e.g. 'n123')
   * @param result - `Set` containing the results (e.g. ['n121','n122','n123','n124'])
   * @returns `Set` including the dataID and all dataIDs adjacent in the parent-child hierarchy
   */
  public getSelfAndSiblings(dataID: DataID, result?: Set<DataID>): Set<DataID> {
    if (result instanceof Set) {
      result.add(dataID);
    } else {
      result = new Set<DataID>([dataID]);
    }

    const parentSet = this._childHasParents.get(dataID) ?? new Set<DataID>();
    for (const parentID of parentSet) {
      const siblingIDs = this._parentHasChildren.get(parentID) ?? new Set<DataID>();
      for (const siblingID of siblingIDs) {
        result.add(siblingID);
      }
    }

    return result;
  }


  /**
   * Finds data drawn on this layer by its dataID, e.g. to select it again after undo.
   * Only data that has been drawn can be found.
   * @param dataID - dataID to look for
   * @returns the data, or `undefined` if it isn't drawn on this layer
   */
  public getData(dataID: DataID): AbstractData | undefined {
    for (const featureID of this._dataHasFeature.get(dataID) ?? []) {
      const data = this.features.get(featureID)?.data;
      if (data) return data;
    }
  }


  /**
   * This updates the feature's classes (e.g. 'select', 'hover', etc.) to match the Scene's classes
   * for the data bound to it.
   *
   * Counterintuitively, the Scene needs to be the source of truth for these classes,
   * because a Feature can be 'selected' or 'drawing' even before it has been created, or after destroyed.
   *
   * Syncing these classes will dirty the feature if the it causes a change.
   * Therefore this should be called after the Feature has been created, but before any updates happen.
   *
   * @param feature - A Feature derived from `AbstractPixiFeature` (point, line, multipolygon)
   */
  public syncFeatureClasses(feature: AbstractPixiFeature): void {
    const featureID = feature.id;
    const dataID = this._featureHasData.get(featureID);
    if (!dataID) return;

    const layerClasses = this.scene.getClasses(dataID);
    const featureClasses = feature.classes;

    for (const classID of featureClasses) {
      if (layerClasses.has(classID)) continue;  // no change
      feature.unsetClass(classID);              // remove extra class from feature
    }
    for (const classID of layerClasses) {
      if (featureClasses.has(classID)) continue;  // no change
      feature.setClass(classID);                  // add missing class to feature
    }

    // Trying to document all the supported pseudoclasses here:
    //
    // 'drawing':  removes the hitarea, and avoids hover, e.g. it prevents snapping
    // 'highlight':  adds a blue glowfilter
    // 'hover':  adds a yellow glowfilter
    // 'select':  adds a dashed line halo
    // 'selectphoto':  styling for the currently selected photo
  }


  /**
   * Mark all features on this layer as `dirty`.
   * During the next "app" pass, dirty features will be rebuilt.
   * (So the layer does that pass, whatever the frame is for: see `keepFeatures`.)
   */
  public dirtyLayer(): void {
    this._currentBox = null;
    for (const feature of this.features.values()) {
      feature.dirty = true;
    }
  }

  /**
   * Mark all features on this layer as needing to be drawn again for a new zoom or rotation.
   * Unlike `dirtyLayer()`, this says that the features themselves haven't changed, so a layer
   * that checks `feature.needsStyle` doesn't work out their styles again.
   */
  public dirtyTransform(): void {
    this._currentBox = null;
    for (const feature of this.features.values()) {
      feature.dirtyTransform();
    }
  }

  /**
   * Mark specific features features as `dirty`
   * During the next "app" pass, dirty features will be rebuilt.
   * @param featureIDs - featureIDs to set dirty
   */
  public dirtyFeatures(featureIDs: OneOrMore<FeatureID>): void {
    this._currentBox = null;
    for (const featureID of utilIterable(featureIDs)) {
      const feature = this.features.get(featureID);
      if (feature) {
        feature.dirty = true;
      }
    }
  }

  /**
   * Mark any features bound to a given dataID as `dirty`
   * During the next "app" pass, dirty features will be rebuilt.
   * @param dataIDs - dataIDs to set dirty
   */
  public dirtyData(dataIDs: OneOrMore<DataID>): void {
    for (const dataID of utilIterable(dataIDs)) {
      const featureIDs = this._dataHasFeature.get(dataID);
      if (featureIDs) {
        this.dirtyFeatures(featureIDs);
      }
    }
  }

}
