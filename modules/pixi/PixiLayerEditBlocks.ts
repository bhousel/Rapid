import type { Viewport } from '@rapid-sdk/math';

import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.ts';

import type { D3Selection, D3EnterSelection } from 'd3-selection';
import type { GeoJSON } from '../data/GeoJSON.ts';
import type { PixiScene } from './PixiScene.ts';

const MINZOOM = 4;


/**
 * PixiLayerEditBlocks
 * @class
 */
export class PixiLayerEditBlocks extends AbstractPixiLayer {

  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  constructor(scene: PixiScene) {
    super(scene);
    this.id = 'edit-blocks';
    this.enabled = true;   // this layer should always be enabled
  }


  /**
   * enabled
   * This layer should always be enabled
   */
  get enabled(): boolean {
    return true;
  }
  set enabled(val: boolean) {
    this._enabled = true;
  }


  /**
   * reset
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset(): void {
    super.reset();
  }


  /**
   * render
   * Render any edit blocking polygons that are visible in the viewport
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param _zoom - Effective zoom level (unused, we use real zoom from context viewport)
   */
  render(frame: number, viewport: Viewport, _zoom: number): void {
    const context = this.context;
    const l10n = context.systems.l10n;
    const locations = context.systems.locations;
    const mapViewport = context.viewport;  // context viewport !== pixi viewport (they are offset)
    const zoom = mapViewport.transform.zoom;   // use real zoom for this, not "effective" zoom

    if (!locations) return;   // Need a LocationSystem for this to work.

    let blocks: GeoJSON[] = [];
    if (zoom >= MINZOOM) {
      blocks = locations.getBlocks(mapViewport.visibleExtent());
      this.renderEditBlocks(frame, viewport, zoom, blocks);
    }

    // setup the explanation
    // add a special 'api-status' line to the map footer explain the block
    const $explanationRow: D3Selection = context.container().select('.main-content > .map-footer')
      .selectAll('.api-status.blocks')
      .data(blocks, (d: GeoJSON) => d.id);

    $explanationRow.exit()
      .remove();

    // enter
    const $$explanationRow: D3EnterSelection = $explanationRow.enter()
      .insert('div', '.api-status')   // before any existing
      .attr('class', 'api-status blocks error');

    $$explanationRow
      .append('span')
      .attr('class', 'explanation-item')
      .text((d: GeoJSON) => d.properties.text as string);

    $$explanationRow
      .append('a')
      .attr('target', '_blank')
      .attr('href', (d: GeoJSON) => d.properties.url as string)
      .text(l10n?.t('rapid_menu.more_info') || 'More Info');
  }


  /**
   * renderEditBlocks
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom to use for rendering
   * @param blocks - Array of block data visible in the view
   */
  renderEditBlocks(frame: number, viewport: Viewport, zoom: number, blocks: GeoJSON[]): void {
    const parentContainer = this.scene.groups.get('blocks')!;
    if (!parentContainer) return;

    const blockStyle = {
      requireFill: true,    // no partial fill option - must fill fully
      fill: { pattern: 'construction', color: 0x000001, alpha: 0.7 }
    };

    for (const d of blocks) {
      const dataID = d.id;
      const parts = d.geoms.parts;

      for (let i = 0; i < parts.length; ++i) {
        // Check that this part has coordinates and is a Polygon
        const part = parts[i];
        if (!part.world || part.type !== 'Polygon') continue;

        const featureID = `${this.layerID}-${dataID}-${i}`;
        let feature = this.features.get(featureID);

        if (!feature) {
          feature = new PixiFeaturePolygon(this, featureID);
          feature.style = blockStyle;
          feature.parentContainer = parentContainer;
          feature.container.cursor = 'not-allowed';
          feature.setCoords(part);
          feature.setData(dataID, d);
        }

        this.syncFeatureClasses(feature);
        feature.update(viewport, zoom);
        this.retainFeature(feature, frame);
      }
    }
  }
}
