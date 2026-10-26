import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { GeometryPart } from '../lib/GeometryPart.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';
import { projWorldToWgs84 } from '@rapid-sdk/math';

import type { AbstractData } from '../data/AbstractData.ts';
import type { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import type { ConflationStatus } from '../core/ConflationSystem.ts';
import type { PixiScene } from './PixiScene.ts';
import type { StyleProps } from '../lib/Style.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


/** Marker colors for each conflation status */
const STATUS_COLORS: Record<ConflationStatus, number> = {
  matched:   0x00cc44,   // green
  unmatched: 0xff3333,   // red
  unknown:   0x999999    // gray
};

/** Marker color for join points */
const JOIN_COLOR = 0x3399ff;   // blue


/**
 * This class renders debug map data.
 * The debug layer is disabled by default.
 *
 * It currently shows how conflation sees each Rapid dataset that has conflation turned on:
 * a dot at each coverage box, colored by its status, and a larger blue dot where each
 * run would join an existing OSM way. This is useful when tuning a dataset's matching rules.
 */
export class PixiLayerDebug extends AbstractPixiLayer {

  /** What each marker was last drawn as (its kind and location). When this changes, the marker is rebuilt. */
  protected _drawnAs: WeakMap<AbstractPixiFeature, string>;


  /**
   * @param scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'debug';
    this.enabled = false;
    this._drawnAs = new WeakMap<AbstractPixiFeature, string>();
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  public reset(): void {
    super.reset();

    // Items in this layer don't actually need to be interactive
    for (const groupID of ['debug-under', 'debug-over']) {
      const groupContainer = this.scene.groups.get(groupID)!;
      groupContainer.eventMode = 'none';
    }
  }


  /**
   * Render any data we have for this layer
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
    if (!this.enabled) return;

    const context = this.context;
    const conflation = context.systems.conflation;   // optional
    const rapid = context.systems.rapid;             // optional
    const spatial = context.systems.spatial!;

    if (!conflation || !rapid) return;

    for (const ds of rapid.datasets.values()) {
      if (!rapid.enabledDatasetIDs.has(ds.id) || !conflation.isEnabled(ds)) continue;

      for (const item of spatial.getVisibleItems(ds.spatialID)) {
        const d = item.contents as AbstractData;
        const result = conflation.getResult(ds, d);
        if (!result) continue;

        const prefix = `${this.layerID}-${ds.id}-${d.id}`;
        result.boxes?.forEach((box, i) => {
          const loc = projWorldToWgs84(box.coord);
          this._renderMarker(`${prefix}-box${i}`, loc, box.status, frame, viewport);
        });

        result.runs?.forEach((run, i) => {
          if (run.startJoin) this._renderMarker(`${prefix}-run${i}-start`, run.startJoin.loc, 'join', frame, viewport);
          if (run.endJoin)   this._renderMarker(`${prefix}-run${i}-end`, run.endJoin.loc, 'join', frame, viewport);
        });
      }
    }
  }


  /**
   * Draws one debug marker.
   * @param featureID - Unique id for the marker
   * @param loc - Where to draw it (WGS84)
   * @param kind - A conflation status, or `'join'`
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  protected _renderMarker(featureID: string, loc: Vec2, kind: ConflationStatus | 'join', frame: number, viewport: Viewport): void {
    let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;
    if (!feature) {
      feature = new PixiFeaturePoint(this, featureID);
      feature.allowInteraction = false;
      feature.parentContainer = this.scene.groups.get('debug-over')!;   // above the Rapid lines
    }

    // Box locations change when the buffer changes, and statuses change after edits.
    const drawnAs = `${kind}@${loc[0]},${loc[1]}`;
    if (this._drawnAs.get(feature) !== drawnAs) {
      this._drawnAs.set(feature, drawnAs);

      const part = new GeometryPart(this.context);
      part.setData({ type: 'Point', coordinates: loc });
      feature.geometry = part;

      const isJoin = (kind === 'join');
      feature.style = {
        marker: {
          color: isJoin ? JOIN_COLOR : STATUS_COLORS[kind],
          image: isJoin ? 'mediumCircle' : 'smallCircle'
        }
      } as Partial<StyleProps>;
    }

    if (feature.dirty) {
      feature.update(viewport);
    }
    this.retainFeature(feature, frame);
  }

}
