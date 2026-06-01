import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { PixiFeatureLine } from './PixiFeatureLine.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';

import type { GeoJSONData } from '../data/GeoJSONData.ts';
import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Viewport } from '@rapid-sdk/math';

const CUSTOM_COLOR = 0x2eff2e;


/**
 * This class contains any geo scribbles that should be 'drawn over' the map.
 * Originally from the EveryDoor folks - reference: https://github.com/Zverik/every_door/issues/197
 * This data comes from API at https://geoscribble.osmz.ru/docs#/default/scribbles_scribbles_get.
 * @class
 */
export class PixiLayerGeoScribble extends AbstractPixiLayer {
  public scribblesContainer: PIXI.Container | null;

  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'geoscribble';

    this.scribblesContainer = null;
  }


  /**
   * Whether the Layer's service exists
   */
  public get supported() {
    return !!this.context.services.geoscribble;
  }


  /**
   * Whether the user has chosen to see the Layer
   * Make sure to start the service.
   */
  public get enabled() {
    return this._enabled;
  }
  public set enabled(val: boolean) {
    if (!this.supported) {
      val = false;
    }

    if (val === this._enabled) return;  // no change
    this._enabled = val;

    const context = this.context;
    const gfx = context.systems.gfx!;
    const service = context.services.geoscribble;
    if (val && service) {
      service.startAsync()
        .then(() => gfx.immediateRedraw());
    }
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  public reset() {
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
   * Render the geojson custom data
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
    if (!this.enabled) return;

    const service = this.context.services.geoscribble;
    if (!service) return;
    service.loadTiles();

    const geoData: GeoJSONData[] = service.getData();

    // Determine which renderer(s) to use for each feature
    // No polygons will be returned by the service, so we don't need to consider those types.
    const lines = geoData.filter(d => d.geoms.parts.some(part => part.type === 'LineString'));
    const points = geoData.filter(d => d.geoms.parts.some(part => part.type === 'Point'));

    this.renderLines(frame, viewport, lines);
    this.renderPoints(frame, viewport, points);
  }


  /**
   * @param props - The GeoJSONData properties object, may contain:
   * `thin`   (boolean)
   * `dashed` (boolean)
   * `color`  (hex code string like `#FFEECC`)
   * `style`  One of: "scribble", "eraser", "road", "track", "footway", "path", "cycleway", "cycleway_shared",
   *          "wall", "fence", "power", "stream", "drain", etc.
   * @return  A style object that can be given to the pixi renderer
   */
  public getLineStyle(props: Record<string, unknown>): Partial<MatchedStyle> {
    const color = props.color ? new PIXI.Color(props.color as string).toNumber() : CUSTOM_COLOR;
    const isThin = props.thin;
    const isDashed = props.dashed;

    return {
      stroke: {
        color: color,
        opacity: 0.7,
        width: isThin ? 4 : 8,
        dash: isDashed ? (isThin ? [12, 6] : [24, 12]) : undefined
      },
      label: {
        color: color
      }
    } as Partial<MatchedStyle>;
  }


  /**
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param lines - Array of line data
   */
  public renderLines(frame: number, viewport: Viewport, lines: GeoJSONData[]): void {
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
          feature.geometry = part;
          feature.setData(dataID, d);
        }

        this.syncFeatureClasses(feature);
        feature.update(viewport);
        this.retainFeature(feature, frame);
      }
    }
  }


  /**
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param points - Array of point data
   */
  public renderPoints(frame: number, viewport: Viewport, points: GeoJSONData[]): void {
    const parentContainer = this.scribblesContainer;

    const pointStyle: Partial<MatchedStyle> = {
      marker: { color: CUSTOM_COLOR, image: 'largeCircle' },
      icon: { color: CUSTOM_COLOR, image: 'maki-circle-stroked' },
      label: { color: CUSTOM_COLOR }
    };

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
          feature.geometry = part;
          feature.setData(dataID, d);
        }

        this.syncFeatureClasses(feature);
        feature.update(viewport);
        this.retainFeature(feature, frame);
      }
    }
  }

}
