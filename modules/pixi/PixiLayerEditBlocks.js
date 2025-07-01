import { AbstractPixiLayer } from './AbstractPixiLayer.js';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.js';

const MINZOOM = 4;


/**
 * PixiLayerEditBlocks
 * @class
 */
export class PixiLayerEditBlocks extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  scene    The Scene that owns this Layer
   * @param  layerID  Unique string to use for the name of this Layer
   */
  constructor(scene, layerID) {
    super(scene, layerID);
    this.enabled = true;   // this layer should always be enabled
  }


  /**
   * enabled
   * This layer should always be enabled
   */
  get enabled() {
    return true;
  }
  set enabled(val) {
    this._enabled = true;
  }


  /**
   * reset
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset() {
    super.reset();
  }


  /**
   * render
   * Render any edit blocking polygons that are visible in the viewport
   * @param  {number}    frame    - Integer frame being rendered
   * @param  {Viewport}  viewport - Pixi viewport to use for rendering
   * @param  {number}    zoom     - Effective zoom to use for rendering
   */
  render(frame, viewport) {
    const context = this.context;
    const l10n = context.systems.l10n;
    const locations = context.systems.locations;
    const mapViewport = context.viewport;  // context viewport !== pixi viewport (they are offset)
    const zoom = mapViewport.transform.zoom;   // use real zoom for this, not "effective" zoom

    let blocks = [];
    if (zoom >= MINZOOM) {
      blocks = locations.getBlocks(mapViewport.visibleExtent());
      this.renderEditBlocks(frame, viewport, zoom, blocks);
    }

    // setup the explanation
    // add a special 'api-status' line to the map footer explain the block
    let $explanationRow = context.container().select('.main-content > .map-footer')
      .selectAll('.api-status.blocks')
      .data(blocks, d => d.id);

    $explanationRow.exit()
      .remove();

    // enter
    const $$explanationRow = $explanationRow.enter()
      .insert('div', '.api-status')   // before any existing
      .attr('class', 'api-status blocks error');

    $$explanationRow
      .append('span')
      .attr('class', 'explanation-item')
      .text(d => d.props.text);

    $$explanationRow
      .append('a')
      .attr('target', '_blank')
      .attr('href', d => d.props.url)
      .text(l10n.t('rapid_menu.more_info'));
  }


  /**
   * renderEditBlocks
   * @param  {number}          frame    -  Integer frame being rendered
   * @param  {Viewport}        viewport -  Pixi viewport to use for rendering
   * @param  {number}          zoom     -  Effective zoom to use for rendering
   * @param  {Array<GeoJSON>}  blocks   -  Array of block data visible in the view
   */
  renderEditBlocks(frame, viewport, zoom, blocks) {
    const parentContainer = this.scene.groups.get('blocks');
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
