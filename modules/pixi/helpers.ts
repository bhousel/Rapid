import * as PIXI from 'pixi.js';
import { geomStrokeMesh } from '../geo/index.ts';
import { GlowFilter } from 'pixi-filters';
import { LineMesh } from './lib/LineMesh.ts';

import type { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import type { LineBatchMesh, LineBatchMeshItem, LineBatchMeshStyle } from './lib/LineBatchMesh.ts';


// The halo around what's selected: a yellow line 2 pixels wide, in dashes of 6 with gaps of 3
// that march along it, over a darker line 4 pixels wide. (The dark line is there so that the
// dashes show on any background, a yellow road as well as a black one.)
const HALO_DASHES: LineBatchMeshStyle = { width: 2, minWidth: 2, color: 0xffff00, alpha: 1, dash: [6, 3], marches: true };
const HALO_UNDER: LineBatchMeshStyle = { width: 4, minWidth: 4, color: 0x000000, alpha: 0.55, marches: true };

/** The color of a hover: the glow around what the pointer is over, and the tint of an area's fill */
export const HOVER_COLOR = 0xffff00;

/** The color of a highlight: the same, for what something in the sidebar points at */
export const HIGHLIGHT_COLOR = 0x7092ff;

/** Where a point is in a container's own coordinates, while `containerHit()` works */
const _local = new PIXI.Point();


/**
 * Whether a point is over a container, by the rules Pixi's own hit test has for one subtree
 * (`EventBoundary.hitTestRecursive`): a `hitArea` decides where it has one, otherwise the
 * children do, and then what the container draws (`containsPoint`). Nothing with
 * `eventMode: 'none'` or hidden is hit.
 *
 * Pixi's hit test starts at the stage and asks every interactive container in the scene. This
 * asks one, for a caller that already knows which few could be under the pointer (see
 * `PixiScene.hitTest`). The container's ancestors aren't looked at.
 * @param container - The container to test
 * @param point - The point, in the stage's coordinates (a pointer event's `global`)
 * @param interactive - Whether an ancestor made everything below it interactive (leave it out)
 * @return `true` if the pointer would hit the container or something in it
 */
export function containerHit(container: PIXI.Container, point: PIXI.PointData, interactive: boolean = false): boolean {
  const eventMode = container.eventMode;
  if (!container.visible || !container.renderable || !container.measurable || eventMode === 'none') return false;
  if (eventMode === 'passive' && !container.interactiveChildren) return false;

  const hitArea = container.hitArea;
  if (hitArea) {
    container.worldTransform.applyInverse(point, _local);
    if (!hitArea.contains(_local.x, _local.y)) return false;
  }

  const isInteractive = interactive || eventMode === 'static' || eventMode === 'dynamic';
  if (container.interactiveChildren) {
    const children = container.children;
    for (let i = children.length - 1; i >= 0; i--) {
      if (containerHit(children[i], point, isInteractive)) return true;
    }
  }

  if (!isInteractive) return false;
  if (hitArea) return true;

  if (container instanceof PIXI.ViewContainer) {   // something that draws: a sprite, a graphics, a mesh
    container.worldTransform.applyInverse(point, _local);
    return container.containsPoint(_local);
  }
  return false;
}


/**
 * Says which of two containers in the same scene is drawn later, and so is on top where they
 * overlap. It's the order of a walk through the tree: a container's children are kept in the
 * order they're drawn in (Pixi sorts them by `zIndex` when it renders).
 * @param a - A container
 * @param b - Another
 * @return A positive number if `a` is drawn after `b`, a negative one if before, and 0 if they're
 *   the same container or aren't in the same tree
 */
export function drawOrder(a: PIXI.Container, b: PIXI.Container): number {
  if (a === b) return 0;

  let depthA = 0;
  let depthB = 0;
  for (let c = a.parent; c; c = c.parent) depthA++;
  for (let c = b.parent; c; c = c.parent) depthB++;

  // Bring the deeper one up to the other's depth. If that arrives at the other, one is inside
  // the other: a container is drawn before what's in it.
  let ca: PIXI.Container = a;
  let cb: PIXI.Container = b;
  for (; depthA > depthB; depthA--) ca = ca.parent!;
  for (; depthB > depthA; depthB--) cb = cb.parent!;
  if (ca === cb) return (ca === a) ? -1 : 1;

  // Then up together, to the two children of the same parent.
  while (ca.parent !== cb.parent) {
    if (!ca.parent || !cb.parent) return 0;
    ca = ca.parent;
    cb = cb.parent;
  }
  const parent = ca.parent;
  if (!parent) return 0;
  return parent.children.indexOf(ca) - parent.children.indexOf(cb);
}


/**
 * The color that a feature glows in: a hover's, a highlight's, or none.
 * @param classes - The feature's classes
 * @return The color as 0xRRGGBB, or `null` if the feature doesn't glow
 */
export function glowColor(classes: ReadonlySet<ClassID>): number | null {
  return classes.has('hover') ? HOVER_COLOR : classes.has('highlight') ? HIGHLIGHT_COLOR : null;
}


/**
 * Gives a container the glow of a hover or a highlight, or takes it away. This is for a
 * feature that draws itself, with display objects in its container: the glow is a filter on
 * the container. (A feature that batches draw has its glow drawn there, by their shaders.)
 * @param container - The feature's container
 * @param color - The glow's color, or `null` for no glow
 */
export function setGlowFilter(container: PIXI.Container, color: number | null): void {
  if (color === null) {
    if (container.filters) {
      container.filters = null!;
    }
  } else if (!container.filters) {
    const glow = new GlowFilter({ distance: 15, outerStrength: 3, color: color });
    glow.resolution = 2;
    container.filters = [glow];
  } else {
    const glow = (container.filters as PIXI.Filter[])[0];
    if (glow instanceof GlowFilter && new PIXI.Color(glow.color).toNumber() !== color) {    // a hover over a highlight
      glow.color = color;
    }
  }
}


/**
 * Draws rings as lines, each a `LineMesh` child of a container. The children are made as rings
 * come and destroyed as they go, so call it again with the container it drew into before.
 * The container's `tint` and `alpha` color them.
 * @param parent - The container to draw into. Nothing else should be in it.
 * @param rings - The rings, each as `[x, y, x, y, …]` in the container's coordinates (its last point may repeat its first)
 * @param width - The lines' width, in those coordinates
 * @param dashTexture - The dash pattern, for dashed lines (`PixiTextures.getDashTexture()`)
 * @param dashLength - The length of one repeat of that pattern, in those coordinates
 */
export function drawRings(
  parent: PIXI.Container, rings: ArrayLike<number>[], width: number,
  dashTexture: PIXI.Texture | null = null, dashLength: number = 0
): void {
  while (parent.children.length > rings.length) {   // a ring fewer than before
    parent.children[parent.children.length - 1].destroy();
  }

  for (let i = 0; i < rings.length; i++) {
    let mesh = parent.children[i] as LineMesh | undefined;
    if (!mesh) {
      mesh = new LineMesh();
      mesh.label = `ring${i}`;
      mesh.eventMode = 'none';
      mesh.sortableChildren = false;
      parent.addChild(mesh);
    }
    // (a miter longer than the line is wide becomes a bevel: an outline can turn sharply)
    const strokeMesh = geomStrokeMesh(rings[i], { closed: true, cap: 'butt', join: 'miter', miterLimit: 2 });
    mesh.setStroke(strokeMesh, width / 2, dashTexture, dashLength);
  }
}


/**
 * Draws the halo of a selected feature: dashed yellow lines along the rings, in a batch of
 * lines whose dashes march (see `LineBatchMesh`, and `PixiLayerMapUI.haloBatchAt`). Each ring is
 * two lines there, a dark one and the dashes over it. Call it again with the same list for
 * other rings (they're written where the old ones were if they have as many points), and with
 * no rings to take the halo away.
 * @param batch - The batch to draw in
 * @param items - The feature's halo in the batch so far. It's brought up to date: two items for each ring.
 * @param rings - The rings to draw, each as `[x, y, x, y, …]` in world units from the place given
 * @param x - Where the rings' coordinates start, in the world
 * @param y - The same, for y
 */
export function drawHalo(batch: LineBatchMesh, items: LineBatchMeshItem[], rings: ArrayLike<number>[], x: number, y: number): void {
  const dx = x - batch.position.x;
  const dy = y - batch.position.y;

  for (let i = 0; i < rings.length; i++) {
    // (a miter longer than the line is wide becomes a bevel: an outline can turn sharply)
    const strokeMesh = geomStrokeMesh(rings[i], { closed: true, cap: 'butt', join: 'miter', miterLimit: 2 });
    for (let k = 0; k < 2; k++) {
      const style = k ? HALO_DASHES : HALO_UNDER;
      const item = items[i * 2 + k];
      if (item?.batch === batch) {
        batch.setStroke(item, strokeMesh, dx, dy);
        batch.setStyle(item, style);
      } else {
        item?.batch?.remove(item);
        items[i * 2 + k] = batch.add(strokeMesh, dx, dy, style, k);
      }
    }
  }

  while (items.length > rings.length * 2) {   // a ring fewer than before
    const item = items.pop()!;
    item.batch?.remove(item);
  }
}


/**
 * Returns a PIXI.Sprite that covers the given box, used for debugging.
 * @param   x      - left of the box
 * @param   y      - top of the box
 * @param   w      - width of the box
 * @param   h      - height of the box
 * @param   tint   - tint of the box (number, or something Pixi accepts as a color)
 * @param   alpha  - alpha of the box
 * @param   label  - name of the box, optional
 * @return  Sprite for the box
 */
export function getDebugBBox(
  x: number,
  y: number,
  w: number,
  h: number,
  tint?: number,
  alpha?: number,
  label?: string
): PIXI.Sprite {
  const sprite = new PIXI.Sprite({ texture: PIXI.Texture.WHITE });
  sprite.eventMode = 'none';
  sprite.anchor.set(0, 0);   // left, top
  sprite.position.set(x, y);
  sprite.width = w;
  sprite.height = h;
  sprite.tint = tint ?? 0xffff33;  // yellow
  sprite.alpha = alpha ?? 0.65;
  if (label) sprite.label = label;
  return sprite;
}


/**
 * Says which of two features is drawn later, and so is on top where they overlap: by where
 * each is drawn in the scene (`sceneContainer`, see `drawOrder`), and for two that the same
 * mesh draws (lines in one batch), by their order in it.
 * @param a - A feature
 * @param b - Another
 * @return A positive number if `a` is drawn after `b`, a negative one if before, and 0 if it can't be said
 */
export function featureOrder(a: AbstractPixiFeature, b: AbstractPixiFeature): number {
  const containerA = a.sceneContainer;
  const containerB = b.sceneContainer;
  if (containerA !== containerB) return drawOrder(containerA, containerB);
  return a.sceneOrder - b.sceneOrder;
}


/** A polygon to triangulate: an outer ring and the holes in it, each as `[x, y, x, y, …]` */
export interface RingPolygon {
  outer: ArrayLike<number>;
  holes: ArrayLike<number>[];
}

/** The triangles that fill some polygons: their corners, and three indices of corners for each */
export interface Triangles {
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
}


/**
 * Works out the triangles that fill polygons, for a `FillBatchMesh`. (With `earcut`, which Pixi
 * uses for its own fills and exports.) The corners are the polygons' own points, in order, so
 * the result has as many as the rings have points.
 * @param polygons - The polygons, each with its holes
 * @return The triangles of all of them
 */
export function triangulate(polygons: RingPolygon[]): Triangles {
  let numFloats = 0;
  for (const polygon of polygons) {
    numFloats += polygon.outer.length;
    for (const hole of polygon.holes) {
      numFloats += hole.length;
    }
  }

  const positions = new Float32Array(numFloats);
  const all: number[] = [];
  let first = 0;    // the first corner of the polygon that's being worked on

  for (const polygon of polygons) {
    const coords: number[] = [];
    const holeStarts: number[] = [];
    const addRing = (ring: ArrayLike<number>): void => {
      const start = coords.length;
      for (let i = 0; i < ring.length; i++) {
        coords[start + i] = ring[i];
      }
    };
    addRing(polygon.outer);
    for (const hole of polygon.holes) {
      holeStarts.push(coords.length / 2);
      addRing(hole);
    }

    positions.set(coords, first * 2);
    for (const index of PIXI.earcut(coords, holeStarts, 2)) {
      all.push(index + first);
    }
    first += coords.length / 2;
  }

  const indices = (first < 65536) ? new Uint16Array(all) : new Uint32Array(all);
  return { positions: positions, indices: indices };
}


/**
 * Whether a point is inside rings, by the even-odd rule: inside an outer ring and not in a hole
 * of it, whichever way the rings go around.
 * @param rings - The rings, each as `[x, y, x, y, …]`
 * @param x - The point
 * @param y - The point
 * @return `true` if it's inside
 */
export function ringsContain(rings: ArrayLike<number>[], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const yi = ring[i + 1];
      const yj = ring[j + 1];
      if ((yi > y) !== (yj > y) && x < (ring[j] - ring[i]) * (y - yi) / (yj - yi) + ring[i]) {
        inside = !inside;
      }
    }
  }
  return inside;
}

