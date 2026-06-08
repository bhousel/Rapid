import * as PIXI from 'pixi.js';
import { AbstractPixiFeature } from './AbstractPixiFeature.ts';

import type { PixiFeatureProps } from './AbstractPixiFeature.ts';
import type { PixiLayerLabels } from './PixiLayerLabels.ts';
import type { Viewport } from '@rapid-sdk/math';


/** Properties for a text label (placed on a point feature). */
export interface TextLabelProps extends PixiFeatureProps {
  kind: 'text';
  str: string;
  style: 'normal' | 'italic';
  /** Texture frame width in CSS pixels (includes any padding). */
  width: number;
  /** Texture frame height in CSS pixels (includes any padding). */
  height: number;
  /** Screen-space (label-coord) anchor for the label. */
  x: number;
  y: number;
  /** Tint applied to the display object. */
  tint: number;
}


/** Properties for a rope label (placed along a line or polygon perimeter). */
export interface RopeLabelProps extends PixiFeatureProps {
  kind: 'rope';
  str: string;
  style: 'normal' | 'italic';
  width: number;
  height: number;
  /** Polyline vertices (label-coord space) the rope follows. */
  coords: number[][];
  tint: number;
}


export type PixiFeatureLabelProps = TextLabelProps | RopeLabelProps;


/**
 * This class renders a Label feature.
 *
 * `PixiLayerLabels` is responsible for _placement_ (RBush math, collision
 * avoidance) and stores a `LabelProps` placeholder for every possible label.
 * Each `PixiFeatureLabel` is created lazily, only when its placeholder first
 * comes into view (mirrors how other managed-feature layers like
 * `PixiLayerKeepRight` create their features on demand inside `render()`).
 *
 * The feature owns its child display object (Sprite, BitmapText, or MeshRope)
 * and materializes / styles it on `update()`.
 *
 * Lifecycle (typical):
 *   1. Layer's placement step stores a `LabelProps` placeholder under some `labelID`.
 *   2. On the first frame the placeholder is in view, the layer creates a
 *      `PixiFeatureLabel(this, labelID)`, assigns `parentContainer` and `props`,
 *      then calls `update()` and `retainFeature()`.
 *   3. `update()` looks up the label texture (or queues it) and adds the
 *      display object as a child of `container` once ready.
 *   4. When the placeholder scrolls out of view, `AbstractPixiLayer.cull()`
 *      eventually destroys the feature; the placeholder remains in `_placeholders`
 *      and can rebuild a feature if it comes back into view.
 *
 * Labels do not participate in hit testing and do not draw halos.
 *
 * Properties available:
 * - `props`   The label generation properties (text or rope) including its placement
 * - `display` The child display object (Sprite, BitmapText, or MeshRope), or null until built
 * - (also all properties inherited from `AbstractPixiFeature`)
 */
export class PixiFeatureLabel extends AbstractPixiFeature {

  /** Narrow the inherited `layer` reference so we can call `resolveLabelTexture()`. */
  public declare layer: PixiLayerLabels;
  /** Narrows the inherited `PixiFeatureProps` props to `PixiFeatureLabelProps` */
  public declare props: PixiFeatureLabelProps;
  /** The child display object — Sprite, BitmapText, or MeshRope (null until built) */
  public display: PIXI.Container | null;


  /**
   * @constructor
   * @param layer - The `PixiLayerLabels` layer that owns this Feature
   * @param featureID - Unique string identifier for this label
   */
  public constructor(layer: PixiLayerLabels, featureID: FeatureID) {
    super(layer, featureID);

    // Labels don't emit pointer events and don't need halos.
    this._allowInteraction = false;
    this.container.eventMode = 'none';
    this.container.sortableChildren = false;

    this.display = null;

    this._styleDirty = true;
    this._geomDirty = false;  // placement is precomputed; geometry doesn't update per-frame
  }


  /**
   * Every Feature should have a destroy function that frees all the resources.
   * Do not use the Feature after calling `destroy()`.
   */
  public destroy(): void {
    if (this.display) {
      this.display.destroy({ children: true });
      this.display = null;
    }
    super.destroy();
  }


  /**
   * Builds the child display object on first call (if its texture is ready),
   * then keeps tint / position in sync on subsequent calls.  Stays dirty if
   * the texture is not yet ready, so the layer will retry next frame.
   * @param viewport - Pixi viewport (unused — label placement is precomputed in layer space)
   * @param _viewport
   */
  public update(_viewport: Viewport): void {
    if (!this._styleDirty || !this.props) return;

    if (this.props.kind === 'text') {
      this._updateText(this.props as TextLabelProps);
    } else if (this.props.kind === 'rope') {
      this._updateRope(this.props as RopeLabelProps);
    }
  }


  /**
   * Labels don't show halos.
   * @override
   */
  public updateHalo(): void {
  }


  /**
   * Build or restyle a text label.
   * If the text only uses plain ASCII characters, use `PIXI.BitmapText` for speed.
   * Otherwise generate a label texture and make a `PIXI.Sprite`.
   * @param props   The properties for the Text Label to create
   */
  protected _updateText(props: TextLabelProps): void {
    if (!this.display) {
      // Is it in the printable ASCII range?  If so, `Pixi.BitmapText` should be faster..
      const useBitmap = /^[\x20-\x7E]*$/.test(props.str);
      if (useBitmap) {
        const bitmap = new PIXI.BitmapText({
          text: props.str,
          style: {
            fontFamily: 'label-normal',
            fontSize: 12
          }
        });
        bitmap.label = props.str;
        bitmap.anchor.set(0.5, 0.5);   // middle, middle
        bitmap.position.set(props.x, props.y);
        this.display = bitmap;

      } else {
        const texture = this.layer.resolveLabelTexture(props.str, props.style);
        if (!texture) return;   // not ready — stay dirty
        const sprite = new PIXI.Sprite({ texture });
        sprite.label = props.str;
        sprite.anchor.set(0.5, 0.5);
        sprite.position.set(props.x, props.y);
        this.display = sprite;
      }
      this.container.addChild(this.display);
    }

    this.display.tint = props.tint || 0xffffff;
    this._styleDirty = false;
  }


  /**
   * Build or restyle a rope label.
   * @param props
   */
  protected _updateRope(props: RopeLabelProps): void {
    if (!this.display) {
      const texture = this.layer.resolveLabelTexture(props.str, props.style);
      if (!texture) return;   // not ready — stay dirty

      const points = props.coords.map(([x, y]) => new PIXI.Point(x, y));
      const rope = new PIXI.MeshRope({ texture, points });
      rope.label = this.id;
      rope.autoUpdate = false;
      rope.sortableChildren = false;
      this.display = rope;
      this.container.addChild(rope);
    }

    this.display.tint = props.tint || 0xffffff;
    this._styleDirty = false;
  }
}
