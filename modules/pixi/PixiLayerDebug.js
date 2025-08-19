import { AbstractPixiLayer } from './AbstractPixiLayer.js';
import { PixiFeaturePoint } from './PixiFeaturePoint.js';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.js';


/**
 * PixiLayerDebug
 * @class
 */
export class PixiLayerDebug extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  {PixiScene}  scene - The Scene that owns this Layer
   */
  constructor(scene) {
    super(scene);
    this.id = 'debug';
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
   * @param  {number}    zoom     -  Effective zoom level to use for rendering
   */
  render(frame, viewport, zoom) {
    if (!this.enabled) return;

    function _isBuilding(entity) {
      return entity.type === 'way' && (!!entity.tags.building && entity.tags.building !== 'no');
    }

    const context = this.context;
    const spatial = context.systems.spatial;

    const DEFAULTSTYLE = {
      requireFill: true,     // disable partial filling effect
      fill:   { width: 1, color: 0xffff00, alpha: 0.5 },
      casing: { alpha: 0 },  // disable
      stroke: { alpha: 0 }   // disable
    };
    const POISTYLE = {
      markerName: 'smallCircle',
      markerTint: 0xffff00,
    };


    const parentContainer = this.scene.groups.get('debug-under');
    const msData = spatial.getVisibleData('msBuildings').filter(d => _isBuilding(d.data));

    for (const hit of msData) {
      if (!spatial.hasTileAtBox('osm', hit)) continue;  // is osm data loaded here?

      const data = hit.data;
      // if (data.type !== 'way') continue;  // consider ways only (not the nodes at the corners)

      const dataID = data.id;
      const version = data.v || 0;
      const parts = data.geoms.parts;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part.world) continue;  // invalid?

        const extent = part.world.extent;
        const poi = part.world.poi;  // Pole of Inaccessability
        const outer = extent.polygon();

        // bounding box
        const featureID = `${this.layerID}-${dataID}-${i}`;
        let feature = this.features.get(featureID);
        if (!feature) {
          feature = new PixiFeaturePolygon(this, featureID);
          feature.allowInteraction = false;
          feature.parentContainer = parentContainer;

          feature.v = version;
          const source = { type: 'Polygon', world: { extent: extent, coords: [ outer ] } };
          feature.setCoords(source);

          // Start with default style, and apply adjustments
          // set style = red if collides, green if not
          const style = Object.assign({}, DEFAULTSTYLE);
          const box = { minX: poi[0], minY: poi[1], maxX: poi[0], maxY: poi[1] };
          // does this test point hit an OSM building?
          const didHitBuilding = spatial.getDataAtBox('osm', box).some(result => _isBuilding(result.data));

          if (didHitBuilding) {
            // console.log(`${dataID} id hit osm building ${didHitBuilding.data.id}`);
            style.fill.color = 0xff0000;  // red
          } else {
            style.fill.color = 0x00ff00;  // green
          }
          feature.style = style;
        }

        // this.syncFeatureClasses(feature);
        feature.update(viewport, zoom);
        this.retainFeature(feature, frame);

        // visualize test point
        const poifeatureID = `${this.layerID}-${dataID}-${i}-poi`;
        let poifeature = this.features.get(poifeatureID);
        if (!poifeature) {
          poifeature = new PixiFeaturePoint(this, poifeatureID);
          poifeature.allowInteraction = false;
          poifeature.parentContainer = parentContainer;

          poifeature.v = version;
          const source = { type: 'Point', world: { coords: poi } };
          poifeature.setCoords(source);
          poifeature.style = POISTYLE;
        }

        // this.syncFeatureClasses(poifeature);
        poifeature.update(viewport, zoom);
        this.retainFeature(poifeature, frame);
      }

    }
  }

}
