import * as PIXI from 'pixi.js';
import RBush from 'rbush';
import { HALF_PI, TAU, numWrap, vecAdd, vecAngle, vecScale, vecSubtract, geomRotatePoints } from '@rapid-sdk/math';

import { AbstractPixiLayer } from './AbstractPixiLayer.js';
import { getLineSegments, getDebugBBox, lineToPoly } from './helpers.js';


const MINZOOM = 12;

const TEXTSTYLE_NORMAL = {
  fill: { color: 0x333333 },
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: 12,
  fontWeight: 600,
  stroke: { color: 0xffffff, width: 3, join: 'round' }
};

const TEXTSTYLE_ITALIC = {
  fill: { color: 0x333333 },
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: 12,
  fontStyle: 'italic',
  fontWeight: 600,
  stroke: { color: 0xffffff, width: 3, join: 'round' }
};



/**
 *  These 'Labels' are placeholders for where a label can go.
 *  The display objects are added to the scene lazily only after the user
 *  has scrolled the placement box into view - see `renderObjects()`
 */
class Label {
  constructor(id, type, props) {
    this.id = id;
    this.type = type;
    this.props = props;
    this.objectID = null;  // A Pixi DisplayObject
  }
}


/**
 * PixiLayerLabels
 * @class
 */
export class PixiLayerLabels extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  {PixiScene}  scene - The Scene that owns this Layer
   */
  constructor(scene) {
    super(scene);
    this.id = 'labels';
    this.enabled = true;   // labels should be enabled by default

    this.labelOriginContainer = null;
    this.debugContainer = null;
    this.labelContainer = null;

    // RBush spatial indexes
    this._labelRBush = new RBush();  // label placement
    this._debugRBush = new RBush();  // debug sprites

    // Keep track of the features we have processed
    this._avoided = new Set();   // Set<featureID>
    this._labeled = new Set();   // Set<featureID>

    // Label objects are placeholders for where a label can go.
    // After working out the placement math, we don't automatically make display objects,
    // since many of the objects would get placed far offscreen.
    this._labels = new Map();    // Map<labelID, Label Object>

    // Pixi Display Objects - may include Sprite, Rope, Text, BitmapText, etc.
    this._objects = new Map();   // Map<objectID, Display Object>

    // Boxes are objects for working with RBush.
    this._boxes = new Map();            // Map<boxID, box>
    this._featureHasBoxes = new Map();  // Map<featureID, Set<boxID>>

    // Keep track of textures that we've allocated
    this._textureIDs = new Map();  // Map<string, textureID>

    // We reset the labeling when scale or rotation change
    this._tPrev = { x: 0, y: 0, z: 1, r: 0 };

    // Tracks the difference between the top left corner of the screen and the parent "origin" container
    this._labelOffset = new PIXI.Point();

    // For ASCII-only labels, we can use PIXI.BitmapText to avoid generating label textures
    PIXI.BitmapFont.install({ name: 'label-normal', style: TEXTSTYLE_NORMAL });
    // PIXI.BitmapFont.install({ name: 'label-italic', style: TEXTSTYLE_ITALIC });  // not currently used

    // For all other labels, generate it on the fly in a PIXI.Text or PIXI.Sprite
    this._textStyleNormal = new PIXI.TextStyle(TEXTSTYLE_NORMAL);
    this._textStyleItalic = new PIXI.TextStyle(TEXTSTYLE_ITALIC);
  }


  /**
   * reset
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset() {
    super.reset();

    // Destroy any Pixi display objects that we created.
    for (const object of this._objects.values()) {
      object.destroy();
    }

    this._labelRBush.clear();
    this._debugRBush.clear();
    this._avoided.clear();
    this._labeled.clear();
    this._labels.clear();
    this._objects.clear();
    this._boxes.clear();
    this._featureHasBoxes.clear();

    // Items in this layer don't actually need to be interactive
    const groupContainer = this.scene.groups.get('labels');
    groupContainer.eventMode = 'none';

    // Remove any existing containers
    for (const child of groupContainer.children) {
      groupContainer.removeChild(child);
      child.destroy({ children: true });  // recursive
    }

    // Add containers
    const labelOriginContainer = new PIXI.Container();
    labelOriginContainer.label= 'labelorigin';
    labelOriginContainer.eventMode = 'none';
    this.labelOriginContainer = labelOriginContainer;

    const debugContainer = new PIXI.Container();  //PIXI.ParticleContainer(50000);
    debugContainer.label = 'debug';
    debugContainer.eventMode = 'none';
    debugContainer.roundPixels = false;
    debugContainer.sortableChildren = false;
    this.debugContainer = debugContainer;

    const labelContainer = new PIXI.Container();
    labelContainer.label = 'labels';
    labelContainer.eventMode = 'none';
    labelContainer.sortableChildren = true;
    this.labelContainer = labelContainer;

    groupContainer.addChild(labelOriginContainer);
    labelOriginContainer.addChild(debugContainer, labelContainer);

    for (const feature of this.scene.features.values()) {
      feature._labelDirty = false;
    }
  }


  /**
   * resetFeature
   * Remove data from labeling caches for the given feature.
   * This will force the feature to be relabeled.
   * @param  {string}  featureID - The feature ID to reset
   */
  resetFeature(featureID) {
    this._avoided.delete(featureID);
    this._labeled.delete(featureID);

    const labelIDs = new Set();
    const objectIDs = new Set();

    // Gather `labelIDs` and `objectIDs` from the boxes
    // Then remove the boxes.
    const boxIDs = this._featureHasBoxes.get(featureID) || [];
    for (const boxID of boxIDs) {
      const box = this._boxes.get(boxID);
      if (box) {
        if (box.type === 'label' || box.type === 'avoid') {
          this._labelRBush.remove(box);
        }
        if (box.type === 'debug') {
          this._debugRBush.remove(box);
        }
        if (box.labelID) {
          labelIDs.add(box.labelID);
        }
        if (box.objectID)  {
          objectIDs.add(box.objectID);
        }
      }
      this._boxes.delete(boxID);
    }
    this._featureHasBoxes.delete(featureID);


    // Gather `objectIDs` from the labels.
    // Then remove the labels.
    for (const labelID of labelIDs) {
      const label = this._labels.get(labelID);
      if (label) {
        if (label.objectID) {
          objectIDs.add(label.objectID);
        }
      }
      this._labels.delete(labelID);
    }

    // Fianlly, remove Pixi Display Objects
    // (they automatically remove from parent containers)
    for (const objectID of objectIDs) {
      const object = this._objects.get(objectID);
      if (object) {
        object.destroy();
      }
      this._objects.delete(objectID);
    }
  }


  /**
   * render
   * Render all the labels. This is a multi-step process:
   * - gather avoids - these are places in the scene that we don't want a label
   * - label placement - do the math of figuring out where labels should be
   * - label rendering - show or hide labels based on their visibility
   *
   * @param  {number}    frame    -  Integer frame being rendered
   * @param  {Viewport}  viewport -  Pixi viewport to use for rendering
   * @param  {number}    zoom     -  Effective zoom level to use for rendering
   */
  render(frame, viewport, zoom) {
    if (!this.enabled || zoom < MINZOOM) {
      this.labelContainer.visible = false;
      this.debugContainer.visible = false;
      return;
    }

    // Reset labels
    const tPrev = this._tPrev;
    const tCurr = viewport.transform.props;
    if (tCurr.z !== tPrev.z || tCurr.r !== tPrev.r) {  // zoom or rotation changed
      this.reset();                                    // reset all labels
    } else {
      for (const [featureID, feature] of this.scene.features) {
        if (feature._labelDirty) {       // reset only the changed labels
          this.resetFeature(featureID);
          feature._labelDirty = false;
        }
      }
    }
    this._tPrev = tCurr;


    // The label container should be kept unrotated so that it stays screen-up not north-up.
    // We need to counter the effects of the 'stage' and 'origin' containers that we are underneath.
    const stage = this.gfx.stage.position;
    const origin = this.gfx.origin.position;
    const bearing = viewport.transform.rotation;

    // Determine the difference between the global/screen coordinate system (where [0,0] is top left)
    // and the `origin` coordinate system (which can be panned around or be under a rotation).
    // We need to save this labelOffset for use elsewhere, it is the basis for having a consistent coordinate
    // system to track labels to place and objects to avoid. (we apply it to values we get from `getBounds`)
    const labelOffset = this._labelOffset;
    this.gfx.origin.toGlobal({ x: 0, y: 0 }, labelOffset);

    const groupContainer = this.scene.groups.get('labels');
    groupContainer.position.set(-origin.x, -origin.y);     // undo origin - [0,0] is now center
    groupContainer.rotation = -bearing;                    // undo rotation

    const labelOriginContainer = this.labelOriginContainer;
    labelOriginContainer.position.set(-stage.x + labelOffset.x, -stage.y + labelOffset.y);  // replace origin

    // Collect features to avoid.
    this.gatherAvoids();

    // Collect features to place labels on.
    const points = [];
    const lines = [];
    const polygons = [];
    for (const [featureID, feature] of this.scene.features) {
      // If the feature can be labeled, and hasn't yet been, add it to the list for placement.
      if (feature.label && feature.visible && !this._labeled.has(featureID)) {
        if (feature.type === 'Point') {
          points.push(feature);
        } else if (feature.type === 'LineString') {
          lines.push(feature);
        } else if (feature.type === 'Polygon') {
          polygons.push(feature);
        }
      }
    }

    // Points first, then lines (so line labels can avoid point labels)
    this.labelPoints(points);
    this.labelLines(lines);
    this.labelPolygons(polygons);

    this.labelContainer.visible = true;
    this.renderObjects();

    const showDebug = this.context.getDebug('label');
    if (showDebug) {
      this.debugContainer.visible = true;
      this.renderDebug();
    } else {
      this.debugContainer.visible = false;
    }
  }


  /**
   * getLabelSprite
   * @param  {string}  str   - String for the label
   * @param  {string}  style - 'normal' or 'italic'
   */
  getLabelSprite(str, style = 'normal') {
    const textureID = `${str}-${style}`;
    const textureManager = this.gfx.textures;

    let texture = textureManager.getTexture('text', textureID);
    if (!texture) {
      // Add some extra padding if we detect unicode combining marks in the text - see Rapid#653
      let pad = 0;
      const marks = str.match(/\p{M}/gu);        // add /u to get a unicode-aware regex
      if (marks && marks.length > 0)  pad = 10;  // Text with a few ascenders/descenders?
      if (marks && marks.length > 20) pad = 50;  // Zalgotext?

      let textStyle;
      if (pad) {   // make a new style
        const opts = Object.assign({}, (style === 'normal' ? TEXTSTYLE_NORMAL : TEXTSTYLE_ITALIC), { padding: pad });
        textStyle = new PIXI.TextStyle(opts);
      } else {     // use a cached style
        textStyle = (style === 'normal' ? this._textStyleNormal : this._textStyleItalic);
      }

      texture = textureManager.textToTexture(textureID, str, textStyle);
      this._textureIDs.set(str, textureID);
    }

    const sprite = new PIXI.Sprite({ texture: texture });
    sprite.label = str;
    sprite.anchor.set(0.5, 0.5);   // middle, middle
    return sprite;
  }


  /**
   * gatherAvoids
   * Gather the avoidable features, create boxes for them,
   *  and insert them into the placement Rbush.
   * If a new avoidance collides with an already placed label,
   *  destroy the label and flag the feature as labeldirty for relabeling
   */
  gatherAvoids() {
    const showDebug = this.context.getDebug('label');

    // Gather the containers that have avoidable stuff on them.
    const avoidContainers = [];

    const selectedContainer = this.scene.layers.get('map-ui').selected;
    if (selectedContainer) {
      avoidContainers.push(selectedContainer);
    }
    const pointsContainer = this.scene.groups.get('points');
    if (pointsContainer) {
      avoidContainers.push(pointsContainer);
    }

    // For each container, gather the things to avoid.
    const avoidObject = _avoidObject.bind(this);
    const labelBoxes = [];
    const debugBoxes = [];
    for (const container of avoidContainers) {
      for (const child of container.children) {
        avoidObject(child);
      }
    }

    // Bulk insert any boxes we collected..
    if (labelBoxes.length) {
      this._labelRBush.load(labelBoxes);
    }
    if (showDebug && debugBoxes.length) {
      this._debugRBush.load(debugBoxes);
    }


    // Adds the given display object as an avoidance
    // @param {PIXI.Container}  sourceObject - a Pixi Display object
    function _avoidObject(sourceObject) {
      if (!sourceObject.visible || !sourceObject.renderable) return;
      const featureID = sourceObject.label;

      if (this._avoided.has(featureID)) return;  // we've processed this avoidance already
      this._avoided.add(featureID);

      // The rectangle is in global/screen coordinates (where [0,0] is top left).
      // To work in a coordinate system that is consistent, remove the label offset.
      // If we didn't do this, as the user pans or rotates the map, the objects that leave
      // and re-enter the scene would end up with different coordinates each time!
      const fRect = sourceObject.getBounds().rectangle;
      fRect.x -= this._labelOffset.x;
      fRect.y -= this._labelOffset.y;

      const EPSILON = 0.01;

      const avoidBox = {
        type: 'avoid',
        id: `${featureID}-avoid`,
        featureID: featureID,
        labelID: null,
        minX: fRect.x + EPSILON,
        minY: fRect.y + EPSILON,
        maxX: fRect.x + fRect.width - EPSILON,
        maxY: fRect.y + fRect.height - EPSILON
      };

      this._cacheBox(avoidBox);
      labelBoxes.push(avoidBox);

      if (showDebug) {
        const debugBox = {
          type: 'debug',
          id: avoidBox.id + '-debug',
          featureID: featureID,
          tint: 0xff0000,   // red (avoid)
          objectID: null,
          minX: avoidBox.minX,
          minY: avoidBox.minY,
          maxX: avoidBox.maxX,
          maxY: avoidBox.maxY
        };

        this._cacheBox(debugBox);
        debugBoxes.push(debugBox);
      }

      // If there is already a label where this avoid box is, we will need to redo that label.
      // This is somewhat common that a label will be placed somewhere, then as more map loads,
      // we learn that some of those junctions become important and we need to avoid them.
      const hits = this._labelRBush.search(avoidBox);
      for (const hit of hits) {
        if (hit.type === 'label' && hit.featureID) {
          this.resetFeature(hit.featureID);
        }
      }

    }
  }


  /**
   * _cacheBox
   * Add the given box to the caches.
   * The box should have `id` and `featureID` properties.
   * @param  {Object}  box - the box to cache
   */
  _cacheBox(box) {
    const boxID = box.id;
    const featureID = box.featureID;
    if (!boxID || !featureID) return;

    this._boxes.set(boxID, box);

    let featureBoxIDs = this._featureHasBoxes.get(featureID);
    if (!featureBoxIDs) {
      featureBoxIDs = new Set();
      this._featureHasBoxes.set(featureID, featureBoxIDs);
    }
    featureBoxIDs.add(boxID);
  }


  /**
   * labelPoints
   * This calculates the placement, but does not actually add the label to the scene.
   * @param {Array<PixiFeaturePoint>}  features - The features to place point labels on
   */
  labelPoints(features) {
    features.sort((a, b) => a.geom.screen.coords[1] - b.geom.screen.coords[1]);

    for (const feature of features) {
      const featureID = feature.id;

      if (this._labeled.has(featureID)) continue;  // processed it already
      this._labeled.add(featureID);

      if (!feature.label) continue;  // no label needed

      let labelObj;
      if (/^[\x20-\x7E]*$/.test(feature.label)) {   // is it in the printable ASCII range?
        labelObj = new PIXI.BitmapText({
          text: feature.label,
          style: {
            fontFamily: 'label-normal',
            fontSize: 12
          }
        });
        labelObj.label = feature.label;
        labelObj.anchor.set(0.5, 0.5);   // middle, middle

      } else {
        labelObj = this.getLabelSprite(feature.label, 'normal');
      }

      if (labelObj) {
        this.placeTextLabel(feature, labelObj);
      }
    }
  }


  /**
   * labelLines
   * Lines are labeled with `PIXI.SimpleRope` that run along the line.
   * This calculates the placement, but does not actually add the rope label to the scene.
   * @param  {Array<PixiFeatureLine>}  features - The features to place point labels on
   */
  labelLines(features) {
    // This is hacky, but we can sort the line labels by their parent container name.
    // It might be a level container with a name like "1", "-1", or just a name like "lines"
    // If `parseInt` fails, just sort the label above everything.
    function level(feature) {
      const lvl = parseInt(feature.container.parent.label, 10);
      return isNaN(lvl) ? 999 : lvl;
    }

    features.sort((a, b) => level(b) - level(a));

    for (const feature of features) {
      const featureID = feature.id;
      const screen = feature.geom.screen;

      if (this._labeled.has(featureID)) continue;  // processed it already
      this._labeled.add(featureID);

      if (!feature.label) continue;   // no label needed
      if (!screen.coords) continue;   // no points
      if (!feature.container.visible || !feature.container.renderable) continue; // not visible
      if (screen.width < 40 && screen.height < 40) continue;    // too small

      const labelObj = this.getLabelSprite(feature.label, 'normal');
      this.placeRopeLabel(feature, labelObj, screen.coords);
    }
  }


  /**
   * labelPolygons
   * Polygons are labeled with `PIXI.SimpleRope` that run along the inside of the perimeter.
   * This calculates the placement, but does not actually add the rope label to the scene.
   * @param  {Array<PixiFeaturePolygon>}  features - The features to place point labels on
   */
  labelPolygons(features) {
    for (const feature of features) {
      const featureID = feature.id;
      const screen = feature.geom.screen;

      if (this._labeled.has(featureID)) continue;  // processed it already
      this._labeled.add(featureID);

      if (!feature.label) continue;      // no label needed
      if (!screen.flatCoords) continue;  // no points
      if (!feature.container.visible || !feature.container.renderable) continue;  // not visible
      if (screen.width < 600 && screen.height < 600) continue;  // too small

      const labelObj = this.getLabelSprite(feature.label, 'italic');

      // someday: precompute line buffer in geometry class maybe?
      const hitStyle = {
        alignment: 0.5,  // middle of line
        color: 0x0,
        width: 24,
        alpha: 1.0,
        join: 'bevel',
        cap: 'butt'
      };
      const outerRing = screen.flatCoords[0];
      const bufferdata = lineToPoly(outerRing, hitStyle);
      if (!bufferdata.inner) continue;
      const coords = new Array(bufferdata.inner.length / 2);  // un-flatten :(
      for (let i = 0; i < bufferdata.inner.length / 2; ++i) {
        coords[i] = [ bufferdata.inner[(i * 2)], bufferdata.inner[(i * 2) + 1] ];
      }

      this.placeRopeLabel(feature, labelObj, coords);
    }
  }


  /**
   * placeTextLabel
   * Text labels are used to label point features like map pins.
   * We generate several placement regions around the marker,
   *  try them until we find one that doesn't collide with something.
   * @param  {AbstractPixiFeature}  feature  - The feature to place point labels on
   * @param  {*}                    labelObj - a PIXI.Sprite, PIXI.Text, or PIXI.BitmapText to use as the label
   */
  placeTextLabel(feature, labelObj) {
    if (!feature) return;

    const showDebug = this.context.getDebug('label');
    const featureID = feature.id;
    const container = feature.container;
    if (!container.visible || !container.renderable) return;

    // `f` - feature, these bounds are in "global" coordinates
    // The rectangle is in global/screen coordinates (where [0,0] is top left).
    // To work in a coordinate system that is consistent, remove the label offset.
    // If we didn't do this, as the user pans or rotates the map, the objects that leave
    // and re-enter the scene would end up with different coordinates each time!
    const fRect = container.getBounds().clone().pad(1, 0);
    fRect.x -= this._labelOffset.x;
    fRect.y -= this._labelOffset.y;

    const fLeft = fRect.x;
    const fTop = fRect.y;
    const fWidth = fRect.width;
    const fHeight = fRect.height;
    const fRight = fRect.x + fWidth;
    const fMidX = fRect.x + (fWidth * 0.5);
    const fBottom = fRect.y + fHeight;
    const fMidY = (feature.type === 'point') ? (fRect.y + fHeight - 14)  // next to marker
      : (fRect.y + (fHeight * 0.5));

    // `l` = label, these bounds are in "local" coordinates to the label,
    // 0,0 is the center of the label
    // (padY -1, because for some reason, calculated height seems higher than necessary)
    const lRect = labelObj.getLocalBounds().clone().pad(0, -1);
    const some = 5;
    const more = 10;
    const lWidth = lRect.width;
    const lHeight = lRect.height;
    const lWidthHalf = lWidth * 0.5;
    const lHeightHalf = lHeight * 0.5;

    // Attempt several placements (these are calculated in "global" coordinates)
    const placements = {
      t1: [fMidX - more,  fTop - lHeightHalf],       //    t1 t2 t3 t4 t5
      t2: [fMidX - some,  fTop - lHeightHalf],       //      +---+---+
      t3: [fMidX,         fTop - lHeightHalf],       //      |       |
      t4: [fMidX + some,  fTop - lHeightHalf],       //      |       |
      t5: [fMidX + more,  fTop - lHeightHalf],       //      +---+---+

      b1: [fMidX - more,  fBottom + lHeightHalf],    //      +---+---+
      b2: [fMidX - some,  fBottom + lHeightHalf],    //      |       |
      b3: [fMidX,         fBottom + lHeightHalf],    //      |       |
      b4: [fMidX + some,  fBottom + lHeightHalf],    //      +---+---+
      b5: [fMidX + more,  fBottom + lHeightHalf],    //    b1 b2 b3 b4 b5

      r1: [fRight + lWidthHalf,  fMidY - more],      //      +---+---+  r1
      r2: [fRight + lWidthHalf,  fMidY - some],      //      |       |  r2
      r3: [fRight + lWidthHalf,  fMidY],             //      |       |  r3
      r4: [fRight + lWidthHalf,  fMidY + some],      //      |       |  r4
      r5: [fRight + lWidthHalf,  fMidY + more],      //      +---+---+  r5

      l1: [fLeft - lWidthHalf,  fMidY - more],       //  l1  +---+---+
      l2: [fLeft - lWidthHalf,  fMidY - some],       //  l2  |       |
      l3: [fLeft - lWidthHalf,  fMidY],              //  l3  |       |
      l4: [fLeft - lWidthHalf,  fMidY + some],       //  l4  |       |
      l5: [fLeft - lWidthHalf,  fMidY + more]        //  l5  +---+---+
    };

    // In order of preference (If left-to-right language, prefer the right of the pin)
    // Prefer placements that are more "visually attached" to the pin (right,bottom,left,top)
    // over placements that are further away (corners)
    let attempts;
    const isRTL = this.context.systems.l10n.isRTL();

    if (isRTL) {   // right to left
      attempts = [
        'l3', 'l4', 'l2',
        'b3', 'b2', 'b4', 'b1', 'b5',
        't3', 't2', 't4', 't1', 't5',
        'r3', 'r4', 'r2',
        'l5', 'l1',
        'r5', 'r1'
      ];
    } else {   // left to right
      attempts = [
        'r3', 'r4', 'r2',
        'b3', 'b4', 'b2', 'b5', 'b1',
        'l3', 'l4', 'l2',
        't3', 't4', 't2', 't5', 't1',
        'r5', 'r1',
        'l5', 'l1'
      ];
    }

//    let picked = null;
    for (const placementID of attempts) {
      const [x, y] = placements[placementID];
      const EPSILON = 0.01;
      const labelBox = {
        type: 'label',
        id: `${featureID}-${placementID}`,
        featureID: featureID,
        labelID: featureID,
        minX: x - lWidthHalf + EPSILON,
        minY: y - lHeightHalf + EPSILON,
        maxX: x + lWidthHalf - EPSILON,
        maxY: y + lHeightHalf - EPSILON
      };

      // If we can render the label in this box..
      // Create a new Label placeholder, and insert the box
      // into the rbush so nothing else gets placed there.
      if (!this._labelRBush.collides(labelBox)) {
//        picked = placementID;
        const label = new Label(featureID, 'text', {
          str: feature.label,
          labelObj: labelObj,
          x: x,
          y: y,
          tint: feature.style.labelTint || 0xeeeeee
        });

        this._labels.set(featureID, label);

        this._cacheBox(labelBox);
        this._labelRBush.insert(labelBox);

        if (showDebug) {
          const debugBox = {
            type: 'debug',
            id: labelBox.id + '-debug',
            featureID: featureID,
            tint: 0x00ff00,   // green (ok)
            objectID: null,
            minX: labelBox.minX,
            minY: labelBox.minY,
            maxX: labelBox.maxX,
            maxY: labelBox.maxY
          };

          this._cacheBox(debugBox);
          this._debugRBush.insert(debugBox);
        }
        break;
      }
    }

//    if (!picked) {
//      labelObj.destroy();  // didn't place it
//    }
  }


  /**
   * placeRopeLabel
   * Rope labels are placed along a string of coordinates.
   * We generate chains of bounding boxes along the line,
   *  then add the labels in spaces along the line wherever they fit.
   * @param  {AbstractPixiFeature}  feature  - The feature to place rope labels on
   * @param  {PIXI.Sprite}          labelObj - A PIXI.Sprite to use as the label
   * @param  {Array<*>}             screenCoords - The coordinates to place a rope on (these are coords relative to 'origin' container)
   */
  placeRopeLabel(feature, labelObj, screenCoords) {
    if (!feature || !labelObj || !screenCoords) return;
    if (!feature.container.visible || !feature.container.renderable) return;

    const showDebug = this.context.getDebug('label');
    const featureID = feature.id;

    // `l` = label, these bounds are in "local" coordinates to the label,
    // 0,0 is the center of the label
    const lRect = labelObj.getLocalBounds();
    const lWidth = lRect.width;
    const lHeight = lRect.height;
    const BENDLIMIT = Math.PI / 8;

    // The size of the collision test bounding boxes, in pixels.
    // Higher numbers will be faster but yield less granular placement
    const boxsize = lHeight + 4;
    const boxhalf = boxsize * 0.5;

    // # of boxes needed to provide enough length for this label
    const numBoxes = Math.ceil(lWidth / boxsize) + 1;
    // Labels will be stretched across boxes slightly, this will scale them back to `lWidth` pixels
    const scaleX = lWidth / ((numBoxes-1) * boxsize);
    // We'll break long chains into smaller regions and center a label within each region
    const maxChainLength = numBoxes + 15;

    // Convert from screen coords to global coords..
    const origin = this.gfx.origin;
    const labelOffset = this._labelOffset;
    const temp = new PIXI.Point();
    const coords = screenCoords.map(([x, y]) => {
      origin.toGlobal({x: x, y: y}, temp);
      return [temp.x - labelOffset.x, temp.y - labelOffset.y];
    });

    // Cover the line in bounding boxes
    const segments = getLineSegments(coords, boxsize);

    const labelBoxes = [];
    const debugBoxes = [];
    const candidates = [];
    let currChain = [];
    let prevAngle = null;

    // Finish current chain of bounding boxes, if any.
    // It will be saved as a label candidate if it is long enough.
    // Each chain link has:  { box: box, coord: coord, angle: currAngle }
    function finishChain() {
      const isCandidate = (currChain.length >= numBoxes);
      if (isCandidate) {
        candidates.push(currChain);
      } else {  // too short to be a candidate
        for (const link of currChain) {
          link.debugBox.tint = 0xffff33;  // yellow (too small)
        }
      }
      currChain = [];   // reset chain
    }


    // Walk the line, creating chains of bounding boxes,
    // and testing for candidate chains where labels can go.
    segments.forEach((segment, segmentIndex) => {
      const currAngle = numWrap(segment.angle, 0, TAU);  // normalize to 0…2π

      segment.coords.forEach((coord, coordIndex) => {
        const [x, y] = coord;
        const EPSILON = 0.01;
        const labelBox = {
          type: 'label',
          id: `${featureID}-${segmentIndex}-${coordIndex}`,
          featureID: featureID,
          labelID: null,   // will be assigned below if this spot gets a label
          minX: x - boxhalf + EPSILON,
          minY: y - boxhalf + EPSILON,
          maxX: x + boxhalf - EPSILON,
          maxY: y + boxhalf - EPSILON
        };

        const debugBox = {
          type: 'debug',
          id: labelBox.id + '-debug',
          featureID: featureID,
          tint: 0x00ff00,   // may be changed below
          objectID: null,
          minX: labelBox.minX,
          minY: labelBox.minY,
          maxX: labelBox.maxX,
          maxY: labelBox.maxY
        };

        // Avoid placing labels where the line bends too much..
        let tooBendy = false;
        if (prevAngle !== null) {
          // compare angles properly: https://stackoverflow.com/a/1878936/7620
          const diff = Math.abs(currAngle - prevAngle);
          tooBendy = Math.min(TAU - diff, diff) > BENDLIMIT;
        }
        prevAngle = currAngle;

        if (tooBendy) {
          finishChain();
          debugBox.tint = 0xff33ff;  // magenta (too bendy)

        } else if (this._labelRBush.collides(labelBox)) {
          finishChain();
          debugBox.tint = 0xff0000;  // red (collision)

        } else {   // Label can go here..
          debugBox.tint = 0x00ff00;  // green (ok)
          currChain.push({
            labelBox: labelBox,
            debugBox: debugBox,
            coord: coord,
            angle: currAngle
          });
          if (currChain.length === maxChainLength) {
            finishChain();
          }
        }

        if (showDebug) {
          this._cacheBox(debugBox);
          debugBoxes.push(debugBox);
        }
      });
    });

    finishChain();


    // Compute a Label placement in the middle of each chain,
    // and insert the boxes into the rbush so nothing else gets placed there.
    candidates.forEach((chain, chainIndex) => {
      // Set aside half any extra boxes at the beginning of the chain
      // (This centers the label within the chain)
      const startIndex = Math.floor((chain.length - numBoxes) / 2);
      const labelID = `${featureID}-rope-${chainIndex}`;

      let coords = [];
      for (let i = startIndex; i < startIndex + numBoxes; i++) {
        coords.push(chain[i].coord);
        const labelBox = chain[i].labelBox;
        labelBox.labelID = labelID;
        this._cacheBox(labelBox);
        labelBoxes.push(labelBox);
      }

      if (!coords.length) return;  // shouldn't happen, min numBoxes is 2 boxes

      const sum = coords.reduce((acc, coord) => vecAdd(acc, coord), [0,0]);
      const origin = vecScale(sum, 1 / coords.length);  // pick local origin as the average of the points
      let angle = vecAngle(coords.at(0), coords.at(-1));
      angle = numWrap(angle, 0, TAU);  // angle from x-axis, normalize to 0…2π
      if (angle > HALF_PI && angle < (3 * HALF_PI)) {  // rope is upside down, flip it
        angle -= Math.PI;
        coords.reverse();
      }

      // The `coords` array follows our bounding box chain, however it will be a little
      // longer than the label needs to be, which can cause stretching of small labels.
      // Here we will scale the points down to the desired label width.
      coords = coords.map(coord => vecSubtract(coord, origin));  // to local coords
      coords = geomRotatePoints(coords, -angle, [0,0]);          // rotate to x axis
      coords = coords.map(([x,y]) => [x * scaleX, y]);           // apply `scaleX`
      coords = geomRotatePoints(coords, angle, [0,0]);           // rotate back
      coords = coords.map(coord => vecAdd(coord, origin));       // back to global coords

      const label = new Label(labelID, 'rope', {
        str: feature.label,
        coords: coords,
        labelObj: labelObj,
        tint: feature.style.labelTint || 0xeeeeee
      });
      this._labels.set(labelID, label);
    });

    // Bulk insert any boxes we collected..
    if (labelBoxes.length) {
      this._labelRBush.load(labelBoxes);
    }
    if (showDebug && debugBoxes.length) {
      this._debugRBush.load(debugBoxes);
    }

    // we can destroy the sprite now, it's texture will remain on the rope?
    // sprite.destroy();
  }


  /**
   * renderObjects
   * This renders any of the Label objects in the view
   */
  renderObjects() {
    // Get the display bounds in screen/global coordinates
    const screen = this.gfx.pixi.screen;
    const labelOffset = this._labelOffset;
    const screenBounds = {
      minX: screen.x - labelOffset.x,
      minY: screen.y - labelOffset.y,
      maxX: screen.width - labelOffset.x,
      maxY: screen.height - labelOffset.y
    };

    // Collect Labels in view
    const labelIDs = new Set();
    const seenTextures = new Set();
    const hits = this._labelRBush.search(screenBounds);
    for (const box of hits) {
      if (box.labelID) {
        labelIDs.add(box.labelID);
      }
    }

    // Create and add Labels to the scene, if needed
    for (const labelID of labelIDs) {
      const label = this._labels.get(labelID);
      if (!label) continue;         // unknown labelID - shouldn't happen?

      const props = label.props;
      seenTextures.add(props.str);

      if (label.objectID) continue;   // The label was created already
      const objectID = labelID;

      if (label.type === 'text') {
        const labelObj = props.labelObj;  // a PIXI.Sprite, PIXI.Text, or PIXI.BitmapText
        labelObj.tint = props.tint || 0xffffff;
        labelObj.position.set(props.x, props.y);

        this._objects.set(objectID, labelObj);
        label.objectID = objectID;
        this.labelContainer.addChild(labelObj);

      } else if (label.type === 'rope') {
        const labelObj = props.labelObj;  // a PIXI.Sprite, or PIXI.Text
        const points = props.coords.map(([x,y]) => new PIXI.Point(x, y));
        const rope = new PIXI.MeshRope({ texture: labelObj.texture, points: points });
        rope.label = labelID;
        rope.autoUpdate = false;
        rope.sortableChildren = false;
        rope.tint = props.tint || 0xffffff;

        this._objects.set(objectID, rope);
        label.objectID = objectID;
        this.labelContainer.addChild(rope);
      }
    }

    // Cleanup label textures not visible in the scene anymore.
    // (Otherwise the text atlas will just keep growing)
    const textureManager = this.gfx.textures;
    for (const [str, textureID] of this._textureIDs) {
      if (!seenTextures.has(str)) {
        textureManager.free('text', textureID);
        this._textureIDs.delete(str);
      }
    }
  }


  /**
   * renderDebug
   * This renders any of the debug sprites in the view
   */
  renderDebug() {
    // Get the display bounds in screen/global coordinates
    const screen = this.gfx.pixi.screen;
    const labelOffset = this._labelOffset;
    const screenBounds = {
      minX: screen.x - labelOffset.x,
      minY: screen.y - labelOffset.y,
      maxX: screen.width - labelOffset.x,
      maxY: screen.height - labelOffset.y
    };

    // Create and add debug boxes to the scene, if needed
    const boxes = this._debugRBush.search(screenBounds);
    for (const box of boxes) {
      if (!box.objectID) {
        const tint = box.tint ?? 0xffffff;
        const objectID = box.id;
        const sprite = getDebugBBox(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY, tint, 0.65, objectID);

        this._objects.set(objectID, sprite);
        box.objectID = objectID;
        this.debugContainer.addChild(sprite);
      }
    }
  }

}
