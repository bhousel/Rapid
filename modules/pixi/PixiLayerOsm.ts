import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { GeometryPart } from '../lib/GeometryPart.ts';
import { MarkerData } from '../data/MarkerData.ts';
import { PixiFeatureLine } from './PixiFeatureLine.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.ts';
import { projWorldToWgs84, vecAngle, vecLength, vecInterp, WORLD_ZOOM } from '@rapid-sdk/math';
import { type OneOrMore, utilIterable } from '../util/iterable.ts';

import type { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import type { MarkerProps } from '../data/MarkerData.ts';
import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { OsmEntity, OsmNode, OsmRelation, OsmTags, OsmWay } from '../data/types.ts';
import type { PixiLayerMapUI } from './PixiLayerMapUI.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Preset } from '../lib/Preset.ts';
import type { RenderFrame } from './RenderFrame.ts';
import type { Extent, Vec2, Viewport } from '@rapid-sdk/math';


/** Minimum zoom level where OSM data is rendered */
const MINZOOM = 12;

/**
 * Polygons are split into containers by map tile (see `_polygonTileContainer`). The tiles are this many
 * zoom levels from the view's zoom (rounded down): at 1 a tile is 128 to 256 pixels wide on screen.
 * Smaller tiles mean less to rebuild after a change, and more containers to draw (about 110 in view).
 */
const POLYGON_TILE_ZOOM = 1;

/**
 * Lines and points are split the same way (see `_lineTileContainer`, `_pointTileContainer`), with
 * tiles this many zoom levels from the view's zoom: at 0 a tile is 256 to 512 pixels wide.
 * Bigger tiles than the polygons', because lines are split by road class as well, and every
 * container costs a few microseconds on every frame. Measured Nov 2026 in Užice (18,882 lines in
 * level 0, 49,259 points): at 0 there are 580 render groups in the scene and at 1 there are
 * 1,026, and a changed line or a new point costs the same 8 ms of DRAW either way (36 before
 * the split).
 */
const LINE_TILE_ZOOM = 0;
const POINT_TILE_ZOOM = 0;

/** Highway type z-index stacking order (motorway on top, footway on bottom) */
const HIGHWAYSTACK: Record<string, number> = {
  motorway: 0,
  motorway_link: -1,
  trunk: -2,
  trunk_link: -3,
  primary: -4,
  primary_link: -5,
  secondary: -6,
  tertiary: -7,
  unclassified: -8,
  residential: -9,
  service: -10,
  busway: -11,
  track: -12,
  footway: -20
};

/** Visible OSM data sorted by geometry type */
interface OsmData {
  polygons: Map<EntityID, OsmEntity>;
  lines: Map<EntityID, OsmWay>;
  points: Map<EntityID, OsmNode>;
  vertices: Map<EntityID, OsmNode>;
}

/** Related entity IDs for selection/hover/drawing */
interface RelatedIDs {
  descendantIDs: Set<EntityID>;
  siblingIDs: Set<EntityID>;
}

/** The kinds of OSM data the layer draws, as it sorts them in `OsmData` */
type OsmDataKind = keyof OsmData;

/** Entities that a pass saw and made no features for yet, by kind (see `PixiLayerOsm._waitToMake`) */
type UnmadeIDs = Record<OsmDataKind, Set<EntityID>>;

/** The geometry that the entities of each kind have */
const KIND_GEOMETRY: Record<OsmDataKind, GeometryType> = {
  polygons: 'area',
  lines: 'line',
  points: 'point',
  vertices: 'vertex'
};

/**
 * When the layer makes features after its pass (see `_makeWaiting`), it takes this many entities
 * at a time, and checks the frame's time between them. At least one batch is made on every call.
 */
const MAKE_BATCH = 64;

/**
 * How many changed entities the layer draws again one by one (see `_renderChanged`). Beyond this
 * it does its pass, which costs the same whatever changed: about 0.7 µs for each entity in the
 * cull box (207 ms for 296,000 in Užice), where an entity drawn again costs 10 to 40 µs.
 */
const MAX_CHANGED = 5000;

/** Midpoint properties */
interface MidpointProps extends MarkerProps {
  type: 'midpoint';
  serviceID: 'osm';
  id: string;
  wayID: EntityID;
  edge: [EntityID, EntityID];
  dist: number;
  rotation: number;
  coord: Vec2;
}

/* Midpoints are markers that accept the MidpointProps */
type Midpoint = MarkerData<MidpointProps>;

/**
 * Returns z-index for highway tags (for drawing order)
 * @param tags - Entity tags
 * @returns z-index value
 */
function getzIndex(tags: OsmTags): number {
  return HIGHWAYSTACK[tags.highway] || 0;
}


/**
 * Returns a number between 0 and 1 that puts a tile in order among the tiles of its zoom: by row
 * from north to south, then by column. Added to a tile container's `zIndex`, it makes the order
 * between tiles the same on every load, where it would otherwise be the order they were made in.
 * (Within 1,024 tiles each way, far more than a scene holds.)
 * @param tile - The tile's `[x, y]`
 * @returns A number between 0 and 1, not including either
 */
function tileOrder(tile: Vec2): number {
  return (((tile[1] % 1024) * 1024) + (tile[0] % 1024) + 1) / 1048578;
}


/**
 * Returns a number between 0 and 1 that puts an entity in order among others, by its ID. Added to
 * a feature's `zIndex`, it makes the order between features that are otherwise equal the same on
 * every load, where it would otherwise be the order they were made in.
 * @param entityID - The entity's ID, e.g. 'w123'
 * @returns A number from 0 to 1, not including 1
 */
function entityOrder(entityID: EntityID): number {
  const num = Math.abs(parseInt(entityID.slice(1), 10)) || 0;
  return (num % 1048576) / 1048576;
}


/**
 * Checks if entity has any wikidata tags (deserves special styling)
 * @param entity - OSM entity to check
 * @returns true if entity has wikidata tags
 */
function hasWikidata(entity: OsmEntity): boolean {
  const tags = entity.tags as OsmTags;
  return !!(
    tags.wikidata ||
    tags['flag:wikidata'] ||
    tags['brand:wikidata'] ||
    tags['network:wikidata'] ||
    tags['operator:wikidata']
  );
}


/**
 * This class renders OpenStreetMap map data.
 */
export class PixiLayerOsm extends AbstractPixiLayer {

  /** Container for polygon features (`basemap/osm/polygons`) */
  public polygonContainer: PIXI.Container | null;
  /** Container for line features (`basemap/osm/lines`, with a child per level, split by tile) */
  public lineContainer: PIXI.Container | null;
  /** Container for points, vertices and virtual POI pins (`points/osm`, split by tile) */
  public pointContainer: PIXI.Container | null;

  /** The containers that features are split into, by parent and label (see `_tileContainer`) */
  protected _tileContainers: Map<PIXI.Container, Map<string, PIXI.Container>>;
  /** collection of calculated midpoints */
  protected _midpoints: Map<DataID, Midpoint>;
  /** Entities in view that the last pass saw, whose features aren't made yet (see `_waitToMake`) */
  protected _unmadeInView: UnmadeIDs;
  /** The same, for entities outside the view (in the cull box's padding) */
  protected _unmadeOutside: UnmadeIDs;
  /** The related IDs that the last pass worked out, for the vertices made after it */
  protected _lastRelated: RelatedIDs;
  /** Features made after the pass, in the current call to `continueWaiting()` */
  protected _madeCount: number;
  /** Whether features outside the view may be made now (in the scene's call to `continueWaiting()`, when there's time) */
  protected _makingOutside: boolean;
  /** Data whose classes changed since the last pass (see `classChanged`, `_renderChanged`) */
  protected _changedIDs: Set<DataID>;
  /** The features retained while `_renderChanged()` runs, `null` the rest of the time */
  protected _seenFeatureIDs: Set<FeatureID> | null;
  /** Whether the mode changed since the midpoints were last drawn (they're shown in select mode only) */
  protected _modeDirty: boolean;


  /**
   * @param scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'osm';
    this._enabled = true;   // OSM layers should be enabled by default

    this.polygonContainer = null;
    this.lineContainer = null;
    this.pointContainer = null;

    this._tileContainers = new Map<PIXI.Container, Map<string, PIXI.Container>>();
    this._midpoints = new Map<DataID, Midpoint>();
    this._unmadeInView = this._newUnmade();
    this._unmadeOutside = this._newUnmade();
    this._lastRelated = { descendantIDs: new Set<EntityID>(), siblingIDs: new Set<EntityID>() };
    this._madeCount = 0;
    this._makingOutside = false;
    this._changedIDs = new Set<DataID>();
    this._seenFeatureIDs = null;
    this._modeDirty = false;
  }


  /**
   * Whether the Layer's service exists
   * @return  `true` if the OSM service is registered
   */
  public get supported(): boolean {
    return !!this.context.services.osm;
  }


  /**
   * Whether the user has chosen to see the Layer
   * Make sure to start the service first.
   * @return  `true` if the layer is enabled
   */
  public get enabled(): boolean {
    return this._enabled;
  }
  /** Enables or disables this layer; starts the OSM service when enabling.
   * @param val - `true` to enable the layer, `false` to disable it
   */
  public set enabled(val: boolean) {
    if (!this.supported) {
      val = false;
    }

    if (val === this._enabled) return;  // no change
    this._enabled = val;

    const context = this.context;
    const osm = context.services.osm;
    if (val && osm) {
      osm.startAsync()
        .then(() => this.gfx.immediateRedraw());
    }
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  public reset(): void {
    super.reset();

    this._tileContainers.clear();
    this._midpoints.clear();
    this._unmadeInView = this._newUnmade();
    this._unmadeOutside = this._newUnmade();
    this._changedIDs.clear();

    // Add containers (`super.reset()` released the old ones), see `design/scene.md`
    const basemap = this._spatialContainer('basemap', 'osm');
    this.polygonContainer = this._childContainer(basemap, 'polygons', 0);
    this.lineContainer = this._childContainer(basemap, 'lines', 1);
    this.pointContainer = this._spatialContainer('points', 'osm');
  }


  /**
   * Render any OSM data within the frame's cull box (the view and some padding around it), and
   * schedule fetching more of it to cover the view.
   * On a frame where only the view moved, inside the box this layer already has everything for,
   * the features stay as they are (see `keepFeatures`).
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public render(frame: RenderFrame, viewport: Viewport): void {
    const context = this.context;
    const osm = context.services.osm;
    const viewZoom = viewport.transform.zoom;
    if (!this.enabled || !osm?.started || viewZoom < MINZOOM) {
      this._unmadeInView = this._newUnmade();    // nothing is drawn, so nothing is waiting to be made
      this._unmadeOutside = this._newUnmade();
      this._changedIDs.clear();
      return;
    }

    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const graph = editor.staging.graph;

    context.loadTiles();  // Load tiles of OSM data to cover the view

    // Only the view moved, and the last pass saw everything there is.
    // (Go on with what an earlier frame had no time for: features to make, and to draw again.)
    if (this.keepFeatures(frame)) {
      this.continueWaiting(frame, viewport);
      return;
    }

    // A pass sees every entity again, and says which ones wait this time.
    this._unmadeInView = this._newUnmade();
    this._unmadeOutside = this._newUnmade();

    let t = performance.now();   // each step's time goes in the frame's stats
    let entities = editor.entitiesInBox(frame.cullBox.bbox(), graph);   // Gather data in and around the view
    t = this._endStep('gather', t);
    entities = filters.filterScene(entities, graph);   // Apply feature filters
    t = this._endStep('filter', t);

    const data: OsmData = {
      polygons: new Map<EntityID, OsmWay | OsmRelation>(),
      lines: new Map<EntityID, OsmWay>(),
      points: new Map<EntityID, OsmNode>(),
      vertices: new Map<EntityID, OsmNode>()
    };

    for (const entity of entities) {
      const geom = entity.geometry(graph);
      if (geom === 'point') {
        data.points.set(entity.id, entity as OsmNode);
      } else if (geom === 'vertex') {
        data.vertices.set(entity.id, entity as OsmNode);
      } else if (geom === 'line') {
        data.lines.set(entity.id, entity as OsmWay);
      } else if (geom === 'area') {
        data.polygons.set(entity.id, entity as OsmWay | OsmRelation);
//      } else if (geom === 'relation') {
//        // No support for this now, but it would be very nice to support
//        // special rendering for a selected relation.
      }
    }

    t = this._endStep('classify', t);

    this.renderPolygons(frame, viewport, data);
    t = this._endStep('polygons', t);
    this.renderLines(frame, viewport, data);
    t = this._endStep('lines', t);
    this.renderPoints(frame, viewport, data);
    t = this._endStep('points', t);

    // At this point, all the visible features have been accounted for,
    // and parent-child data links have been established.
    // We can prepare vertices and midpoints.

    const related = this._gatherRelated(viewZoom);
    this._lastRelated = related;
    this._changedIDs.clear();   // the pass has seen every feature, whatever changed
    this._modeDirty = false;
    t = this._endStep('related', t);

    this.renderVertices(frame, viewport, data, related);
    t = this._endStep('vertices', t);

    if (context.mode?.id === 'select') {
      this.renderMidpoints(frame, viewport, data, related);
    } else {
      this._midpoints.clear();
    }
    t = this._endStep('midpoints', t);

    // Features may have moved to other tiles' containers, or been destroyed since the last pass.
    this._removeEmptyContainers();
    this._endStep('containers', t);
  }


  /**
   * Decides whether an entity that has no feature yet gets one now, or in a later frame.
   * Making a feature (its Pixi objects, its style) and drawing it for the first time is the most
   * expensive thing the layer does per feature, and after a load there are thousands to make.
   *
   * - Outside the view (in the cull box's padding), it waits until the view's are made and a frame
   *   has time to spare.
   * - In view, it's made while the frame has time. In a frame the user asked for, it's made
   *   whatever the time if the user needs it at once (`needed`: they just drew it, or it's a
   *   vertex of what they selected).
   *
   * An entity that waits is remembered, and `continueWaiting()` makes its feature in a later
   * frame (see "A deadline on the frame" in `design/graphics-system.md`).
   * @param kind - Which of the layer's kinds of data the entity is
   * @param entityID - The entity
   * @param extent - Where it is, in world coordinates
   * @param frame - The frame being rendered
   * @param needed - Whether the user needs to see it at once
   * @return `true` if the caller should skip the entity for now
   */
  protected _waitToMake(kind: OsmDataKind, entityID: EntityID, extent: Extent | undefined, frame: RenderFrame, needed: boolean): boolean {
    const inView = !extent || extent.intersects(frame.viewBox);
    // After the pass, a few are made on every call even with no time left, so the work always gets done.
    const hasTime = frame.hasTime() || (this._catchingUp && this._madeCount < MAKE_BATCH);

    let wait: boolean;
    if (!inView) {
      wait = !(this._makingOutside && hasTime);
    } else if (needed && frame.urgent) {
      wait = false;
    } else {
      wait = !hasTime;
    }

    if (wait) {
      (inView ? this._unmadeInView : this._unmadeOutside)[kind].add(entityID);
    } else {
      this._madeCount++;
    }
    return wait;
  }


  /**
   * Goes on with what earlier frames put off: the features to draw again (see
   * `AbstractPixiLayer.continueWaiting`), then the features to make, for the entities that
   * `_waitToMake()` remembered. The ones in view come first.
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param outside - Whether to go on to what's outside the view, once what's in view is done
   */
  public override continueWaiting(frame: RenderFrame, viewport: Viewport, outside: boolean = false): void {
    // First what the user is looking at: the data that changed (an edit), or whose classes did
    // (a hover, a selection). Unless a pass is due anyway: it sees everything.
    if ((this._changedIDs.size || this._modeDirty) && this._currentBox) {
      this._renderChanged(frame, viewport);
    }

    super.continueWaiting(frame, viewport, outside);

    if (!this._countUnmade(this._unmadeOutside) && !this._countUnmade(this._unmadeInView)) return;

    this._catchingUp = true;
    this._madeCount = 0;
    this._makeWaiting(frame, viewport, false);

    // ..and with time to spare (or nothing else to do), the ones outside the view
    if (outside && (frame.hasTime() || !this._countUnmade(this._unmadeInView))) {
      this._makingOutside = true;
      this._makeWaiting(frame, viewport, true);
      this._makingOutside = false;
    }
    this._catchingUp = false;
  }


  /**
   * Remembers data whose classes changed, to draw its features again on the next frame
   * (see `_renderChanged`). The scene calls this for every layer, so the data may not be ours.
   * @param dataID - The data whose classes changed
   */
  public override classChanged(dataID: DataID): void {
    this._changedIDs.add(dataID);
  }


  /**
   * Notes that the mode changed, to draw the midpoints again (or take them away) on the next
   * frame: they're shown in select mode only.
   */
  public override modeChanged(): void {
    this._modeDirty = true;
  }


  /**
   * Remembers the entities that an edit affects, to draw them again on the next frame without
   * a pass (see `_renderChanged`). Their features are marked dirty, so they get their styles
   * worked out again: what changed may be only how they connect (a vertex that's shared now).
   * When there are too many (a big undo, a paste), a pass is the cheaper way, and this asks
   * for one.
   * @param dataIDs - The entities the edit affects (`Difference.complete()`)
   */
  public override dataChanged(dataIDs: OneOrMore<DataID>): void {
    for (const dataID of utilIterable(dataIDs)) {
      this._changedIDs.add(dataID);
      for (const featureID of (this._dataHasFeature.get(dataID) ?? [])) {
        const feature = this.features.get(featureID);
        if (feature) {
          feature.dirty = true;
        }
      }
    }
    if (this._changedIDs.size > MAX_CHANGED) {
      this._currentBox = null;   // do the pass (see `keepFeatures`)
    }
  }


  /**
   * Retains a feature (see `AbstractPixiLayer.retainFeature`), and notes that it was seen, while
   * `_renderChanged()` is watching for the features that aren't.
   * @param feature - The feature
   * @param frame - The frame being rendered
   */
  public override retainFeature(feature: AbstractPixiFeature, frame: RenderFrame): void {
    super.retainFeature(feature, frame);
    this._seenFeatureIDs?.add(feature.id);
  }


  /**
   * Gathers the IDs related to what's selected, hovered or being drawn: its nodes and midpoints
   * (descendants), and the nodes that share a way with it (siblings). These decide which vertices
   * and midpoints are drawn, above everything else.
   * It goes by the links between features' data, so the features must have been made.
   * @param viewZoom - The view's zoom
   * @return The related IDs
   */
  protected _gatherRelated(viewZoom: number): RelatedIDs {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;

    // Gather ids related to the selected/hovered/drawing features.
    const selectedIDs = this.scene.getDataWithClass('select');
    const hoveredIDs = this.scene.getDataWithClass('hover');
    const drawingIDs = this.scene.getDataWithClass('drawing');
    const dataIDs = new Set<EntityID>([...selectedIDs, ...hoveredIDs, ...drawingIDs]);

    // Experiment: avoid showing child vertices/midpoints for too small parents
    for (const dataID of dataIDs) {
      const entity = graph.hasEntity(dataID);
      if (entity?.type === 'node') continue;  // ways, relations only

      const extent = entity && graph.geometry(entity).world?.extent;
      if (!extent) continue;

      // Determine dimensions in screen pixels
      const worldScale = 2 ** (viewZoom - WORLD_ZOOM);
      const w = Math.abs(extent.max[0] - extent.min[0]) * worldScale;
      const h = Math.abs(extent.max[1] - extent.min[1]) * worldScale;

      if (w < 25 && h < 25) {   // too small, skip this
        dataIDs.delete(dataID);
      }
    }

    // Expand set to include parent ways for selected/hovered/drawing nodes too..
    const interestingIDs = new Set<EntityID>(dataIDs);
    for (const dataID of dataIDs) {
      const entity = graph.hasEntity(dataID);
      if (entity?.type !== 'node') continue;   // nodes only
      for (const parent of graph.parentWays(entity)) {
        interestingIDs.add(parent.id);
      }
    }

    // Create collections of the sibling and descendant IDs,
    // These will determine which vertices and midpoints get drawn.
    const related: RelatedIDs = {
      descendantIDs: new Set<EntityID>(),
      siblingIDs: new Set<EntityID>()
    };
    for (const interestingID of interestingIDs) {
      this.getSelfAndDescendants(interestingID, related.descendantIDs);
      this.getSelfAndSiblings(interestingID, related.siblingIDs);
    }

    return related;
  }


  /**
   * Draws again the features of the data whose classes changed since the last pass (a hover, a
   * selection), without the pass: in a dense place a pass takes 200 ms, and a hover changes two
   * features and a few vertices.
   *
   * What a class changes: the data's own features (a halo, a highlight), and which vertices and
   * midpoints are shown above everything (`_gatherRelated`). So this runs the changed data, and
   * everything that was or is now related to it, through the same `render…()` functions as a
   * pass. Then it hides whichever of their features those functions didn't want anymore (the
   * vertices of a line that's no longer hovered), as `cull()` does after a pass.
   *
   * These are drawn at once, whatever time the frame has: the user is looking at them.
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  protected _renderChanged(frame: RenderFrame, viewport: Viewport): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const graph = editor.staging.graph;

    const changedIDs = new Set<DataID>(this._changedIDs);
    this._changedIDs.clear();
    this._modeDirty = false;

    // Sorts data as a pass does, leaving out what a pass wouldn't have gathered: what's outside
    // the cull box, or hidden. (Some of it isn't entities: midpoints, and other layers' data.)
    const sort = (dataIDs: Iterable<DataID>): OsmData => {
      const sorted: OsmData = {
        polygons: new Map<EntityID, OsmWay | OsmRelation>(),
        lines: new Map<EntityID, OsmWay>(),
        points: new Map<EntityID, OsmNode>(),
        vertices: new Map<EntityID, OsmNode>()
      };
      for (const dataID of dataIDs) {
        const entity = graph.hasEntity(dataID);
        if (!entity) continue;

        const extent = graph.geometry(entity).world?.extent;
        if (!extent?.intersects(frame.cullBox)) continue;
        const geom = entity.geometry(graph) as GeometryType;
        if (filters.isHidden(entity, graph, geom)) continue;

        if (geom === 'point') {
          sorted.points.set(entity.id, entity as OsmNode);
        } else if (geom === 'vertex') {
          sorted.vertices.set(entity.id, entity as OsmNode);
        } else if (geom === 'line') {
          sorted.lines.set(entity.id, entity as OsmWay);
        } else if (geom === 'area') {
          sorted.polygons.set(entity.id, entity as OsmWay | OsmRelation);
        }
      }
      return sorted;
    };

    // What was a midpoint before may not be one after
    const midpointsBefore = [...this._midpoints.keys()];

    const wasUrgent = frame.urgent;
    frame.urgent = true;                // draw them in this frame
    this._catchingUp = true;            // (their features belong to the last pass: see `retainFeature`)
    this._madeCount = 0;
    this._seenFeatureIDs = new Set<FeatureID>();

    // First the shapes of what changed, as in a pass. They link each way to its nodes, and what's
    // related to the selection is worked out from those links: a way that just gained a node
    // has to be drawn before its vertices are.
    const data = sort(changedIDs);
    if (data.polygons.size)  this.renderPolygons(frame, viewport, data);
    if (data.lines.size)     this.renderLines(frame, viewport, data);
    if (data.points.size)    this.renderPoints(frame, viewport, data);

    const before = this._lastRelated;
    const related = this._gatherRelated(viewport.transform.zoom);
    this._lastRelated = related;

    // ..then whatever was or is now related to what's selected or hovered, and wasn't drawn above
    const relatedIDs = new Set<DataID>();
    for (const ids of [before.descendantIDs, before.siblingIDs, related.descendantIDs, related.siblingIDs]) {
      for (const dataID of ids) {
        if (!changedIDs.has(dataID)) {
          relatedIDs.add(dataID);
        }
      }
    }
    const more = sort(relatedIDs);
    if (more.polygons.size)  this.renderPolygons(frame, viewport, more);
    if (more.lines.size)     this.renderLines(frame, viewport, more);
    if (more.points.size)    this.renderPoints(frame, viewport, more);

    // ..then the vertices and midpoints of all of it
    for (const kind of Object.keys(more) as OsmDataKind[]) {
      for (const [entityID, entity] of more[kind]) {
        (data[kind] as Map<EntityID, OsmEntity>).set(entityID, entity);
      }
    }
    if (data.vertices.size)  this.renderVertices(frame, viewport, data, related);

    if (context.mode?.id === 'select') {
      this.renderMidpoints(frame, viewport, data, related);
    } else {
      this._midpoints.clear();
    }

    const dataIDs = new Set<DataID>([...changedIDs, ...relatedIDs]);

    const seen = this._seenFeatureIDs;
    this._seenFeatureIDs = null;
    this._catchingUp = false;
    frame.urgent = wasUrgent;

    // Hide the features that weren't wanted this time. The ones that were drawn above everything
    // only because they were related (plain vertices, midpoints) are destroyed: a pass would get
    // to that after not seeing them for a while, and without passes they'd pile up.
    const mapUiLayer = this.scene.layers.get('map-ui') as PixiLayerMapUI;
    const selectedContainer = mapUiLayer.selected;
    const unwanted: AbstractPixiFeature[] = [];
    for (const dataID of dataIDs) {
      for (const featureID of (this._dataHasFeature.get(dataID) ?? [])) {
        const feature = this.features.get(featureID);
        if (feature && !seen.has(featureID)) {
          unwanted.push(feature);
        }
      }
    }
    for (const midpointID of midpointsBefore) {
      const featureID = `${this.layerID}-midpoint-${midpointID}`;
      const feature = this.features.get(featureID);
      if (feature && !seen.has(featureID)) {
        unwanted.push(feature);
      }
    }
    for (const feature of unwanted) {
      if (!feature.container) continue;   // listed twice, and destroyed already
      if (feature.container.parent === selectedContainer) {
        feature.destroy();
      } else {
        feature.visible = false;
      }
    }
  }


  /**
   * Makes features for entities that waited, a batch at a time, by running them through the same
   * `render…()` functions as a pass does. Each function asks `_waitToMake()` again, so an entity
   * that still can't be made goes back to waiting.
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param outside - `true` for the entities outside the view, `false` for the ones in view
   */
  protected _makeWaiting(frame: RenderFrame, viewport: Viewport, outside: boolean): void {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;

    const waiting = outside ? this._unmadeOutside : this._unmadeInView;

    const newBatch = (): OsmData => ({
      polygons: new Map<EntityID, OsmWay | OsmRelation>(),
      lines: new Map<EntityID, OsmWay>(),
      points: new Map<EntityID, OsmNode>(),
      vertices: new Map<EntityID, OsmNode>()
    });

    let batch = newBatch();
    let batchSize = 0;
    let stopped = false;

    const makeBatch = (): void => {
      if (batch.polygons.size)  this.renderPolygons(frame, viewport, batch);
      if (batch.lines.size)     this.renderLines(frame, viewport, batch);
      if (batch.points.size)    this.renderPoints(frame, viewport, batch);
      if (batch.vertices.size)  this.renderVertices(frame, viewport, batch, this._lastRelated);
      batch = newBatch();
      batchSize = 0;
      stopped = !frame.hasTime();
    };

    // Take them in the order they waited, and leave the rest where it is when the time is up.
    // (Not a copy of what's left: tens of thousands can be waiting, on every frame.)
    // An entity that still can't be made goes back to waiting: `_waitToMake()` adds it again,
    // after the others. That only happens once the frame is out of time, so the loop ends there.
    for (const kind of Object.keys(waiting) as OsmDataKind[]) {
      const entityIDs = waiting[kind];
      for (const entityID of entityIDs) {
        entityIDs.delete(entityID);   // (deleting from a Set while iterating over it is safe)

        // Is it still there, and still the same kind of thing? If not, the next pass sorts it out.
        const entity = graph.hasEntity(entityID);
        if (!entity || entity.geometry(graph) !== KIND_GEOMETRY[kind]) continue;

        (batch[kind] as Map<EntityID, OsmEntity>).set(entityID, entity);
        if (++batchSize >= MAKE_BATCH) {
          makeBatch();
          if (stopped) return;
        }
      }
    }

    if (batchSize) {
      makeBatch();
    }
  }


  /**
   * Sorts the waiting work again if the view has moved (see `AbstractPixiLayer._sortWaiting`):
   * the entities that waited outside the view, and are in view now, go with the ones in view.
   * @param frame - The frame being rendered
   * @return `true` if the work was sorted again
   */
  protected override _sortWaiting(frame: RenderFrame): boolean {
    if (!super._sortWaiting(frame)) return false;

    const context = this.context;
    const graph = context.systems.editor!.staging.graph;

    for (const kind of Object.keys(this._unmadeOutside) as OsmDataKind[]) {
      const outside = this._unmadeOutside[kind];
      for (const entityID of outside) {
        const entity = graph.hasEntity(entityID);
        const extent = entity && graph.geometry(entity).world?.extent;
        if (extent?.intersects(frame.viewBox)) {
          outside.delete(entityID);   // (deleting from a Set while iterating over it is safe)
          this._unmadeInView[kind].add(entityID);
        }
      }
    }
    return true;
  }


  /**
   * How many entities are waiting for their features to be made, and features to be drawn again.
   * @return The number waiting
   */
  public override get numWaiting(): number {
    return super.numWaiting + this._countUnmade(this._unmadeInView) + this._countUnmade(this._unmadeOutside);
  }


  /**
   * How many of those are in view.
   * @return The number waiting in view
   */
  public override get numWaitingInView(): number {
    return super.numWaitingInView + this._countUnmade(this._unmadeInView);
  }


  /**
   * Makes an empty collection of waiting entities.
   * @return Empty sets, one per kind of data
   */
  protected _newUnmade(): UnmadeIDs {
    return {
      polygons: new Set<EntityID>(),
      lines: new Set<EntityID>(),
      points: new Set<EntityID>(),
      vertices: new Set<EntityID>()
    };
  }


  /**
   * Counts the entities in a collection of waiting entities.
   * @param unmade - The collection to count
   * @return How many entities it holds
   */
  protected _countUnmade(unmade: UnmadeIDs): number {
    return unmade.polygons.size + unmade.lines.size + unmade.points.size + unmade.vertices.size;
  }


  /**
   * Renders the visible OSM area (polygon) features for this frame.
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   */
  public renderPolygons(frame: RenderFrame, viewport: Viewport, data: OsmData): void {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;
    const filters = context.systems.filters!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;
    const styles = context.systems.styles!;

    const showPoints = filters.isEnabled('points');

    // For deciding if an unlabeled polygon feature is interesting enough to show a virtual pin.
    // Note that labeled polygon features will always get a virtual pin.
    const isInterestingPreset = (preset: Preset | null): boolean => {
      if (!preset || preset.isFallback()) return false;

      // These presets probably are not POIs
      if (/^(address|building|indoor|landuse|man_made|military|natural|playground)/.test(preset.id)) return false;

      // These presets probably are POIs even without a label
      // See nsi.guide for the sort of things we are looking for.
      if (/^(attraction|club|craft|emergency|healthcare|office|power|shop|telecom|tourism)/.test(preset.id)) return true;
      if (/^amenity\/(?!parking|shelter)/.test(preset.id)) return true;
      if (/^leisure\/(?!garden|firepit|picnic_table|pitch|swimming_pool)/.test(preset.id)) return true;

      return false;   // not sure, just ignore it
    };

    const tileZoom = Math.floor(viewport.transform.zoom) + POLYGON_TILE_ZOOM;
    const pointTileZoom = Math.floor(viewport.transform.zoom) + POINT_TILE_ZOOM;

    const entities = data.polygons;
    for (const [entityID, entity] of entities) {
      const parts = graph.geometry(entity).parts;

      for (let i = 0; i < parts.length; ++i) {
        const part = parts[i];
        if (!part.world || part.type !== 'Polygon') continue;  // invalid?

        const featureID = `${this.layerID}-${entityID}-${i}`;
        let feature = this.features.get(featureID) as PixiFeaturePolygon | undefined;

        // If feature existed before as a different type, recreate it.
        if (feature && feature.type !== 'Polygon') {
          feature.destroy();
          feature = undefined;
        }

        if (!feature) {
          // (If it isn't needed at once, it's made in a later frame)
          if (this._waitToMake('polygons', entityID, part.world.extent, frame, entity.isNew())) continue;
          feature = new PixiFeaturePolygon(this, featureID);
        }

        // If data has changed.. Replace data and parent-child links.
        // (A changed shape is a new Geometry, so its parts are new objects too.)
        if (feature.data !== entity || feature.geometry !== part) {
          feature.geometry = part;
          const area = part.world.extent.area();
          feature.container.zIndex = -area;      // sort by area descending (small things above big things)

          feature.data = entity;
          feature.clearChildData(entityID);
          if (entity.type === 'relation') {
            feature.addChildData(entityID, (entity as OsmRelation).members.map(member => member.id));
          }
          if (entity.type === 'way') {
            feature.addChildData(entityID, (entity as OsmWay).nodes);
          }
        }


        const props = feature.props;
        this.syncFeatureClasses(feature);

        if (feature.dirty) {
          // A new shape, or a new zoom (and its tiles), may put it in another container
          feature.parentContainer = this._polygonTileContainer(part, tileZoom);
        }

        // (Not after a change of zoom alone: what it is hasn't changed, see `needsStyle`)
        if (feature.needsStyle) {
          const preset = schema.match(entity, graph);

          const geometry = entity.geometry(graph);
          const style = styles.styleMatch(entity.tags, geometry, 'osm');
          feature.style = style;

          const label = l10n.displayPOIName(entity.tags);
          feature.label = label;

          // POI = "Point of Interest" -and- "Pole of Inaccessability"
          // For POIs mapped as polygons, we can create a virtual point feature at the pole of inaccessability.
          // Try to show a virtual pin if there is a label or if the preset is interesting enough..
          // Store the details about this in the feature's properties object.
          if (showPoints && (label || isInterestingPreset(preset))) {
            props.poiFeatureID = `${this.layerID}-${entityID}-poi-${i}`;
            props.poiPreset = preset;
          } else {
            props.poiFeatureID = null;
            props.poiPreset = null;
          }
        }

        this.updateFeature(feature, frame, viewport);   // now, or in a later frame if it can wait
        this.retainFeature(feature, frame);

        // Same as above, but for the virtual POI, if any
        if (props.poiFeatureID) {
          const poiFeatureID = props.poiFeatureID as FeatureID;
          const poiPreset = props.poiPreset as Preset | null;

          let poiFeature = this.features.get(poiFeatureID) as PixiFeaturePoint | undefined;
          if (!poiFeature) {
            poiFeature = new PixiFeaturePoint(this, poiFeatureID);
            poiFeature.props.isVirtual = true;
          }

          if (poiFeature.data !== entity || poiFeature.props.polygonPart !== part) {
            poiFeature.props.polygonPart = part;   // the polygon part that the pin is placed in

            const poiGeometry = new GeometryPart(context);
            poiGeometry.setData({ type: 'Point', coordinates: projWorldToWgs84(part.world.poi!) });
            poiFeature.geometry = poiGeometry;
            poiFeature.data = entity;
          }

          this.syncFeatureClasses(poiFeature);

          if (poiFeature.needsStyle) {
            // copy the polygon style, then apply customizations
            const markerStyle = structuredClone(feature.style) as MatchedStyle;

            if (hasWikidata(entity)) {
              markerStyle.marker.image = 'boldPin';
              markerStyle.marker.color = 0xdddddd;  // grey pins
              markerStyle.label.color = 0xdddddd;
            } else {
              markerStyle.marker.image = 'pin';
              markerStyle.marker.color = 0xffffff;  // white pins
              markerStyle.label.color = 0xffffff;
            }
            // -or- make the virtual pins more closely match the polygon fill color?
            // (interesting idea, but these tend to be hard to see)
            // see Rapid#958 and Rapid#1474
            // markerStyle.marker.color = markerStyle.fill.color;
            // markerStyle.label.color = markerStyle.fill.color;
            markerStyle.icon.color = 0x444444;

            const poiIcon = poiPreset?.props?.icon;
            if (poiIcon) {
              markerStyle.icon.image = poiIcon;
            }

            poiFeature.style = markerStyle;
            poiFeature.label = feature.label;
          }

          if (poiFeature.dirty) {
            this._placePoint(poiFeature, pointTileZoom);
          }

          this.updateFeature(poiFeature, frame, viewport);
          this.retainFeature(poiFeature, frame);
        }

      }
    }

  }


  /**
   * Returns the container for a polygon, under `polygons`. Polygons are split up by map tile, each
   * tile's in a container with its own render group, so that a change to one polygon (a hover, or
   * one scrolling into view) makes Pixi rebuild the instructions of that tile only, not of every
   * polygon in view. A polygon bigger than a tile goes in the `large` container, drawn below the tiles.
   *
   * Within a container polygons are sorted by area, biggest first, as before. Between tiles they
   * aren't: two polygons smaller than a tile, in different tiles, that overlap, are drawn in the
   * order of their tiles (by row, then by column: `tileOrder`). (See "Render groups" in
   * `design/scene.md`.)
   * @param part - The polygon's geometry
   * @param tileZoom - The zoom of the tiles to split by
   * @return The container to put the polygon's feature in
   */
  protected _polygonTileContainer(part: GeometryPart, tileZoom: number): PIXI.Container {
    const polygonContainer = this.polygonContainer!;
    const tile = this._tileOf(part.world!.extent, tileZoom);
    if (!tile) {
      return this._tileContainer(polygonContainer, 'large', -1);
    }
    return this._tileContainer(polygonContainer, `${tile[0]},${tile[1]},${tileZoom}`, tileOrder(tile));
  }


  /**
   * Returns the container for a line, under its level's container. Lines are split up like polygons
   * (see `_polygonTileContainer`), and for the same reason: all the lines of a level in one render
   * group meant that a hover, a drag or a new line made Pixi collect every one of them again
   * (44 ms for the 18,882 of level 0 in Užice).
   *
   * Lines are drawn in the order of their road class (`getzIndex`), so they're split by that first
   * and then by tile: each container holds the lines of one class whose centers are in one tile.
   * A line bigger than a tile goes in its class's `large` container. So the order between road
   * classes is what it was.
   *
   * Lines of the same class used to be drawn in the order they were made, which differs from
   * one load to the next. Now it's: the `large` container, then the tiles by row and column
   * (`tileOrder`), and within a container by the way's ID (`entityOrder`). That's no more right
   * than before, but it's the same picture every time.
   * @param levelContainer - The container of the line's level (`way.layer()`)
   * @param zIndex - The line's road class (a whole number, see `getzIndex`)
   * @param part - The line's geometry
   * @param tileZoom - The zoom of the tiles to split by
   * @return The container to put the line's feature in
   */
  protected _lineTileContainer(levelContainer: PIXI.Container, zIndex: number, part: GeometryPart, tileZoom: number): PIXI.Container {
    const tile = this._tileOf(part.world!.extent, tileZoom);
    if (!tile) {
      return this._tileContainer(levelContainer, `${zIndex}/large`, zIndex);
    }
    return this._tileContainer(levelContainer, `${zIndex}/${tile[0]},${tile[1]},${tileZoom}`, zIndex + tileOrder(tile));
  }


  /**
   * Returns the container for a point (or a vertex, or a virtual POI pin), under `points`.
   * Points are split up by map tile too: in one render group, making one point among Užice's
   * 49,259 cost 38 ms.
   *
   * Points are drawn from north to south, so that each pin overlaps the ones above it on the map.
   * A tile's container is ordered among its siblings by the tile's row, and within a tile points
   * are sorted as before, so that still holds between rows and within a tile. It doesn't hold
   * between two tiles side by side: where pins overlap across the edge between them, the eastern
   * tile's are on top (about 1 overlapping pair in 100 in Užice). (See "Render groups" in
   * `design/scene.md`.)
   *
   * A point with viewfields goes in a container above all the tiles, as it was above the other
   * points before.
   * @param part - The point's geometry
   * @param hasViewfields - Whether the point is drawn with viewfields
   * @param tileZoom - The zoom of the tiles to split by
   * @return The container to put the point's feature in
   */
  protected _pointTileContainer(part: GeometryPart, hasViewfields: boolean, tileZoom: number): PIXI.Container {
    const pointContainer = this.pointContainer!;
    const tile = part.world && this._tileOf(part.world.extent, tileZoom);
    if (hasViewfields || !tile) {
      return this._tileContainer(pointContainer, 'viewfields', Number.MAX_SAFE_INTEGER);
    }
    return this._tileContainer(pointContainer, `${tile[0]},${tile[1]},${tileZoom}`, tile[1] + tileOrder(tile));
  }


  /**
   * Finds the map tile that a shape belongs in, by its center.
   * @param extent - The shape's extent, in world coordinates
   * @param tileZoom - The zoom of the tiles
   * @return The tile's `[x, y]`, or `null` if the shape is bigger than a tile in either direction
   */
  protected _tileOf(extent: Extent, tileZoom: number): Vec2 | null {
    const tileSize = 256 * (2 ** (WORLD_ZOOM - tileZoom));   // in world coordinates
    const [minX, minY] = extent.min;
    const [maxX, maxY] = extent.max;
    if ((maxX - minX) > tileSize || (maxY - minY) > tileSize) return null;

    return [Math.floor((minX + maxX) / 2 / tileSize), Math.floor((minY + maxY) / 2 / tileSize)];
  }


  /**
   * Returns the container with the given label under the given parent, making it if needed, like
   * `_childContainer`. This remembers the ones it made: there can be hundreds under one parent,
   * and it's asked once for every feature that's drawn again.
   * `_removeEmptyContainers()` removes them again.
   * @param parent - The container to look in
   * @param label - The container's label
   * @param zIndex - The container's `zIndex` among its siblings, if it's made
   * @return The container
   */
  protected _tileContainer(parent: PIXI.Container, label: string, zIndex: number): PIXI.Container {
    let byLabel = this._tileContainers.get(parent);
    if (!byLabel) {
      byLabel = new Map<string, PIXI.Container>();
      this._tileContainers.set(parent, byLabel);
    }
    let container = byLabel.get(label);
    if (!container) {
      container = this._childContainer(parent, label, zIndex);
      byLabel.set(label, container);
    }
    return container;
  }


  /**
   * Removes the containers that features were split into and that have emptied: their features
   * moved to other tiles after a change of zoom, or were destroyed after scrolling away.
   */
  protected _removeEmptyContainers(): void {
    for (const [parent, byLabel] of this._tileContainers) {
      for (const [label, container] of byLabel) {
        if (!container.children.length) {
          this.scene.destroyWorldContainer(container);
          byLabel.delete(label);    // (deleting from a Map while iterating over it is safe)
        }
      }
      if (!byLabel.size) {
        this._tileContainers.delete(parent);
      }
    }
  }


  /**
   * Renders the visible OSM line features for this frame.
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   */
  public renderLines(frame: RenderFrame, viewport: Viewport, data: OsmData): void {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;
    const l10n = context.systems.l10n!;
    const styles = context.systems.styles!;
    const lineContainer = this.lineContainer!;

    const _getLevelContainer = (level: string): PIXI.Container => {
      return this._childContainer(lineContainer, level, parseInt(level, 10));
    };

    const tileZoom = Math.floor(viewport.transform.zoom) + LINE_TILE_ZOOM;

    const ways = data.lines;
    for (const [wayID, way] of ways) {
      const layer = way.layer();
      const levelContainer = _getLevelContainer(layer.toString());
      const zindex = getzIndex(way.tags);

      const parts = graph.geometry(way).parts;

      for (let i = 0; i < parts.length; ++i) {
        const part = parts[i];
        if (!part.world || part.type !== 'LineString') continue;  // invalid?

        const featureID = `${this.layerID}-${wayID}-${i}`;
        let feature = this.features.get(featureID) as PixiFeatureLine | undefined;

        // If feature existed before as a different type, recreate it.
        if (feature && feature.type !== 'LineString') {
          feature.destroy();
          feature = undefined;
        }

        if (!feature) {
          if (this._waitToMake('lines', wayID, part.world.extent, frame, way.isNew())) continue;
          feature = new PixiFeatureLine(this, featureID);
        }

        // If data has changed.. Replace data and parent-child links.
        // (A changed shape is a new Geometry, so its parts are new objects too.)
        if (feature.data !== way || feature.geometry !== part) {
          feature.geometry = part;
          feature.container.zIndex = zindex + entityOrder(wayID);   // by road class, then by ID

          feature.data = way;
          feature.clearChildData(wayID);
          feature.addChildData(wayID, way.nodes);
        }

        this.syncFeatureClasses(feature);

        if (feature.dirty) {
          // A new shape, level or road class, or a new zoom (and its tiles), may put it in another container
          feature.parentContainer = this._lineTileContainer(levelContainer, zindex, part, tileZoom);
        }

        if (feature.needsStyle) {
          let styleTags = way.tags;
          let styleGeometry: 'line' | 'area' = 'line';
          let isUntaggedMultipolygonEdge = false;

          // A line no tags - If it's a multipolygon edge (e.g. outer or inner),
          // attempt to styleMatch the tags of its parent relation.
          if (!way.hasInterestingTags()) {
            const parent = graph.parentRelations(way).find(relation => relation.isMultipolygon());
            if (parent) {
              styleTags = parent.tags;
              styleGeometry = 'area';
              isUntaggedMultipolygonEdge = true;
            }
          }

          const style = styles.styleMatch(styleTags, styleGeometry, 'osm');
          if (way.isOneWay()) {
            style.lineMarker ??= {};
            const isAlternating = (way.tags.oneway === 'alternating' || way.tags.oneway === 'reversible');
            style.lineMarker.image = isAlternating ? 'twoway' : 'oneway';
          } else {
            delete style.lineMarker;
          }
          if (way.isSided()) {    // todo: handle both-sided cases
            style.sidedMarker ??= {};
            style.sidedMarker.image = 'sided';
          } else {
            delete style.sidedMarker;
          }

          // Override styling for untagged 'inner'/'outer' ways.
          // Note that multipolygons were already fully rendered by `renderPolygons` -
          // what we are doing here is rendering the 'inner'/'outer' lines that
          // sit on top of the multipolygon edges and are selectable as ways.
          if (isUntaggedMultipolygonEdge) {
            style.casing.width = 0;
            style.stroke.color = style.fill.color;
            style.stroke.width = 2;
          }

          feature.style = style;
          feature.label = l10n.displayName(way.tags);
        }

        this.updateFeature(feature, frame, viewport);
        this.retainFeature(feature, frame);
      }
    }
  }


  /**
   * Renders the visible OSM vertices (way nodes) for this frame.
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   * @param related - Collections of related OSM IDs
   */
  public renderVertices(frame: RenderFrame, viewport: Viewport, data: OsmData, related: RelatedIDs): void {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;
    const l10n = context.systems.l10n!;
    const map = context.systems.map;
    const styles = context.systems.styles!;

    const viewZoom = viewport.transform.zoom;
    const styleZoom = map?.effectiveZoom() ?? viewZoom;

    // Vertices related to the selection/hover should be drawn above everything
    const mapUiLayer = this.scene.layers.get('map-ui') as PixiLayerMapUI;
    const selectedContainer = mapUiLayer.selected;

    const isInterestingVertex = (node: OsmNode): boolean => {
      return node.hasInterestingTags() || node.isEndpoint(graph) || node.isIntersection(graph);
    };

    const isRelatedVertex = (entityID: EntityID): boolean => {
      return related.descendantIDs.has(entityID) || related.siblingIDs.has(entityID);
    };


    const tileZoom = Math.floor(viewZoom) + POINT_TILE_ZOOM;

    const nodes = data.vertices;
    for (const [nodeID, node] of nodes) {
      const isRelated = isRelatedVertex(nodeID);   // major importance: drawn above everything
      const isInteresting = (styleZoom >= 16 && isInterestingVertex(node));   // minor importance: drawn with the points

      if (!isRelated && !isInteresting) continue;   // this vertex isn't important enough to render

      const featureID = `${this.layerID}-${nodeID}`;
      let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

      // If feature existed before as a different type, recreate it.
      if (feature && feature.type !== 'Point') {
        feature.destroy();
        feature = undefined;
      }

      if (!feature) {
        // (The vertices of what's selected or hovered are needed at once: the user is about to grab one)
        const extent = graph.geometry(node).parts[0]?.world?.extent;
        if (this._waitToMake('vertices', nodeID, extent, frame, node.isNew() || isRelated)) continue;
        feature = new PixiFeaturePoint(this, featureID);
      }

      // If data has changed, replace it. (A node's geometry is its own, so a new shape is a new node.)
      if (feature.data !== node) {
        const part = graph.geometry(node).parts[0];
        feature.geometry = part;
        feature.data = node;
      }

      this.syncFeatureClasses(feature);

      if (feature.needsStyle) {
        const markerStyle = styles.styleMatch(node.tags, 'vertex', 'osm');

        // If we have an icon, increase the size of the marker..
        if (markerStyle.icon.image) {
          markerStyle.marker.image = 'largeCircle';
        } else if (node.hasInterestingTags()) {
          markerStyle.marker.image = 'taggedCircle';
        } else {
          markerStyle.marker.image = 'smallCircle';
        }

        // Show viewfields, if any..
        markerStyle.viewfield.angles = node.directions(graph);
        markerStyle.viewfield.image = 'viewfieldDark';

        if (hasWikidata(node)) {
          markerStyle.icon.color = 0x444444;
          markerStyle.marker.color = 0xdddddd;
          markerStyle.label.color = 0xdddddd;
        }
        if (node.isShared(graph)) {     // shared nodes / junctions are more grey
          markerStyle.icon.color = 0x111111;
          markerStyle.marker.color = 0xbbbbbb;
          markerStyle.label.color = 0xbbbbbb;
        }

        feature.style = markerStyle;
        feature.label = l10n.displayName(node.tags);
      }

      // Change layer stacking if necessary: above everything, or among the points in its tile.
      // (A new shape or a new zoom may put it in another tile.)
      if (isRelated) {
        feature.parentContainer = selectedContainer;
      } else if (feature.dirty || feature.container.parent === selectedContainer) {
        this._placePoint(feature, tileZoom);
      }

      this.updateFeature(feature, frame, viewport);
      this.retainFeature(feature, frame);
    }
  }


  /**
   * Puts a point's feature in the container of its tile (see `_pointTileContainer`).
   * Call this once the feature has its geometry and style.
   * @param feature - The point's feature
   * @param tileZoom - The zoom of the tiles to split by
   */
  protected _placePoint(feature: PixiFeaturePoint, tileZoom: number): void {
    const part = feature.geometry;
    if (!part) return;

    const hasViewfields = (feature.style?.viewfield?.angles?.length ?? 0) > 0;
    feature.parentContainer = this._pointTileContainer(part, hasViewfields, tileZoom);
  }


  /**
   * Renders the visible OSM standalone point features for this frame.
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   */
  public renderPoints(frame: RenderFrame, viewport: Viewport, data: OsmData): void {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;
    const styles = context.systems.styles!;

    const tileZoom = Math.floor(viewport.transform.zoom) + POINT_TILE_ZOOM;

    const nodes = data.points;
    for (const [nodeID, node] of nodes) {
      const featureID = `${this.layerID}-${nodeID}`;
      let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

      // If feature existed before as a different type, recreate it.
      if (feature && feature.type !== 'Point') {
        feature.destroy();
        feature = undefined;
      }

      if (!feature) {
        const extent = graph.geometry(node).parts[0]?.world?.extent;
        if (this._waitToMake('points', nodeID, extent, frame, node.isNew())) continue;
        feature = new PixiFeaturePoint(this, featureID);
      }

      // If data has changed, replace it. (A node's geometry is its own, so a new shape is a new node.)
      if (feature.data !== node) {
        const part = graph.geometry(node).parts[0];
        feature.geometry = part;
        feature.data = node;
      }

      this.syncFeatureClasses(feature);

      if (feature.needsStyle) {
        const markerStyle = styles.styleMatch(node.tags, 'point', 'osm');

        if (hasWikidata(node)) {
          markerStyle.marker.image = 'boldPin';
          markerStyle.marker.color = 0xdddddd;  // grey pins
          markerStyle.label.color = 0xdddddd;
        } else {
          markerStyle.marker.image = 'pin';
          markerStyle.marker.color = 0xffffff;  // white pins
          markerStyle.label.color = 0xffffff;
        }
        markerStyle.icon.color = 0x444444;

        // Show viewfields, if any..
        markerStyle.viewfield.angles = node.directions(graph);
        markerStyle.viewfield.image = 'viewfieldDark';


        // Override to style standalone addresses as circles, not pins.
        const preset = schema.matchTags(node.tags, 'point');
        if (preset?.id === 'address') {
          markerStyle.icon.image = 'maki-circle-stroked';
          markerStyle.marker.image = 'largeCircle';
        }

        feature.style = markerStyle;
        feature.label = l10n.displayName(node.tags);
      }

      if (feature.dirty) {
        this._placePoint(feature, tileZoom);   // a new shape or a new zoom may put it in another tile
      }

      this.updateFeature(feature, frame, viewport);
      this.retainFeature(feature, frame);
    }
  }


  /**
   * Gathers the midpoints that currently belong in the scene.
   * @param  viewport - Pixi viewport to use for rendering
   * @param  data - Visible OSM data to render, sorted by type
   * @param  related - Collections of related OSM IDs
   * @return Array of midpoint properties
   */
  protected _gatherMidpoints(viewport: Viewport, data: OsmData, related: RelatedIDs): MidpointProps[]  {
    const context = this.context;
    const graph = context.systems.editor!.staging.graph;

    // Need to consider both `data.lines` and `data.polygons` for drawing our midpoints.
    // Include only ways that are directly selected, or descended from a relation that is selected.
    const ways = new Set<OsmWay>();
    for (const [entityID, entity] of data.lines) {
      if (!related.descendantIDs.has(entityID)) continue;   // not selected
      ways.add(entity);
    }
    for (const [entityID, entity] of data.polygons) {
      if (entity.type !== 'way') continue;                  // not a way
      if (!related.descendantIDs.has(entityID)) continue;   // not selected
      ways.add(entity as OsmWay);
    }

    const results: MidpointProps[] = [];
    for (const way of ways) {
      const nodes = graph.childNodes(way);
      if (!nodes.length) continue;  // no nodes?

      // swap order for reverse-drawn ways
      const isReverse = (way.tags.oneway === '-1');

      for (let i = 0; i < nodes.length - 1; i++) {
        const node1 = isReverse ? nodes[i + 1] : nodes[i];
        const node2 = isReverse ? nodes[i] : nodes[i + 1];

        // gather world coordinates of the nodes
        const coord1 = graph.geometry(node1).parts[0].world?.coords as Vec2;
        const coord2 = graph.geometry(node2).parts[0].world?.coords as Vec2;
        if (!coord1 || !coord2) continue;

        const dist = vecLength(coord1, coord2);
        const rotation = vecAngle(coord1, coord2);
        const coord = vecInterp(coord1, coord2, 0.5);
        const loc = projWorldToWgs84(coord);

        // The node world coords can be used as a unique identifier
        const key = `${coord1[0].toFixed(7)},${coord1[1].toFixed(7)}:${coord2[0].toFixed(7)},${coord2[1].toFixed(7)}`;

        results.push({
          type: 'midpoint',
          serviceID: 'osm',
          isNew: true,
          id: key,
          wayID: way.id,
          edge: [node1.id, node2.id],
          dist: dist,
          rotation: rotation,
          coord: coord,
          loc: loc
        });
      }
    }

    return results;
  }


  /**
   * Renders the midpoint handles along visible OSM ways for this frame.
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param data - Visible OSM data to render, sorted by type
   * @param related - Collections of related OSM IDs
   */
  public renderMidpoints(frame: RenderFrame, viewport: Viewport, data: OsmData, related: RelatedIDs): void {
    const context = this.context;

    // Convert screen pixel values to world units
    const scale = 2 ** (WORLD_ZOOM - viewport.transform.z);
    const minDistance = 40 * scale;

    // Midpoints should be drawn above everything
    const mapUiLayer = this.scene.layers.get('map-ui') as PixiLayerMapUI;
    const selectedContainer = mapUiLayer.selected;

    // Keep only the midpoints drawn this frame, so stale ones don't pile up
    const prevMidpoints = this._midpoints;
    this._midpoints = new Map<DataID, Midpoint>();

    // Gather midpoints in view
    const midpointData = this._gatherMidpoints(viewport, data, related);
    for (const props of midpointData) {
      if (props.dist < minDistance) continue;  // skip if points are too close at this zoom

      // Generate data element if needed.
      // (Midpoints are found again by the segment's coordinates, so after a merge or split the same
      // segment can belong to another way, or have other nodes: then it's a new midpoint.)
      const prev = prevMidpoints.get(props.id);
      const isSame = (prev?.props.wayID === props.wayID && prev?.props.edge[0] === props.edge[0] && prev?.props.edge[1] === props.edge[1]);
      const midpoint = (prev && isSame) ? prev : new MarkerData<MidpointProps>(context, props);
      this._midpoints.set(props.id, midpoint);

      // Check that this part has coordinates and is a Point
      const part = midpoint.geoms.parts[0];
      if (!part.world || part.type !== 'Point') continue;

      const featureID = `${this.layerID}-midpoint-${midpoint.id}`;
      let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

      if (!feature) {
        feature = new PixiFeaturePoint(this, featureID);
        feature.style = {
          marker: { color: 0xffffff, image: 'midpoint' }
        };
        feature.parentContainer = selectedContainer;
      }

      // If data has changed.. Replace data and the link to its way.
      if (feature.data !== midpoint || feature.geometry !== part) {
        const prevWayID = (feature.data as Midpoint | null)?.props.wayID;
        if (prevWayID && prevWayID !== midpoint.props.wayID) {
          this.removeChildData(prevWayID, midpoint.id);
        }
        feature.geometry = part;
        feature.data = midpoint;
      }
      // (Every frame: the way's own redraw replaces its links to children)
      feature.addChildData(midpoint.props.wayID, midpoint.id);

      this.syncFeatureClasses(feature);
      if (feature.dirty) {
        // Important to apply viewport rotation - this needs to go on the marker,
        // because the container automatically rotates to be north-up.
        feature.marker!.rotation = midpoint.props.rotation + viewport.transform.rotation;
      }
      feature.update(viewport);
      this.retainFeature(feature, frame);
    }

    // Unlink the midpoints that aren't drawn anymore from their ways
    for (const [midpointID, prev] of prevMidpoints) {
      if (!this._midpoints.has(midpointID)) {
        this.removeChildData(prev.props.wayID, midpointID);
      }
    }
  }

}
