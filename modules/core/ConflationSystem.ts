import { AbstractSystem } from './AbstractSystem.ts';
import { GeoJSONData } from '../data/GeoJSONData.ts';
import { geoMetersToWorld, geomHeadingAlong, geomLineDistances, geomPositionAlong } from '../geo/geom.ts';
import { geomPathIntersections, projWgs84ToWorld, projWorldToWgs84, vecAngle, vecEqual, vecInterp, vecLength, vecProject } from '@rapid-sdk/math';
import { PropMatcher } from '../lib/PropMatcher.ts';

import type { AbstractData } from '../data/AbstractData.ts';
import type { Context } from '../Context.ts';
import type { CoverageBox, LinePosition } from '../geo/geom.ts';
import type { GeoJSONProps } from '../data/GeoJSONData.ts';
import type { GeometryPart } from '../lib/GeometryPart.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { OsmFeature, OsmWay, Segment } from '../data/OsmWay.ts';
import type { PropMatcherProps } from '../lib/PropMatcher.ts';
import type { RapidDataset } from '../lib/RapidDataset.ts';
import type { Vec2 } from '@rapid-sdk/math';


/** Default max heading difference (degrees) between a source line and a target line. */
const DEFAULT_MAX_ANGLE = 30;
/** Lines are sampled at least this far apart (meters), so a `sameDist` of 0 still gives a usable spacing. */
const MIN_SAMPLE_METERS = 1;
/** An end of a run snaps to an existing OSM node if it is within this distance (meters). */
const JOIN_SNAP_METERS = 1;
/** Where the status changes along a line, the boundary between runs is found to within this distance (meters). */
const BOUNDARY_METERS = 0.1;
/** Which OSM geometries count as each kind of geometry named in a rule. */
const TARGET_GEOMETRY: Record<ConflationGeometry, GeometryType[]> = {
  point: ['point', 'vertex'],
  line: ['line'],
  area: ['area']
};


/** A kind of geometry, as named in a conflation rule. */
export type ConflationGeometry = 'point' | 'line' | 'area';

/** Conditions on one side of a rule: the source (the dataset's feature) or the target (the OSM feature). */
export interface ConflationSide {
  /** The geometry this side must have */
  geometry: ConflationGeometry;
  /** Property conditions this side must meet, all of them (AND). Source props are checked after the data mapping. */
  props?: PropMatcherProps[];
}

/**
 * A `ConflationRule` defines when a source feature and a target feature are the same thing.
 * - All of a rule's conditions must hold (AND).
 * - A dataset can have several rules, and any one of them saying "same" is enough (OR).
 * - Source props are checked after the dataset's data mapping has been applied.
 * - Distances are measured from the source to the target.
 */
export interface ConflationRule {
  /** Conditions on the source feature */
  source: ConflationSide;
  /** Conditions on the target feature */
  target: ConflationSide;
  /** Property keys whose values must be present and equal on both source and target */
  sameKeys?: string[];
  /** "Same": the target is within this distance of the source, in meters (0 means touching or inside) */
  sameDist: number;
  /** "Same", lines only: the heading difference is at most this, in degrees (default 30) */
  sameAngle?: number;
  /** "Near" (needs review): the target is within this distance, in meters (default `sameDist`, no review band) */
  nearDist?: number;
  /** "Near", lines only: the heading difference is at most this, in degrees (default `sameAngle`) */
  nearAngle?: number;
}

/**
 * Per-dataset conflation settings, stored on `RapidDataset.conflation`.
 * Whether conflation runs at all is `RapidDataset.conflated`, a switch the user can flip to compare
 * the raw data with the result of the rules.
 */
export interface ConflationSettings {
  /** Whether to draw "already mapped" features in a muted style, instead of hiding them */
  showMatched: boolean;
  /** The rules that decide sameness. Any one rule saying "same" is enough. */
  rules: ConflationRule[];
}

/**
 * Triage status.
 * - `matched` - already mapped
 * - `uncertain` - needs review
 * - `unmatched` - new
 * - `unknown` - OSM data isn't loaded here yet
 */
export type ConflationStatus = 'matched' | 'uncertain' | 'unmatched' | 'unknown';

/** Measures for one candidate pair (new feature, existing OSM feature). */
export interface ConflationMeasures {
  /** Mean distance over the boxes this candidate matched, in meters */
  distance: number;
  /** Mean heading difference over the boxes this candidate matched, in degrees */
  angle: number;
  /** Share of the new feature's boxes that this candidate matched, 0–1 */
  overlap: number;
  /** Whether the two geometries cross */
  intersects: boolean;
  /** Whether the candidate satisfies the rule's tag conditions (always true for kept candidates) */
  tags: boolean;
}

/** An existing OSM feature that may be the same as the new feature. */
export interface ConflationCandidate {
  /** The OSM feature: a way, or a relation such as a multipolygon (see `OsmWay.asFeature`) */
  entityID: EntityID;
  /** Score for this pair, 0–1 */
  score: number;
  /** Measures for this pair */
  measures: ConflationMeasures;
}

/** Triage of one coverage box along a new line. */
export interface BoxMatch {
  /** Box center, in world coordinates */
  coord: Vec2;
  /** `matched`, `uncertain`, or `unmatched` */
  status: ConflationStatus;
  /** OSM features that matched this box at its status, closest first */
  entityIDs: EntityID[];
  /** For each of `entityIDs`, the OSM way whose segment matched (the way that a run can join) */
  wayIDs: EntityID[];
}

/** Where the end of a run should connect to an existing OSM way. */
export interface JoinPoint {
  /** The OSM way to connect to */
  wayID: EntityID;
  /** The run's endpoint projected onto that way (WGS84) */
  loc: Vec2;
  /** An existing node within snapping distance of `loc`, if any (reuse it instead of adding one) */
  nodeID?: EntityID;
  /** When there is no `nodeID`: the segment of the way that `loc` is on (add a node there) */
  edge?: [EntityID, EntityID];
}

/** Where the ends of a line being accepted should connect (see `ConflationSystem.getJoins`). */
export interface LineJoins {
  /** Join for the line's first node */
  start?: JoinPoint;
  /** Join for the line's last node */
  end?: JoinPoint;
}

/**
 * Props for the data element that stands for one run of a partly mapped line.
 * The run can be selected and accepted on its own, and carries where its ends should join.
 */
export interface ConflationRunProps extends GeoJSONProps {
  /** The source feature that this run is part of */
  sourceID: DataID;
  /** Join for the run's first node */
  startJoin?: JoinPoint;
  /** Join for the run's last node */
  endJoin?: JoinPoint;
}

/** A maximal stretch of a new line whose boxes share a status. */
export interface LineRun {
  /** `matched`, `uncertain`, or `unmatched` */
  status: ConflationStatus;
  /** The stretch of the line that this run covers, as fractions of its length (see `pieceID`) */
  range: [number, number];
  /** WGS84 sub-line of the original geometry */
  coords: Vec2[];
  /** Set when the start of this run meets an already-mapped stretch, or an allowed target line */
  startJoin?: JoinPoint;
  /** Set when the end of this run meets an already-mapped stretch, or an allowed target line */
  endJoin?: JoinPoint;
  /**
   * For runs that aren't already mapped, when the run isn't the whole line: a data element for just
   * this stretch, so it can be drawn, selected, and accepted on its own. Its id is `pieceID(dataID, range)`.
   */
  datum?: GeoJSONData<ConflationRunProps>;
}

/** The result of matching one new feature against OSM. */
export interface ConflationResult {
  /** The new feature */
  dataID: DataID;
  /** Triage status for the whole feature */
  status: ConflationStatus;
  /** Feature score, 0–1 */
  score: number;
  /** Lines: some stretches are already mapped and some are not */
  partial: boolean;
  /** Existing OSM features that may be the same, best first */
  candidates: ConflationCandidate[];
  /** Lines: one entry per coverage box, in order along the line */
  boxes?: BoxMatch[];
  /** Lines: the stretches of the line, in order */
  runs?: LineRun[];
}


/** A contiguous range of boxes that share a status (internal). */
interface BoxRange {
  status: ConflationStatus;
  start: number;   // first box index
  end: number;     // last box index
}

/** Where one run ends and the next begins, along the source line (internal). */
interface RunBoundary {
  pos: LinePosition;     // the boundary
  match?: BoxMatch;      // what matched there, if one side is already mapped (its last or first matched point)
}

/** The best match of one feature to one box, across all rules (internal). */
interface BoxHit {
  entityID: EntityID;   // the feature
  wayID: EntityID;      // the way that the segment is on
  distance: number;     // meters
  angle: number;        // degrees
  level: 1 | 2;         // 2 = same, 1 = near
}

/** Running totals for one candidate feature (internal). */
interface FeatureTally {
  strict: number;
  loose: number;
  distance: number;
  angle: number;
  wayIDs: Set<EntityID>;   // the feature's ways that matched (more than one for a multipolygon)
}


/**
 * Returns the data ID of a piece of a line: the line's data ID, and the range along the line that the
 * piece covers, as fractions of the line's length (like the linear referencing `between: [start, end]`
 * that Overture uses). For example `odot_sidewalks:12345:0@0.85-1`. The fractions are rounded to 4
 * decimals, about 10 cm on a 1 km line.
 * @param dataID - The line's data ID
 * @param range - The piece's start and end, as fractions of the line's length
 * @return The piece's data ID
 */
export function pieceID(dataID: DataID, range: [number, number]): DataID {
  const fmt = (n: number) => String(Math.round(n * 10000) / 10000);
  return `${dataID}@${fmt(range[0])}-${fmt(range[1])}`;
}


/**
 * Splits the data ID of a piece of a line into the line's data ID and the range (see `pieceID`).
 * @param id - A data ID
 * @return The line's data ID and the range, or `undefined` if `id` isn't a piece's ID
 */
export function parsePieceID(id: DataID): { dataID: DataID; range: [number, number] } | undefined {
  const match = /^(.+)@(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(id);
  if (!match) return undefined;
  const start = Number(match[2]);
  const end = Number(match[3]);
  if (!(start >= 0 && end <= 1 && start < end)) return undefined;
  return { dataID: match[1], range: [start, end] };
}


/**
 * Returns new default conflation settings: disabled, with one rule per geometry type and no property
 * conditions (so a nearby target counts regardless of its tags, until the user adds conditions).
 * @return Default settings
 */
export function conflationDefaults(): ConflationSettings {
  return {
    showMatched: false,
    rules: [
      { source: { geometry: 'line' }, target: { geometry: 'line' }, sameDist: 3, sameAngle: DEFAULT_MAX_ANGLE, nearDist: 3, nearAngle: DEFAULT_MAX_ANGLE },
      // { source: { geometry: 'point' }, target: { geometry: 'point' }, sameDist: 3, nearDist: 6 },
      // { source: { geometry: 'area' }, target: { geometry: 'area' }, sameDist: 0 }
    ]
  };
}


/**
 * The `ConflationSystem` compares features from a Rapid dataset with the OSM data loaded in the
 * editor. For each new feature it runs the four stages: **match** (find nearby OSM features and
 * measure them), **score**, **triage** (already mapped, needs review, or new), and it prepares what the
 * **act** stage needs, such as the runs of a partly mapped line and where they join existing ways.
 *
 * It compares against the `editor_stable` spatial caches, so results only change when the user
 * finishes an edit. Results are computed lazily, cached per feature, and flushed on `stablechange`
 * and `merge`.
 *
 * Every source feature whose geometry some rule covers is tested. Rules decide "same" (all of a rule's
 * conditions hold) and "near" (needs review); any one rule saying "same" is enough.
 *
 * Only LineStrings from GeoJSON-backed datasets are matched so far. Points and areas follow.
 *
 * See `design/conflation-system.md` for the full design.
 *
 * Events available:
 * - `conflationchange` - Fires after cached results are flushed, so they will be recomputed
 */
export class ConflationSystem extends AbstractSystem {

  /** Cached results, by datasetID then dataID. `null` means no rule covers that feature's geometry. */
  protected _results: Map<DatasetID, Map<DataID, ConflationResult | null>>;
  /** Compiled property matchers, per rule side */
  protected _matchers: WeakMap<ConflationSide, PropMatcher[]>;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'conflation';
    this.requiredDependencies = new Set<SystemID>(['editor', 'rapid', 'spatial']);

    this._results = new Map<DatasetID, Map<DataID, ConflationResult | null>>();
    this._matchers = new WeakMap<ConflationSide, PropMatcher[]>();
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const editor = context.systems.editor!;

    return this._initPromise = super.initAsync()
      .then(() => editor.initAsync())
      .then(() => {
        editor
          .on('stablechange', () => this.invalidate())
          .on('merge', () => this.invalidate());
      });
  }


  /**
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state.
   * @return Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    this._results.clear();
    this._matchers = new WeakMap<ConflationSide, PropMatcher[]>();
    return Promise.resolve();
  }


  /**
   * Whether conflation is turned on for a dataset.
   * @param ds - The dataset
   * @return `true` if enabled
   */
  public isEnabled(ds: RapidDataset): boolean {
    return !!ds.conflated;
  }


  /**
   * Returns the conflation result for one feature of a dataset, computing it if needed.
   * @param ds - The dataset that the feature belongs to
   * @param datum - The new feature
   * @return The result, or `undefined` if conflation is off for the dataset or no rule covers the feature's geometry
   */
  public getResult(ds: RapidDataset, datum: AbstractData): ConflationResult | undefined {
    if (!this.isEnabled(ds)) return undefined;

    let cache = this._results.get(ds.id);
    if (!cache) {
      cache = new Map<DataID, ConflationResult | null>();
      this._results.set(ds.id, cache);
    }

    const dataID = datum.id;
    if (cache.has(dataID)) {
      return cache.get(dataID) ?? undefined;
    }

    const result = this._compute(ds, datum);
    if (result?.status !== 'unknown') {   // don't cache 'unknown', it should change when OSM data arrives
      cache.set(dataID, result ?? null);
    }
    return result;
  }


  /**
   * Returns the features in the current viewport that need review, in a stable order
   * (top to bottom, then left to right).
   * @param ds - The dataset
   * @return Results with status `uncertain`
   */
  public getQueue(ds: RapidDataset): ConflationResult[] {
    const context = this.context;
    const spatial = context.systems.spatial!;

    if (!this.isEnabled(ds)) return [];

    const queue: Array<{ result: ConflationResult; key: Vec2 }> = [];
    for (const item of spatial.getVisibleItems(ds.spatialID)) {
      const datum = item.contents as GeoJSONData;
      const result = this.getResult(ds, datum);
      if (result?.status !== 'uncertain') continue;
      queue.push({ result: result, key: [item.minY, item.minX] });
    }

    queue.sort((a, b) => (a.key[0] - b.key[0]) || (a.key[1] - b.key[1]));
    return queue.map(q => q.result);
  }


  /**
   * Returns where the ends of a line should connect when it is accepted.
   * - For the data element of one run of a partly mapped line, its own joins.
   * - For a whole source line that is a single run (not already mapped), that run's joins.
   * @param ds - The dataset that the data belongs to
   * @param datum - A source feature, or the data element of one run (see `LineRun.datum`)
   * @return The joins, or `undefined` if there are none to make
   */
  public getJoins(ds: RapidDataset, datum: AbstractData): LineJoins | undefined {
    const props = datum.props as Partial<ConflationRunProps>;
    if (props.sourceID) {
      return { start: props.startJoin, end: props.endJoin };
    }

    const result = this.getResult(ds, datum);
    const run = (result?.runs?.length === 1) ? result.runs[0] : undefined;
    if (!run || run.datum || run.status === 'matched') return undefined;
    return { start: run.startJoin, end: run.endJoin };
  }


  /**
   * Flushes cached results so they are recomputed on next access, and emits `conflationchange`.
   * Call this after changing a dataset's rules (including editing a rule in place).
   * @param datasetID - Flush only this dataset's results (default: all datasets)
   */
  public invalidate(datasetID?: DatasetID): void {
    if (datasetID) {
      this._results.delete(datasetID);
    } else {
      this._results.clear();
    }
    // Rules may have been edited in place, so recompile their property matchers too (it's cheap).
    this._matchers = new WeakMap<ConflationSide, PropMatcher[]>();
    this.emit('conflationchange');
  }


  /**
   * Computes the result for one feature.
   * @param ds - The dataset that the feature belongs to
   * @param datum - The new feature
   * @return The result, or `undefined` if no rule covers the feature's geometry
   */
  protected _compute(ds: RapidDataset, datum: AbstractData): ConflationResult | undefined {
    if (!(datum instanceof GeoJSONData)) return undefined;   // OSM-backed datasets: not yet

    const part = datum.geoms.parts[0];   // single part only, like `actionRapidAcceptFeature`
    if (!part?.orig || !part.world) return undefined;

    const geometry: ConflationGeometry = part.type === 'LineString' ? 'line' : part.type === 'Polygon' ? 'area' : 'point';
    const rules = (ds.conflation?.rules ?? []).filter(rule => rule.source.geometry === geometry);
    if (!rules.length) return undefined;

    const tags = ds.dictionary ? ds.dictionary.applyTransforms(datum.properties) : datum.properties;
    if (geometry === 'line') {
      return this._conflateLine(datum, rules, tags, part);
    }
    return undefined;   // points and areas: not yet
  }


  /**
   * Returns the compiled property matchers for one side of a rule.
   * @param side - The rule's source or target
   * @return PropMatchers for `side.props`
   */
  protected _propMatchers(side: ConflationSide): PropMatcher[] {
    let matchers = this._matchers.get(side);
    if (!matchers) {
      matchers = (side.props ?? []).map(props => PropMatcher.from(props));
      this._matchers.set(side, matchers);
    }
    return matchers;
  }


  /**
   * Whether a target feature meets a rule's target conditions (geometry and props).
   * @param rule - The rule
   * @param feature - The target feature (see `OsmWay.asFeature`)
   * @return `true` if the feature is the kind of target the rule is about
   */
  protected _targetAllowed(rule: ConflationRule, feature: OsmFeature): boolean {
    if (!TARGET_GEOMETRY[rule.target.geometry].includes(feature.geometry)) return false;
    return PropMatcher.matchAll(this._propMatchers(rule.target), feature.tags);
  }


  /**
   * Whether a target feature meets a rule's target conditions, and agrees with the source on `sameKeys`.
   * @param rule - The rule
   * @param feature - The target feature (see `OsmWay.asFeature`)
   * @param sourceTags - The source feature's tags, after the data mapping
   * @return `true` if the rule allows this pair to be the same thing
   */
  protected _targetMatches(rule: ConflationRule, feature: OsmFeature, sourceTags: Record<string, unknown>): boolean {
    if (!this._targetAllowed(rule, feature)) return false;

    for (const k of rule.sameKeys ?? []) {
      const sourceVal = sourceTags[k];
      if (sourceVal === undefined || sourceVal === null || sourceVal === '') return false;
      if (String(sourceVal) !== feature.tags[k]) return false;
    }
    return true;
  }


  /**
   * Whether OSM data is loaded at a world coordinate.
   * Without an OSM service (tests, or a build without one), whatever is in the graph is all there is.
   * @param coord - World coordinate
   * @return `true` if loaded
   */
  protected _isLoaded(coord: Vec2): boolean {
    const osm = this.context.services.osm;
    if (!osm) return true;
    return osm.isDataLoaded(projWorldToWgs84(coord));
  }


  /**
   * Matches a source LineString against target (OSM) features.
   * The segment index holds OSM ways; each one is resolved to the feature it represents
   * (`OsmWay.asFeature`), so an untagged multipolygon edge counts as its relation.
   *
   * The source is sampled at points along its length, and each sample (coverage box) is triaged on
   * its own: *matched* if some rule says a target feature is the same there (within `sameDist` and
   * `sameAngle`, and all the rule's conditions hold), *uncertain* if some rule says one is near
   * (within `nearDist` and `nearAngle`), and *unmatched* otherwise. Consecutive boxes with the same
   * status form runs.
   * @param datum - The source feature
   * @param rules - The rules whose source geometry is 'line'
   * @param sourceTags - The source feature's tags, after the data mapping
   * @param part - The source feature's geometry
   * @return The result
   */
  protected _conflateLine(
    datum: GeoJSONData,
    rules: ConflationRule[],
    sourceTags: Record<string, unknown>,
    part: GeometryPart
  ): ConflationResult {
    const context = this.context;
    const editor = context.systems.editor!;
    const rapid = context.systems.rapid!;
    const spatial = context.systems.spatial!;

    const dataID = datum.id;
    const graph = editor.stable.graph!;
    const segSpatialID = editor.spatialIDForGraph(graph) + '-segments';

    // Rules whose source conditions this feature fails can't say "same" or "near" for it.
    const active = rules.filter(rule => PropMatcher.matchAll(this._propMatchers(rule.source), sourceTags));

    const lat = part.orig!.extent.center()[1];
    const metersPerWorld = 1 / geoMetersToWorld(1, lat);
    const nearDistOf = (rule: ConflationRule) => Math.max(rule.nearDist ?? rule.sameDist, rule.sameDist);
    const queryMeters = Math.max(0, ...active.map(nearDistOf));
    const queryR = geoMetersToWorld(queryMeters, lat);

    // Samples are spaced by the smallest `sameDist`, so runs have that resolution.
    // Each query box reaches out to the largest `nearDist`, so "near" targets are found too.
    const spacing = Math.max(MIN_SAMPLE_METERS, Math.min(...rules.map(rule => rule.sameDist)));
    const boxes = part.computeCoverage(spacing);
    const source = part.world!.outer!;
    const sourceMeters = lineLength(source) * metersPerWorld;

    if (boxes.some(box => !this._isLoaded(box.coord))) {
      return { dataID: dataID, status: 'unknown', score: 0, partial: false, candidates: [] };
    }

    const nodeCoords = new Map<EntityID, Vec2>();
    const features = new Map<EntityID, OsmFeature | null>();   // by wayID; `null` if the way is missing
    const allowed = new Map<string, boolean>();                // by `${ruleIndex}:${entityID}`
    const tallies = new Map<EntityID, FeatureTally>();         // by feature entityID
    const boxMatches: BoxMatch[] = [];

    const coordOf = (nodeID: EntityID): Vec2 | undefined => {
      let coord = nodeCoords.get(nodeID);
      if (!coord) {
        const node = graph.hasEntity(nodeID) as OsmNode | undefined;
        if (!node?.loc) return undefined;
        coord = projWgs84ToWorld(node.loc);
        nodeCoords.set(nodeID, coord);
      }
      return coord;
    };

    const featureOf = (wayID: EntityID): OsmFeature | null => {
      let feature = features.get(wayID);
      if (feature === undefined) {
        const way = graph.hasEntity(wayID) as OsmWay | undefined;
        feature = way?.asFeature(graph) ?? null;
        features.set(wayID, feature);
      }
      return feature;
    };

    // For each target feature near a point on the source line, finds its best match across all rules:
    // "same" beats "near", and a closer segment beats a farther one.
    const hitsAt = (coord: Vec2, heading: number): Map<EntityID, BoxHit> => {
      const best = new Map<EntityID, BoxHit>();
      const query = {
        minX: coord[0] - queryR, minY: coord[1] - queryR,
        maxX: coord[0] + queryR, maxY: coord[1] + queryR
      };
      const hits = active.length ? spatial.getItemsAtBox(segSpatialID, query) : [];

      for (const hit of hits) {
        const seg = hit.contents as Segment;
        const wayID = seg.wayID;

        const feature = featureOf(wayID);
        if (!feature) continue;

        const a = coordOf(seg.edge[0]);
        const b = coordOf(seg.edge[1]);
        if (!a || !b) continue;

        const entityID = feature.entity.id;
        const distance = (vecProject(coord, [a, b])?.distance ?? Infinity) * metersPerWorld;
        const angle = headingDiff(heading, vecAngle(a, b));

        for (let r = 0; r < active.length; r++) {
          const rule = active[r];
          const key = `${r}:${entityID}`;
          let ok = allowed.get(key);
          if (ok === undefined) {
            ok = this._targetMatches(rule, feature, sourceTags);
            allowed.set(key, ok);
          }
          if (!ok) continue;

          // A source line shorter than `sameDist` (a stub) has no reliable heading, so it is judged
          // by distance only. Many datasets are split into short edges at every junction.
          const isStub = sourceMeters < rule.sameDist;
          const sameAngle = rule.sameAngle ?? DEFAULT_MAX_ANGLE;
          const nearAngle = rule.nearAngle ?? sameAngle;
          let level: 0 | 1 | 2 = 0;
          if (distance <= rule.sameDist && (isStub || angle <= sameAngle)) {
            level = 2;
          } else if (distance <= nearDistOf(rule) && (isStub || angle <= nearAngle)) {
            level = 1;
          }
          if (!level) continue;

          const prev = best.get(entityID);
          if (!prev || level > prev.level || (level === prev.level && distance < prev.distance)) {
            best.set(entityID, { entityID: entityID, wayID: wayID, distance: distance, angle: angle, level: level });
          }
        }
      }
      return best;
    };

    // Triages a point by its best target features.
    const matchOf = (coord: Vec2, best: Map<EntityID, BoxHit>): BoxMatch => {
      const strictHits = [...best.values()].filter(h => h.level === 2);
      const looseHits = [...best.values()].filter(h => h.level === 1);
      const hits = strictHits.length ? strictHits : looseHits;
      const status: ConflationStatus = strictHits.length ? 'matched' : looseHits.length ? 'uncertain' : 'unmatched';
      hits.sort((a, b) => a.distance - b.distance);
      return { coord: coord, status: status, entityIDs: hits.map(h => h.entityID), wayIDs: hits.map(h => h.wayID) };
    };

    for (const box of boxes) {
      const best = hitsAt(box.coord, box.angle);

      // Tally the candidates, then triage the box by its best target features.
      for (const h of best.values()) {
        const tally = tallies.get(h.entityID) ?? { strict: 0, loose: 0, distance: 0, angle: 0, wayIDs: new Set<EntityID>() };
        if (h.level === 2) {
          tally.strict++;
        } else {
          tally.loose++;
        }
        tally.distance += h.distance;
        tally.angle += h.angle;
        tally.wayIDs.add(h.wayID);
        tallies.set(h.entityID, tally);
      }
      boxMatches.push(matchOf(box.coord, best));
    }

    // Score: matched boxes count 1, uncertain boxes count 0.5.
    const n = boxMatches.length;
    const boxScore = (bm: BoxMatch) => (bm.status === 'matched' ? 1 : bm.status === 'uncertain' ? 0.5 : 0);
    const score = n ? boxMatches.reduce((sum, bm) => sum + boxScore(bm), 0) / n : 0;

    // Candidates, with their measures.
    const candidates: ConflationCandidate[] = [];
    for (const [entityID, tally] of tallies) {
      const count = tally.strict + tally.loose;
      const intersects = [...tally.wayIDs].some(wayID => {
        const wayCoords = (graph.hasEntity(wayID) as OsmWay | undefined)?.nodes
          .map(nodeID => coordOf(nodeID))
          .filter((c): c is Vec2 => !!c) ?? [];
        return geomPathIntersections(source, wayCoords).length > 0;
      });

      candidates.push({
        entityID: entityID,
        score: n ? (tally.strict + 0.5 * tally.loose) / n : 0,
        measures: {
          distance: tally.distance / count,
          angle: tally.angle / count,
          overlap: count / n,
          intersects: intersects,
          tags: true
        }
      });
    }
    candidates.sort((a, b) => b.score - a.score);

    // A line end that isn't next to an already-mapped stretch can still join a target line that some
    // rule allows (ignoring `sameKeys`), within `sameDist` and at any angle. This is how an accepted
    // crossing connects to the sidewalks at its ends.
    const endJoinMeters = Math.max(0, ...active.map(rule => rule.sameDist));
    const endJoinAt = (coord: Vec2): JoinPoint | undefined => {
      if (endJoinMeters <= 0) return undefined;
      const r = geoMetersToWorld(endJoinMeters, lat);
      const query = { minX: coord[0] - r, minY: coord[1] - r, maxX: coord[0] + r, maxY: coord[1] + r };

      let bestWayID: EntityID | undefined;
      let bestDistance = Infinity;
      for (const hit of spatial.getItemsAtBox(segSpatialID, query)) {
        const seg = hit.contents as Segment;
        const feature = featureOf(seg.wayID);
        if (feature?.geometry !== 'line') continue;
        if (!active.some(rule => this._targetAllowed(rule, feature))) continue;

        const a = coordOf(seg.edge[0]);
        const b = coordOf(seg.edge[1]);
        if (!a || !b) continue;

        const distance = (vecProject(coord, [a, b])?.distance ?? Infinity) * metersPerWorld;
        if (distance <= endJoinMeters && distance < bestDistance) {
          bestDistance = distance;
          bestWayID = seg.wayID;
        }
      }
      return this._joinPoint(bestWayID, coord, graph, coordOf, metersPerWorld);
    };

    // Runs.
    const ranges = this._lineRanges(boxMatches, boxes, source, metersPerWorld, spacing);

    // Samples are a spacing apart, so where the status changes between two of them, find where it
    // changes more precisely: test points in between, halving the gap until it is under BOUNDARY_METERS.
    // Each boundary is on the already-mapped side, if there is one, so that a run that isn't mapped
    // reaches exactly to where the mapped stretch ends, and joins it there.
    const dist = geomLineDistances(source);
    const window = geoMetersToWorld(spacing, lat);   // the same heading window as the samples
    const distOf = (pos: { index: number; t: number }) => dist[pos.index] + pos.t * (dist[pos.index + 1] - dist[pos.index]);

    const boundaries: RunBoundary[] = [];   // `boundaries[i]` is between `ranges[i]` and `ranges[i + 1]`
    for (let i = 0; i < ranges.length - 1; i++) {
      const before = ranges[i];
      const after = ranges[i + 1];
      let lo = distOf(boxes[before.end]);
      let hi = distOf(boxes[after.start]);
      let loMatch = boxMatches[before.end];
      let hiMatch = boxMatches[after.start];

      while ((hi - lo) * metersPerWorld > BOUNDARY_METERS) {
        const mid = (lo + hi) / 2;
        const pos = geomPositionAlong(source, dist, mid);
        const match = matchOf(pos.coord, hitsAt(pos.coord, geomHeadingAlong(source, dist, mid, window)));
        if (match.status === before.status) {
          lo = mid;
          loMatch = match;
        } else {
          hi = mid;
          hiMatch = match;
        }
      }

      if (before.status === 'matched') {
        boundaries.push({ pos: geomPositionAlong(source, dist, lo), match: loMatch });
      } else if (after.status === 'matched') {
        boundaries.push({ pos: geomPositionAlong(source, dist, hi), match: hiMatch });
      } else {
        boundaries.push({ pos: geomPositionAlong(source, dist, (lo + hi) / 2) });
      }
    }

    const toWgs84 = (coords: Vec2[]) => coords.map(coord => projWorldToWgs84(coord));
    const lineWayOf = (match: BoxMatch | undefined): EntityID | undefined =>
      match?.wayIDs.find(wayID => features.get(wayID)?.geometry === 'line');

    // The stretches of the line that the user already accepted or ignored are left out of the runs,
    // so they drop out even when the line matches again afterward (it now matches what was accepted).
    // A run cut this way doesn't join anything where it was cut, and a sliver left over shorter than
    // the sample spacing is dropped, like the short runs in `_lineRanges`.
    const total = dist.at(-1)!;
    const fracOf = (pos: { index: number; t: number }) => (total > 0 ? distOf(pos) / total : 0);
    const acted = rapid.actedRanges(dataID);

    const runs: LineRun[] = [];
    ranges.forEach((range, i) => {
      const prev = ranges[i - 1];
      const next = ranges[i + 1];
      const start = boundaries[i - 1]?.pos ?? boxes[range.start];
      const end = boundaries[i]?.pos ?? boxes[range.end];
      const whole: [number, number] = [fracOf(start), fracOf(end)];

      for (const piece of subtractRanges(whole, acted)) {
        const isStart = piece[0] === whole[0];
        const isEnd = piece[1] === whole[1];
        if (!(isStart && isEnd) && (piece[1] - piece[0]) * total * metersPerWorld < spacing) continue;

        const pieceStart = isStart ? start : geomPositionAlong(source, dist, piece[0] * total);
        const pieceEnd = isEnd ? end : geomPositionAlong(source, dist, piece[1] * total);
        if (range.status === 'matched') {
          runs.push({ status: range.status, range: piece, coords: toWgs84(subLine(source, pieceStart, pieceEnd)) });
          continue;
        }

        // A run that isn't already mapped reaches to where a neighboring already-mapped stretch ends,
        // and joins the OSM way that matched there (if that way is a line, not an area's edge).
        let coords = subLine(source, pieceStart, pieceEnd);
        const run: LineRun = { status: range.status, range: piece, coords: [] };

        if (isStart && prev?.status === 'matched') {
          run.startJoin = this._joinPoint(lineWayOf(boundaries[i - 1].match), positionOf(source, start), graph, coordOf, metersPerWorld);
        } else if (isStart && !prev) {
          run.startJoin = endJoinAt(source[0]);
        }
        if (isEnd && next?.status === 'matched') {
          run.endJoin = this._joinPoint(lineWayOf(boundaries[i].match), positionOf(source, end), graph, coordOf, metersPerWorld);
        } else if (isEnd && !next) {
          run.endJoin = endJoinAt(source.at(-1)!);
        }

        // Trim the run to its joins: it ends at the point on the source line nearest each join.
        // The extension above, or a join that snapped to a nearby node, can otherwise leave the run
        // reaching past where it connects (e.g. around a corner), which would add a hook on accept.
        if (run.endJoin) {
          coords = trimEnd(coords, projWgs84ToWorld(run.endJoin.loc));
        }
        if (run.startJoin) {
          coords = trimStart(coords, projWgs84ToWorld(run.startJoin.loc));
        }
        run.coords = toWgs84(coords);
        runs.push(run);
      }
    });

    // Each run that isn't already mapped and isn't the whole line gets its own data element,
    // so it can be drawn, selected and accepted on its own. Its id is the line's id and the stretch
    // the run covers (see `pieceID`), so it is the same each time it's computed from the same data,
    // and accepting or ignoring it can be remembered across restarts.
    const isWhole = runs.length === 1 && runs[0].range[0] === 0 && runs[0].range[1] === 1;
    if (!isWhole) {
      runs.forEach(run => {
        if (run.status === 'matched') return;
        run.datum = new GeoJSONData<ConflationRunProps>(context, {
          id: pieceID(dataID, run.range),
          datasetID: datum.props.datasetID,
          serviceID: datum.props.serviceID,
          sourceID: dataID,
          startJoin: run.startJoin,
          endJoin: run.endJoin,
          geojson: {
            type: 'Feature',
            properties: datum.properties,
            geometry: { type: 'LineString', coordinates: run.coords }
          }
        });
      });
    }

    // Triage what's left for the user to act on (all of it, if they've acted on all of it).
    const statuses = new Set<ConflationStatus>((runs.length ? runs : ranges).map(r => r.status));
    let status: ConflationStatus;
    if (statuses.has('uncertain')) {
      status = 'uncertain';
    } else if (statuses.has('unmatched')) {
      status = 'unmatched';
    } else {
      status = 'matched';
    }

    return {
      dataID: dataID,
      status: status,
      score: score,
      partial: statuses.has('matched') && statuses.size > 1,
      candidates: candidates,
      boxes: boxMatches,
      runs: runs
    };
  }


  /**
   * Groups consecutive boxes with the same status into ranges.
   * A run shorter than `minLength` that isn't already mapped, next to an already-mapped run,
   * is treated as already mapped. These are usually misalignment noise at the ends of a match.
   * @param boxMatches - Triage for each box
   * @param boxes - The coverage boxes
   * @param source - The new line, in world coordinates
   * @param metersPerWorld - Meters per world unit at this latitude
   * @param minLength - Minimum run length, in meters
   * @return The ranges, in order
   */
  protected _lineRanges(
    boxMatches: BoxMatch[],
    boxes: CoverageBox[],
    source: Vec2[],
    metersPerWorld: number,
    minLength: number
  ): BoxRange[] {
    const group = (statusOf: (i: number) => ConflationStatus): BoxRange[] => {
      const ranges: BoxRange[] = [];
      for (let i = 0; i < boxMatches.length; i++) {
        const status = statusOf(i);
        const last = ranges.at(-1);
        if (last?.status === status) {
          last.end = i;
        } else {
          ranges.push({ status: status, start: i, end: i });
        }
      }
      return ranges;
    };

    const ranges = group(i => boxMatches[i].status);
    if (ranges.length < 2) return ranges;

    const absorbed = new Set<number>();
    for (let r = 0; r < ranges.length; r++) {
      const range = ranges[r];
      if (range.status === 'matched') continue;
      const hasMatchedNeighbor = ranges[r - 1]?.status === 'matched' || ranges[r + 1]?.status === 'matched';
      if (!hasMatchedNeighbor) continue;

      const length = lineLength(subLine(source, boxes[range.start], boxes[range.end])) * metersPerWorld;
      if (length < minLength) {
        for (let i = range.start; i <= range.end; i++) absorbed.add(i);
      }
    }

    if (!absorbed.size) return ranges;
    return group(i => (absorbed.has(i) ? 'matched' : boxMatches[i].status));
  }


  /**
   * Finds where a run's end should connect to an existing OSM way.
   * @param wayID - The OSM way that matched next to the run
   * @param coord - The run's endpoint, in world coordinates
   * @param graph - The graph the way belongs to
   * @param coordOf - Returns a node's world coordinate
   * @param metersPerWorld - Meters per world unit at this latitude
   * @return The join point, or `undefined` if the way can't be resolved
   */
  protected _joinPoint(
    wayID: EntityID | undefined,
    coord: Vec2,
    graph: Graph,
    coordOf: (nodeID: EntityID) => Vec2 | undefined,
    metersPerWorld: number
  ): JoinPoint | undefined {
    if (!wayID) return undefined;
    const way = graph.hasEntity(wayID) as OsmWay | undefined;
    if (!way) return undefined;

    const nodeIDs = way.nodes.filter(nodeID => !!coordOf(nodeID));
    const points = nodeIDs.map(nodeID => coordOf(nodeID)!);
    const closest = vecProject(coord, points);
    if (!closest) return undefined;

    const join: JoinPoint = { wayID: wayID, loc: projWorldToWgs84(closest.point) };

    // `closest.index` is the index of the end of the closest segment.
    for (const i of [closest.index - 1, closest.index]) {
      const nodeCoord = points[i];
      if (nodeCoord && vecLength(nodeCoord, closest.point) * metersPerWorld <= JOIN_SNAP_METERS) {
        join.nodeID = nodeIDs[i];
        join.loc = projWorldToWgs84(nodeCoord);
        break;
      }
    }
    if (!join.nodeID) {   // no node close enough, so a new one goes on this segment
      join.edge = [nodeIDs[closest.index - 1], nodeIDs[closest.index]];
    }
    return join;
  }

}


/**
 * Difference between two line headings, ignoring direction.
 * @param a - Heading in radians
 * @param b - Heading in radians
 * @return Difference in degrees, 0–90
 */
function headingDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % Math.PI;   // opposite directions count as the same heading
  if (d > Math.PI / 2) d = Math.PI - d;
  return d * 180 / Math.PI;
}


/**
 * Returns the point at a position along a line (a box center, or a run boundary).
 * @param source - The line, in world coordinates
 * @param pos - The position: a segment index, and how far along it
 * @return World coordinate
 */
function positionOf(source: Vec2[], pos: { index: number; t: number }): Vec2 {
  const a = source[pos.index];
  const b = source[pos.index + 1] ?? a;
  return vecInterp(a, b, pos.t);
}


/**
 * Cuts the stretch of a line between two positions along it (box centers, or run boundaries).
 * @param source - The line, in world coordinates
 * @param from - The position where the stretch starts
 * @param to - The position where the stretch ends
 * @return The sub-line, in world coordinates
 */
function subLine(source: Vec2[], from: { index: number; t: number }, to: { index: number; t: number }): Vec2[] {
  const coords: Vec2[] = [positionOf(source, from)];
  for (let i = from.index + 1; i <= to.index; i++) {
    coords.push(source[i]);
  }
  coords.push(positionOf(source, to));

  const result: Vec2[] = [];
  for (const coord of coords) {
    if (result.length && vecEqual(result.at(-1)!, coord, 1e-9)) continue;
    result.push(coord);
  }
  return result;
}


/**
 * Cuts a line so it ends at the point on it nearest to `point`.
 * Leaves the line as it is if cutting would leave nothing of it.
 * @param coords - The line, in world coordinates
 * @param point - The point to cut at (projected onto the line)
 * @return The trimmed line, in world coordinates
 */
function trimEnd(coords: Vec2[], point: Vec2): Vec2[] {
  const closest = vecProject(point, coords);
  if (!closest) return coords;
  const trimmed = coords.slice(0, closest.index);   // the points before the closest segment's end
  if (!vecEqual(trimmed.at(-1)!, closest.point, 1e-9)) {
    trimmed.push(closest.point);
  }
  return (trimmed.length >= 2 && lineLength(trimmed) > 0) ? trimmed : coords;
}


/**
 * Cuts a line so it starts at the point on it nearest to `point`.
 * Leaves the line as it is if cutting would leave nothing of it.
 * @param coords - The line, in world coordinates
 * @param point - The point to cut at (projected onto the line)
 * @return The trimmed line, in world coordinates
 */
function trimStart(coords: Vec2[], point: Vec2): Vec2[] {
  const closest = vecProject(point, coords);
  if (!closest) return coords;
  const trimmed = coords.slice(closest.index);   // the points after the closest segment's start
  if (!vecEqual(trimmed[0], closest.point, 1e-9)) {
    trimmed.unshift(closest.point);
  }
  return (trimmed.length >= 2 && lineLength(trimmed) > 0) ? trimmed : coords;
}


/**
 * Removes ranges from a range, leaving the pieces that none of them cover.
 * Pieces that aren't cut keep their exact ends.
 * @param range - The range, `[start, end]`
 * @param cuts - The ranges to remove
 * @return The pieces left, in order
 */
function subtractRanges(range: [number, number], cuts: Array<[number, number]>): Array<[number, number]> {
  let pieces: Array<[number, number]> = [range];
  for (const [c0, c1] of cuts) {
    pieces = pieces.flatMap(([p0, p1]): Array<[number, number]> => {
      if (c1 <= p0 || c0 >= p1) return [[p0, p1]];
      const left: Array<[number, number]> = (c0 > p0) ? [[p0, c0]] : [];
      const right: Array<[number, number]> = (c1 < p1) ? [[c1, p1]] : [];
      return [...left, ...right];
    });
  }
  return pieces;
}


/**
 * Length of a line.
 * @param coords - The line, in world coordinates
 * @return Length in world units
 */
function lineLength(coords: Vec2[]): number {
  let length = 0;
  for (let i = 1; i < coords.length; i++) {
    length += vecLength(coords[i - 1], coords[i]);
  }
  return length;
}
