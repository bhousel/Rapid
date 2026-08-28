import * as PIXI from 'pixi.js';
import { EventEmitter } from 'tseep/lib/ee-safe';
import { PixiLayerBackgroundTiles } from './PixiLayerBackgroundTiles.ts';
import { PixiLayerCustomData } from './PixiLayerCustomData.ts';
import { PixiLayerDebug } from './PixiLayerDebug.ts';
import { PixiLayerEditBlocks } from './PixiLayerEditBlocks.ts';
import { PixiLayerKartaPhotos } from './PixiLayerKartaPhotos.ts';
import { PixiLayerKeepRight } from './PixiLayerKeepRight.ts';
import { PixiLayerLabels } from './PixiLayerLabels.ts';
import { PixiLayerMapillaryDetections } from './PixiLayerMapillaryDetections.ts';
import { PixiLayerMapillaryPhotos } from './PixiLayerMapillaryPhotos.ts';
import { PixiLayerMapillarySigns } from './PixiLayerMapillarySigns.ts';
import { PixiLayerMapRoulette } from './PixiLayerMapRoulette.ts';
import { PixiLayerMapUI } from './PixiLayerMapUI.ts';
import { PixiLayerOsm } from './PixiLayerOsm.ts';
import { PixiLayerOsmNotes } from './PixiLayerOsmNotes.ts';
import { PixiLayerOsmose } from './PixiLayerOsmose.ts';
import { PixiLayerRapid } from './PixiLayerRapid.ts';
import { PixiLayerStreetsidePhotos } from './PixiLayerStreetsidePhotos.ts';
import { PixiLayerGeoScribble } from './PixiLayerGeoScribble.ts';
import { utilIterable, type OneOrMore } from '../util/iterable.ts';

import type { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { Context } from '../Context.ts';
import type { GraphicsSystem } from '../core/GraphicsSystem.ts';
import type { Viewport } from '@rapid-sdk/math';


/**
 * This class manages the collections of known `Layers` and `Features` in the scene.
 * It is responsible for rendering and culling all of the data in our scene graph.
 *
 * Features are organized into thematic Layers that can be enabled or disabled if needed.
 * Each Layer is responsible for managing its own data and Features.
 * Features must be added to an appropriate group parent container.
 *
 * Notes on identifiers:
 *  - `GroupID` - A unique identifier for the group (a parent PIXI.container)
 *  - `LayerID` - A unique identifier for the layer, for example 'osm'
 *  - `FeatureID` - A unique identifier for the feature, for example 'osm-w-123-fill'
 *  - `DataID` - A feature may have data bound to it, for example OSM identifier like 'w-123'
 *  - `ClassID` - A pseudoclass identifier like 'hover' or 'select'
 *
 * Properties available:
 * - `groups`     `Map<GroupID, PIXI.Container>` of all groups
 * - `layers`     `Map<LayerID, Layer>` of all layers in the scene
 * - `features`   `Map<FeatureID, Feature>` of all features in the scene
 *
 * Events available:
 * - `layerchange`   Fires when layers are toggled from enabled/disabled
 */
export class PixiScene extends EventEmitter {

  /** Reference to the owning GraphicsSystem */
  public gfx: GraphicsSystem;
  /** Global shared application context */
  public context: Context;
  /** Top-level Pixi containers that group layers (e.g. 'basemap', 'points', 'ui') */
  public groups: Map<GroupID, PIXI.Container>;
  /** All registered layers, keyed by LayerID */
  public layers: Map<LayerID, AbstractPixiLayer>;
  /** All registered features, keyed by FeatureID */
  public features: Map<FeatureID, AbstractPixiFeature>;


  /**
   * @constructor
   * @param gfx - The GraphicsSystem that owns this Scene
   */
  public constructor(gfx: GraphicsSystem) {
    super();
    this.gfx = gfx;
    this.context = gfx.context;

    this.groups = new Map<GroupID, PIXI.Container>();
    this.layers = new Map<LayerID, AbstractPixiLayer>();
    this.features = new Map<FeatureID, AbstractPixiFeature>();

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._layerChanged = this._layerChanged.bind(this);

    // Create Layers
    [
      new PixiLayerBackgroundTiles(this),
      new PixiLayerDebug(this),
      new PixiLayerGeoScribble(this),

      new PixiLayerOsm(this),
      new PixiLayerRapid(this),

      new PixiLayerMapillaryDetections(this),
      new PixiLayerMapillarySigns(this),

      new PixiLayerCustomData(this),
      new PixiLayerMapRoulette(this),
      new PixiLayerOsmNotes(this),
      new PixiLayerKeepRight(this),
      new PixiLayerOsmose(this),

      new PixiLayerMapillaryPhotos(this),
      new PixiLayerKartaPhotos(this),
      new PixiLayerStreetsidePhotos(this),

      new PixiLayerLabels(this),
      new PixiLayerEditBlocks(this),
      new PixiLayerMapUI(this)
    ].forEach(layer => this.layers.set(layer.id, layer));

    this.reset();
  }


  /**
   * Replace any Pixi objects and internal state.
   * Also calls each Layer's `reset' method to do the same for that layer.
   */
  public reset(): void {
    const gfx = this.gfx;
    const origin = gfx.origin;
    if (!origin) return;   // need the `origin` container to exist first

    // Ensure that Group Containers have been added to the `origin`.
    // Groups are pre-established Containers that the Layers can add
    // their Features to, so that the scene can be sorted reasonably.
    [
      'background',   // Background imagery
      'debug-under',  // Debug that appears under everything
      'basemap',      // Editable basemap (OSM/Rapid)
      'points',       // Editable points (OSM/Rapid)
      'streetview',   // Streetview imagery, sequences
      'qa',           // Q/A items, issues, notes
      'labels',       // Text labels
      'blocks',       // Blocked out regions
      'ui'            // Misc UI draw above everything (select lasso, geocoding circle, debug shapes)
    ].forEach((groupID, i) => {
      let container = this.groups.get(groupID);
      if (!container) {
        container = new PIXI.Container();
        container.label = groupID;
        container.sortableChildren = true;
        container.zIndex = i;
        this.groups.set(groupID, container);
      }
      if (!origin.getChildByLabel(groupID)) {
        origin.addChild(container);
      }
    });

    // Reset/setup render layers.
    for (const layer of this.layers.values()) {
      layer.reset();
    }

    this._layerChanged();
  }


  /**
   * Calls each Layer's `render` and `cull` methods
   * - `render` will create and update the Features that belong in the scene
   * - `cull` will make invisible or destroy Features that aren't in the scene anymore
   *
   * This process happens on a layer-by-layer basis for several reasons.
   * - We don't have a full picture of what all will be included in the scene until we actually
   *   call down to each layer's render method. It depends on where on the map the user is
   *   looking. This is different from a normal game where the scene is set up ahead of time.
   * - For proper label placement, we really need to cull the feature layers
   *   before we render the label layer, so we do these calls in layer order.
   *
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
    // Groups that live under `origin` render in world coordinates;
    // the `origin` container (set up in `GraphicsSystem._app`) provides the position
    // and scale that maps world coords → screen coords. Group containers themselves
    // need no extra transform (except the `labels` group which renders in screen space).
    for (const layer of this.layers.values()) {
      layer.render(frame, viewport);
      layer.cull(frame);
    }
  }


  /**
   * Enables the layers with the given layerIDs, other layers will not be affected
   * @param layerIDs - layerIDs to enable
   */
  public enableLayers(layerIDs: OneOrMore<LayerID>): void {
    for (const layerID of utilIterable(layerIDs)) {
      const layer = this.layers.get(layerID);
      if (layer) {
        layer.enabled = true;
      }
    }
    this._layerChanged();
  }


  /**
   * Disables the layers with the given layerIDs, other layers will not be affected
   * @param layerIDs - layerIDs to disable
   */
  public disableLayers(layerIDs: OneOrMore<LayerID>): void {
    for (const layerID of utilIterable(layerIDs)) {
      const layer = this.layers.get(layerID);
      if (layer) {
        layer.enabled = false;
      }
    }
    this._layerChanged();
  }


  /**
   * Toggles the layers with the given layerIDs, other layers will not be affected
   * @param layerIDs - layerIDs to toggle
   */
  public toggleLayers(layerIDs: OneOrMore<LayerID>): void {
    for (const layerID of utilIterable(layerIDs)) {
      const layer = this.layers.get(layerID);
      if (layer) {
        layer.enabled = !layer.enabled;
      }
    }
    this._layerChanged();
  }


  /**
   * LayerIDs in the given list will be enabled, all others will be disabled
   * @param layerIDs - layerIDs to keep enabled
   */
  public onlyLayers(layerIDs: OneOrMore<LayerID>): void {
    const toEnable = new Set<LayerID>(utilIterable(layerIDs));
    for (const layer of this.layers.values()) {
      layer.enabled = toEnable.has(layer.id);
    }
    this._layerChanged();
  }


  /**
   * Add a feature to the scene feature cache.
   * @param feature - A render feature (point, line, multipolygon)
   */
  public addFeature(feature: AbstractPixiFeature): void {
    this.features.set(feature.id, feature);
  }


  /**
   * Remove a Feature from the scene feature cache.
   * @param feature - A render feature (point, line, multipolygon)
   */
  public removeFeature(feature: AbstractPixiFeature): void {
    this.features.delete(feature.id);
  }


  /**
   * Sets a dataID as being classed a certain way (e.g. 'hover')
   * @param classID - classID (e.g. 'hover')
   * @param layerID - layerID (e.g. 'osm')
   * @param dataID - dataID (e.g. 'r123')
   */
  public setClass(classID: ClassID, layerID: LayerID, dataID: DataID): void {
    this.layers.get(layerID)?.setClass(classID, dataID);
  }


  /**
   * Unsets a dataID from being classed a certain way (e.g. 'hover')
   * @param classID - classID (e.g. 'hover')
   * @param layerID - layerID (e.g. 'osm')
   * @param dataID - dataID (e.g. 'r123')
   */
  public unsetClass(classID: ClassID, layerID: LayerID, dataID: DataID): void {
    this.layers.get(layerID)?.unsetClass(classID, dataID);
  }


  /**
   * Clear out all uses of the given classID across all layers.
   * @param classID - classID (e.g. 'hover')
   */
  public clearClass(classID: ClassID): void {
    for (const layer of this.layers.values()) {
      layer.clearClass(classID);
    }
  }


  /**
   * Mark the whole scene as `dirty`, for example when changing zooms.
   * During the next "APP" pass, dirty features will be rebuilt.
   */
  public dirtyScene(): void {
    for (const feature of this.features.values()) {
      feature.dirty = true;
    }
  }


  /**
   * Mark all features on a given layer as `dirty`
   * @param layerIDs - layerIDs to flag as 'dirty'
   */
  public dirtyLayers(layerIDs: OneOrMore<LayerID>): void {
    for (const layerID of utilIterable(layerIDs)) {
      this.layers.get(layerID)?.dirtyLayer();
    }
  }


  /**
   * Mark specific features features as `dirty`
   * During the next "APP" pass, dirty features will be rebuilt.
   * @param featureIDs - featureIDs to flag as 'dirty'
   */
  public dirtyFeatures(featureIDs: OneOrMore<FeatureID>): void {
    for (const featureID of utilIterable(featureIDs)) {
      const feature = this.features.get(featureID);
      if (feature) {
        feature.dirty = true;
      }
    }
  }


  /**
   * Mark any features bound to a given dataID as `dirty`
   * DataIDs are only consistent within a Layer, therefore the layerID is required here.
   * @param layerID - layerID that is rendering the data
   * @param dataIDs - dataIDs to flag as 'dirty'
   */
  public dirtyData(layerID: LayerID, dataIDs: OneOrMore<DataID>): void {
    this.layers.get(layerID)?.dirtyData(dataIDs);
  }


  /**
   * Called whenever the enabled layers change.
   * This will trigger a redraw and emit a 'layerchange' event.
   */
  protected _layerChanged(): void {
    this.gfx.immediateRedraw();
    this.emit('layerchange');
  }

}
