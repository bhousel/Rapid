import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from './AbstractPixiLayer.ts';

import type { Viewport } from '@rapid-sdk/math';
import type { PixiScene } from './PixiScene.ts';


/**
 * This class contains any overlay vectors that should be 'drawn over' the map, usually at low zooms.
 * The data for these are scraped from the RapidSystem's datasets, specifically the 'overlay' field.
 * @class
 */
export class PixiLayerRapidOverlay extends AbstractPixiLayer {
  /** Whether overlays have been defined for the current dataset set (null = not yet checked) */
  protected _overlaysDefined: boolean | null;
  /** The Pixi container holding all overlay feature containers */
  public overlaysContainer: PIXI.Container | null;

  /**
   * @constructor
   * @param  scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'rapidoverlay';

    this._enabled = true;
    this._overlaysDefined = null;
    this.overlaysContainer = null;
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  public reset(): void {
    super.reset();

    const groupContainer = this.scene.groups.get('basemap')!;

    // Remove any existing containers
    for (const child of groupContainer.children) {
      if (child.label === this.layerID) {   // 'rapidoverlay'
        groupContainer.removeChild(child);
        child.destroy({ children: true });  // recursive
      }
    }

    // Add containers
    const overlays = new PIXI.Container();
    overlays.label = `${this.layerID}`;  // 'rapidoverlay'
    overlays.sortableChildren = false;
    overlays.interactiveChildren = true;
    this.overlaysContainer = overlays;
    this._overlaysDefined = null;

    groupContainer.addChild(overlays);
  }


  /**
   * Render the GeoJSON custom data
   * @param  frame    -  Integer frame being rendered
   * @param  viewport -  Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
return; // not yet
    if (!this.enabled || !(this.hasData())) return;

    const vtService = this.context.services.vectortile;
    const rapid = this.context.systems.rapid!;
    const datasets = rapid.datasets;
    const parentContainer = this.overlaysContainer!;
    const viewZoom = viewport.transform.zoom;

    // Extremely inefficient but we're not drawing anything else at this zoom
    parentContainer.removeChildren();

    for (const dataset of datasets.values()) {
      if (dataset.overlay && dataset.enabled) {
        const customColor = new PIXI.Color(dataset.color);
        const overlay = dataset.overlay as any;  // this code is dead (see return above), overlay type may change
        if (vtService) {
          if ((viewZoom >= overlay.minZoom ) && (viewZoom <= overlay.maxZoom)) {  // avoid firing off too many API requests
            vtService!.loadTiles(overlay.url);
          }
          const overlayData = vtService!.getData(overlay.url).map((d: any) => d.geojson);
          const points = overlayData.filter((d: any) => d.geometry.type === 'Point' || d.geometry.type === 'MultiPoint');
          this.renderPoints(frame, viewport, points, customColor);
        }
      }
    }
  }


  /**
   * Renders the Rapid overlay point features for this frame.
   * @param  frame    -  Integer frame being rendered
   * @param  viewport -  Pixi viewport to use for rendering
   * @param  points   -  Array of feature data
   * @param  color    -  The color to use
   */
  public renderPoints(frame: number, viewport: Viewport, points: any[], color: PIXI.Color): void {
    const parentContainer = this.overlaysContainer!;
    for (const d of points) {
      const coords = (d.geometry.type === 'Point') ? [d.geometry.coordinates]
        : (d.geometry.type === 'MultiPoint') ? d.geometry.coordinates : [];

      for (const loc of coords) {
        const point = viewport.project(loc);
        const feature = new PIXI.Graphics()
          .circle(0, 0, 40)
          .fill({color, alpha:0.05});

        feature.x = point[0];
        feature.y = point[1];
        parentContainer.addChild(feature);
      }
    }
  }


  /**
   * Return true if there is any overlay endpoint URLs defined in the rapid datasets.
   * @return  `true` if there is a vector tile template or geojson to display
   */
  public hasData(): boolean {
    if (this._overlaysDefined === null) {
      const rapid = this.context.systems.rapid!;
      const datasets = rapid.datasets;
      this._overlaysDefined = false;
      for (const dataset of datasets.values()) {
        if (dataset.overlay) {
          this._overlaysDefined = true;
        }
      }
    }

    return this._overlaysDefined;
  }

}
