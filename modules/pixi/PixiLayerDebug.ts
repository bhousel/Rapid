import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { GeometryPart } from '../lib/GeometryPart.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.ts';

import type { OsmEntity } from '../data/OsmEntity.ts';
import type { PixiScene } from './PixiScene.ts';
import type { StyleProps } from '../lib/Style.ts';
import type { Viewport } from '@rapid-sdk/math';


/**
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
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset(): void {
    super.reset();

    // Items in this layer don't actually need to be interactive
    const groupContainer = this.scene.groups.get('debug-under')!;
    groupContainer.eventMode = 'none';
  }


  /**
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
      fill: { color: 0xffff00, opacity: 0.5, width: 1, type: 'full' },  // always fill fully
      casing: { opacity: 0 },  // disable
      stroke: { opacity: 0 }   // disable
    } as Partial<StyleProps>;

    const POISTYLE = {
      marker: { color: 0xffff00, image: 'smallCircle' }
    } as Partial<StyleProps>;


    const parentContainer = this.scene.groups.get('debug-under')!;

    // Gather visible Microsoft Buildings
    const msData = spatial.getVisibleData('msBuildings').filter(hit => _isBuilding(hit.contents as OsmEntity));
    for (const hit of msData) {
      if (!spatial.hasTileAtBox('osm-data', hit)) continue;  // Is osm data loaded here?

      const data = hit.contents as OsmEntity;
      // if (data.type !== 'way') continue;  // consider ways only (not the nodes at the corners)

      const dataID = data.id;
      const version = data.v || 0;
      const parts = data.geoms.parts;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part.orig || !part.world) continue;  // invalid?

        const origExtent = part.orig.extent;
        const worldPoi = part.world?.poi;  // Pole of Inaccessability (world coordinates for rbush query)

        // bounding box
        const bboxFeatureID = `${this.layerID}-${dataID}-${i}`;
        let bboxFeature = this.features.get(bboxFeatureID);
        if (worldPoi && !bboxFeature) {
          bboxFeature = new PixiFeaturePolygon(this, bboxFeatureID);
          bboxFeature.allowInteraction = false;
          bboxFeature.parentContainer = parentContainer;
          bboxFeature.v = version;

          const bboxGeometry = new GeometryPart(context);
          bboxGeometry.setData({ type: 'Polygon', coordinates: [origExtent.polygon()] });
          bboxFeature.geometry = bboxGeometry;

          // Start with default style, and apply adjustments
          // set style = red if collides, green if not
          const style = structuredClone(DEFAULTSTYLE);
          const box = { minX: worldPoi![0], minY: worldPoi![1], maxX: worldPoi![0], maxY: worldPoi![1] };
          // does this test point hit an OSM building?
          const didHitBuilding = spatial.getDataAtBox('osm', box).some(hit => _isBuilding(hit.contents as OsmEntity));

          if (didHitBuilding) {
            // console.log(`${dataID} id hit osm building ${didHitBuilding.contents.id}`);
            style.fill!.color = 0xff0000;  // red
          } else {
            style.fill!.color = 0x00ff00;  // green
          }
          bboxFeature.style = style;
        }

        if (bboxFeature) {
          // this.syncFeatureClasses(feature);
          bboxFeature.update(viewport, zoom);
          this.retainFeature(bboxFeature, frame);
        }

        // visualize test point
        if (worldPoi) {
          const origPoi = viewport.worldToWgs84(worldPoi);

          const poiFeatureID = `${this.layerID}-${dataID}-${i}-poi`;
          let poiFeature = this.features.get(poiFeatureID);
          if (!poiFeature) {
            poiFeature = new PixiFeaturePoint(this, poiFeatureID);
            poiFeature.allowInteraction = false;
            poiFeature.parentContainer = parentContainer;
            poiFeature.v = version;

            const poiGeometry = new GeometryPart(context);
            poiGeometry.setData({ type: 'Point', coordinates: origPoi });
            poiFeature.geometry = poiGeometry;

            poiFeature.style = POISTYLE;
          }

          // this.syncFeatureClasses(poifeature);
          poiFeature.update(viewport, zoom);
          this.retainFeature(poiFeature, frame);
        }
      }

    }
  }

}
