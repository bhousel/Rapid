import { AbstractPixiLayer } from './AbstractPixiLayer.js';
import { PixiFeaturePoint } from './PixiFeaturePoint.js';

const MINZOOM = 12;


/**
 * PixiLayerOsmNotes
 * @class
 */
export class PixiLayerOsmNotes extends AbstractPixiLayer {

  /**
   * @constructor
   * @param  {PixiScene}  scene - The Scene that owns this Layer
   */
  constructor(scene) {
    super(scene);
    this.id = 'notes';
  }


  /**
   * supported
   * Whether the Layer's service exists
   */
  get supported() {
    return !!this.context.services.osm;
  }


  /**
   * enabled
   * Whether the user has chosen to see the Layer
   * Make sure to start the service first.
   */
  get enabled() {
    return this._enabled;
  }
  set enabled(val) {
    if (!this.supported) {
      val = false;
    }

    if (val === this._enabled) return;  // no change
    this._enabled = val;

    const context = this.context;
    const gfx = context.systems.gfx;
    const osm = context.services.osm;
    if (val && osm) {
      osm.startAsync()
        .then(() => gfx.immediateRedraw());
    }
  }


  /**
   * reset
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset() {
    super.reset();
  }


  /**
   * renderMarkers
   * @param  {number}    frame    -  Integer frame being rendered
   * @param  {Viewport}  viewport -  Pixi viewport to use for rendering
   * @param  {number}    zoom     -  Effective zoom level to use for rendering
   */
  renderMarkers(frame, viewport, zoom) {
    const osm = this.context.services.osm;
    if (!osm?.started) return;

    const parentContainer = this.scene.groups.get('qa');
    const notes = osm.getNotes();

    for (const d of notes) {
      const dataID = d.id;
      const version = d.v || 0;
      const part = d.geoms.parts[0];
      if (!part?.world || part?.type !== 'Point') continue;

      const featureID = `${this.layerID}-${dataID}`;
      let feature = this.features.get(featureID);

      // Create feature if necessary..
      if (!feature) {
        feature = new PixiFeaturePoint(this, featureID);
        feature.parentContainer = parentContainer;
      }

      // If data has changed, replace it..
      if (feature.v !== version) {
        feature.v = version;
        feature.setCoords(part);
        feature.setData(dataID, d);
      }

      this.syncFeatureClasses(feature);

      if (feature.dirty) {
        let color = 0xff3300;  // open (red)
        let iconName = 'rapid-icon-close';
        if (d.props.status === 'closed') {
          color = 0x55dd00;  // closed (green)
          iconName = 'rapid-icon-apply';
        }
        if (d.isNew) {
          color = 0xffee00;  // new (yellow)
          iconName = 'rapid-icon-plus';
        }

        const style = {
          markerName: 'osmnote',
          markerTint: color,
          iconName: iconName,
          // override 'y' for better centering within the note balloon
          anchor: { y: 0.65 }
        };

        feature.style = style;
      }

      feature.update(viewport, zoom);
      this.retainFeature(feature, frame);
    }
  }


  /**
   * render
   * Render any data we have, and schedule fetching more of it to cover the view
   * @param  {number}    frame    -  Integer frame being rendered
   * @param  {Viewport}  viewport -  Pixi viewport to use for rendering
   * @param  {number}    zoom     -  Effective zoom level to use for rendering
   */
  render(frame, viewport, zoom) {
    const osm = this.context.services.osm;
    if (!this.enabled || !osm?.started || zoom < MINZOOM) return;

    osm.loadNotes(this.context.viewport);  // note: context.viewport !== pixi viewport
    this.renderMarkers(frame, viewport, zoom);
  }

}

