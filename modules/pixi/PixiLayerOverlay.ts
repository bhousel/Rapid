import * as PIXI from 'pixi.js';
import { projWgs84ToWorld, WORLD_ZOOM } from '@rapid-sdk/math';

import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { DashLine } from './lib/DashLine.ts';

import type { PixiScene } from './PixiScene.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


/**
 * A shape an embedding app draws over the map (see `PixiLayerOverlay.setShapes`).
 * Sizes are in screen pixels, so they look the same at every zoom.
 */
export interface OverlayShape {
  /** Identifies the shape among its owner's shapes */
  id: string;
  /** The shape's points, as [lon, lat] */
  coordinates: Vec2[];
  /** Whether to join the last point back to the first (default `false`) */
  closed?: boolean;
  /** The outline (default: a 2px white line) */
  stroke?: {
    color?: number;      // e.g. 0xff0000
    opacity?: number;    // 0-1 (default 1)
    width?: number;      // px (default 2)
    dash?: number[];     // px on/off, e.g. [6, 3] (default solid)
  };
  /** The fill, for a closed shape (default none) */
  fill?: {
    color?: number;
    opacity?: number;    // 0-1 (default 0.3)
  };
  /** Text shown just above the shape's top left corner */
  label?: string;
  /** Draw under the map data, or over everything (the default) */
  placement?: 'under' | 'over';
}

/** Style of overlay labels */
const LABEL_STYLE = new PIXI.TextStyle({
  fill: 0xffffff,
  fontSize: 12,
  fontWeight: '600',
  stroke: { color: 0x333333, width: 3 }
});


/**
 * This class renders shapes that an embedding app draws over the map, such as
 * an outline around the area being reviewed. Shapes are grouped by owner, so
 * each part of an app can replace or clear its own shapes without disturbing
 * the others:
 * ```
 * const overlay = context.systems.gfx.scene.layers.get('overlay');
 * overlay.setShapes('review', [{ id: 'tile', coordinates: ring, closed: true, label: 'Tile Extent' }]);
 * overlay.clearShapes('review');
 * ```
 * This layer is always enabled; it draws nothing until shapes are set.
 */
export class PixiLayerOverlay extends AbstractPixiLayer {
  /** Containers for shapes drawn under the map data and over everything */
  protected _under: PIXI.Container | null;
  protected _over: PIXI.Container | null;
  /** The shapes to draw, by owner */
  protected _shapes: Map<string, OverlayShape[]>;
  /** Whether the shapes need to be redrawn */
  protected _dirty: boolean;
  /** The zoom the shapes were last drawn at */
  protected _drawnZoom: number | null;


  /**
   * @param scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'overlay';
    this.enabled = true;   // this layer should always be enabled

    this._under = null;
    this._over = null;
    this._shapes = new Map<string, OverlayShape[]>();
    this._dirty = true;
    this._drawnZoom = null;
  }


  /**
   * This layer should always be enabled
   * @return  Always `true` — this layer cannot be disabled
   */
  public get enabled(): boolean {
    return true;
  }
  /** This layer is always enabled; the setter ignores the value and forces `_enabled = true`.
   * @param val - Ignored; the layer is always forced to enabled
   */
  public set enabled(val: boolean) {
    this._enabled = true;
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   * The shapes themselves are kept, and drawn again.
   */
  public reset(): void {
    super.reset();

    this._under?.destroy({ children: true });
    this._over?.destroy({ children: true });

    this._under = this._makeContainer('debug-under');
    this._over = this._makeContainer('ui');
    this._dirty = true;
  }


  /**
   * Replaces the shapes drawn for an owner.
   * @param ownerID - Whoever's drawing them, e.g. 'review'
   * @param shapes - The shapes to draw
   */
  public setShapes(ownerID: string, shapes: OverlayShape[]): void {
    this._shapes.set(ownerID, shapes);
    this._redraw();
  }


  /**
   * Removes the shapes drawn for an owner.
   * @param ownerID - Whoever drew them
   */
  public clearShapes(ownerID: string): void {
    if (this._shapes.delete(ownerID)) {
      this._redraw();
    }
  }


  /**
   * The shapes drawn for an owner.
   * @param ownerID - Whoever drew them
   * @return The shapes, or an empty array if there are none
   */
  public getShapes(ownerID: string): OverlayShape[] {
    return this._shapes.get(ownerID) ?? [];
  }


  /**
   * Draws the shapes, when they or the zoom have changed.
   * They're drawn in world coordinates, so panning doesn't need a redraw.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
    const under = this._under;
    const over = this._over;
    if (!under || !over) return;

    const zoom = viewport.transform.zoom;
    if (!this._dirty && zoom === this._drawnZoom) return;
    this._dirty = false;
    this._drawnZoom = zoom;

    for (const container of [under, over]) {
      for (const child of container.removeChildren()) {
        child.destroy({ children: true });
      }
    }

    // Convert screen pixel values to world units
    const scale = 2 ** (WORLD_ZOOM - zoom);

    for (const shapes of this._shapes.values()) {
      for (const shape of shapes) {
        const container = shape.placement === 'under' ? under : over;
        const graphic = this._drawShape(shape, scale);
        if (graphic) container.addChild(graphic);
      }
    }
  }


  /**
   * Draws one shape.
   * @param shape - The shape
   * @param scale - World units per screen pixel
   * @return A container holding the shape's graphics, or `null` if it has no points
   */
  protected _drawShape(shape: OverlayShape, scale: number): PIXI.Container | null {
    const points = shape.coordinates.map(coord => projWgs84ToWorld(coord));
    if (!points.length) return null;

    // Draw relative to the first point, to keep the numbers small
    const [ox, oy] = points[0];
    const flat: number[] = [];
    let minX = Infinity;
    let minY = Infinity;
    for (const [x, y] of points) {
      flat.push(x - ox, y - oy);
      minX = Math.min(minX, x - ox);
      minY = Math.min(minY, y - oy);
    }
    if (shape.closed && points.length > 2) {
      flat.push(0, 0);
    }

    const container = new PIXI.Container();
    container.label = shape.id;
    container.eventMode = 'none';
    container.position.set(ox, oy);

    if (shape.fill && shape.closed && points.length > 2) {
      const fill = new PIXI.Graphics()
        .poly(flat)
        .fill({ color: shape.fill.color ?? 0xffffff, alpha: shape.fill.opacity ?? 0.3 });
      container.addChild(fill);
    }

    if (points.length > 1) {
      const stroke = shape.stroke ?? {};
      const width = stroke.width ?? 2;
      const color = stroke.color ?? 0xffffff;
      const alpha = stroke.opacity ?? 1;
      const line = new PIXI.Graphics();
      if (stroke.dash?.length) {
        new DashLine(this.gfx, line, { dash: stroke.dash, width, color, alpha, scale }).poly(flat);
      } else {
        line.poly(flat, false).stroke({ width: width * scale, color, alpha, join: 'round', cap: 'round' });
      }
      container.addChild(line);
    }

    if (shape.label) {
      const text = new PIXI.Text({ text: shape.label, style: LABEL_STYLE });
      text.label = 'label';
      text.anchor.set(0, 1);
      text.position.set(minX, minY - 2 * scale);
      text.scale.set(scale);
      container.addChild(text);
    }

    return container;
  }


  /**
   * Adds a container for shapes to one of the scene's groups.
   * @param groupID - The group, e.g. 'ui'
   * @return The container
   */
  protected _makeContainer(groupID: string): PIXI.Container | null {
    const group = this.scene.groups.get(groupID);
    if (!group) return null;

    const container = new PIXI.Container();
    container.label = this.layerID;
    container.eventMode = 'none';
    container.sortableChildren = false;
    group.addChild(container);
    return container;
  }


  /**
   * Marks the shapes as changed, and redraws the map.
   */
  protected _redraw(): void {
    this._dirty = true;
    this.gfx.immediateRedraw();
  }
}
