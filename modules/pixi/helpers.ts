import * as PIXI from 'pixi.js';
import { geomStrokeMesh } from '../geo/index.ts';
import { LineMesh } from './lib/LineMesh.ts';

import type { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import type { PixiTextures } from './PixiTextures.ts';


// The halo around what's selected: a yellow line 2 pixels wide, in dashes of 6 with gaps of 3.
const HALO_COLOR = 0xffff00;
const HALO_ALPHA = 0.9;
const HALO_WIDTH = 2;
const HALO_DASH = [6, 3];

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
 * Draws the halo of a selected feature: dashed yellow lines along the rings.
 * @param halo - The feature's halo container (see `drawRings`)
 * @param rings - The rings to draw, in the container's coordinates
 * @param scale - How many of those coordinates a screen pixel is
 * @param textures - The texture manager, for the dash pattern
 */
export function drawHalo(halo: PIXI.Container, rings: ArrayLike<number>[], scale: number, textures: PixiTextures): void {
  let dashLength = 0;
  for (const part of HALO_DASH) {
    dashLength += part * scale;
  }
  halo.tint = HALO_COLOR;
  halo.alpha = HALO_ALPHA;
  drawRings(halo, rings, HALO_WIDTH * scale, textures.getDashTexture(HALO_DASH), dashLength);
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
