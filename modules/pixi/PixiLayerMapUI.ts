import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { DashLine } from './lib/DashLine.ts';
import { geoMetersToLon, projWgs84ToWorld, vecSubtract, WORLD_ZOOM } from '@rapid-sdk/math';

import type { DashLineOptions } from './lib/DashLine.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Viewport, Vec2 } from '@rapid-sdk/math';


/**
 * This class contains any UI elements to be 'drawn over' the map.
 * Some of these containers will contain data managed by other layers.
 *
 * - selected / hovered vertices and other elements
 * - geolocation aura
 * - tile debugging grid
 * - lasso selection polygon
 * - others?
 *
 * @class
 */
export class PixiLayerMapUI extends AbstractPixiLayer {
  private _oldz: number;
  private _geolocationData: GeolocationCoordinates | null;
  private _geolocationDirty: boolean;
  private _lassoData: Vec2[] | null;
  private _lassoDirty: boolean;
  private _lassoLine: PIXI.Graphics | null;
  private _lassoFill: PIXI.Graphics | null;

  geolocation: PIXI.Container | null;
  tileDebug: PIXI.Container | null;
  selected: PIXI.Container | null;
  halo: PIXI.Container | null;
  lasso: PIXI.Container | null;

  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  constructor(scene: PixiScene) {
    super(scene);
    this.id = 'map-ui';
    this.enabled = true;   // this layer should always be enabled

    this._oldz = 0;

    this._geolocationData = null;
    this._geolocationDirty = false;

    this._lassoData = null;
    this._lassoDirty = false;
    this._lassoLine = null;
    this._lassoFill = null;

    this.geolocation = null;
    this.tileDebug = null;
    this.selected = null;
    this.halo = null;
    this.lasso = null;
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset(): void {
    super.reset();

    this._oldz = 0;

    const groupContainer = this.scene.groups.get('ui')!;

    // Remove any existing containers.
    // Note: iterate over a snapshot - `removeChild` splices `children` mid-iteration.
    for (const child of [...groupContainer.children]) {
      groupContainer.removeChild(child);
      child.destroy({ children: true });  // recursive
    }

    // Add containers
    // These only go visible if they have something to show

    // GEOLOCATION
    const geolocation = new PIXI.Container();
    geolocation.label = 'geolocation';
    geolocation.eventMode = 'none';
    geolocation.sortableChildren = false;
    geolocation.visible = false;
    this.geolocation = geolocation;

    // TILE DEBUGGING
    const tileDebug = new PIXI.Container();
    tileDebug.label = 'tile-debug';
    tileDebug.eventMode = 'none';
    tileDebug.sortableChildren = false;
    tileDebug.visible = false;
    this.tileDebug = tileDebug;

    // SELECTED
    const selected = new PIXI.Container();
    selected.label = 'selected';
    selected.sortableChildren = true;
    selected.visible = true;
    this.selected = selected;

    // HALO
    const halo = new PIXI.Container();
    halo.label = 'halo';
    halo.sortableChildren = true;
    halo.visible = true;
    this.halo = halo;

    // LASSO
    if (this._lassoLine)  this._lassoLine.destroy();
    if (this._lassoFill)  this._lassoFill.destroy();

    this._lassoLine = new PIXI.Graphics();
    this._lassoFill = new PIXI.Graphics();
    this._lassoData = null;

    const lasso = new PIXI.Container();
    lasso.label = 'lasso';
    lasso.eventMode = 'none';
    lasso.sortableChildren = false;
    lasso.visible = false;
    this.lasso = lasso;

    groupContainer.addChild(geolocation, tileDebug, selected, halo, lasso);
  }


  /**
   * This layer should always be enabled - it contains important UI stuff
   */
  get enabled(): boolean {
    return true;
  }
  set enabled(val: boolean) {
    this._enabled = true;
  }


  /**
   * see:  https://developer.mozilla.org/en-US/docs/Web/API/GeolocationPosition
   */
  get geolocationData(): GeolocationCoordinates | null {
    return this._geolocationData;
  }
  set geolocationData(val: GeolocationCoordinates | null) {
    this._geolocationData = val;
    this._geolocationDirty = true;
  }


  /**
   * Pass an array of coordinate data that grows at the user draws the lasso
   */
  get lassoData(): Vec2[] | null {
    return this._lassoData;
  }
  set lassoData(val: Vec2[] | null) {
    this._lassoData = val;
    this._lassoDirty = true;
  }


  /**
   * Render any of the child containers for UI that should float over the map.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  render(frame: number, viewport: Viewport): void {
    // redraw if zoom changes - note: use true zoom here, not "effective" zoom.
    const z = viewport.transform.zoom;
    if (z !== this._oldz) {
      this._geolocationDirty = true;
      this._lassoDirty = true;
      this._oldz = z;
    }

    if (this._geolocationDirty) {
      this.renderGeolocation(frame, viewport);
    }

    if (this._lassoDirty) {
      this.renderLasso(frame, viewport);
    }

  }

  /**
   * Render the lasso polygon
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  renderLasso(frame: number, viewport: Viewport): void {
    if (!this._lassoDirty) return;

    const lasso = this.lasso;
    if (!lasso) return;

    const line = this._lassoLine;
    const fill = this._lassoFill;
    const data = this._lassoData;  // lasso world coords from `LassoBehavior.ts`

    if (line && fill && Array.isArray(data) && data.length > 1) {  // should show lasso
      lasso.visible = true;
      if (!lasso.children.length) {
        lasso.addChild(line, fill);
      }

      // Choose a local origin and generate flattened coordinate array.
      const origin = data.at(0)!;
      lasso.position.set(origin[0], origin[1]);

      const flatCoords: number[] = new Array(data.length * 2 + 2);
      for (let i = 0; i < data.length; i++) {
        const [x, y] = vecSubtract(data[i], origin);  // world -> local
        flatCoords[i * 2] = x;
        flatCoords[i * 2 + 1] = y;
      }
      // close the shape (the first point is the local origin = 0,0)
      flatCoords[data.length * 2] = 0;
      flatCoords[data.length * 2 + 1] = 0;


      // Convert screen pixel values to world units
      const scale = 2 ** (WORLD_ZOOM - viewport.transform.z);

      // line
      const lineStyle: DashLineOptions = {
        alpha: 0.7,
        dash: [6, 3],
        width: 1,
        scale: scale,
        color: 0xffffff
      };
      line.clear();
      new DashLine(this.gfx, line, lineStyle).poly(flatCoords);

      // fill
      const fillStyle: PIXI.FillStyle = {
        alpha: 0.5,
        color: 0xaaaaaa
      };
      fill.clear().poly(flatCoords).fill(fillStyle);

    } else {  // no lasso data
      lasso.visible = false;
      if (lasso.children.length) {
        lasso.removeChildren();
      }
    }

    this._lassoDirty = false;
  }


  /**
   * Render the geoloation data
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  renderGeolocation(frame: number, viewport: Viewport): void {
    if (!this._geolocationDirty) return;

    const container = this.geolocation;
    if (!container) return;

    container.removeChildren();

    if (this.geolocationData) {
      container.visible = true;

      const d = this.geolocationData;
      const coord: Vec2 = [d.longitude, d.latitude];
      const [x, y] = projWgs84ToWorld(coord);

      // Convert screen pixel values to world units
      const viewZoom = viewport.transform.zoom;
      const scale = 2 ** (WORLD_ZOOM - viewZoom);

      // Calculate the radius of the accuracy aura (convert meters -> pixels)
      const dLon = geoMetersToLon(d.accuracy, coord[1]);  // coord[1] = at this latitude
      const edge: Vec2 = [d.longitude + dLon, d.latitude];
      const x2 = projWgs84ToWorld(edge)[0];
      const r = Math.max(Math.abs(x2 - x), 15) * scale;
      const BLUE = 0xe60ff;

      const aura = new PIXI.Graphics()
        .circle(x, y, r)
        .fill({ alpha: 0.4, color: BLUE });
      aura.label = 'aura';
      container.addChild(aura);

      // Show a viewfield for the heading if we have it
      if (d.heading !== null && !isNaN(d.heading)) {
        const textureManager = this.gfx.textureManager!;
        const heading = new PIXI.Sprite(textureManager.getTexture('symbol', 'viewfieldDark') || PIXI.Texture.EMPTY);
        heading.anchor.set(0.5, 1);  // middle, top
        heading.angle = d.heading;
        heading.label = 'heading';
        heading.position.set(x, y);
        container.addChild(heading);
      }

      const position = new PIXI.Graphics()
        .circle(x, y, 6.5 * scale)
        .stroke({ alpha: 1.0, width: 1.5 * scale, color: 0xffffff })
        .fill({ alpha: 1.0, color: BLUE });
      position.label = 'position';
      container.addChild(position);

    } else {
      container.visible = false;
    }

    this._geolocationDirty = false;

  }

}
