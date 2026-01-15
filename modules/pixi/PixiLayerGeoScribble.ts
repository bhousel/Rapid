import * as PIXI from 'pixi.js';

import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeatureLine, type LineStyle } from './PixiFeatureLine.ts';
import { PixiFeaturePoint, type PointStyle } from './PixiFeaturePoint.ts';

import type { GeoJSON } from '../data/GeoJSON.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Viewport } from '@rapid-sdk/math';

const CUSTOM_COLOR = 0x2eff2e;


/**
 * PixiLayerGeoScribble
 * This class contains any geo scribbles that should be 'drawn over' the map.
 * Originally from the EveryDoor folks - reference: https://github.com/Zverik/every_door/issues/197
 * This data comes from API at https://geoscribble.osmz.ru/docs#/default/scribbles_scribbles_get.
 * @class
 */
export class PixiLayerGeoScribble extends AbstractPixiLayer {
  scribblesContainer: PIXI.Container | null;

  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  constructor(scene: PixiScene) {
    super(scene);
    this.id = 'geoscribble';

    this.scribblesContainer = null;
  }


  /**
   * supported
   * Whether the Layer's service exists
   */
  get supported() {
    return !!this.context.services.geoscribble;
  }


  /**
   * enabled
   * Whether the user has chosen to see the Layer
   * Make sure to start the service.
   */
  get enabled() {
    return this._enabled;
  }
  set enabled(val: boolean) {
    if (!this.supported) {
      val = false;
    }

    if (val === this._enabled) return;  // no change
    this._enabled = val;

    const context = this.context;
    const gfx = context.systems.gfx as any;
    const service = context.services.geoscribble;
    if (val && service) {
      service.startAsync()
        .then(() => gfx?.immediateRedraw());
    }
  }


  /**
   * reset
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset() {
    super.reset();

    const groupContainer = this.scene.groups.get('basemap')!;

    // Remove any existing containers
    for (const child of groupContainer.children) {
      if (child.label.startsWith(this.layerID + '-')) {   // 'geoscribble-*'
        groupContainer.removeChild(child);
        child.destroy({ children: true });  // recursive
      }
    }

    const geoscribbles = new PIXI.Container();
    geoscribbles.label = `${this.layerID}-geoscribbles`;
    geoscribbles.sortableChildren = false;
    geoscribbles.interactiveChildren = true;
    this.scribblesContainer = geoscribbles;

    groupContainer.addChild(geoscribbles);
  }


  /**
   * render
   * Render the geojson custom data
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom level to use for rendering
   */
  render(frame: number, viewport: Viewport, zoom: number): void {
    if (!this.enabled) return;

    const service = this.context.services.geoscribble;
    service.loadTiles();

    const geoData: GeoJSON[] = service.getData();

    // Determine which renderer(s) to use for each feature
    // No polygons will be returned by the service, so we don't need to consider those types.
    const lines = geoData.filter(d => d.geoms.parts.some(part => part.type === 'LineString'));
    const points = geoData.filter(d => d.geoms.parts.some(part => part.type === 'Point'));

    this.renderLines(frame, viewport, zoom, lines);
    this.renderPoints(frame, viewport, zoom, points);
  }


  /**
   * getLineStyle
   * @param props - The GeoJSON properties object, may contain:
   * `thin`   (boolean)
   * `dashed` (boolean)
   * `color`  (hex code string like `#FFEECC`)
   * `style`  One of: "scribble", "eraser", "road", "track", "footway", "path", "cycleway", "cycleway_shared",
   *          "wall", "fence", "power", "stream", "drain", etc.
   * @return  A style object that can be given to the pixi renderer
   */
  getLineStyle(props: Record<string, unknown>): LineStyle {
    const lineStyle = {
      stroke: { width: 2, color: CUSTOM_COLOR, alpha: 1, cap: 'round' },
      labelTint: CUSTOM_COLOR
    } as LineStyle;

    const color = props.color ? new PIXI.Color(props.color as string).toNumber() : CUSTOM_COLOR;
    const thin = props.thin;
    const dashed = props.dashed;

    // Modify the alpha down a bit to add to 'scribble' factor.
    lineStyle.stroke!.alpha = 0.70;
    lineStyle.stroke!.color = color;
    lineStyle.stroke!.width = thin ? 4 : 8;
    if (dashed) {
      lineStyle.stroke!.dash = thin ? [12, 6] : [24, 12]; // Thinner lines get shorter dashes
    }

    return lineStyle;
  }


  /**
   * renderLines
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom to use for rendering
   * @param lines - Array of line data
   */
  renderLines(frame: number, viewport: Viewport, zoom: number, lines: GeoJSON[]): void {
    const parentContainer = this.scribblesContainer;

    for (const d of lines) {
      const lineStyle = this.getLineStyle(d.properties);
      const dataID = d.id;
      const version = d.v || 0;
      const parts = d.geoms.parts;

      for (let i = 0; i < parts.length; ++i) {
        // Check that this part has coordinates and is a LineString
        const part = parts[i];
        if (!part.world || part.type !== 'LineString') continue;

        const featureID = `${this.layerID}-${dataID}-${i}`;
        let feature = this.features.get(featureID) as PixiFeatureLine | undefined;

        // If feature existed before as a different type, recreate it.
        if (feature && feature.type !== 'LineString') {
          feature.destroy();
          feature = undefined;
        }

        if (!feature) {
          feature = new PixiFeatureLine(this, featureID);
          feature.style = lineStyle;
          feature.parentContainer = parentContainer;
        }

        // If data has changed.. Replace it.
        if (feature.v !== version) {
          feature.v = version;
          feature.label = (d.properties.text as string) || null;
          feature.setCoords(part);
          feature.setData(dataID, d);
        }

        this.syncFeatureClasses(feature);
        feature.update(viewport, zoom);
        this.retainFeature(feature, frame);
      }
    }
  }


  /**
   * renderPoints
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param zoom - Effective zoom to use for rendering
   * @param points - Array of point data
   */
  renderPoints(frame: number, viewport: Viewport, zoom: number, points: GeoJSON[]): void {
    const parentContainer = this.scribblesContainer;

    const pointStyle = {
      markerName: 'largeCircle',
      markerTint: CUSTOM_COLOR,
      iconName: 'maki-circle-stroked',
      labelTint: CUSTOM_COLOR
    } as PointStyle;

    for (const d of points) {
      const dataID = d.id;
      const version = d.v || 0;
      const parts = d.geoms.parts;

      for (let i = 0; i < parts.length; ++i) {
        // Check that this part has coordinates and is a Point
        const part = parts[i];
        if (!part.world || part.type !== 'Point') continue;

        const featureID = `${this.layerID}-${dataID}-${i}`;
        let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

        // If feature existed before as a different type, recreate it.
        if (feature && feature.type !== 'Point') {
          feature.destroy();
          feature = undefined;
        }

        if (!feature) {
          feature = new PixiFeaturePoint(this, featureID);
          feature.style = pointStyle;
          feature.parentContainer = parentContainer;
        }

        // If data has changed.. Replace it.
        if (feature.v !== version) {
          feature.v = version;
          feature.label = (d.properties.text as string) || null;
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
