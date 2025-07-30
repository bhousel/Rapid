import { AbstractPixiLayer } from './AbstractPixiLayer.js';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.js';


/**
 * PixiLayerDebug
 * @class
 */
export class PixiLayerDebug extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  scene    The Scene that owns this Layer
   * @param  layerID  Unique string to use for the name of this Layer
   */
  constructor(scene, layerID) {
    super(scene, layerID);
    this.enabled = false;
  }


  /**
   * reset
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset() {
    super.reset();

    // Items in this layer don't actually need to be interactive
    const groupContainer = this.scene.groups.get('debug-under');
    groupContainer.eventMode = 'none';
  }


  /**
   * render
   * Render any data we have for this layer
   * @param  {number}    frame    -  Integer frame being rendered
   * @param  {Viewport}  viewport -  Pixi viewport to use for rendering
   * @param  {number}    zoom     -  Effective zoom to use for rendering
   */
  render(frame, viewport, zoom) {
    if (!this.enabled) return;

    const context = this.context;
    const spatial = context.systems.spatial;

    const parentContainer = this.scene.groups.get('debug-under');
    const data = [];  //spatial.getData();

    const style = {
      requireFill: true,     // disable partial filling effect
      fill:   { width: 1, color: 0xffff00, alpha: 0.3 },
      casing: { alpha: 0 },  // disable
      stroke: { alpha: 0 }   // disable
    };

    for (const d of data) {
      const dataID = d.id;
      const part = d.geoms.parts[0];
      if (!part?.world || part?.type !== 'Polygon') continue;

      const featureID = `${this.layerID}-${dataID}`;
      let feature = this.features.get(featureID);

      if (!feature) {
        feature = new PixiFeaturePolygon(this, featureID);
        feature.allowInteraction = false;
        feature.style = style;
        feature.parentContainer = parentContainer;
        feature.setCoords(part);
        feature.setData(dataID, d);
      }

      // this.syncFeatureClasses(feature);
      feature.update(viewport, zoom);
      this.retainFeature(feature, frame);
    }
  }

}
