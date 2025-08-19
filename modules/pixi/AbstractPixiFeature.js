import * as PIXI from 'pixi.js';
import { PixiGeometryPart } from './PixiGeometryPart.js';


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

  /**
   * @constructor
   * @param  {Layer}   layer     - The Layer that owns this Feature
   * @param  {string}  featureID - Unique string to use for the identifier of this Feature
   */
  constructor(layer, featureID) {
    this.id = featureID;  // put this first so debug inspect shows it first

    this.layer = layer;
    this.scene = layer.scene;
    this.gfx = layer.gfx;
    this.context = layer.context;

    const container = new PIXI.Container();
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

    this.geom = new PixiGeometryPart();
    this._style = null;
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
   * destroy
   * Every Feature should have a destroy function that frees all the resources
   * Do not use the Feature after calling `destroy()`.
   */
  destroy() {
    this.layer.removeFeature(this);
    this.scene.removeFeature(this);

    // Destroying a container removes it from its parent container automatically
    // We also remove the children too
    this.container.filters = null;
    this.container.__feature__ = null;
    this.container.destroy({ children: true });
    this.container = null;

    this.layer = null;
    this.scene = null;
    this.gfx = null;
    this.context = null;

    if (this.halo) {
      this.halo.destroy();
      this.halo = null;
    }

    this.geom.destroy();
    this.geom = null;
    this._style = null;
    this._label = null;

    this._dataID = null;
    this._data = null;
  }


  /**
   * update
   * Every Feature should have an `update()` function that redraws the Feature at the given viewport and zoom.
   * When the Feature is updated, its `dirty` flags should be set to `false`.
   * Override in a subclass with needed logic. It will be passed:
   * @param  {Viewport}  viewport - Pixi viewport to use for rendering
   * @param  {number}    zoom     - Effective zoom to use for rendering
   * @abstract
   */
  update(viewport, zoom) {
    if (!this.dirty) return;  // nothing to do

    this.geom.update(viewport, zoom);
    this._styleDirty = false;
    // The labeling code will decide what to do with the `_labelDirty` flag
  }


  /**
   * updateHalo
   * Every Feature should have an `updateHalo()` function that redraws any hover or select styling.
   * Override in a subclass with needed logic.
   * @abstract
   */
  updateHalo() {
  }


  /**
   * featureID
   * Unique string to identify this render Feature.
   * @return  {string}  This feature's unique id
   * @readonly
   */
  get featureID() {
    return this.id;
  }

  /**
   * Feature type
   * The type of feature, this is taken from the GeometryPart.
   * @return  {string}  This feature's type, one of 'Point', 'LineString', or 'Polygon'
   * @readonly
   */
  get type() {
    return this.geom.type;
  }

  /**
   * parentContainer
   * @param  {PIXI.Container}  val - container for the parent, this Feature's container will be added to it.
   */
  get parentContainer() {
    return this.container.parent;
  }
  set parentContainer(val) {
    const currParent = this.container.parent;
    if (val && val !== currParent) {   // put this feature under a different parent container
      val.addChild(this.container);
    } else if (!val && currParent) {   // remove this feature from its parent container
      currParent.removeChild(this.container);
    }
  }


  /**
   * visible
   * Whether the Feature is currently visible
   * @return  {boolean}  `true` if the feature is currently visible
   */
  get visible() {
    return this.container.visible;
  }
  set visible(val) {
    if (val === this.container.visible) return;  // no change
    this.container.visible = val;
    this.updateHalo();
    this._labelDirty = true;
  }


  /**
   * dirty
   * Whether the Feature needs to be rebuilt
   * @return  {boolean}  `true` if the feature needs to be rebuilt
   */
  get dirty() {
    // The labeling code will decide what to do with the `_labelDirty` flag
    return this.geom.dirty || this._styleDirty;
  }
  set dirty(val) {
    this.geom.dirty = val;
    this._styleDirty = val;
    this._labelDirty = val;
  }


  /**
   * allowInteraction
   * Whether the Feature is allowed to be interactive
   * @return  {boolean}  `true` if the feature is currently interactive, `false` if not
   */
  get allowInteraction() {
    return this._allowInteraction;
  }
  set allowInteraction(val) {
    if (val === this._allowInteraction) return;  // no change
    this._allowInteraction = val;

    if (this.container) {
      this.container.eventMode = this._allowInteraction ? 'static' : 'none';
    }
  }


  /**
   * style
   * @param {Object} obj - Style `Object` (contents depends on the Feature type)
   *
   * 'point' - @see PixiFeaturePoint.js
   * 'line'/'polygon' - @see styles.js
   */
  get style() {
    return this._style;
  }
  set style(obj) {
    this._style = obj;
    this._styleDirty = true;
  }


  /**
   * label
   * @param {string}  str - the label to use
   */
  get label() {
    return this._label;
  }
  set label(str) {
    if (str === this._label) return;  // no change
    this._label = str;
    this._labelDirty = true;
  }


  /**
   * data
   * Getter only, use `setData()` to change it.
   * (because we need to know an id/key to identify the data by, and these can be anything)
   * @readonly
   */
  get data() {
    return this._data;
  }

  /**
   * dataID
   * Getter only, use `setData()` to change it.
   * (because we need to know an id/key to identify the data by, and these can be anything)
   * @readonly
   */
  get dataID() {
    return this._dataID;
  }


  /**
   * setClass
   * Sets a pseudoclass.
   * Pseudoclasses are special values that can affecct the styling of a feature.
   * (They do the same thing that CSS classes do).
   * When changing the value of the class we'll also dirty the feature so that it gets redrawn on the next pass.
   * @param  {string}  classID - the pseudoclass to set
   */
  setClass(classID) {
    const hasClass = this._classes.has(classID);
    if (hasClass) return;  // nothing to do

    this._classes.add(classID);
    this._styleDirty = true;
    this._labelDirty = true;
  }


  /**
   * unsetClass
   * Unsets a pseudoclass.
   * Pseudoclasses are special values that can affecct the styling of a feature.
   * (They do the same thing that CSS classes do).
   * When changing the value of the class we'll also dirty the feature so that it gets redrawn on the next pass.
   * @param  {string}  classID - the pseudoclass to remove
   */
  unsetClass(classID) {
    const hasClass = this._classes.has(classID);
    if (!hasClass) return;  // nothing to do

    this._classes.delete(classID);
    this._styleDirty = true;
    this._labelDirty = true;
  }


  /**
   * hasClass
   * @param  {string}  classID - the class to check
   * @return {boolean} `true` if the feature has this class, `false` if not
   */
  hasClass(classID) {
    return this._classes.has(classID);
  }

  /**
   * setData
   * This binds the data element to the feature, also lets the layer know about it.
   * @param  {string}  dataID - Identifer for this data element (e.g. 'n123')
   * @param  {*}       data   - data to bind to the feature (e.g. an OSM Node)
   */
  setData(dataID, data) {
    this._dataID = dataID;
    this._data = data;
    this.layer.bindData(this.id, dataID);
    this.dirty = true;
  }

  /**
   * setCoords
   * This sets the coordinate data to be rendered.
   * @param  {GeometryPart|Object}  source - A GeometryPart, or something that can be turned into one.
   */
  setCoords(source) {
    this.geom.setData(source);
  }

  /**
   * addChildData
   * Adds a mapping from parent data to child data.
   * @param  {string}  parentID - dataID of the parent (e.g. 'r123')
   * @param  {string}  childID  - dataID of the child (e.g. 'w123')
   */
  addChildData(parentID, childID) {
    this.layer.addChildData(parentID, childID);
    this.dirty = true;
  }

  /**
   * clearChildData
   * Removes all child dataIDs for the given parent dataID
   * @param  {string}  parentID - dataID of the parent (e.g. 'r123')
   */
  clearChildData(parentID) {
    this.layer.clearChildData(parentID);
    this.dirty = true;
  }

}
