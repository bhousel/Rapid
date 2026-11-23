import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { FillBatch } from './lib/FillBatch.ts';
import { GeometryPart } from '../lib/GeometryPart.ts';
import { LineBatch } from './lib/LineBatch.ts';
import { MarkerData } from '../data/MarkerData.ts';
import { PixiFeatureLine } from './PixiFeatureLine.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.ts';
import { featureOrder } from './helpers.ts';
import { Extent, projWorldToWgs84, vecAngle, vecLength, vecInterp, WORLD_ZOOM } from '@rapid-sdk/math';
import { type OneOrMore, utilIterable } from '../util/iterable.ts';

import type { AbstractPixiFeature } from './AbstractPixiFeature.ts';
import type { Graph } from '../lib/Graph.ts';
import type { MarkerProps } from '../data/MarkerData.ts';
import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { OsmEntity, OsmNode, OsmRelation, OsmTags, OsmWay } from '../data/types.ts';
import type { PixiLayerMapUI } from './PixiLayerMapUI.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Preset } from '../lib/Preset.ts';
import type { RenderFrame } from './RenderFrame.ts';
import type { VertexBatch } from './lib/VertexBatch.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


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

/**
 * The casings and strokes of lines are drawn in batches (see `_lineBatch`): for each level, one
 * for every casing and one for every stroke. In a level's container the casings are drawn first,
 * then the strokes, and both before the containers of the road classes, which hold what a
 * line's feature draws itself (oneway arrows, a hovered line). Road classes go from -20 to 0
 * (`getzIndex`).
 */
const CASING_BATCH = -2000;
const STROKE_BATCH = -1000;

/**
 * Polygons are drawn in two batches too (see `_polygonBatch`): every fill, then every outline,
 * both before the tile containers, which hold what a polygon's feature draws itself (the
 * outlines of a hovered one). In each the polygons are in the order of their size, the largest
 * first. (A tile container's `zIndex` is -1 or more.)
 */
const FILL_BATCH = -2000;
const OUTLINE_BATCH = -1000;

/**
 * A batch's vertices are 32-bit floats, relative to a place in the world near its lines. The
 * layer moves that place to the view's center when it's so far from it that a float could be
 * off by this much of a pixel at the view's zoom (see `_moveBatchOrigins`). At zoom 16 that's
 * 260,000 pixels away, at zoom 19 a 32,000 world units, at zoom 22 4,000.
 */
const BATCH_PRECISION = 1 / 32;

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
  /**
   * The related IDs that are there to be grabbed: those of what's selected or being drawn, and
   * not of what's only hovered. Labels keep clear of these vertices and midpoints. They don't
   * for a hover, which would push labels around under the pointer.
   */
  handleIDs: Set<EntityID>;
}

/** The batches that draw the lines of one level (see `PixiLayerOsm._lineBatch`) */
interface LineBatchPair {
  casings: LineBatch | null;
  strokes: LineBatch | null;
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

/** What's known about a tile container (see `PixiLayerOsm._tileContainer`, `_retile`) */
interface TilePlace {
  /** The container it was made under: the polygons, the points, or a level of lines */
  parent: PIXI.Container;
  /** Its label there */
  label: string;
  /** For lines, the road class (z-index) */
  lineClass?: number;
  /** The tile `[x, y]` and its zoom, or nothing for a container that isn't one tile (`large`, `viewfields`) */
  tile?: Vec2;
  tileZoom?: number;
}

/**
 * After the view crosses a whole zoom level, the layer moves its features to the new zoom's tile
 * containers a few tiles at a time (see `_retile`). At least this many old containers are emptied
 * on every frame, and more while the frame has time.
 */
const MIN_RETILE = 4;

/** What moving a feature to another tile container costs the DRAW pass, which rebuilds both (ms) */
const RETILE_DRAW_MS = 0.002;

/**
 * The zoom (the map's effective zoom) from which the vertices worth showing by themselves are drawn:
 * the tagged ones, and where ways end or intersect (see `OsmNode.vertexKind`).
 */
const MIN_VERTEX_ZOOM = 16;

/**
 * While the layer goes through the entities that arrived (see `_renderArrived`), most of them
 * need nothing done (vertices that only shape their way). It looks at up to this many for each
 * batch, so that a frame can't spend all of its time passing them by.
 */
const ARRIVED_LOOK = 8000;

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

/**
 * Entities that arrived (a tile loaded, or the cull box moved over them) are sorted and looked at
 * this many at a time, with a check of the frame's time between (see `_renderArrived`). Most are
 * vertices that aren't drawn, so a batch takes about a millisecond.
 */
const ARRIVED_BATCH = 1000;

/**
 * How many moves of the cull box (or passes) a hidden feature is kept for before it's destroyed.
 * Panning back within that many finds it still made.
 */
const KEEP_HIDDEN_MOVES = 20;

/**
 * Pixels added to the furthest a feature can be hit from the box of its entity (`hitReach`),
 * when the layer asks the spatial index for the entities near the pointer (see `hitTest`).
 * The pointer and the features are placed by the frame that was drawn, the index isn't.
 */
const HIT_REACH_MARGIN = 4;

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
 * Returns the parts of one box that another doesn't cover, as up to four boxes: left and right of
 * the other at full height, and above and below it in between.
 * @param a - The box
 * @param b - The box to take away from it
 * @returns The parts of `a` outside `b` (`a` itself if they don't overlap)
 */
function extentMinus(a: Extent, b: Extent): Extent[] {
  if (!a.intersects(b)) return [a];

  const [ax0, ay0] = a.min;
  const [ax1, ay1] = a.max;
  const [bx0, by0] = b.min;
  const [bx1, by1] = b.max;
  const parts: Extent[] = [];

  if (bx0 > ax0)  parts.push(new Extent([ax0, ay0], [bx0, ay1]));
  if (bx1 < ax1)  parts.push(new Extent([bx1, ay0], [ax1, ay1]));

  const x0 = Math.max(ax0, bx0);
  const x1 = Math.min(ax1, bx1);
  if (by0 > ay0)  parts.push(new Extent([x0, ay0], [x1, by0]));
  if (by1 < ay1)  parts.push(new Extent([x0, by1], [x1, ay1]));

  return parts;
}


/**
 * Whether an entity's shape reaches into a box (in world coordinates).
 * A node is asked for its location, not its geometry: asking for that builds and keeps one, and
 * the cull box moves over thousands of nodes that are never drawn (see `OsmEntity.geoms`).
 * @param entity - The entity
 * @param graph - The graph it's in
 * @param box - The box
 * @return `true` or `false`, or `undefined` if the entity has no shape
 */
function reachesInto(entity: OsmEntity, graph: Graph, box: Extent): boolean | undefined {
  if (entity.type === 'node') {
    const coord = (entity as OsmNode).worldCoord();
    if (!coord) return undefined;
    return coord[0] >= box.min[0] && coord[0] <= box.max[0] && coord[1] >= box.min[1] && coord[1] <= box.max[1];
  }
  return graph.geometry(entity).world?.extent?.intersects(box);
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

  /**
   * Whether lines and polygons are drawn in batches (see `_lineBatch`, `_polygonBatch`), not by
   * display objects of each feature's own. Change it and `reset()` the layer to compare the two.
   */
  public useBatches: boolean;

  /** The containers that features are split into, by parent and label (see `_tileContainer`) */
  protected _tileContainers: Map<PIXI.Container, Map<string, PIXI.Container>>;
  /** The batches that lines are drawn in, by the container of their level: one for the casings, one for the strokes (see `_lineBatch`) */
  protected _lineBatches: Map<PIXI.Container, LineBatchPair>;
  /** The batch that draws the polygons' fills (see `_polygonBatch`) */
  protected _polygonFills: FillBatch | null;
  /** The batch that draws the polygons' outlines, above their fills */
  protected _polygonOutlines: LineBatch | null;
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
  /** Entities that arrived since the last pass, to sort and draw when frames have time (see `dataArrived`, `_moveBox`) */
  protected _arrivedIDs: Set<EntityID>;
  /** How many times the cull box moved, or a pass was done: hidden features age by this */
  protected _moves: number;
  /** The features that are hidden, and the value of `_moves` when each was (see `_forgetHidden`) */
  protected _hiddenAt: Map<FeatureID, number>;
  /** Whether the zoom was high enough for vertices the last time the layer looked (see `MIN_VERTEX_ZOOM`) */
  protected _showsVertices: boolean;
  /** Whether the features were marked to be drawn again for a new zoom or rotation (see `dirtyTransform`) */
  protected _zoomed: boolean;
  /** The whole zoom level that the features' tile containers are for (see `_retile`) */
  protected _tileFloor: number;
  /** What each tile container is */
  protected _tilePlace: WeakMap<PIXI.Container, TilePlace>;
  /** The tile containers of another zoom whose features are still to move, in the order to take them */
  protected _oldTiles: Set<PIXI.Container>;


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

    this.useBatches = true;

    this._tileContainers = new Map<PIXI.Container, Map<string, PIXI.Container>>();
    this._lineBatches = new Map<PIXI.Container, LineBatchPair>();
    this._polygonFills = null;
    this._polygonOutlines = null;
    this._midpoints = new Map<DataID, Midpoint>();
    this._unmadeInView = this._newUnmade();
    this._unmadeOutside = this._newUnmade();
    this._lastRelated = { descendantIDs: new Set<EntityID>(), siblingIDs: new Set<EntityID>(), handleIDs: new Set<EntityID>() };
    this._madeCount = 0;
    this._makingOutside = false;
    this._changedIDs = new Set<DataID>();
    this._seenFeatureIDs = null;
    this._modeDirty = false;
    this._arrivedIDs = new Set<EntityID>();
    this._moves = 0;
    this._hiddenAt = new Map<FeatureID, number>();
    this._showsVertices = false;
    this._zoomed = false;
    this._tileFloor = 0;
    this._tilePlace = new WeakMap<PIXI.Container, TilePlace>();
    this._oldTiles = new Set<PIXI.Container>();
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
    this._lineBatches.clear();    // (`super.reset()` destroyed them, with the containers they were in)
    this._polygonFills = null;
    this._polygonOutlines = null;
    this._oldTiles.clear();
    this._midpoints.clear();
    this._unmadeInView = this._newUnmade();
    this._unmadeOutside = this._newUnmade();
    this._changedIDs.clear();
    this._arrivedIDs.clear();
    this._hiddenAt.clear();

    // This layer finds its own features under the pointer (see `hitTest`)
    this.scene.setHitTester('osm', this);

    // Add containers (`super.reset()` released the old ones), see `design/scene.md`
    const basemap = this._spatialContainer('basemap', 'osm');
    this.polygonContainer = this._childContainer(basemap, 'polygons', 0);
    this.lineContainer = this._childContainer(basemap, 'lines', 1);
    this.pointContainer = this._spatialContainer('points', 'osm');
  }


  /**
   * The batches that draw the lines' casings and strokes (see `_lineBatch`)
   * @return The batches, in no particular order
   * @readonly
   */
  public get lineBatches(): LineBatch[] {
    const batches: LineBatch[] = [];
    for (const pair of this._lineBatches.values()) {
      if (pair.casings) batches.push(pair.casings);
      if (pair.strokes) batches.push(pair.strokes);
    }
    return batches;
  }


  /**
   * The batches that draw the polygons' fills and outlines (see `_polygonBatch`)
   * @return The fills' batch and the outlines' batch, each if there is one
   * @readonly
   */
  public get polygonBatches(): VertexBatch[] {
    const batches: VertexBatch[] = [];
    if (this._polygonFills) batches.push(this._polygonFills);
    if (this._polygonOutlines) batches.push(this._polygonOutlines);
    return batches;
  }


  /**
   * Finds the feature under the pointer, the one drawn on top if there are several.
   *
   * The scene asks this in place of Pixi's hit test (`PixiScene.setHitTester`), which walks every
   * feature: 7 ms for each pointer event among Užice's 107,000. Here the editor's spatial index
   * says which entities are near the pointer, and only their features are asked.
   * Each feature answers for itself (`AbstractPixiFeature.hitTest`: a point or an area as it
   * would have to Pixi, a line by its distance from the pointer), and the winner is the one
   * that's drawn on top (`featureOrder`).
   *
   * (The vertices and midpoints of what's selected are in the map UI's container, above
   * everything, and Pixi still finds those.)
   * @param point - The pointer's place in the stage's coordinates (a pointer event's `global`)
   * @param world - The same place in world coordinates
   * @return The feature, or `null` if the pointer is over none
   */
  public override hitTest(point: PIXI.PointData, world: PIXI.PointData): AbstractPixiFeature | null {
    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const viewport = context.viewport;

    if (!this._numVisible) return null;   // disabled, or zoomed out too far to draw

    // How far from the box of an entity one of its features can be hit, in world coordinates:
    // a line a few pixels from it, a pin above its point (the furthest of any feature drawn so far).
    const reach = (this._hitReach + HIT_REACH_MARGIN) * (2 ** (WORLD_ZOOM - viewport.transform.zoom));
    const box = { minX: world.x - reach, minY: world.y - reach, maxX: world.x + reach, maxY: world.y + reach };

    let best: AbstractPixiFeature | null = null;
    for (const entity of editor.entitiesInBox(box, graph)) {
      const featureIDs = this._dataHasFeature.get(entity.dataID);
      if (!featureIDs) continue;   // most are vertices that aren't drawn

      for (const featureID of featureIDs) {
        const feature = this.features.get(featureID);
        if (!feature?.hitTest(point, world)) continue;
        if (!best || featureOrder(feature, best) > 0) {
          best = feature;
        }
      }
    }
    return best;
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
      if (this._zoomed) {     // the features are for another zoom: the next thing to do is a pass
        this._zoomed = false;
        this._currentBox = null;
      }
      this._unmadeInView = this._newUnmade();    // nothing is drawn, so nothing is waiting to be made
      this._unmadeOutside = this._newUnmade();
      this._changedIDs.clear();
      this._arrivedIDs.clear();
      return;
    }

    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const map = context.systems.map;
    const graph = editor.staging.graph;

    context.loadTiles();  // Load tiles of OSM data to cover the view

    // The batches work out their lines' widths from this, on every frame. (A zoom changes
    // nothing else in them.) Lines are narrower below zoom 17, and have no casing below 16.
    const styleZoom = map?.effectiveZoom() ?? viewZoom;
    LineBatch.setView({
      pixel: 2 ** (WORLD_ZOOM - viewZoom),
      narrow: (styleZoom < 16) ? 4 : (styleZoom < 17) ? 2 : 0,
      wireframe: !!map?.wireframeMode,
      casing: styleZoom >= 16
    });
    FillBatch.setView({
      pixel: 2 ** (WORLD_ZOOM - viewZoom),
      rotation: viewport.transform.rotation,
      wireframe: !!map?.wireframeMode
    });
    this._moveBatchOrigins(viewport);

    const showsVertices = styleZoom >= MIN_VERTEX_ZOOM;

    // Only the view moved, and the last pass saw everything there is.
    // (Go on with what an earlier frame had no time for: features to make, and to draw again.)
    const prevBox = this._currentBox;
    const prevSortedBox = this._sortedBox;
    if (this.keepFeatures(frame)) {
      if (!frame.held) {
        if (this._zoomed && prevBox) {
          this._zoomed = false;
          this._moveBox(frame, prevBox, true);
        }
        this._checkVertexZoom(frame, showsVertices);
      }
      this.continueWaiting(frame, viewport);
      return;
    }

    // Only the view changed, and the frame has a new cull box that overlaps the old one: the view
    // left the box, or has a new zoom or rotation. Then the features in both boxes are still
    // the right ones, and the layer looks at what the box moved over and what it left behind.
    // After a zoom it also runs what stays through `render…()` again, over the next frames.
    // (Not after anything else changed: `requestedFor`. And whatever marks features dirty except
    // `dirtyTransform()` forgets the box, so that there's a pass.)
    const zoomed = this._zoomed;
    this._zoomed = false;
    if (prevBox && !frame.requestedFor(this.id) && prevBox.intersects(frame.cullBox)) {
      const t0 = performance.now();
      this._keptFrame = frame.id;          // no pass, so `cull()` leaves the features alone
      this._sortedBox = prevSortedBox;     // ..and what's waiting is still sorted by the old view
      this._moveBox(frame, prevBox, zoomed);
      if (zoomed) this._modeDirty = true;  // which vertices and midpoints are shown depends on the zoom
      this._checkVertexZoom(frame, showsVertices);
      this._endStep('box', t0);
      this.continueWaiting(frame, viewport);
      return;
    }

    // A pass sees every entity again, and says which ones wait this time.
    // (After a whole zoom level, the features move to other tiles over the next frames: `_retile`.)
    if (this._tileFloor !== Math.floor(viewZoom)) {
      this._tileFloor = Math.floor(viewZoom);
      this._findOldTiles(frame);
    }
    this._unmadeInView = this._newUnmade();
    this._unmadeOutside = this._newUnmade();
    this._arrivedIDs.clear();

    let t = performance.now();   // each step's time goes in the frame's stats
    const gathered = editor.entitiesInBox(frame.cullBox.bbox(), graph);   // Gather data in and around the view
    t = this._endStep('gather', t);

    // Leave out the vertices that won't be drawn, before anything is asked about them: in a
    // dense place they're three quarters of what's there. A vertex that only shapes its way is
    // drawn only for what's selected or hovered (`_addRelatedVertices`, below), and below the
    // zoom for vertices that goes for the ones where ways end or intersect too.
    // (The tagged ones stay whatever the zoom: `filterScene` counts the ones it hides.)
    this._showsVertices = showsVertices;
    let entities: OsmEntity[] = [];
    for (const entity of gathered) {
      if (entity.type === 'node') {
        const kind = (entity as OsmNode).vertexKind(graph);
        if (kind === 'shape' || (kind === 'structural' && !showsVertices)) continue;
      }
      entities.push(entity);
    }
    t = this._endStep('vertexkinds', t);

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
    this._addRelatedVertices(frame, data, related);
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
    this._moves++;
    this._forgetHidden();
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
      const changedIDs = new Set<DataID>(this._changedIDs);
      this._changedIDs.clear();
      this._modeDirty = false;
      this._renderChanged(frame, viewport, changedIDs, true);
    }

    // ..then what arrived, while there's time
    if (this._arrivedIDs.size && this._currentBox) {
      this._renderArrived(frame, viewport);
    }

    super.continueWaiting(frame, viewport, outside);

    if (this._countUnmade(this._unmadeOutside) || this._countUnmade(this._unmadeInView)) {
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

    // Last, the tiles of another zoom: nobody sees which container a feature is in.
    // (A few on every frame, and the rest once the drawing is done.)
    if (this._oldTiles.size) {
      const t0 = performance.now();
      this._retile(frame);
      this._endStep('retile', t0);
    }
  }


  /**
   * Marks the features to be drawn again for a new zoom or rotation, as every layer does.
   * Unlike the others, this layer doesn't forget which cull box its features are for: a zoom
   * changes how they're drawn, not which ones there are, so `render()` can follow the box to
   * its new size without a pass (see `_moveBox`).
   */
  public override dirtyTransform(): void {
    const box = this._currentBox;
    super.dirtyTransform();
    this._currentBox = box;
    this._zoomed = true;
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
   * Remembers the entities that arrived (a tile loaded), to sort them and make their features
   * over the next frames, without a pass (see `_renderArrived`). The ones that have features
   * already get their styles worked out again: what arrived may change how they connect, or
   * what they're a member of.
   * @param dataIDs - The entities on the tile, and the ones whose shape it changed (what
   *   `EditSystem` lists with its `merge` event)
   */
  public override dataArrived(dataIDs: OneOrMore<DataID>): void {
    for (const dataID of utilIterable(dataIDs)) {
      this._arrivedIDs.add(dataID);
      for (const featureID of (this._dataHasFeature.get(dataID) ?? [])) {
        const feature = this.features.get(featureID);
        if (feature) {
          feature.dirty = true;
        }
      }
    }
  }


  /**
   * Notes which features are hidden, and since when (see `_forgetHidden`).
   * @param feature - The feature
   * @param visible - Whether it's visible now
   */
  public override visibilityChanged(feature: AbstractPixiFeature, visible: boolean): void {
    super.visibilityChanged(feature, visible);
    if (visible) {
      this._hiddenAt.delete(feature.id);
    } else {
      this._hiddenAt.set(feature.id, this._moves);
    }
  }


  /**
   * Adds a feature to the layer (see `AbstractPixiLayer.addFeature`). A new feature is visible,
   * whatever became of an earlier one with its ID.
   * @param feature - The feature
   */
  public override addFeature(feature: AbstractPixiFeature): void {
    super.addFeature(feature);
    this._hiddenAt.delete(feature.id);
  }


  /**
   * Removes a feature from the layer (see `AbstractPixiLayer.removeFeature`).
   * @param feature - The feature
   */
  public override removeFeature(feature: AbstractPixiFeature): void {
    super.removeFeature(feature);
    this._hiddenAt.delete(feature.id);
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
    if (this._hiddenAt.size) {
      this._hiddenAt.delete(feature.id);   // wanted, even if it isn't shown at this zoom
    }
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
    const hoverOnlyIDs = new Set<EntityID>();   // hovered, and neither selected nor being drawn
    for (const hoveredID of hoveredIDs) {
      if (!selectedIDs.has(hoveredID) && !drawingIDs.has(hoveredID)) {
        hoverOnlyIDs.add(hoveredID);
      }
    }

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
        if (hoverOnlyIDs.has(dataID) && !interestingIDs.has(parent.id)) {
          hoverOnlyIDs.add(parent.id);
        } else if (!hoverOnlyIDs.has(dataID)) {
          hoverOnlyIDs.delete(parent.id);
        }
        interestingIDs.add(parent.id);
      }
    }

    // Create collections of the sibling and descendant IDs,
    // These will determine which vertices and midpoints get drawn.
    const related: RelatedIDs = {
      descendantIDs: new Set<EntityID>(),
      siblingIDs: new Set<EntityID>(),
      handleIDs: new Set<EntityID>()
    };
    for (const interestingID of interestingIDs) {
      this.getSelfAndDescendants(interestingID, related.descendantIDs);
      this.getSelfAndSiblings(interestingID, related.siblingIDs);
      if (!hoverOnlyIDs.has(interestingID)) {
        this.getSelfAndDescendants(interestingID, related.handleIDs);
        this.getSelfAndSiblings(interestingID, related.handleIDs);
      }
    }

    return related;
  }


  /**
   * Adds the vertices related to what's selected, hovered or being drawn to the data of a pass.
   * These are drawn whatever kind of vertex they are, and the pass left out the ones that only
   * shape their way. Like everything else in a pass, they have to be in the frame's cull box,
   * and not hidden.
   * @param frame - The frame being rendered
   * @param data - The data of the pass, sorted by type
   * @param related - Collections of related OSM IDs
   */
  protected _addRelatedVertices(frame: RenderFrame, data: OsmData, related: RelatedIDs): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const graph = editor.staging.graph;

    for (const relatedIDs of [related.descendantIDs, related.siblingIDs]) {
      for (const entityID of relatedIDs) {
        if (data.vertices.has(entityID)) continue;

        const entity = graph.hasEntity(entityID);
        if (entity?.type !== 'node') continue;

        const node = entity as OsmNode;
        if (node.geometry(graph) !== 'vertex') continue;
        if (!graph.geometry(node).world?.extent?.intersects(frame.cullBox)) continue;
        if (filters.isHidden(node, graph, 'vertex')) continue;

        data.vertices.set(entityID, node);
      }
    }
  }


  /**
   * Whether there's nothing to do for an entity that arrived, because it's a vertex that only
   * shapes its way. Such a vertex has a feature only while it's related to what's selected or
   * hovered, and most of what arrives in a dense place is one of these.
   * @param entity - The entity, if it still exists
   * @return `true` if the layer can pass it by
   */
  protected _isIdleVertex(entity: OsmEntity | undefined): boolean {
    if (entity?.type !== 'node') return false;

    const graph = this.context.systems.editor!.staging.graph;
    const related = this._lastRelated;
    const nodeID = entity.id;

    if ((entity as OsmNode).vertexKind(graph) !== 'shape') return false;
    if (this._dataHasFeature.get(nodeID)?.size) return false;    // (it was something else before)
    return !related.descendantIDs.has(nodeID) && !related.siblingIDs.has(nodeID);
  }


  /**
   * Looks at whether the zoom for vertices was crossed without a pass. The map's effective zoom
   * depends on the latitude, so a view that only moves north or south can cross it.
   * The vertices that appear or disappear then are remembered as having arrived, to be drawn or
   * hidden over the next frames (`_renderArrived`).
   * @param frame - The frame being rendered
   * @param showsVertices - Whether the zoom is high enough for vertices now
   */
  protected _checkVertexZoom(frame: RenderFrame, showsVertices: boolean): void {
    if (showsVertices === this._showsVertices) return;
    this._showsVertices = showsVertices;

    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;

    for (const entity of editor.entitiesInBox(frame.cullBox.bbox(), graph)) {
      if (entity.type !== 'node') continue;
      const kind = (entity as OsmNode).vertexKind(graph);
      if (kind && kind !== 'shape') {
        this._arrivedIDs.add(entity.id);
      }
    }
  }


  /**
   * Draws the features of some data again without the pass: in a dense place a pass takes 200 ms,
   * and a hover changes two features and a few vertices.
   *
   * It runs the data through the same `render…()` functions as a pass does, leaving out what a
   * pass wouldn't have gathered (hidden, or outside the cull box). Then it hides whichever of the
   * data's features those functions didn't want anymore, as `cull()` does after a pass.
   *
   * There are two ways to call it:
   * - **Urgent,** for what the user just did: an edit, a hover, a selection, a change of mode.
   *   A class changes the data's own features (a halo, a highlight) and which vertices and
   *   midpoints are shown above everything (`_gatherRelated`), so this also draws again
   *   everything that was or is now related, and the midpoints. All of it is drawn in this
   *   frame, whatever time the frame has.
   * - **Not urgent,** for data that arrived. New features are made and drawn as the frame's time
   *   allows, and wait otherwise (`_waitToMake`, `updateFeature`). What's related isn't worked
   *   out again, unless some of what arrived is related: then the next frame does that.
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param changedIDs - The data to draw again
   * @param urgent - Whether the user is waiting for it (see above)
   */
  protected _renderChanged(frame: RenderFrame, viewport: Viewport, changedIDs: Set<DataID>, urgent: boolean): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters!;
    const graph = editor.staging.graph;

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
    const midpointsBefore = urgent ? [...this._midpoints.keys()] : [];

    const wasUrgent = frame.urgent;
    if (urgent) {
      frame.urgent = true;              // draw them in this frame
    }
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

    let related = this._lastRelated;
    const relatedIDs = new Set<DataID>();

    if (urgent) {
      const before = this._lastRelated;
      related = this._gatherRelated(viewport.transform.zoom);
      this._lastRelated = related;

      // ..then whatever was or is now related to what's selected or hovered, and wasn't drawn above
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
    }

    if (data.vertices.size)  this.renderVertices(frame, viewport, data, related);

    if (urgent) {
      if (context.mode?.id === 'select') {
        this.renderMidpoints(frame, viewport, data, related);
      } else {
        this._midpoints.clear();
      }
    } else {
      // Did something arrive that's related to what's selected or hovered? Its vertices and
      // midpoints may be different now: work that out on the next frame.
      for (const dataID of changedIDs) {
        if (related.descendantIDs.has(dataID) || related.siblingIDs.has(dataID)) {
          this._modeDirty = true;
          break;
        }
      }
    }

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
    for (const dataIDs of [changedIDs, relatedIDs]) {
      for (const dataID of dataIDs) {
        for (const featureID of (this._dataHasFeature.get(dataID) ?? [])) {
          const feature = this.features.get(featureID);
          if (feature && !seen.has(featureID)) {
            unwanted.push(feature);
          }
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
   * Sorts and draws the entities that arrived (a tile loaded, or the cull box moved over them),
   * a batch at a time while the frame has time, and at least one batch.
   * A new entity gets its feature now or in a later frame, like any other (`_waitToMake`).
   * The vertices that need nothing done aren't part of a batch (see `_isIdleVertex`).
   * @param frame - The frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  protected _renderArrived(frame: RenderFrame, viewport: Viewport): void {
    const graph = this.context.systems.editor!.staging.graph;

    const arrivedIDs = this._arrivedIDs;
    do {
      const batch = new Set<DataID>();
      let looked = 0;
      for (const entityID of arrivedIDs) {
        arrivedIDs.delete(entityID);   // (deleting from a Set while iterating over it is safe)
        if (!this._isIdleVertex(graph.hasEntity(entityID))) {
          batch.add(entityID);
          if (batch.size >= ARRIVED_BATCH) break;
        }
        if (++looked >= ARRIVED_LOOK) break;
      }
      if (batch.size) {
        this._renderChanged(frame, viewport, batch, false);
      }
    } while (arrivedIDs.size && frame.hasTime());
  }


  /**
   * Follows the cull box to a new place without a pass: the view left the box that the layer
   * has features for, and the frame has a new one that overlaps it. Whatever is in both stays
   * as it is.
   * - What the box left behind is hidden, as `cull()` would hide it. (It's kept for a while,
   *   in case the view comes back: see `_forgetHidden`.)
   * - What the box moved over is remembered as having arrived, the entities in view first, and
   *   made over the next frames (`_renderArrived`).
   * - After a zoom, what stays is remembered as having arrived too. Its features are drawn for
   *   another zoom, and may belong in other tiles' containers and need other details (a line's
   *   arrows). The `render…()` functions see to all of that, a batch at a time, where a pass
   *   would do it for everything in one frame.
   * @param frame - The frame being rendered
   * @param prevBox - The cull box that the layer's features were current for
   * @param zoomed - Whether the features are to be drawn again for a new zoom or rotation
   */
  protected _moveBox(frame: RenderFrame, prevBox: Extent, zoomed: boolean = false): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const graph = editor.staging.graph;
    const box = frame.cullBox;

    // Left behind: the features of entities that the new box doesn't reach.
    // (By the entity's whole shape, as a pass gathers it, not by the feature's own part of it.)
    const zoomFloor = Math.floor(frame.zoom);
    const crossed = (zoomFloor !== this._tileFloor);
    this._tileFloor = zoomFloor;

    const left = new Map<DataID, boolean>();
    const inView: EntityID[] = [];
    const outside: EntityID[] = [];

    // After a pan, what the box left behind is in the parts of the old box that the new one
    // doesn't cover, and the spatial index knows what's there: that costs what moved, where a
    // walk over every feature costs what there is. (After a zoom the walk is needed anyway, to
    // have every feature that stays drawn again.)
    if (!zoomed) {
      for (const part of extentMinus(prevBox, box)) {
        for (const entity of editor.entitiesInBox(part.bbox(), graph)) {
          const featureIDs = this._dataHasFeature.get(entity.id);
          if (!featureIDs?.size) continue;
          const extent = graph.geometry(entity).world?.extent;
          if (!extent || extent.intersects(box)) continue;    // it reaches into the new box
          for (const featureID of featureIDs) {
            const feature = this.features.get(featureID);
            if (!feature) continue;
            feature.visible = false;
            this._waitingInView.delete(feature);   // (drawing it again could show it)
            this._waitingOutside.delete(feature);
          }
        }
      }
    }

    for (const feature of (zoomed ? this.features.values() : [])) {
      // (The hidden ones count too: a feature hides itself at a zoom where it's too small to
      // see, and may be big enough now.)

      // Most features are still in the box, and their own shape says so: then their entity's is
      // too, and there's nothing to look up. (Not a midpoint: those go with their ways.)
      const own = feature.geometry?.world?.extent;
      if (own?.intersects(box)) {
        if (zoomed) {
          const data = feature.data;
          const type = data?.type;
          if (type === 'node' || type === 'way' || type === 'relation') {
            (own.intersects(frame.viewBox) ? inView : outside).push(data!.dataID);
          }
        }
        if (crossed) {
          this._placeLarge(feature);
        }
        continue;
      }

      const dataID = this._featureHasData.get(feature.id);
      if (!dataID) continue;

      let hasLeft = left.get(dataID);
      if (hasLeft === undefined) {
        const entity = graph.hasEntity(dataID);     // (not a midpoint: those go with their ways)
        const extent = entity && graph.geometry(entity).world?.extent;
        hasLeft = !!extent && !extent.intersects(box);
        left.set(dataID, hasLeft);
        if (zoomed && extent && !hasLeft) {
          (extent.intersects(frame.viewBox) ? inView : outside).push(dataID);
        }
      }
      if (hasLeft) {
        feature.visible = false;
        this._waitingInView.delete(feature);   // (drawing it again could show it)
        this._waitingOutside.delete(feature);
      } else if (crossed) {
        this._placeLarge(feature);
      }
    }

    // Moved over: the entities in the parts of the new box that the old one didn't cover.
    // (An entity that reaches into the old box was there already.)
    for (const part of extentMinus(box, prevBox)) {
      for (const entity of editor.entitiesInBox(part.bbox(), graph)) {
        const wasThere = reachesInto(entity, graph, prevBox);
        if (wasThere === undefined || wasThere) continue;
        (reachesInto(entity, graph, frame.viewBox) ? inView : outside).push(entity.id);
      }
    }
    for (const entityID of inView) {
      this._arrivedIDs.add(entityID);
    }
    for (const entityID of outside) {
      this._arrivedIDs.add(entityID);
    }

    if (crossed) {
      this._findOldTiles(frame);
    }

    this._moves++;
    this._forgetHidden();
    this._removeEmptyContainers();
  }


  /**
   * Destroys the features that have been hidden for more than `KEEP_HIDDEN_MOVES` moves of the
   * cull box (or passes). A pass does this for what it hasn't seen in a while (`cull()`), but
   * while the view only moves there are no passes, and what the box leaves behind would pile up.
   */
  protected _forgetHidden(): void {
    for (const [featureID, hiddenAt] of this._hiddenAt) {
      if (this._moves - hiddenAt <= KEEP_HIDDEN_MOVES) continue;
      this._hiddenAt.delete(featureID);    // (deleting from a Map while iterating over it is safe)
      this.features.get(featureID)?.destroy();
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

        // ..and still in the cull box? (It may have moved on since: see `_moveBox`.)
        const extent = graph.geometry(entity).world?.extent;
        if (extent && !extent.intersects(frame.cullBox)) continue;

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
    return super.numWaiting + this._countUnmade(this._unmadeInView) + this._countUnmade(this._unmadeOutside) +
      this._arrivedIDs.size + this._oldTiles.size;
  }


  /**
   * How many of those are in view.
   * @return The number waiting in view
   */
  public override get numWaitingInView(): number {
    // (What arrived counts as in view until it's been looked at: the labels wait for this to be
    // zero before they're placed, because they're placed around the points and vertices.)
    return super.numWaitingInView + this._countUnmade(this._unmadeInView) + this._arrivedIDs.size;
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

        // The batches that draw its fill and its outlines
        if (feature.dirty) {
          if (!this.useBatches) {
            feature.fillBatch = null;
            feature.strokeBatch = null;
          } else if (!feature.fillBatch || feature.fillBatch.destroyed || !feature.strokeBatch || feature.strokeBatch.destroyed) {
            feature.fillBatch = this._polygonBatch(true, part);
            feature.strokeBatch = this._polygonBatch(false, part);
          }
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

        // A polygon that draws something itself (the outlines of a hovered one, or all of it
        // if it has no batches) is in its tile's container. One that's drawn by its batches
        // alone isn't in the scene. (A new shape or zoom may put it in another container.)
        if (feature.dirty) {
          if (feature.drawsInContainer()) {
            this._setTile(feature, this._polygonTileContainer(part, tileZoom));
          } else if (feature.container.parent) {
            feature.parentContainer = null;
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
            poiFeature.labelAvoid = true;   // labels keep clear of it
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
    return this._tileContainer(polygonContainer, `${tile[0]},${tile[1]},${tileZoom}`, tileOrder(tile), tile, tileZoom);
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
    const container = tile ?
      this._tileContainer(levelContainer, `${zIndex}/${tile[0]},${tile[1]},${tileZoom}`, zIndex + tileOrder(tile), tile, tileZoom) :
      this._tileContainer(levelContainer, `${zIndex}/large`, zIndex);
    this._tilePlace.get(container)!.lineClass = zIndex;
    return container;
  }


  /**
   * Returns the tile container a feature belongs in at the current zoom, given the kind of
   * container it's in now (polygons, points, or a level and road class of lines).
   * @param feature - The feature
   * @param place - What its container is
   * @return The container, or `null` if the feature has no shape
   */
  protected _tileFor(feature: AbstractPixiFeature, place: TilePlace): PIXI.Container | null {
    const part = feature.geometry;
    if (!part?.world) return null;

    if (place.parent === this.polygonContainer) {
      return this._polygonTileContainer(part, this._tileFloor + POLYGON_TILE_ZOOM);
    } else if (place.parent === this.pointContainer) {
      const hasViewfields = (feature.style?.viewfield?.angles?.length ?? 0) > 0;
      return this._pointTileContainer(part, hasViewfields, this._tileFloor + POINT_TILE_ZOOM);
    } else if (place.lineClass !== undefined) {
      return this._lineTileContainer(place.parent, place.lineClass, part, this._tileFloor + LINE_TILE_ZOOM);
    }
    return null;
  }


  /**
   * Puts a feature in a tile container, as the `render…()` functions do for a feature they
   * draw again. While the feature's old tile is waiting to be moved as a whole (`_retile`), it
   * stays there, unless it belongs somewhere else altogether (another level or road class).
   * @param feature - The feature
   * @param container - The tile container it belongs in
   */
  protected _setTile(feature: AbstractPixiFeature, container: PIXI.Container): void {
    const current = feature.container.parent;
    if (current && this._oldTiles.has(current)) {
      const from = this._tilePlace.get(current);
      const to = this._tilePlace.get(container);
      if (from && to && from.parent === to.parent && from.lineClass === to.lineClass) return;
    }
    feature.parentContainer = container;
  }


  /**
   * After the view crossed a whole zoom level: moves a feature at once if it's bigger than a
   * tile at one of the two zooms and not at the other. Those go between a tile and the `large`
   * container, which is too big to rebuild every time a tile's worth of features joins it.
   * @param feature - The feature
   */
  protected _placeLarge(feature: AbstractPixiFeature): void {
    const extent = feature.geometry?.world?.extent;
    const current = feature.container.parent;
    const place = current && this._tilePlace.get(current);
    if (!extent || !place || place.parent === this.pointContainer) return;

    const tileZoom = this._tileFloor + ((place.parent === this.polygonContainer) ? POLYGON_TILE_ZOOM : LINE_TILE_ZOOM);
    const isLarge = !place.tile;
    const willBeLarge = !this._tileOf(extent, tileZoom);
    if (isLarge !== willBeLarge) {
      const container = this._tileFor(feature, place);
      if (container) {
        feature.parentContainer = container;
      }
    }
  }


  /**
   * After the view crossed a whole zoom level: lists the tile containers that are for another
   * zoom, the ones in view first. `_retile()` moves their features over the next frames.
   * @param frame - The frame being rendered
   */
  protected _findOldTiles(frame: RenderFrame): void {
    const inView: PIXI.Container[] = [];
    const outside: PIXI.Container[] = [];

    for (const [parent, byLabel] of this._tileContainers) {
      const kindZoom = (parent === this.polygonContainer) ? POLYGON_TILE_ZOOM : (parent === this.pointContainer) ? POINT_TILE_ZOOM : LINE_TILE_ZOOM;
      const tileZoom = this._tileFloor + kindZoom;
      for (const container of byLabel.values()) {
        const place = this._tilePlace.get(container);
        if (!place?.tile || place.tileZoom === undefined || place.tileZoom === tileZoom) continue;

        const tileSize = 256 * (2 ** (WORLD_ZOOM - place.tileZoom));
        const [x, y] = place.tile;
        const extent = new Extent([x * tileSize, y * tileSize], [(x + 1) * tileSize, (y + 1) * tileSize]);
        (extent.intersects(frame.viewBox) ? inView : outside).push(container);
      }
    }

    // Tiles that share a parent tile go one after the other: after a zoom out they all move
    // into that one, and it's rebuilt once if they arrive on the same frame.
    const byParentTile = (a: PIXI.Container, b: PIXI.Container): number => {
      const [ax, ay] = this._tilePlace.get(a)!.tile!;
      const [bx, by] = this._tilePlace.get(b)!.tile!;
      return ((ay >> 1) - (by >> 1)) || ((ax >> 1) - (bx >> 1));
    };
    this._oldTiles = new Set<PIXI.Container>([...inView.sort(byParentTile), ...outside.sort(byParentTile)]);
  }


  /**
   * Moves features to the tile containers of the current zoom, a few old tiles at a time.
   *
   * When the view crosses a whole zoom level, every feature belongs in another tile's container.
   * Moving them all on one frame costs 100 ms, and then Pixi rebuilds every container's
   * instructions (150 ms in Užice). Moving them as they're drawn again takes 30 frames, and
   * Pixi rebuilds the containers at both ends on each of them. So a whole old tile moves at a
   * time: its container is rebuilt never again, and the new ones once, or a few times.
   * Meanwhile the old and the new tiles are drawn side by side.
   * @param frame - The frame being rendered
   */
  protected _retile(frame: RenderFrame): void {
    const oldTiles = this._oldTiles;
    let count = 0;

    for (const container of oldTiles) {
      if (count >= MIN_RETILE && !frame.hasTime()) return;
      oldTiles.delete(container);   // (deleting from a Set while iterating over it is safe)
      count++;

      const place = this._tilePlace.get(container);
      if (!place || container.destroyed) continue;

      const children = container.removeChildren();
      for (const child of children) {
        const feature = this.features.get(child.label);
        const tile = feature && this._tileFor(feature, place);
        if (tile) {
          tile.addChild(child);
        } else {
          container.addChild(child);    // (nothing we know: it stays)
        }
      }
      frame.drawDebt += children.length * RETILE_DRAW_MS;

      if (!container.children.length) {
        this._tileContainers.get(place.parent)?.delete(place.label);
        this.scene.destroyWorldContainer(container);
      }
    }
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
    return this._tileContainer(pointContainer, `${tile[0]},${tile[1]},${tileZoom}`, tile[1] + tileOrder(tile), tile, tileZoom);
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
   * @param tile - The tile `[x, y]`, for a container that's one tile
   * @param tileZoom - That tile's zoom
   * @return The container
   */
  protected _tileContainer(parent: PIXI.Container, label: string, zIndex: number, tile?: Vec2, tileZoom?: number): PIXI.Container {
    let byLabel = this._tileContainers.get(parent);
    if (!byLabel) {
      byLabel = new Map<string, PIXI.Container>();
      this._tileContainers.set(parent, byLabel);
    }
    let container = byLabel.get(label);
    if (!container) {
      container = this._childContainer(parent, label, zIndex);
      byLabel.set(label, container);
      this._tilePlace.set(container, { parent: parent, label: label, tile: tile, tileZoom: tileZoom });
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

    for (const [parent, pair] of this._lineBatches) {
      // (Not a batch that a feature is waiting to be drawn in: it's empty until then.)
      if (pair.casings && !pair.casings.size && !pair.casings.users) {
        pair.casings.destroy();
        pair.casings = null;
      }
      if (pair.strokes && !pair.strokes.size && !pair.strokes.users) {
        pair.strokes.destroy();
        pair.strokes = null;
      }
      if (!pair.casings && !pair.strokes) {
        this._lineBatches.delete(parent);
      }
    }
    if (this._polygonFills && !this._polygonFills.size && !this._polygonFills.users) {
      this._polygonFills.destroy();
      this._polygonFills = null;
    }
    if (this._polygonOutlines && !this._polygonOutlines.size && !this._polygonOutlines.users) {
      this._polygonOutlines.destroy();
      this._polygonOutlines = null;
    }
  }


  /**
   * Returns the batch that draws the polygons' fills, or the one that draws their outlines,
   * making it if there's none. Every fill is drawn before every outline, so a polygon's outline
   * is never under another's fill. In each batch the polygons are in the order of their
   * feature's `zIndex`: by size, the largest first.
   * @param isFill - Whether the batch is for the fills, not the outlines
   * @param part - The geometry of the polygon that the batch is wanted for
   * @return The batch to draw the polygon's fill or outlines in
   */
  protected _polygonBatch(isFill: true, part: GeometryPart): FillBatch;
  protected _polygonBatch(isFill: false, part: GeometryPart): LineBatch;
  protected _polygonBatch(isFill: boolean, part: GeometryPart): FillBatch | LineBatch {
    const existing = isFill ? this._polygonFills : this._polygonOutlines;
    if (existing && !existing.destroyed) return existing;

    // The batch's coordinates start near its polygons: at the first of them (see `_moveBatchOrigins`).
    const origin = part.world!.origin!;
    const batch = isFill ? new FillBatch() : new LineBatch();
    batch.label = isFill ? 'fills' : 'outlines';
    batch.zIndex = isFill ? FILL_BATCH : OUTLINE_BATCH;
    batch.position.set(origin[0], origin[1]);
    this.polygonContainer!.addChild(batch);
    if (isFill) {
      this._polygonFills = batch as FillBatch;
    } else {
      this._polygonOutlines = batch as LineBatch;
    }
    return batch;
  }


  /**
   * Returns the batch that draws the casings, or the strokes, of a level's lines, making it if
   * there's none. A batch is one mesh and one draw call for all of its lines (see `LineBatch`).
   *
   * A level's casings are all drawn before its strokes, so where two roads meet, neither's
   * casing crosses the other's stroke. In a batch the lines are in the order of their
   * feature's `zIndex`: by road class, then by the way's ID.
   * @param levelContainer - The container of the line's level (`way.layer()`)
   * @param isCasing - Whether the batch is for the casings, not the strokes
   * @param part - The geometry of the line that the batch is wanted for
   * @return The batch to draw the line's casing or stroke in
   */
  protected _lineBatch(levelContainer: PIXI.Container, isCasing: boolean, part: GeometryPart): LineBatch {
    let pair = this._lineBatches.get(levelContainer);
    if (!pair) {
      pair = { casings: null, strokes: null };
      this._lineBatches.set(levelContainer, pair);
    }

    let batch = isCasing ? pair.casings : pair.strokes;
    if (!batch || batch.destroyed) {
      batch = new LineBatch();
      batch.label = isCasing ? 'casings' : 'strokes';
      batch.zIndex = isCasing ? CASING_BATCH : STROKE_BATCH;

      // The batch's coordinates start near its lines: at the first of them. (Its buffers hold
      // 32-bit floats, which world coordinates don't fit in. See `_moveBatchOrigins`.)
      const origin = part.world!.origin!;
      batch.position.set(origin[0], origin[1]);
      levelContainer.addChild(batch);
      if (isCasing) {
        pair.casings = batch;
      } else {
        pair.strokes = batch;
      }
    }
    return batch;
  }


  /**
   * Keeps the batches' coordinates fine enough for the view's zoom. A batch's vertices are
   * 32-bit floats relative to its place in the world, which is where its first line was. When
   * the view is far from there (after a long pan), and zoomed in enough for it to show, the
   * batch's place moves to the view's center, and its vertices with it.
   * @param viewport - The viewport that's being drawn
   */
  protected _moveBatchOrigins(viewport: Viewport): void {
    if (!this._lineBatches.size && !this._polygonFills && !this._polygonOutlines) return;

    // How far from its place a batch's floats are still good to a part of a pixel, at this zoom
    const reach = BATCH_PRECISION * (2 ** 23) * (2 ** (WORLD_ZOOM - viewport.transform.zoom));
    const [x, y] = viewport.screenToWorld(viewport.center());

    const isFar = (batch: VertexBatch | null): batch is VertexBatch => {
      return !!batch && !batch.destroyed && (Math.abs(batch.position.x - x) > reach || Math.abs(batch.position.y - y) > reach);
    };
    for (const pair of this._lineBatches.values()) {
      if (isFar(pair.casings)) pair.casings.moveOrigin(Math.round(x), Math.round(y));
      if (isFar(pair.strokes)) pair.strokes.moveOrigin(Math.round(x), Math.round(y));
    }
    if (isFar(this._polygonFills)) this._polygonFills.moveOrigin(Math.round(x), Math.round(y));
    if (isFar(this._polygonOutlines)) this._polygonOutlines.moveOrigin(Math.round(x), Math.round(y));
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
          // Its level's batches. (A new level puts it in others.)
          if (!this.useBatches) {
            feature.batch = null;
            feature.casingBatch = null;
          } else if (feature.batch?.parent !== levelContainer || feature.casingBatch?.parent !== levelContainer) {
            feature.batch = this._lineBatch(levelContainer, false, part);
            feature.casingBatch = this._lineBatch(levelContainer, true, part);
          }
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

        // A line that draws something itself (oneway arrows, a hover's glow, or the whole line
        // if it has no batches) is in the container of its road class and tile. One that's
        // drawn by its batches alone isn't in the scene: Pixi has nothing to do for it then.
        // (A new shape, level, road class or zoom may put it in another container.)
        if (feature.dirty) {
          if (feature.drawsInContainer()) {
            this._setTile(feature, this._lineTileContainer(levelContainer, zindex, part, tileZoom));
          } else if (feature.container.parent) {
            feature.parentContainer = null;
          }
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
      return node.vertexKind(graph) !== 'shape';   // tagged, or where ways end or intersect
    };

    const isRelatedVertex = (entityID: EntityID): boolean => {
      return related.descendantIDs.has(entityID) || related.siblingIDs.has(entityID);
    };


    const tileZoom = Math.floor(viewZoom) + POINT_TILE_ZOOM;

    const nodes = data.vertices;
    for (const [nodeID, node] of nodes) {
      const isRelated = isRelatedVertex(nodeID);   // major importance: drawn above everything
      const isInteresting = (styleZoom >= MIN_VERTEX_ZOOM && isInterestingVertex(node));   // minor importance: drawn with the points

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
      // Labels keep clear of a vertex, unless it's only drawn because its way is hovered.
      // (A hover that pushed labels aside would make them jump around under the pointer.)
      const labelAvoid = isInteresting || related.handleIDs.has(nodeID);
      if (feature.labelAvoid !== labelAvoid) {
        feature.labelAvoid = labelAvoid;
        if (!feature.dirty) feature.updateAvoid();   // (a dirty one marks its place when it's drawn)
      }

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
    this._setTile(feature, this._pointTileContainer(part, hasViewfields, tileZoom));
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
        feature.labelAvoid = true;   // labels keep clear of it
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

      // Labels keep clear of a midpoint, unless its way is only hovered (as for vertices).
      const labelAvoid = related.handleIDs.has(midpoint.props.wayID);
      if (feature.labelAvoid !== labelAvoid) {
        feature.labelAvoid = labelAvoid;
        if (!feature.dirty) feature.updateAvoid();
      }

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
