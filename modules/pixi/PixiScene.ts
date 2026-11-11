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

import type { AbstractMode } from '../modes/AbstractMode.ts';
import type { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import type { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import type { Context } from '../Context.ts';
import type { GraphicsSystem } from '../core/GraphicsSystem.ts';
import type { Viewport } from '@rapid-sdk/math';

/** Returned by `getClasses()` for data that has no classes */
const EMPTY_CLASSES: ReadonlySet<ClassID> = new Set<ClassID>();


/**
 * This class manages the collections of known `Layers` and `Features` in the scene.
 * It is responsible for rendering and culling all of the data in our scene graph.
 * See `design/scene.md` for how the scene is stacked and what the pointer can reach.
 *
 * Features are organized into thematic Layers that can be enabled or disabled if needed.
 * Each Layer is responsible for managing its own data and Features.
 * Features go under the container for their spatial ID in the appropriate group
 * (`getSpatialContainer`), never straight into the group.
 *
 * Notes on identifiers:
 *  - `GroupID` - A unique identifier for the group (a parent PIXI.container)
 *  - `LayerID` - A unique identifier for the layer, for example 'osm'
 *  - `SpatialID` - The ID of the data cache a feature's data comes from, for example 'osm' or 'fbRoads'
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

  /** Map of dataID to Set of classIDs */
  protected _dataHasClass: Map<DataID, Set<ClassID>>;
  /** Map of classID to Set of dataIDs */
  protected _classHasData: Map<ClassID, Set<DataID>>;
  /** The containers made for each spatial ID, one per group it has drawn in */
  protected _spatialContainers: Map<SpatialID, Set<PIXI.Container>>;
  /** Spatial IDs the pointer can reach in the current mode, or `null` for all of them */
  protected _interactiveSpatialIDs: ReadonlySet<SpatialID> | null;


  /**
   * @param gfx - The GraphicsSystem that owns this Scene
   */
  public constructor(gfx: GraphicsSystem) {
    super();
    this.gfx = gfx;
    this.context = gfx.context;

    this.groups = new Map<GroupID, PIXI.Container>();
    this.layers = new Map<LayerID, AbstractPixiLayer>();
    this.features = new Map<FeatureID, AbstractPixiFeature>();

    // Data <-> Class
    // Data classes are strings (like what CSS classes used to do for us)
    // Counterintuitively, the Scene needs to be the source of truth for these data classes,
    // because a Feature can be 'selected' or 'drawing' even before it has been created, or after destroyed
    this._dataHasClass = new Map<DataID, Set<ClassID>>();
    this._classHasData = new Map<ClassID, Set<DataID>>();

    this._spatialContainers = new Map<SpatialID, Set<PIXI.Container>>();
    this._interactiveSpatialIDs = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._layerChanged = this._layerChanged.bind(this);
    this._modeChanged = this._modeChanged.bind(this);

    this.context.on('modechange', this._modeChanged);

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
      'debug-over',   // Debug that appears over the basemap
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

    this._dataHasClass.clear();       // maybe don't clear this (should pseudo css survive a reset?)
    this._classHasData.clear();       // maybe don't clear this (should pseudo css survive a reset?)

    // Reset/setup render layers.  (Each layer releases the spatial containers it asked for.)
    for (const layer of this.layers.values()) {
      layer.reset();
    }

    this._modeChanged(this.context.mode);
    this._layerChanged();
  }


  /**
   * Returns the container for the given spatial ID in the given group, making it if needed.
   * Layers put their features here (or in sub-containers they make under it), never straight into
   * the group, so the scene can keep whole datasets from the pointer (see `design/scene.md`).
   * OSM's container is lowest in its group; the others stack above it in the order they were made.
   * @param groupID - The group, e.g. 'basemap' or 'points'
   * @param spatialID - The spatial ID of the data drawn in it, e.g. 'osm' or 'fbRoads'
   * @return The container, with `sortableChildren` on
   * @throws Error if there is no such group
   */
  public getSpatialContainer(groupID: GroupID, spatialID: SpatialID): PIXI.Container {
    const group = this.groups.get(groupID);
    if (!group) {
      throw new Error(`PixiScene: no group '${groupID}'`);
    }

    let container = group.getChildByLabel(spatialID) as PIXI.Container | null;
    if (container) return container;

    const siblings = group.children.filter(child => child.label !== 'osm').length;
    container = new PIXI.Container();
    container.label = spatialID;
    container.sortableChildren = true;
    container.zIndex = (spatialID === 'osm') ? 0 : siblings + 1;
    container.eventMode = this._isInteractive(spatialID) ? 'passive' : 'none';
    group.addChild(container);

    let containers = this._spatialContainers.get(spatialID);
    if (!containers) {
      containers = new Set<PIXI.Container>();
      this._spatialContainers.set(spatialID, containers);
    }
    containers.add(container);

    return container;
  }


  /**
   * Removes and destroys the containers made for the given spatial ID, in every group.
   * Their features should have been destroyed already (the layer does this in `reset()`).
   * @param spatialID - The spatial ID
   */
  public releaseSpatialContainers(spatialID: SpatialID): void {
    const containers = this._spatialContainers.get(spatialID);
    if (!containers) return;

    for (const container of containers) {
      container.parent?.removeChild(container);
      container.destroy({ children: true });  // recursive
    }
    this._spatialContainers.delete(spatialID);
  }


  /**
   * Whether the pointer can reach the data with the given spatial ID in the current mode.
   * @param spatialID - The spatial ID, e.g. 'osm' or 'fbRoads'
   * @return `true` if that data's features can be hovered and clicked
   */
  protected _isInteractive(spatialID: SpatialID): boolean {
    return this._interactiveSpatialIDs === null || this._interactiveSpatialIDs.has(spatialID);
  }


  /**
   * Applies the new mode's `interactiveSpatialIDs` to the spatial containers:
   * the pointer skips the whole subtree of a spatial ID the mode doesn't list.
   * @param mode - The mode just entered, or `null` before there is one
   */
  protected _modeChanged(mode: AbstractMode | null): void {
    this._interactiveSpatialIDs = mode?.interactiveSpatialIDs ?? null;

    for (const [spatialID, containers] of this._spatialContainers) {
      const eventMode = this._isInteractive(spatialID) ? 'passive' : 'none';
      for (const container of containers) {
        container.eventMode = eventMode;
      }
    }
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
   * Makes sure the given data is shown, e.g. when a link selects it: the first Layer that draws each
   * datum turns on (and a Rapid dataset's data also turns its dataset on). Other layers are not affected.
   * @param dataIDs - The data IDs, e.g. `['w1', 'osm-notes:123']`
   */
  public showData(dataIDs: OneOrMore<DataID>): void {
    const wasEnabled = new Set<LayerID>([...this.layers.values()].filter(layer => layer.enabled).map(layer => layer.id));

    for (const dataID of utilIterable(dataIDs)) {
      for (const layer of this.layers.values()) {
        if (layer.drawsData(dataID)) {
          layer.showData(dataID);
          break;
        }
      }
    }

    for (const layer of this.layers.values()) {
      if (layer.enabled !== wasEnabled.has(layer.id)) {
        this._layerChanged();
        break;
      }
    }
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
   * Sets a dataID as being classed a certain way (e.g. 'hover').
   * Data IDs are unique across Rapid, so whichever layer draws the data shows the class
   * (see `design/data-ids.md`).
   * @param classID - classID (e.g. 'hover')
   * @param dataID - dataID (e.g. 'r123', 'fbRoads:w-1')
   */
  public setClass(classID: ClassID, dataID: DataID): void {
    let classIDs = this._dataHasClass.get(dataID);
    if (!classIDs) {
      classIDs = new Set<ClassID>();
      this._dataHasClass.set(dataID, classIDs);
    }
    classIDs.add(classID);

    let dataIDs = this._classHasData.get(classID);
    if (!dataIDs) {
      dataIDs = new Set<DataID>();
      this._classHasData.set(classID, dataIDs);
    }
    dataIDs.add(dataID);
  }


  /**
   * Unsets a dataID from being classed a certain way (e.g. 'hover')
   * @param classID - classID (e.g. 'hover')
   * @param dataID - dataID (e.g. 'r123')
   */
  public unsetClass(classID: ClassID, dataID: DataID): void {
    const classIDs = this._dataHasClass.get(dataID);
    if (classIDs) {
      classIDs.delete(classID);
      if (!classIDs.size) {
        this._dataHasClass.delete(dataID);
      }
    }

    const dataIDs = this._classHasData.get(classID);
    if (dataIDs) {
      dataIDs.delete(dataID);
      if (!dataIDs.size) {
        this._classHasData.delete(classID);
      }
    }
  }


  /**
   * Clear out all uses of the given classID.
   * @param classID - classID (e.g. 'hover')
   */
  public clearClass(classID: ClassID): void {
    const dataIDs = this._classHasData.get(classID) ?? new Set<DataID>();
    for (const dataID of dataIDs) {
      this.unsetClass(classID, dataID);
    }
  }


  /**
   * Returns the dataIDs that are currently classed with the given classID
   * @param classID - classID to check (e.g. 'hover')
   * @return The dataIDs that currently have this classID set (a copy)
   */
  public getDataWithClass(classID: ClassID): Set<DataID> {
    const dataIDs = this._classHasData.get(classID) ?? new Set<DataID>();
    return new Set<DataID>(dataIDs);  // copy
  }


  /**
   * Returns the classIDs that the given dataID is classed with.
   * @param dataID - dataID to check (e.g. 'r123')
   * @return The classIDs (don't modify it)
   */
  public getClasses(dataID: DataID): ReadonlySet<ClassID> {
    return this._dataHasClass.get(dataID) ?? EMPTY_CLASSES;
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
