import { AbstractSystem } from './AbstractSystem.ts';
import { GeoJSONData } from '../data/GeoJSONData.ts';
import { geoMetersToWorld } from '../geo/geom.ts';
import { geomPathIntersections, projWgs84ToWorld, projWorldToWgs84, vecAngle, vecEqual, vecInterp, vecLength, vecProject } from '@rapid-sdk/math';
import { PropMatcher } from '../lib/PropMatcher.ts';

import type { Context } from '../Context.ts';
import type { CoverageBox } from '../geo/geom.ts';
import type { GeometryPart } from '../lib/GeometryPart.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { OsmWay, Segment } from '../data/OsmWay.ts';
import type { PropMatcherProps } from '../lib/PropMatcher.ts';
import type { RapidDataset } from '../lib/RapidDataset.ts';
import type { Vec2 } from '@rapid-sdk/math';


/** Default looseness of the "needs review" limits, as a multiple of the "already mapped" limits. */
const DEFAULT_REVIEW_FACTOR = 2;
/** Default max heading difference (degrees) between a new line and an existing one. */
const DEFAULT_MAX_ANGLE = 30;
/** An end of a run snaps to an existing OSM node if it is within this distance (meters). */
const JOIN_SNAP_METERS = 1;


/** Which OSM features count as "already mapped" for a rule. Same shape as a `StyleSelector`'s `match`. */
export interface ConflationMatch {
  /** OSM geometry type(s) that can match */
  geometry?: GeometryType | GeometryType[];
  /** Tag conditions, all must match (AND) */
  tags?: PropMatcherProps[];
}

/**
 * One matching rule for a dataset. A rule applies to a new feature when the feature's geometry type
 * is `geometry` and its tags (after the data dictionary) satisfy `match.tags`. It then looks for
 * existing OSM features that satisfy `match`.
 */
export interface ConflationRule {
  /** Which geometry type of new feature this rule applies to */
  geometry: 'point' | 'line' | 'area';
  /** Which OSM features count as "already mapped" */
  match: ConflationMatch;
  /** "Already mapped" proximity limit, in meters */
  buffer: number;
  /** Lines: "already mapped" heading limit, in degrees (default 30) */
  maxAngle?: number;
  /** The "needs review" limits are this multiple of the "already mapped" limits (default 2) */
  reviewFactor?: number;
}

/** Per-dataset conflation settings, stored on `RapidDataset.conflation`. */
export interface ConflationSettings {
  /** Whether conflation runs for this dataset */
  enabled: boolean;
  /** Whether to draw "already mapped" features in a muted style, instead of hiding them */
  showMatched: boolean;
  /** The matching rules, checked in order. The first rule that applies to a feature is used. */
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
  /** The OSM entity */
  entityID: EntityID;
  /** Score for this pair, 0–1 */
  score: number;
  /** Measures for this pair */
  measures: ConflationMeasures;
}

/** Triage of one coverage box along a new line. */
export interface BoxMatch {
  /** `matched`, `uncertain`, or `unmatched` */
  status: ConflationStatus;
  /** OSM ways that matched this box at its status, closest first */
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
}

/** A maximal stretch of a new line whose boxes share a status. */
export interface LineRun {
  /** `matched`, `uncertain`, or `unmatched` */
  status: ConflationStatus;
  /** WGS84 sub-line of the original geometry */
  coords: Vec2[];
  /** Set when the start of this run meets an already-mapped stretch */
  startJoin?: JoinPoint;
  /** Set when the end of this run meets an already-mapped stretch */
  endJoin?: JoinPoint;
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

/** Running totals for one candidate way (internal). */
interface WayTally {
  strict: number;
  loose: number;
  distance: number;
  angle: number;
}


/**
 * Returns new default conflation settings: disabled, with one rule per geometry type.
 * @return Default settings
 */
export function conflationDefaults(): ConflationSettings {
  return {
    enabled: false,
    showMatched: false,
    rules: [
      { geometry: 'line', match: { geometry: 'line' }, buffer: 3, maxAngle: DEFAULT_MAX_ANGLE, reviewFactor: DEFAULT_REVIEW_FACTOR },
      { geometry: 'point', match: {}, buffer: 3, reviewFactor: DEFAULT_REVIEW_FACTOR },
      { geometry: 'area', match: { geometry: 'area' }, buffer: 0, reviewFactor: DEFAULT_REVIEW_FACTOR }
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
 * Only LineStrings from GeoJSON-backed datasets are matched so far. Points and areas follow.
 *
 * See `design/conflation-system.md` for the full design.
 *
 * Events available:
 * - `conflationchange` - Fires after cached results are flushed, so they will be recomputed
 */
export class ConflationSystem extends AbstractSystem {

  /** Cached results, by datasetID then dataID. `null` means no rule applies to that feature. */
  protected _results: Map<DatasetID, Map<DataID, ConflationResult | null>>;
  /** Compiled tag matchers, per rule */
  protected _matchers: WeakMap<ConflationRule, PropMatcher[]>;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'conflation';
    this.requiredDependencies = new Set<SystemID>(['editor', 'rapid', 'spatial']);

    this._results = new Map<DatasetID, Map<DataID, ConflationResult | null>>();
    this._matchers = new WeakMap<ConflationRule, PropMatcher[]>();
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
    return Promise.resolve();
  }


  /**
   * Whether conflation is turned on for a dataset.
   * @param ds - The dataset
   * @return `true` if enabled
   */
  public isEnabled(ds: RapidDataset): boolean {
    return !!ds.conflation?.enabled;
  }


  /**
   * Returns the conflation result for one feature of a dataset, computing it if needed.
   * @param ds - The dataset that the feature belongs to
   * @param datum - The new feature
   * @return The result, or `undefined` if conflation is off for the dataset or no rule applies
   */
  public getResult(ds: RapidDataset, datum: GeoJSONData | OsmEntity): ConflationResult | undefined {
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
   * Flushes cached results so they are recomputed on next access, and emits `conflationchange`.
   * @param datasetID - Flush only this dataset (default: all datasets)
   */
  public invalidate(datasetID?: DatasetID): void {
    if (datasetID) {
      this._results.delete(datasetID);
    } else {
      this._results.clear();
    }
    this.emit('conflationchange');
  }


  /**
   * Computes the result for one feature.
   * @param ds - The dataset that the feature belongs to
   * @param datum - The new feature
   * @return The result, or `undefined` if no rule applies
   */
  protected _compute(ds: RapidDataset, datum: GeoJSONData | OsmEntity): ConflationResult | undefined {
    if (!(datum instanceof GeoJSONData)) return undefined;   // OSM-backed datasets: not yet

    const part = datum.geoms.parts[0];   // single part only, like `actionRapidAcceptFeature`
    if (!part?.orig || !part.world) return undefined;

    const geometry = part.type === 'LineString' ? 'line' : part.type === 'Polygon' ? 'area' : 'point';
    const tags = ds.dictionary ? ds.dictionary.applyTransforms(datum.properties) : datum.properties;
    const rule = this._ruleFor(ds, geometry, tags);
    if (!rule) return undefined;

    if (geometry === 'line') {
      return this._conflateLine(datum.id, rule, part);
    }
    return undefined;   // points and areas: not yet
  }


  /**
   * Finds the first rule that applies to a new feature.
   * @param ds - The dataset
   * @param geometry - The new feature's geometry type
   * @param tags - The new feature's tags, after the data dictionary
   * @return The rule, or `undefined` if none applies
   */
  protected _ruleFor(ds: RapidDataset, geometry: string, tags: Record<string, unknown>): ConflationRule | undefined {
    for (const rule of ds.conflation?.rules ?? []) {
      if (rule.geometry !== geometry) continue;
      if (PropMatcher.matchAll(this._tagMatchers(rule), tags)) return rule;
    }
    return undefined;
  }


  /**
   * Returns the compiled tag matchers for a rule.
   * @param rule - The rule
   * @return PropMatchers for `rule.match.tags`
   */
  protected _tagMatchers(rule: ConflationRule): PropMatcher[] {
    let matchers = this._matchers.get(rule);
    if (!matchers) {
      matchers = (rule.match.tags ?? []).map(props => PropMatcher.from(props));
      this._matchers.set(rule, matchers);
    }
    return matchers;
  }


  /**
   * Whether an existing OSM way satisfies a rule's `match`.
   * @param rule - The rule
   * @param way - The OSM way
   * @param graph - The graph the way belongs to
   * @return `true` if the way can match
   */
  protected _wayMatches(rule: ConflationRule, way: OsmWay, graph: Graph): boolean {
    const want = rule.match.geometry;
    if (want) {
      const geometry = way.geometry(graph);
      const wants = Array.isArray(want) ? want : [want];
      if (!wants.includes(geometry)) return false;
    }
    return PropMatcher.matchAll(this._tagMatchers(rule), way.tags);
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
   * Matches a new LineString against existing OSM ways.
   *
   * Each coverage box is triaged on its own: *matched* if an OSM way that satisfies the rule is
   * within `buffer` meters and `maxAngle` degrees, *uncertain* if one is within the looser review
   * limits, and *unmatched* otherwise. Consecutive boxes with the same status form runs.
   * @param dataID - The new feature's id
   * @param rule - The rule that applies
   * @param part - The new feature's geometry
   * @return The result
   */
  protected _conflateLine(dataID: DataID, rule: ConflationRule, part: GeometryPart): ConflationResult {
    const context = this.context;
    const editor = context.systems.editor!;
    const spatial = context.systems.spatial!;

    const graph = editor.stable.graph!;
    const segSpatialID = editor.spatialIDForGraph(graph) + '-segments';

    const factor = rule.reviewFactor ?? DEFAULT_REVIEW_FACTOR;
    const maxAngle = rule.maxAngle ?? DEFAULT_MAX_ANGLE;
    const looseAngle = Math.min(90, maxAngle * factor);
    const lat = part.orig!.extent.center()[1];
    const metersPerWorld = 1 / geoMetersToWorld(1, lat);
    const looseR = geoMetersToWorld(rule.buffer * factor, lat);

    // Boxes are spaced by the strict buffer, so runs have that resolution.
    // Each query box is grown to the loose radius, so "needs review" candidates are found too.
    const boxes = part.computeCoverage(rule.buffer);
    const source = part.world!.outer!;

    if (boxes.some(box => !this._isLoaded(box.coord))) {
      return { dataID: dataID, status: 'unknown', score: 0, partial: false, candidates: [] };
    }

    const nodeCoords = new Map<EntityID, Vec2>();
    const wayOK = new Map<EntityID, boolean>();
    const tallies = new Map<EntityID, WayTally>();
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

    for (const box of boxes) {
      const query = {
        minX: box.coord[0] - looseR, minY: box.coord[1] - looseR,
        maxX: box.coord[0] + looseR, maxY: box.coord[1] + looseR
      };

      // For each way near this box, keep its closest segment.
      const best = new Map<EntityID, { distance: number; angle: number }>();
      for (const hit of spatial.getItemsAtBox(segSpatialID, query)) {
        const seg = hit.contents as Segment;
        const wayID = seg.wayID;

        let ok = wayOK.get(wayID);
        if (ok === undefined) {
          const way = graph.hasEntity(wayID) as OsmWay | undefined;
          ok = !!way && this._wayMatches(rule, way, graph);
          wayOK.set(wayID, ok);
        }
        if (!ok) continue;

        const a = coordOf(seg.edge[0]);
        const b = coordOf(seg.edge[1]);
        if (!a || !b) continue;

        const distance = (vecProject(box.coord, [a, b])?.distance ?? Infinity) * metersPerWorld;
        const angle = headingDiff(box.angle, vecAngle(a, b));
        const prev = best.get(wayID);
        if (!prev || distance < prev.distance) {
          best.set(wayID, { distance: distance, angle: angle });
        }
      }

      // Triage the box by its best way.
      const strictIDs: Array<[EntityID, number]> = [];
      const looseIDs: Array<[EntityID, number]> = [];
      for (const [wayID, m] of best) {
        let tally = tallies.get(wayID);
        if (m.distance <= rule.buffer && m.angle <= maxAngle) {
          strictIDs.push([wayID, m.distance]);
          tally ??= { strict: 0, loose: 0, distance: 0, angle: 0 };
          tally.strict++;
        } else if (m.distance <= rule.buffer * factor && m.angle <= looseAngle) {
          looseIDs.push([wayID, m.distance]);
          tally ??= { strict: 0, loose: 0, distance: 0, angle: 0 };
          tally.loose++;
        } else {
          continue;
        }
        tally.distance += m.distance;
        tally.angle += m.angle;
        tallies.set(wayID, tally);
      }

      const byDistance = (a: [EntityID, number], b: [EntityID, number]) => a[1] - b[1];
      if (strictIDs.length) {
        boxMatches.push({ status: 'matched', wayIDs: strictIDs.sort(byDistance).map(d => d[0]) });
      } else if (looseIDs.length) {
        boxMatches.push({ status: 'uncertain', wayIDs: looseIDs.sort(byDistance).map(d => d[0]) });
      } else {
        boxMatches.push({ status: 'unmatched', wayIDs: [] });
      }
    }

    // Score: matched boxes count 1, uncertain boxes count 0.5.
    const n = boxMatches.length;
    const boxScore = (bm: BoxMatch) => (bm.status === 'matched' ? 1 : bm.status === 'uncertain' ? 0.5 : 0);
    const score = n ? boxMatches.reduce((sum, bm) => sum + boxScore(bm), 0) / n : 0;

    // Candidates, with their measures.
    const candidates: ConflationCandidate[] = [];
    for (const [wayID, tally] of tallies) {
      const count = tally.strict + tally.loose;
      const wayCoords = (graph.hasEntity(wayID) as OsmWay | undefined)?.nodes
        .map(nodeID => coordOf(nodeID))
        .filter((c): c is Vec2 => !!c) ?? [];

      candidates.push({
        entityID: wayID,
        score: n ? (tally.strict + 0.5 * tally.loose) / n : 0,
        measures: {
          distance: tally.distance / count,
          angle: tally.angle / count,
          overlap: count / n,
          intersects: geomPathIntersections(source, wayCoords).length > 0,
          tags: true
        }
      });
    }
    candidates.sort((a, b) => b.score - a.score);

    // Runs.
    const ranges = this._lineRanges(boxMatches, boxes, source, metersPerWorld, rule.buffer);
    const toWgs84 = (coords: Vec2[]) => coords.map(coord => projWorldToWgs84(coord));
    const runs = ranges.map((range, i): LineRun => {
      const prev = ranges[i - 1];
      const next = ranges[i + 1];
      if (range.status === 'matched') {
        return { status: range.status, coords: toWgs84(subLine(source, boxes[range.start], boxes[range.end])) };
      }

      // A run that isn't already mapped extends into a neighboring already-mapped stretch,
      // and joins the OSM way that matched there.
      const startBox = prev?.status === 'matched' ? boxes[prev.end] : boxes[range.start];
      const endBox = next?.status === 'matched' ? boxes[next.start] : boxes[range.end];
      const run: LineRun = { status: range.status, coords: toWgs84(subLine(source, startBox, endBox)) };

      if (prev?.status === 'matched') {
        run.startJoin = this._joinPoint(boxMatches[prev.end].wayIDs[0], startBox.coord, graph, coordOf, metersPerWorld);
      }
      if (next?.status === 'matched') {
        run.endJoin = this._joinPoint(boxMatches[next.start].wayIDs[0], endBox.coord, graph, coordOf, metersPerWorld);
      }
      return run;
    });

    const statuses = new Set<ConflationStatus>(ranges.map(r => r.status));
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
 * Returns the position of a box center along a line.
 * @param source - The line, in world coordinates
 * @param box - The box
 * @return World coordinate
 */
function positionOf(source: Vec2[], box: CoverageBox): Vec2 {
  const a = source[box.index];
  const b = source[box.index + 1] ?? a;
  return vecInterp(a, b, box.t);
}


/**
 * Cuts the stretch of a line between two box centers.
 * @param source - The line, in world coordinates
 * @param from - The box where the stretch starts
 * @param to - The box where the stretch ends
 * @return The sub-line, in world coordinates
 */
function subLine(source: Vec2[], from: CoverageBox, to: CoverageBox): Vec2[] {
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
