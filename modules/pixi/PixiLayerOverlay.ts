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
  /**
   * The shape's points, as [lon, lat]: one path, or several paths drawn with
   * the same style (e.g. all of a drawing's walls), which is much faster than
   * a shape per path when there are many.
   */
  coordinates: Vec2[] | Vec2[][];
  /** Whether to join each path's last point back to its first (default `false`) */
  closed?: boolean;
  /** The outline (default: a 2px white line), or `null` for none (e.g. a fill only) */
  stroke?: {
    color?: number;      // e.g. 0xff0000
    opacity?: number;    // 0-1 (default 1)
    width?: number;      // px (default 2)
    dash?: number[];     // px on/off, e.g. [6, 3] (default solid)
    /**
     * Draw 1px lines (ignoring `width` and `dash`). They're built once rather
     * than again as the map zooms, so use this for large drawings.
     */
    hairline?: boolean;
  } | null;
  /** The fill, for a closed shape (default none); each path is filled on its own */
  fill?: {
    color?: number;
    opacity?: number;    // 0-1 (default 0.3)
  };
  /** Text shown just above the shape's top left corner */
  label?: string;
  /** Draw under the map data, or over everything (the default) */
  placement?: 'under' | 'over';
  /** Order among the shapes with the same placement: higher draws on top (default 0) */
  zIndex?: number;
}

/** Style of overlay labels */
const LABEL_STYLE = new PIXI.TextStyle({
  fill: 0xffffff,
  fontSize: 12,
  fontWeight: '600',
  stroke: { color: 0x333333, width: 3 }
});

/** A shape as drawn: its container, and the parts redrawn when the zoom changes */
interface DrawnShape {
  shape: OverlayShape;
  container: PIXI.Container;
  /** Each path's points, flattened, relative to the container's position */
  paths: number[][];
  /** Width-scaled or dashed strokes, restroked when the zoom changes */
  scaledStroke: PIXI.Graphics | null;
  label: PIXI.Text | null;
  /** The shape's top left, relative to the container's position */
  topLeft: Vec2;
}


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
  /** The shapes as drawn */
  protected _drawn: DrawnShape[];
  /** Whether the shapes need to be built again */
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
    this._drawn = [];
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
    this._drawn = [];
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
   * Draws the shapes when they've changed. They're drawn in world coordinates,
   * so panning doesn't need a redraw; when the zoom changes, only what's sized
   * in screen pixels is updated: width-scaled or dashed strokes, and labels.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
    const under = this._under;
    const over = this._over;
    if (!under || !over) return;

    const zoom = viewport.transform.zoom;
    if (!this._dirty && zoom === this._drawnZoom) return;

    // Convert screen pixel values to world units
    const scale = 2 ** (WORLD_ZOOM - zoom);
    this._drawnZoom = zoom;

    if (this._dirty) {
      this._dirty = false;
      for (const container of [under, over]) {
        for (const child of container.removeChildren()) {
          child.destroy({ children: true });
        }
      }
      this._drawn = [];
      for (const shapes of this._shapes.values()) {
        for (const shape of shapes) {
          const drawn = this._drawShape(shape, scale);
          if (!drawn) continue;
          this._drawn.push(drawn);
          (shape.placement === 'under' ? under : over).addChild(drawn.container);
        }
      }
      return;
    }

    for (const drawn of this._drawn) {
      if (drawn.scaledStroke) this._strokeScaled(drawn, scale);
      if (drawn.label) this._placeLabel(drawn, scale);
    }
  }


  /**
   * Draws one shape.
   * @param shape - The shape
   * @param scale - World units per screen pixel
   * @return The drawn shape, or `null` if it has no points
   */
  protected _drawShape(shape: OverlayShape, scale: number): DrawnShape | null {
    const coordinates = shape.coordinates ?? [];
    const lonLatPaths = (Array.isArray(coordinates[0]?.[0]) ? coordinates : [coordinates]) as Vec2[][];
    const worldPaths = lonLatPaths.map(path => path.map(coord => projWgs84ToWorld(coord))).filter(path => path.length);
    if (!worldPaths.length) return null;

    // Draw relative to the first point, to keep the numbers small
    const [ox, oy] = worldPaths[0][0];
    let minX = Infinity;
    let minY = Infinity;
    const paths = worldPaths.map(path => {
      const flat: number[] = [];
      for (const [x, y] of path) {
        flat.push(x - ox, y - oy);
        minX = Math.min(minX, x - ox);
        minY = Math.min(minY, y - oy);
      }
      if (shape.closed && path.length > 2) {
        flat.push(flat[0], flat[1]);
      }
      return flat;
    });

    const container = new PIXI.Container();
    container.label = shape.id;
    container.eventMode = 'none';
    container.position.set(ox, oy);
    container.zIndex = shape.zIndex ?? 0;

    if (shape.fill && shape.closed) {
      const fill = new PIXI.Graphics();
      for (const flat of paths) {
        if (flat.length >= 8) {   // 3 points, closed
          fill.poly(flat).fill({ color: shape.fill.color ?? 0xffffff, alpha: shape.fill.opacity ?? 0.3 });
        }
      }
      container.addChild(fill);
    }

    const drawn: DrawnShape = { shape, container, paths, scaledStroke: null, label: null, topLeft: [minX, minY] };

    const stroke = shape.stroke === undefined ? {} : shape.stroke;
    const lines = paths.filter(flat => flat.length >= 4);   // 2 points
    if (stroke && lines.length) {
      const color = stroke.color ?? 0xffffff;
      const alpha = stroke.opacity ?? 1;
      if (stroke.hairline) {
        // 1px at any zoom: built once
        const hairline = new PIXI.Graphics();
        for (const flat of lines) {
          hairline.poly(flat, false).stroke({ width: 1, color, alpha, pixelLine: true });
        }
        container.addChild(hairline);
      } else {
        drawn.scaledStroke = new PIXI.Graphics();
        container.addChild(drawn.scaledStroke);
        this._strokeScaled(drawn, scale);
      }
    }

    if (shape.label) {
      drawn.label = new PIXI.Text({ text: shape.label, style: LABEL_STYLE });
      drawn.label.label = 'label';
      drawn.label.anchor.set(0, 1);
      container.addChild(drawn.label);
      this._placeLabel(drawn, scale);
    }

    return drawn;
  }


  /**
   * (Re)strokes a shape's width-scaled or dashed lines for the given scale.
   * @param drawn - The drawn shape
   * @param scale - World units per screen pixel
   */
  protected _strokeScaled(drawn: DrawnShape, scale: number): void {
    const graphics = drawn.scaledStroke!;
    const stroke = drawn.shape.stroke ?? {};
    const width = stroke.width ?? 2;
    const color = stroke.color ?? 0xffffff;
    const alpha = stroke.opacity ?? 1;

    graphics.clear();
    for (const flat of drawn.paths) {
      if (flat.length < 4) continue;
      if (stroke.dash?.length) {
        new DashLine(this.gfx, graphics, { dash: stroke.dash, width, color, alpha, scale }).poly(flat);
      } else {
        graphics.poly(flat, false).stroke({ width: width * scale, color, alpha, join: 'round', cap: 'round' });
      }
    }
  }


  /**
   * Sizes and places a shape's label for the given scale, just above its top left.
   * @param drawn - The drawn shape
   * @param scale - World units per screen pixel
   */
  protected _placeLabel(drawn: DrawnShape, scale: number): void {
    const [minX, minY] = drawn.topLeft;
    drawn.label!.position.set(minX, minY - 2 * scale);
    drawn.label!.scale.set(scale);
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
    container.sortableChildren = true;   // by each shape's zIndex
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
