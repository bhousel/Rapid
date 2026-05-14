import * as PIXI from 'pixi.js';
import { merge as deepMerge } from 'lodash-es';
import { PixiGeometryPart } from './PixiGeometryPart.ts';
import { styleDefaults } from '../lib/Style.ts';

import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { Context } from '../Context.ts';
import type { GeometryPart } from '../lib/GeometryPart.ts';
import type { GraphicsSystem } from '../core/GraphicsSystem.ts';
import type { MinimalStyleProps, StyleProps } from '../lib/Style.ts';
import type { PixiScene } from './PixiScene.ts';
import type { SingularGeometryType } from '../lib/types.ts';
import type { Viewport } from '@rapid-sdk/math';

/** Extended PIXI.Container with feature reference */
export interface FeatureContainer extends PIXI.Container {
  __feature__: AbstractPixiFeature | null;
}


/**
 * AbstractPixiFeature is the base class from which all rendered Features inherit.
 * It contains properties that used to manage the Feature in the scene graph.
 *
 * Properties you can access:
 *   `id` (or `featureID`)  Unique string to use for the name of this Feature
 *   `type`                 String describing what kind of Feature this is ('Point', 'LineString', 'Polygon')
 *   `container`            PIXI.Container() that contains all the graphics needed to draw the Feature
 *   `parentContainer`      PIXI.Container() for the parent - this Feature's container will be added to it.
 *   `geom`                 PixiGeometryPart() class containing all the information about the geometry
 *   `style`                Object containing style info
 *   `label`                String containing the Feature's label (if any)
 *   `data`                 Data bound to this Feature (like `__data__` from the D3.js days)
 *   `dataID`               Data bound to this Feature (like `__data__` from the D3.js days)
 *   `visible`              `true` if the Feature is visible (`false` if it is culled)
 *   `allowInteraction`     `true` if the Feature is allowed to be interactive (emits Pixi events)
 *   `dirty`                `true` if the Feature needs to be rebuilt
 *   `v`                    Version of the Feature, can be used to detect changes
 *   `lod`                  Level of detail for the Feature last time it was styled (0 = off, 1 = simplified, 2 = full)
 *   `halo`                 A PIXI.DisplayObject() that contains the graphics for the Feature's halo (if it has one)
 */
export class AbstractPixiFeature {
  /** Unique string identifier for this Feature */
  id: FeatureID;
  /** The Layer that owns this Feature */
  layer: AbstractPixiLayer;
  /** The PixiScene that contains this Feature */
  scene: PixiScene;
  /** Reference to the GraphicsSystem */
  gfx: GraphicsSystem;
  /** Global shared application context */
  context: Context;
  /** PIXI.Container that contains all the graphics needed to draw the Feature */
  container: FeatureContainer;
  /** Version of the Feature, can be used to detect changes */
  v: number;
  /** Level of detail for the Feature last time it was styled (0 = off, 1 = simplified, 2 = full) */
  lod: number;
  /** A PIXI.Container that contains the graphics for the Feature's halo (if it has one) */
  halo: PIXI.Container | null;
  /** PixiGeometryPart containing all the information about the geometry */
  geom: PixiGeometryPart;

  /** Whether the Feature is allowed to be interactive */
  protected _allowInteraction: boolean;
  /** PixiGeometryPart containing all the information about the geometry */
  protected _geom: GeometryPart | null;
  /** Style object (contents depends on the Feature type) */
  protected _style: MinimalStyleProps;
  /** Whether the style needs to be reapplied */
  protected _styleDirty: boolean;
  /** Label string for this feature */
  protected _label: string | null;
  /** Whether the label needs to be reapplied */
  protected _labelDirty: boolean;
  /** Identifier for the data bound to this Feature */
  protected _dataID: DataID | null;
  /** Data bound to this Feature */
  protected _data: unknown;
  /** Pseudoclasses for styling */
  protected _classes: Set<ClassID>;

  /**
   * @constructor
   * @param layer - The Layer that owns this Feature
   * @param featureID - Unique string to use for the identifier of this Feature
   */
  constructor(layer: AbstractPixiLayer, featureID: FeatureID) {
    this.id = featureID;  // put this first so debug inspect shows it first

    this.layer = layer;
    this.scene = layer.scene;
    this.gfx = layer.gfx;
    this.context = layer.context;

    const container = new PIXI.Container() as FeatureContainer;
    this.container = container;

    container.__feature__ = this;   // Link the container back to `this`
    container.label = featureID;
    container.sortableChildren = false;
    container.visible = true;

    // By default, make the Feature interactive
    this._allowInteraction = true;
    container.eventMode = 'static';

    this.v = -1;
    this.lod = 2;   // full detail
    this.halo = null;

    this.geom = new PixiGeometryPart(this.context);
    this._geom = null;
    this._style = deepMerge({}, styleDefaults);
    this._styleDirty = true;
    this._label = null;
    this._labelDirty = true;

    this._dataID = null;
    this._data = null;

    // pseudoclasses, @see `AbstractPixiLayer.syncFeatureClasses()`
    this._classes = new Set();

    this.layer.addFeature(this);
    this.scene.addFeature(this);
  }


  /**
   * Every Feature should have a destroy function that frees all the resources
   * Do not use the Feature after calling `destroy()`.
   */
  destroy(): void {
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

    if (this.halo) {
      this.halo.destroy({ children: true });
      this.halo = null;
    }

    this.geom.destroy();
    this.geom = null!;
    this._geom = null;
    this._style = null!;
    this._label = null;

    this._dataID = null;
    this._data = null;
  }


  /**
   * Every Feature should have an `update()` function that redraws the Feature at the given viewport and zoom.
   * When the Feature is updated, its `dirty` flags should be set to `false`.
   * Override in a subclass with needed logic. It will be passed:
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom to use for rendering
   * @abstract
   */
  update(viewport: Viewport, zoom: number): void {
    if (!this.dirty) return;  // nothing to do

    this.geom.update(viewport);
    this._styleDirty = false;
    // The labeling code will decide what to do with the `_labelDirty` flag
  }


  /**
   * Every Feature should have an `updateHalo()` function that redraws any hover or select styling.
   * Override in a subclass with needed logic.
   * @param zoom - Effective zoom to use for rendering. Omit to signal "hide/destroy the halo only".
   * @abstract
   */
  updateHalo(zoom?: number): void {
  }


  /**
   * Unique string to identify this render Feature.
   * @return This feature's unique id
   * @readonly
   */
  get featureID(): FeatureID {
    return this.id;
  }

  /**
   * Feature type
   * The type of feature, this is taken from the GeometryPart.
   * @return This feature's type, one of 'Point', 'LineString', or 'Polygon'
   * @readonly
   */
  get type(): SingularGeometryType | undefined {
    return this._geom?.type;
  }

  /**
   * @param val - container for the parent, this Feature's container will be added to it.
   */
  get parentContainer(): PIXI.Container | null {
    return this.container.parent;
  }
  set parentContainer(val: Nullable<PIXI.Container>) {
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
  get visible(): boolean {
    return this.container.visible;
  }
  set visible(val: boolean) {
    if (val === this.container.visible) return;  // no change
    this.container.visible = val;
    this.updateHalo();
    this._labelDirty = true;
  }


  /**
   * Whether the Feature needs to be rebuilt
   * @return `true` if the feature needs to be rebuilt
   */
  get dirty(): boolean {
    // The labeling code will decide what to do with the `_labelDirty` flag
    return this.geom.dirty || this._styleDirty;
  }
  set dirty(val: boolean) {
    this.geom.dirty = val;
    this._styleDirty = val;
    this._labelDirty = val;
  }


  /**
   * Whether the Feature is allowed to be interactive
   * @return `true` if the feature is currently interactive, `false` if not
   */
  get allowInteraction(): boolean {
    return this._allowInteraction;
  }
  set allowInteraction(val: boolean) {
    if (val === this._allowInteraction) return;  // no change
    this._allowInteraction = val;

    if (this.container) {
      this.container.eventMode = this._allowInteraction ? 'static' : 'none';
    }
  }


  /**
   * @param props - Style properties object, see `Style.ts`
   */
  get style(): MinimalStyleProps | null {
    return this._style;
  }
  set style(props: Partial<StyleProps>) {
    // result: defaults ← props
    this._style = deepMerge({}, styleDefaults, props) as MinimalStyleProps;
    this._styleDirty = true;
  }


  /**
   * @param val - a GeometryPart to render
   */
  get geometry(): GeometryPart | null {
    return this._geom;
  }
  set geometry(val: GeometryPart) {
    this._geom = val;
    this.geom.dirty = true;
  }


  /**
   * @param str - the label to use
   */
  get label(): string | null {
    return this._label;
  }
  set label(str: string | null) {
    if (str === this._label) return;  // no change
    this._label = str;
    this._labelDirty = true;
  }


  /**
   * Getter only, use `setData()` to change it.
   * (because we need to know an id/key to identify the data by, and these can be anything)
   * @readonly
   */
  get data(): unknown {
    return this._data;
  }

  /**
   * Getter only, use `setData()` to change it.
   * (because we need to know an id/key to identify the data by, and these can be anything)
   * @readonly
   */
  get dataID(): DataID | null {
    return this._dataID;
  }


  /**
   * Sets a pseudoclass.
   * Pseudoclasses are special values that can affecct the styling of a feature.
   * (They do the same thing that CSS classes do).
   * When changing the value of the class we'll also dirty the feature so that it gets redrawn on the next pass.
   * @param classID - the pseudoclass to set
   */
  setClass(classID: ClassID): void {
    const hasClass = this._classes.has(classID);
    if (hasClass) return;  // nothing to do

    this._classes.add(classID);
    this._styleDirty = true;
    this._labelDirty = true;
  }


  /**
   * Unsets a pseudoclass.
   * Pseudoclasses are special values that can affecct the styling of a feature.
   * (They do the same thing that CSS classes do).
   * When changing the value of the class we'll also dirty the feature so that it gets redrawn on the next pass.
   * @param classID - the pseudoclass to remove
   */
  unsetClass(classID: ClassID): void {
    const hasClass = this._classes.has(classID);
    if (!hasClass) return;  // nothing to do

    this._classes.delete(classID);
    this._styleDirty = true;
    this._labelDirty = true;
  }


  /**
   * @param classID - the class to check
   * @return `true` if the feature has this class, `false` if not
   */
  hasClass(classID: ClassID): boolean {
    return this._classes.has(classID);
  }

  /**
   * Returns a read-only view of the feature's pseudoclasses
   */
  get classes(): ReadonlySet<ClassID> {
    return this._classes;
  }

  /**
   * This binds the data element to the feature, also lets the layer know about it.
   * @param dataID - Identifer for this data element (e.g. 'n123')
   * @param data - data to bind to the feature (e.g. an OSM Node)
   */
  setData(dataID: DataID, data: unknown): void {
    this._dataID = dataID;
    this._data = data;
    this.layer.bindData(this.id, dataID);
    this.dirty = true;
  }

  /**
   * This sets the coordinate data to be rendered.
   * @param source - A GeometryPart, or something that can be turned into one.
   */
  setCoords(source: GeometryPart | GeoJSON.Geometry): void {
    this.geom.setData(source);
  }

  /**
   * Adds a mapping from parent data to child data.
   * @param parentID - dataID of the parent (e.g. 'r123')
   * @param childID - dataID of the child (e.g. 'w123')
   */
  addChildData(parentID: DataID, childID: DataID): void {
    this.layer.addChildData(parentID, childID);
    this.dirty = true;
  }

  /**
   * Removes all child dataIDs for the given parent dataID
   * @param parentID - dataID of the parent (e.g. 'r123')
   */
  clearChildData(parentID: DataID): void {
    this.layer.clearChildData(parentID);
    this.dirty = true;
  }

}
