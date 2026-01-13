import type { Viewport } from '@rapid-sdk/math';

import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.ts';

import type { PixiScene } from './PixiScene.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { GeometryPart } from '../lib/GeometryPart.ts';

/**
 * PixiLayerDebug
 * @class
 */
export class PixiLayerDebug extends AbstractPixiLayer {

  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  constructor(scene: PixiScene) {
    super(scene);
    this.id = 'debug';
    this.enabled = false;
  }


  /**
   * reset
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset(): void {
    super.reset();

    // Items in this layer don't actually need to be interactive
    const groupContainer = this.scene.groups.get('debug-under');
    groupContainer.eventMode = 'none';
  }


  /**
   * render
   * Render any data we have for this layer
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom level to use for rendering
   */
  render(frame: number, viewport: Viewport, zoom: number): void {
    if (!this.enabled) return;

    function _isBuilding(entity: OsmEntity): boolean {
      return entity.type === 'way' && (!!entity.tags.building && entity.tags.building !== 'no');
    }

    const context = this.context;
    const spatial = context.systems.spatial!;

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
    const msData = spatial.getVisibleData('msBuildings').filter((d: any) => _isBuilding(d.data));

    for (const hit of msData) {
      if (!spatial.hasTileAtBox('osm', hit)) continue;  // is osm data loaded here?

      const data = hit.data as OsmEntity;
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
        if (poi && !feature) {
          feature = new PixiFeaturePolygon(this, featureID);
          feature.allowInteraction = false;
          feature.parentContainer = parentContainer;

          feature.v = version;
          const source = { type: 'Polygon', world: { extent: extent, coords: [ outer ] } };
          feature.setCoords(source as GeometryPart);

          // Start with default style, and apply adjustments
          // set style = red if collides, green if not
          const style = Object.assign({}, DEFAULTSTYLE);
          const box = { minX: poi![0], minY: poi![1], maxX: poi![0], maxY: poi![1] };
          // does this test point hit an OSM building?
          const didHitBuilding = spatial.getDataAtBox('osm', box).some((result: any) => _isBuilding(result.data));

          if (didHitBuilding) {
            // console.log(`${dataID} id hit osm building ${didHitBuilding.data.id}`);
            style.fill.color = 0xff0000;  // red
          } else {
            style.fill.color = 0x00ff00;  // green
          }
          feature.style = style;
        }

        if (feature) {
          // this.syncFeatureClasses(feature);
          feature.update(viewport, zoom);
          this.retainFeature(feature, frame);
        }

        // visualize test point
        if (poi) {
          const poifeatureID = `${this.layerID}-${dataID}-${i}-poi`;
          let poifeature = this.features.get(poifeatureID);
          if (!poifeature) {
            poifeature = new PixiFeaturePoint(this, poifeatureID);
            poifeature.allowInteraction = false;
            poifeature.parentContainer = parentContainer;

            poifeature.v = version;
            const source = { type: 'Point', world: { coords: poi } };
            poifeature.setCoords(source as GeometryPart);
            poifeature.style = POISTYLE;
          }

          // this.syncFeatureClasses(poifeature);
          poifeature.update(viewport, zoom);
          this.retainFeature(poifeature, frame);
        }
      }

    }
  }

}
