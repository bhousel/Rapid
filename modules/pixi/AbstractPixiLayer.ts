import { type OneOrMore, utilIterable } from '../util/iterable.ts';

import type { AbstractData } from '../data/AbstractData.ts';
import type { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import type { Context } from '../Context.ts';
import type { GraphicsSystem } from '../core/GraphicsSystem.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Viewport } from '@rapid-sdk/math';


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
 * - `retained`          - `Map<featureID, Integer frame>` last seen
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
  /** Map of featureID to frame last seen */
  public retained: Map<FeatureID, number>;

  /** Whether the user has chosen to see the layer */
  protected _enabled: boolean;
  /** Map of featureID to dataID */
  protected _featureHasData: Map<FeatureID, DataID>;
  /** Map of dataID to Set of featureIDs */
  protected _dataHasFeature: Map<DataID, Set<FeatureID>>;
  /** Map of parent dataID to Set of child dataIDs */
  protected _parentHasChildren: Map<DataID, Set<DataID>>;
  /** Map of child dataID to Set of parent dataIDs */
  protected _childHasParents: Map<DataID, Set<DataID>>;


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

    // Feature <-> Data
    // These lookups capture which features are bound to which data.
    this._featureHasData = new Map<FeatureID, DataID>();
    this._dataHasFeature = new Map<DataID, Set<FeatureID>>();

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
  }


  /**
   * Every Layer should have a render function that manages the Features in view.
   * Override in a subclass with needed logic. It will be passed:
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @abstract
   */
  public render(frame?: number, viewport?: Viewport): void {
  }


  /**
   * Make invisible any Features that were not seen during the current frame
   * @param frame - Integer frame being rendered
   */
  public cull(frame: number): void {
    for (const [featureID, feature] of this.features) {
      const seenFrame = this.retained.get(featureID);
      if (seenFrame === frame) continue;

      // Can't see it currently, make it invisible
      feature.visible = false;

      // Haven't seen it in a while, remove completely
      if (seenFrame !== undefined && frame - seenFrame > 20) {
        feature.destroy();
      }
    }
  }


  /**
   * Add a feature to the layer cache.
   * @param feature - A Feature derived from `AbstractPixiFeature` (point, line, multipolygon)
   */
  public addFeature(feature: AbstractPixiFeature): void {
    this.features.set(feature.id, feature);
  }


  /**
   * Remove a Feature from the layer cache.
   * @param feature - A Feature derived from `AbstractPixiFeature` (point, line, multipolygon)
   */
  public removeFeature(feature: AbstractPixiFeature): void {
    this.unbindData(feature.id);
    this.retained.delete(feature.id);
    this.features.delete(feature.id);
  }


  /**
   * Retain the feature for the given frame.
   * Features that are not retained may be automatically culled (made invisible) or removed.
   * @param feature - A Feature derived from `AbstractPixiFeature` (point, line, multipolygon)
   * @param frame - Integer frame being rendered
   */
  public retainFeature(feature: AbstractPixiFeature, frame: number): void {
    if (feature.lod > 0) {
      feature.visible = true;
    }
    // If in user's view, retain it regardless of whether it's actually visible.
    // We want to avoid continuously creating invisible things just to dispose of them a few frames later.
    // For example points when zoomed out far.
    this.retained.set(feature.id, frame);
  }


  /**
   * Adds (or replaces) a data binding from featureID to a dataID
   * @param featureID - featureID  (e.g. 'osm-w-123-fill')
   * @param dataID - dataID     (e.g. 'w-123')
   */
  public bindData(featureID: FeatureID, dataID: DataID): void {
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
        parentSet.delete(childID);
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
      this.removeChildData(parentID, childSet);
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
   */
  public dirtyLayer(): void {
    for (const feature of this.features.values()) {
      feature.dirty = true;
    }
  }

  /**
   * Mark specific features features as `dirty`
   * During the next "app" pass, dirty features will be rebuilt.
   * @param featureIDs - featureIDs to set dirty
   */
  public dirtyFeatures(featureIDs: OneOrMore<FeatureID>): void {
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
