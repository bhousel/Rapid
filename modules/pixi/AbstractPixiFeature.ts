import * as PIXI from 'pixi.js';
import { containerHit } from './helpers.ts';
import { utilDeepMerge } from '../util/deep_merge.ts';
import { styleDefaults } from '../lib/Style.ts';

import type { AbstractData } from '../data/AbstractData.ts';
import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { CellRect } from './lib/AvoidGrid.ts';
import type { Context } from '../Context.ts';
import type { GeometryPart } from '../lib/GeometryPart.ts';
import type { GraphicsSystem } from '../core/GraphicsSystem.ts';
import type { MinimalStyleProps, StyleProps } from '../lib/Style.ts';
import type { OneOrMore } from '../util/iterable.ts';
import type { PixiScene } from './PixiScene.ts';
import type { SingularGeometryType } from '../lib/types.ts';
import type { Viewport } from '@rapid-sdk/math';


/** A PIXI.Container with an optional reference back to the feature */
export interface FeatureContainer extends PIXI.Container {
  __feature__?: AbstractPixiFeature | null;
}

/** A Feature may have arbitrary properties attached to it. */
export type PixiFeatureProps = Record<string, unknown>;


/**
 * AbstractPixiFeature is the base class from which all rendered Features inherit.
 * It contains properties that used to manage the Feature in the scene graph.
 *
 * Properties available:
 * - `id` (or `featureID`) - Unique string to use for the name of this Feature
 * - `type`                - String describing what kind of Feature this is ('Point', 'LineString', 'Polygon')
 * - `container`           - PIXI.Container() that contains all the graphics needed to draw the Feature
 * - `parentContainer`     - PIXI.Container() for the parent - this Feature's container will be added to it.
 * - `geom`                - GeometryPart() class containing all the information about the geometry
 * - `style`               - Object containing style info
 * - `label`               - String containing the Feature's label (if any)
 * - `data`                - Data element bound to this Feature (like `__data__` from the D3.js days).
 *                           Data is immutable, so layers bind it again when it's a different object.
 * - `props`               - Properties object, can contain other arbitrary properties
 * - `visible`             - `true` if the Feature is visible (`false` if it is culled)
 * - `allowInteraction`    - `true` if the Feature is allowed to be interactive (emits Pixi events)
 * - `dirty`               - `true` if the Feature needs to be rebuilt
 * - `lod`                 - Level of detail for the Feature last time it was styled (0 = off, 1 = simplified, 2 = full)
 * - `halo`                - A PIXI.Container() that contains the graphics for the Feature's halo (if it has one)
 */
export class AbstractPixiFeature {

  /** Unique string identifier for this Feature */
  public id: FeatureID;
  /** The Layer that owns this Feature */
  public layer: AbstractPixiLayer;
  /** The PixiScene that contains this Feature */
  public scene: PixiScene;
  /** Reference to the GraphicsSystem */
  public gfx: GraphicsSystem;
  /** Global shared application context */
  public context: Context;
  /** PIXI.Container that contains all the graphics needed to draw the Feature */
  public container: FeatureContainer;
  /** Properties object, can be used to attach arbitrary data to this Feature */
  public props: Partial<PixiFeatureProps>;
  /** Level of detail for the Feature last time it was styled (0 = off, 1 = simplified, 2 = full) */
  public lod: number;
  /** A PIXI.Container that contains the graphics for the Feature's halo (if it has one) */
  public halo: PIXI.Container | null;
  /**
   * How far outside the box of its geometry the Feature can be hit, in pixels: a line a few
   * pixels from it, a pin above its point. A subclass sets it when it draws. A layer that finds
   * its features through a spatial index looks this far around the pointer (`PixiLayerOsm.hitTest`).
   */
  public hitReach: number;
  /**
   * Whether labels keep clear of this Feature. Its layer sets this: pins and vertices are
   * avoided, photo and QA markers aren't. (See `updateAvoid`.)
   */
  public labelAvoid: boolean;

  /** The cells of the scene's avoid grid that this Feature has marked, if any */
  protected _avoidCells: CellRect | null;
  /** The generation of the avoid grid that `_avoidCells` is for */
  protected _avoidGeneration: number;
  /** Whether the Feature is allowed to be interactive */
  protected _allowInteraction: boolean;
  /** GeometryPart containing all the information about the geometry */
  protected _geom: GeometryPart | null;
  /** Whether the geometry needs to be recalculated */
  protected _geomDirty: boolean;
  /** Style object (contents depends on the Feature type) */
  protected _style: MinimalStyleProps;
  /** Whether the style needs to be reapplied */
  protected _styleDirty: boolean;
  /** Whether the layer should work out the style again from the data (see `needsStyle`) */
  protected _needsStyle: boolean;
  /** Whether the Feature is dirty only because the view's zoom or rotation changed (see `onlyTransformDirty`) */
  protected _transformOnly: boolean;
  /** Label string for this feature */
  protected _label: string | null;
  /** Whether the label needs to be reapplied */
  protected _labelDirty: boolean;
  /** Data bound to this Feature */
  protected _data: AbstractData | null;
  /** Pseudoclasses for styling */
  protected _classes: Set<ClassID>;


  /**
   * @param layer - The Layer that owns this Feature
   * @param featureID - Unique string to use for the identifier of this Feature
   */
  public constructor(layer: AbstractPixiLayer, featureID: FeatureID) {
    this.id = featureID;  // put this first so debug inspect shows it first

    this.layer = layer;
    this.scene = layer.scene;
    this.gfx = layer.gfx;
    this.context = layer.context;
    this.props = {};

    const container = new PIXI.Container() as FeatureContainer;
    this.container = container;

    container.__feature__ = this;   // Link the container back to `this`
    container.label = featureID;
    container.sortableChildren = false;
    container.visible = true;

    // By default, make the Feature interactive
    this._allowInteraction = true;
    container.eventMode = 'static';

    this.lod = 2;   // full detail
    this.halo = null;
    this.hitReach = 0;
    this.labelAvoid = false;
    this._avoidCells = null;
    this._avoidGeneration = 0;

    this._geom = null;
    this._geomDirty = true;
    this._style = styleDefaults;   // shared until a style is assigned (nothing changes a style in place)
    this._styleDirty = true;
    this._needsStyle = true;
    this._transformOnly = false;
    this._label = null;
    this._labelDirty = true;
    this._data = null;

    // pseudoclasses, @see `AbstractPixiLayer.syncFeatureClasses()`
    this._classes = new Set<ClassID>();

    this.layer.addFeature(this);
    this.scene.addFeature(this);
  }


  /**
   * Every Feature should have a destroy function that frees all the resources
   * Do not use the Feature after calling `destroy()`.
   */
  public destroy(): void {
    this._setAvoid(null);
    this.scene.featureChanged(this);    // (its label goes with it)
    this.layer.removeFeature(this);
    this.scene.removeFeature(this);

    // Destroying a container removes it from its parent container automatically
    // We also remove the children too
    this.container.filters = null!;
    this.container.__feature__ = null;
    this.container.destroy({ children: true });
    this.container = null!;

    this.layer = null!;
    this.scene = null!;
    this.gfx = null!;
    this.context = null!;
    this.props = null!;

    if (this.halo) {
      this.halo.destroy({ children: true });
      this.halo = null;
    }

    this._geom = null;
    this._style = null!;
    this._label = null;
    this._data = null;
  }


  /**
   * Every Feature should have an `update()` function that redraws the Feature using the given viewport.
   * When the Feature is updated, its `dirty` flags should be set to `false`.
   * Override in a subclass with needed logic.
   * @param viewport - Pixi viewport to use for rendering
   * @abstract
   */
  public update(viewport: Viewport): void {
    if (!this.dirty) return;   // nothing to do
    this.layer.work.updated++;
    this._geomDirty = false;
    this._styleDirty = false;
    this.scene.featureChanged(this);
  }


  /**
   * Every Feature should have an `updateHalo()` function that redraws any hover or select styling.
   * Override in a subclass with needed logic.
   * @param viewport - Pixi viewport to use for rendering
   * @abstract
   */
  public updateHalo(viewport: Viewport): void {
  }


  /**
   * Whether the pointer is over this Feature: over its hit area if it has one, otherwise over
   * what it draws. A Feature that's hidden, or not allowed to be interactive, is never hit.
   * (A Feature that's waiting to be drawn again answers for where it was last drawn.)
   * @param point - The pointer's place in the stage's coordinates (a pointer event's `global`)
   * @param _world - The same place in world coordinates, for a subclass that tests without Pixi
   * @return `true` if the pointer hits it
   */
  public hitTest(point: PIXI.PointData, _world: PIXI.PointData): boolean {
    return containerHit(this.container, point);
  }


  /**
   * The container in the scene that says where this Feature is drawn among the others: the one
   * drawn later is on top, and is what the pointer hits (`featureOrder()` in `helpers.ts`).
   * It's the Feature's own container, unless something else draws the Feature.
   * @return The container
   */
  public get sceneContainer(): PIXI.Container {
    return this.container;
  }


  /**
   * Where this Feature is drawn among the others with the same `sceneContainer`, if that draws
   * several (higher is on top).
   * @return A number to order by
   */
  public get sceneOrder(): number {
    return 0;
  }


  /**
   * Unique string to identify this render Feature.
   * @return This feature's unique id
   * @readonly
   */
  public get featureID(): FeatureID {
    return this.id;
  }

  /**
   * Feature type
   * The type of feature, this is taken from the GeometryPart.
   * @return This feature's type, one of 'Point', 'LineString', or 'Polygon'
   * @readonly
   */
  public get type(): SingularGeometryType | undefined {
    return this._geom?.type;
  }

  /**
   * The parent PIXI container that this feature's container is attached to
   * @return  Parent `PIXI.Container`, or `null` if not attached
   */
  public get parentContainer(): PIXI.Container | null {
    return this.container.parent;
  }
  /**
   * Setting a new parent container moves this feature's container to the new parent.
   * @param val - New parent container, or `null` to detach from the current parent
   */
  public set parentContainer(val: Nullable<PIXI.Container>) {
    const currParent = this.container.parent;
    if (val && val !== currParent) {   // put this feature under a different parent container
      val.addChild(this.container);
    } else if (!val && currParent) {   // remove this feature from its parent container
      currParent.removeChild(this.container);
    }
  }


  /**
   * Whether the Feature is currently visible
   * @return `true` if the feature is currently visible
   */
  public get visible(): boolean {
    return this.container.visible;
  }
  /**
   * Setting visibility also propagates to the halo and marks the label as dirty.
   * @param val - `true` to show the feature, `false` to hide it
   */
  public set visible(val: boolean) {
    if (val === this.container.visible) return;  // no change
    this.container.visible = val;
    this.layer.visibilityChanged(this, val);
    if (this.halo) this.halo.visible = val;
    this._labelDirty = true;
    // What's hidden isn't in a label's way. What's shown is, where it was drawn. (If it's
    // waiting to be drawn again, it marks its place when it is.)
    if (!val) {
      this._setAvoid(null);
    } else if (!this.dirty) {
      this.updateAvoid();
    }
    this.scene.featureChanged(this);
  }


  /**
   * Marks, in the scene's avoid grid, the part of label space that this Feature covers, so that
   * no label is placed over it (see "Label placement" in `design/graphics-system.md`).
   * A Feature that labels avoid calls this at the end of its `update()`, once it's where it
   * will be drawn. Override in a subclass that can be avoided; this one covers nothing.
   */
  public updateAvoid(): void {
  }


  /**
   * The cells of the scene's avoid grid that this Feature has marked, if it has marked any that
   * still count (see `updateAvoid`).
   * @return The cells, or `null`
   */
  public get avoidCells(): CellRect | null {
    const grid = this.scene?.avoidGrid;
    return (grid && this._avoidGeneration === grid.generation) ? this._avoidCells : null;
  }


  /**
   * Replaces what this Feature has marked in the avoid grid.
   * If a label is where the Feature now is, the scene is told, and the label moves.
   * @param box - What the Feature covers, `[minX, minY, maxX, maxY]` in label space, or `null` for nothing
   */
  protected _setAvoid(box: [number, number, number, number] | null): void {
    const scene = this.scene;
    const grid = scene?.avoidGrid;
    if (!grid) return;

    const old = (this._avoidGeneration === grid.generation) ? this._avoidCells : null;   // (else: cleared since)
    const cells = box && grid.cellsOf(box[0], box[1], box[2], box[3]);
    if (old && cells && old[0] === cells[0] && old[1] === cells[1] && old[2] === cells[2] && old[3] === cells[3]) return;

    if (old) {
      grid.unmark('avoid', old);
      scene.avoidFreed(old);
    }
    if (cells) {
      grid.mark('avoid', cells);
      if (grid.isTaken('label', cells)) {
        scene.avoidHit(cells);
      }
    }
    this._avoidCells = cells;
    this._avoidGeneration = grid.generation;
  }


  /**
   * Whether the Feature needs to be rebuilt
   * @return `true` if the feature needs to be rebuilt
   */
  public get dirty(): boolean {
    // The labeling code will decide what to do with the `_labelDirty` flag
    return this._geomDirty || this._styleDirty;
  }
  /**
   * Setting dirty marks the geometry, style, and label as needing rebuild.
   * @param val - `true` to mark all parts as dirty
   */
  public set dirty(val: boolean) {
    this._geomDirty = val;
    this._styleDirty = val;
    this._labelDirty = val;
    if (val) {
      this._needsStyle = true;
      this._transformOnly = false;
    }
  }


  /**
   * Whether the Feature's label has to be placed again: its shape, its label or its visibility
   * changed since the label was placed. (Not for a hover or a selection: see `setClass`.)
   * The labels layer reads this when the Feature tells the scene it changed
   * (`PixiScene.featureChanged`), and clears it with `labelPlaced()`.
   * @return `true` if the label is out of date
   */
  public get labelDirty(): boolean {
    return this._labelDirty;
  }


  /**
   * The labels layer has looked at this Feature's label, as it is now.
   */
  public labelPlaced(): void {
    this._labelDirty = false;
  }


  /**
   * Whether the layer should work out the Feature's style and label again from its data.
   * That's so for a new Feature, and after anything that may have changed what the Feature is:
   * its data was bound again, or it was marked dirty (`dirty = true`, as the layer and the scene
   * do when the data, the styles, the language or the filters change). Assigning a `style` clears it.
   *
   * A change of zoom or rotation doesn't set it (see `dirtyTransform`), and neither does a class
   * (hover, select): the Feature is drawn again with the style it has. Matching a style to tags
   * costs several times what drawing does, so a layer should only do it when this says so:
   * ```ts
   * if (feature.needsStyle) {
   *   feature.style = styles.styleMatch(entity.tags, geometry, 'osm');
   *   feature.label = l10n.displayName(entity.tags);
   * }
   * feature.update(viewport);
   * ```
   * @return `true` if the style should be assigned again
   */
  public get needsStyle(): boolean {
    return this._needsStyle;
  }


  /**
   * Marks the Feature as needing to be drawn again because the view's zoom or rotation changed.
   * What the Feature is hasn't changed, so its style stays as it is (see `needsStyle`).
   */
  public dirtyTransform(): void {
    if (!this.dirty) {
      this._transformOnly = true;   // (if it was dirty already, it's for another reason too)
    }
    this._geomDirty = true;
    this._styleDirty = true;
    this._labelDirty = true;
  }


  /**
   * Whether the Feature is dirty only because the view's zoom or rotation changed, and not because
   * of anything about the Feature itself (its data, its style, a class like hover or select).
   * Such a Feature can be drawn as it was for a few frames, so its redraw can wait even in a
   * frame that the user asked for (see `AbstractPixiLayer.updateFeature`).
   * @return `true` if nothing but the view changed since the Feature was last drawn
   */
  public get onlyTransformDirty(): boolean {
    return this._transformOnly && this.dirty;
  }


  /**
   * Whether the Feature is allowed to be interactive
   * @return `true` if the feature is currently interactive, `false` if not
   */
  public get allowInteraction(): boolean {
    return this._allowInteraction;
  }
  /**
   * Setting interactivity updates the Pixi container's `eventMode`.
   * @param val - `true` to enable interaction, `false` to disable
   */
  public set allowInteraction(val: boolean) {
    if (val === this._allowInteraction) return;  // no change
    this._allowInteraction = val;

    if (this.container) {
      this.container.eventMode = this._allowInteraction ? 'static' : 'none';
    }
  }


  /**
   * Current style properties for this feature
   * @return  Current `MinimalStyleProps`, or `null` if not yet set
   */
  public get style(): MinimalStyleProps | null {
    return this._style;
  }
  /**
   * Merges the given style props with defaults and marks the style as dirty.
   * @param props - Partial style properties to merge with defaults
   */
  public set style(props: Partial<StyleProps>) {
    // result: defaults ← props
    this._style = utilDeepMerge({}, styleDefaults, props) as MinimalStyleProps;
    this._styleDirty = true;
    this._needsStyle = false;
    this._transformOnly = false;
  }

  /**
   * The bound geometry part for this feature
   * @return  Current `GeometryPart`, or `null` if none bound
   */
  public get geom(): GeometryPart | null {
    return this._geom;
  }
  /**
   * Alias for `geom`; returns the bound GeometryPart.
   * @return  Current `GeometryPart`, or `null` if none bound
   */
  public get geometry(): GeometryPart | null {
    return this._geom;
  }
  /**
   * Binds a new GeometryPart and marks the geometry as dirty.
   * @param val - New `GeometryPart` to bind to this feature
   */
  public set geometry(val: GeometryPart) {
    this._geom = val;
    this._geomDirty = true;
    this._transformOnly = false;
  }


  /**
   * The label string for this feature
   * @return  Current label text, or `null` if none
   */
  public get label(): string | null {
    return this._label;
  }
  /**
   * Updating the label string marks the label as dirty so it is re-rasterized.
   * @param str - New label text, or `null` to clear the label
   */
  public set label(str: string | null) {
    if (str === this._label) return;  // no change
    this._label = str;
    this._labelDirty = true;
    this.scene.featureChanged(this);
  }


  /**
   * The bound data for this feature
   * @return  Current `AbstractData`, or `null` if none bound
   */
  public get data(): AbstractData | null {
    return this._data;
  }
  /**
   * Binds a data element to this feature and marks the feature as dirty.
   * @param val - `AbstractData` to bind to this feature
   */
  public set data(val: AbstractData) {
    this._data = val;
    this.layer.bindData(this.id, val.dataID);
    this.dirty = true;
  }


  /**
   * Sets a pseudoclass.
   * Pseudoclasses are special values that can affecct the styling of a feature.
   * (They do the same thing that CSS classes do).
   * When changing the value of the class we'll also dirty the feature so that it gets redrawn on the next pass.
   * @param classID - the pseudoclass to set
   */
  public setClass(classID: ClassID): void {
    const hasClass = this._classes.has(classID);
    if (hasClass) return;  // nothing to do

    this._classes.add(classID);
    this._styleDirty = true;      // (not the label: a class changes how a feature looks, not where
    this._transformOnly = false;  //  its label goes. A label that's placed again can land elsewhere.)
  }


  /**
   * Unsets a pseudoclass.
   * Pseudoclasses are special values that can affecct the styling of a feature.
   * (They do the same thing that CSS classes do).
   * When changing the value of the class we'll also dirty the feature so that it gets redrawn on the next pass.
   * @param classID - the pseudoclass to remove
   */
  public unsetClass(classID: ClassID): void {
    const hasClass = this._classes.has(classID);
    if (!hasClass) return;  // nothing to do

    this._classes.delete(classID);
    this._styleDirty = true;
    this._transformOnly = false;
  }


  /**
   * Tests whether the feature has the given pseudoclass.
   * @param classID - the class to check
   * @return `true` if the feature has this class, `false` if not
   */
  public hasClass(classID: ClassID): boolean {
    return this._classes.has(classID);
  }

  /**
   * Returns a read-only view of the feature's pseudoclasses
   * @return  Read-only set of active `ClassID`s
   */
  public get classes(): ReadonlySet<ClassID> {
    return this._classes;
  }

  /**
   * Adds a mapping from parent data to child data.
   * @param parentID - dataID of the parent (e.g. 'r123')
   * @param childID - dataIDs of the child (e.g. 'w123')
   */
  public addChildData(parentID: DataID, childIDs: OneOrMore<DataID>): void {
    this.layer.addChildData(parentID, childIDs);
    this.dirty = true;
  }

  /**
   * Removes all child dataIDs for the given parent dataID
   * @param parentID - dataID of the parent (e.g. 'r123')
   */
  public clearChildData(parentID: DataID): void {
    this.layer.clearChildData(parentID);
    this.dirty = true;
  }

}
