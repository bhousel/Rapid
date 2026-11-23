import * as PIXI from 'pixi.js';
import { geomStrokeMesh } from '../geo/index.ts';
import { LineMesh } from './lib/LineMesh.ts';

import type { PixiTextures } from './PixiTextures.ts';


// The halo around what's selected: a yellow line 2 pixels wide, in dashes of 6 with gaps of 3.
const HALO_COLOR = 0xffff00;
const HALO_ALPHA = 0.9;
const HALO_WIDTH = 2;
const HALO_DASH = [6, 3];


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
