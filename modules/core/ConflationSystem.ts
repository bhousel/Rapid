import { AbstractSystem } from './AbstractSystem.ts';
import { GeoJSONData } from '../data/GeoJSONData.ts';
import { geoMetersToWorld } from '../geo/geom.ts';
import { geomPathIntersections, projWgs84ToWorld, projWorldToWgs84, vecAngle, vecEqual, vecInterp, vecLength, vecProject } from '@rapid-sdk/math';
import { PropMatcher } from '../lib/PropMatcher.ts';

import type { AbstractData } from '../data/AbstractData.ts';
import type { Context } from '../Context.ts';
import type { CoverageBox } from '../geo/geom.ts';
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

/** Per-dataset conflation settings, stored on `RapidDataset.conflation`. */
export interface ConflationSettings {
  /** Whether conflation runs for this dataset */
  enabled: boolean;
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
  /** WGS84 sub-line of the original geometry */
  coords: Vec2[];
  /** Set when the start of this run meets an already-mapped stretch, or an allowed target line */
  startJoin?: JoinPoint;
  /** Set when the end of this run meets an already-mapped stretch, or an allowed target line */
  endJoin?: JoinPoint;
  /**
   * For runs that aren't already mapped, when the line has more than one run: a data element for just
   * this stretch, so it can be drawn, selected, and accepted on its own.
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
 * Returns new default conflation settings: disabled, with one rule per geometry type and no property
 * conditions (so a nearby target counts regardless of its tags, until the user adds conditions).
 * @return Default settings
 */
export function conflationDefaults(): ConflationSettings {
  return {
    enabled: false,
    showMatched: false,
    rules: [
      { source: { geometry: 'line' }, target: { geometry: 'line' }, sameDist: 3, sameAngle: DEFAULT_MAX_ANGLE, nearDist: 6, nearAngle: DEFAULT_MAX_ANGLE },
      { source: { geometry: 'point' }, target: { geometry: 'point' }, sameDist: 3, nearDist: 6 },
      { source: { geometry: 'area' }, target: { geometry: 'area' }, sameDist: 0 }
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
    return !!ds.conflation?.enabled;
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
    if (!run || run.status === 'matched') return undefined;
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

    for (const box of boxes) {
      // For each target feature near this box, keep its best match across all rules:
      // "same" beats "near", and a closer segment beats a farther one.
      const best = new Map<EntityID, BoxHit>();
      const query = {
        minX: box.coord[0] - queryR, minY: box.coord[1] - queryR,
        maxX: box.coord[0] + queryR, maxY: box.coord[1] + queryR
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
        const distance = (vecProject(box.coord, [a, b])?.distance ?? Infinity) * metersPerWorld;
        const angle = headingDiff(box.angle, vecAngle(a, b));

        for (let r = 0; r < active.length; r++) {
          const rule = active[r];
          const key = `${r}:${entityID}`;
          let ok = allowed.get(key);
          if (ok === undefined) {
            ok = this._targetMatches(rule, feature, sourceTags);
            allowed.set(key, ok);
          }
          if (!ok) continue;

          const sameAngle = rule.sameAngle ?? DEFAULT_MAX_ANGLE;
          const nearAngle = rule.nearAngle ?? sameAngle;
          let level: 0 | 1 | 2 = 0;
          if (distance <= rule.sameDist && angle <= sameAngle) {
            level = 2;
          } else if (distance <= nearDistOf(rule) && angle <= nearAngle) {
            level = 1;
          }
          if (!level) continue;

          const prev = best.get(entityID);
          if (!prev || level > prev.level || (level === prev.level && distance < prev.distance)) {
            best.set(entityID, { entityID: entityID, wayID: wayID, distance: distance, angle: angle, level: level });
          }
        }
      }

      // Triage the box by its best target features.
      const strictHits: BoxHit[] = [];
      const looseHits: BoxHit[] = [];
      for (const h of best.values()) {
        const tally = tallies.get(h.entityID) ?? { strict: 0, loose: 0, distance: 0, angle: 0, wayIDs: new Set<EntityID>() };
        if (h.level === 2) {
          strictHits.push(h);
          tally.strict++;
        } else {
          looseHits.push(h);
          tally.loose++;
        }
        tally.distance += h.distance;
        tally.angle += h.angle;
        tally.wayIDs.add(h.wayID);
        tallies.set(h.entityID, tally);
      }

      const boxMatch = (status: ConflationStatus, hits: BoxHit[]): BoxMatch => {
        hits.sort((a, b) => a.distance - b.distance);
        return { coord: box.coord, status: status, entityIDs: hits.map(h => h.entityID), wayIDs: hits.map(h => h.wayID) };
      };
      if (strictHits.length) {
        boxMatches.push(boxMatch('matched', strictHits));
      } else if (looseHits.length) {
        boxMatches.push(boxMatch('uncertain', looseHits));
      } else {
        boxMatches.push(boxMatch('unmatched', []));
      }
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
    const toWgs84 = (coords: Vec2[]) => coords.map(coord => projWorldToWgs84(coord));
    const runs = ranges.map((range, i): LineRun => {
      const prev = ranges[i - 1];
      const next = ranges[i + 1];
      if (range.status === 'matched') {
        return { status: range.status, coords: toWgs84(subLine(source, boxes[range.start], boxes[range.end])) };
      }

      // A run that isn't already mapped extends into a neighboring already-mapped stretch,
      // and joins the OSM way that matched there (if that way is a line, not an area's edge).
      const startBox = prev?.status === 'matched' ? boxes[prev.end] : boxes[range.start];
      const endBox = next?.status === 'matched' ? boxes[next.start] : boxes[range.end];
      const run: LineRun = { status: range.status, coords: toWgs84(subLine(source, startBox, endBox)) };

      const lineWayAt = (boxIndex: number): EntityID | undefined =>
        boxMatches[boxIndex].wayIDs.find(wayID => features.get(wayID)?.geometry === 'line');

      if (prev?.status === 'matched') {
        run.startJoin = this._joinPoint(lineWayAt(prev.end), startBox.coord, graph, coordOf, metersPerWorld);
      } else if (!prev) {
        run.startJoin = endJoinAt(source[0]);
      }
      if (next?.status === 'matched') {
        run.endJoin = this._joinPoint(lineWayAt(next.start), endBox.coord, graph, coordOf, metersPerWorld);
      } else if (!next) {
        run.endJoin = endJoinAt(source.at(-1)!);
      }
      return run;
    });

    // When the line has more than one run, each run that isn't already mapped gets its own data element,
    // so it can be drawn, selected and accepted on its own. Its id is based on where the run starts
    // along the line, so it stays the same when other parts of the line change.
    if (runs.length > 1) {
      runs.forEach((run, i) => {
        if (run.status === 'matched') return;
        run.datum = new GeoJSONData<ConflationRunProps>(context, {
          id: `${dataID}~${ranges[i].start}`,
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
