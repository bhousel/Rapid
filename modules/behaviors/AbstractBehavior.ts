import { EventEmitter } from 'tseep';
import { vecRotate } from '@rapid-sdk/math';

import type { Context } from '../Context.ts';
import type { AbstractData } from '../data/AbstractData.ts';
import type { AbstractPixiFeature, FeatureContainer } from '../pixi/AbstractPixiFeature.ts';
import type { AbstractPixiLayer } from '../pixi/AbstractPixiLayer.ts';
import type { CoordData } from '../pixi/PixiEvents.ts';
import type { Vec2 } from '@rapid-sdk/math';


/** Target information extracted from Pixi events */
export interface EventTarget {
  /** The PIXI.Container that was targeted */
  container: FeatureContainer;
  /** The PixiFeature, or null */
  feature: AbstractPixiFeature | null;
  /** The feature ID, or null */
  featureID: FeatureID | null;
  /** The PixiLayer, or null */
  layer: AbstractPixiLayer | null;
  /** The layer ID, or null */
  layerID: LayerID | null;
  /** The data associated with the feature */
  data: AbstractData | null;
  /** The data ID, or null */
  dataID: DataID | null;
}


/** Data extracted from pointer events */
export interface EventData {
  /** Pointer ID or type */
  id: number | string;
  /** The original Pixi FederatedEvent */
  event: Event;
  /** The original DOM event */
  originalEvent: Event;
  /** Coordinates in both screen and map space */
  coord: CoordData;
  /** Event timestamp */
  time: number;
  /** Whether the event was cancelled */
  isCancelled: boolean;
  /** Target information, or null if no target */
  target: EventTarget | null;
}


/**
 * "Behaviors" are groups of event handlers that we can
 * enable and disable depending on what the user is doing.
 *
 * `AbstractBehavior` is the base class from which all behaviors inherit.
 * It contains enable/disable methods which manage the event handlers for the behavior.
 * All behaviors are event emitters.
 *
 * Properties available:
 *   `id` (or `behaviorID`)  String identifier for the behavior (e.g. 'draw')
 *   `enabled`               `true` if the event handlers are enabled, `false` if not.
 */
export class AbstractBehavior extends EventEmitter {

  /** Unique string identifier for this behavior (e.g. 'drag', 'draw', 'hover') */
  public id: string;
  /** Global shared application context */
  public context: Context;
  /** Whether this behavior's event handlers are currently active */
  protected _enabled: boolean;


  /**
   * @constructor
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.id = '';
    this.context = context;
    this._enabled = false;
  }


  /**
   * Every behavior should have an `enable` function
   * to setup whatever event handlers this behavior needs
   */
  public enable(): void {
    if (this._enabled) return;
    this._enabled = true;
  }


  /**
   * Every behavior should have a `disable` function
   * to teardown whatever event handlers this behavior needs
   */
  public disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
  }


  /**
   * Unique string to identify this Behavior.
   * @return  The behavior identifier string (e.g. 'draw', 'hover')
   * @readonly
   */
  public get behaviorID(): string {
    return this.id;
  }


  /**
   * Whether the behavior is enabled.
   * @return  `true` if enabled, `false` if not
   * @readonly
   */
  public get enabled(): boolean {
    return this._enabled;
  }

//  /**
//   * _getEventCoord
//   * Returns an [x,y] coordinate of interest for the supplied event.
//   * This can get pretty hairy given the touch and mouse event interactions have different formats.
//   */
//  _getEventCoord(e) {
//    let coord;
//    const oe = e.data.originalEvent;
//    if (oe.offsetX !== undefined) {
//      coord = [oe.offsetX, oe.offsetY];    // mouse coords
//    } else if (oe.layerX !== undefined) {
//      coord = [oe.layerX, oe.layerY];      // ipad coords, seemingly?
//    } else if (oe.touches && oe.touches[0]) {
//      coord = [oe.touches[0].clientX, oe.touches[0].clientY];   // initial touch
//    } else {
//      coord = [oe.changedTouches.clientX, oe.changedTouches.clientY];   // updated touch
//    }
//
//    return coord;
//  }
//

  /**
   * Returns an object containing the important details about this Pixi event.
   * @param  e - A Pixi FederatedEvent (or something that looks like one)
   * @return Object containing data about the event and what was targeted
   */
  protected _getEventData(e: any): EventData {
    const context = this.context;
    const viewport = context.viewport;
    const r = viewport.transform.r;

    // Gather coordinate data.
    const coord: Partial<CoordData> = {};
    coord.screen = [e.global.x, e.global.y] as Vec2;
    coord.map = r ? vecRotate(coord.screen, -r, viewport.center()) : coord.screen;  // remove rotation
    coord.world = viewport.screenToWorld(coord.map);

    const result: EventData = {
      id: e.pointerId ?? e.pointerType ?? 'unknown',
      event: e,
      originalEvent: e.originalEvent,
      coord: coord as CoordData,
      time: e.timeStamp,
      isCancelled: false,
      target: null
    };

    //console.log(`hit: ${e.target?.label}`);

    if (!e.target) {   // `e.target` is the PIXI.Container that triggered this event.
      return result;
    }

    let currContainer: FeatureContainer = e.target;

    // Try to find a target feature - it will have a `__feature__` property.
    // Look up through the scene graph until we find one or end up at the root stage.
    while (currContainer) {
      const feature = currContainer.__feature__;
      if (feature) {
        result.target = {
          container: currContainer,
          feature: feature,
          featureID: feature.id,
          layer: feature.layer,
          layerID: feature.layer.id,
          data: feature.data,
          dataID: feature.data?.id ?? null
        };
        return result;

      } else {
        if (currContainer.parent) {
          currContainer = currContainer.parent;

        } else {  // can't look up any further, just return the original target.
          result.target = {
            container: e.target,
            feature: null,
            featureID: null,
            layer: null,
            layerID: null,
            data: null,
            dataID: null
          };
          return result;
        }
      }
    }

    return result;
  }

}
