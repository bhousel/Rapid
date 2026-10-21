# Conflation System Design

This document proposes a `ConflationSystem` for Rapid. It compares features from a third-party dataset
against the OSM data loaded in the editor, measures how well they match, and helps the user decide
what to do with each one: add it, skip it, or review it.

Conflation runs entirely in the browser, on top of [`SpatialSystem`](./spatial-system.md). This is
Step 3d of the spatial design, which said the match semantics would live in a dedicated module. This
doc is that module's design.

> **Status:** In progress. Steps 1–5 are done: `ConflationSystem` matches LineStrings from
> GeoJSON-backed datasets, with measures, scoring, triage, runs and join points; `PixiLayerRapid`
> draws the results; and the missing part of a line can be accepted and joined to what exists
> (see [Rollout Plan](#rollout-plan)).
> It builds on `SpatialSystem` box queries, the `editor_*` caches with their `segments` index, and
> `GeometryPart.computeCoverage(radius)`. The scoring model is provisional until it is aligned with
> the external matching tools (see [Scoring](#scoring)).

## Match → Score → Triage → Act

"Conflation" is jargon, and people use it for different things. This doc breaks it into four plain
stages, and uses these names everywhere instead:

| Stage | Question | Output |
|---|---|---|
| **1. Match** | Which existing features could each new feature be the same as? | Candidate pairs, plus **measures**: distance, angle, overlap, intersection, tags |
| **2. Score** | How confident are we that a pair is the same thing? | A score from 0 to 1 for each pair and each feature |
| **3. Triage** | Hide it, review it, or offer it? | A **status**: `matched`, `uncertain`, or `unmatched` (plus *partial* geometry for lines) |
| **4. Act** | What does the user do about it? | Accept new data (maybe part of a line, joined to what exists), skip duplicates, and later merge attributes |

We call stage 3 *triage* rather than *filter*, because it does more than hide things. It sorts each
feature into one of three outcomes, and the uncertain ones go to a person.

**Words in the UI.** "Conflation" appears in exactly one place: the **Conflation Settings** heading
in `UiRapidDatasetSettings`. The text right under the heading defines the word using the four stages
(see [Settings UI](#settings-ui-uirapiddatasetsettings)). Every other user-facing string uses the stage
words, and the statuses appear as **Already mapped**, **Needs review** and **New**. In code, "conflation"
is fine (`ConflationSystem`, `ds.conflation`), since it matches the existing spatial design.

Stages 1 and 2 can also run outside Rapid, for example as server-side matching over whole datasets.
Rapid's job is mainly stages 3 and 4, with a person in the loop. But Rapid also has to be able to run
stages 1 and 2 itself, because:
- data can arrive **raw**, with nothing matched yet;
- any external result describes OSM **as it was** when the tool ran, while Rapid knows the **current**
  graph, including the user's own edits. Re-matching against the live graph is what makes accepted
  data disappear from the "missing" set, and makes undo bring it back.

So Rapid computes the **same measures as the external tools, with the same names and meanings.** A
"3 m buffer" or "30° angle variance" should mean the same thing everywhere. Rapid can also take
precomputed scores as input (see [Inputs](#inputs)).

## Guiding use case

> *Accept the part of the sidewalk that is missing, and join it to the part of the sidewalk that exists.*

A transportation agency publishes sidewalk and crossing data (OSW-style: `highway=footway` +
`footway=sidewalk|crossing`). Some of it is already in OSM, some partly, some not at all. The user
should see only what's missing, plus a short list of cases that need a judgment call. Accepting a
missing piece should create an OSM way that connects to the existing network at its ends, not one
that lies beside it or on top of it.

**Real-world patterns,** from comparing agency sidewalk and crossing data with OSM in a small-city
street grid:
- The agency's sidewalks run about **1–2 m** off the OSM sidewalks, a systematic offset between
  surveys. A buffer under about 2.5 m misses true matches, so the default is **3 m**.
- **Partial lines happen all the time.** One block-long sidewalk can run alongside an existing OSM
  sidewalk for part of its length, then continue where OSM has nothing.
- **Perpendicular features are everywhere:** crossings meet sidewalks, and sidewalks cross other
  sidewalks at corners. Without an angle test, every corner would look like a match.
- Crossings have to **join the sidewalks at their ends**, whether those sidewalks are already in OSM
  or were accepted a moment ago.

## Problem

- Every visible feature in a Rapid dataset is drawn, whether or not OSM already has it. For datasets
  that mostly overlap OSM, the user has to sort out duplicates by eye.
- `RapidDataset.conflated` is a boolean saved in settings and shown as a checkbox in
  `UiRapidDatasetSettings`, but nothing reads it. It was originally a flag for server-conflated data.
- The only conflation logic so far is a prototype in `PixiLayerDebug` (a Microsoft-buildings check).
- Accepting a feature is all-or-nothing: `actionRapidAcceptFeature` copies the whole geometry and
  joins only through the optional autoconnect step.

## Goals

1. **Measures that match the external tools:** buffer distance, angle variance, percent overlap,
   intersection, and tag criteria, all configurable for each dataset.
2. **Three-way triage.** Confident matches are hidden, confident misses are offered as new data, and
   anything in between goes to a **review queue**.
3. **Partial line matching.** Matching is decided for each coverage box, so the matched and unmatched
   stretches of a line are known separately.
4. **Joining on accept.** The ends of any accepted line connect to the existing network: to the
   matched way where a partial run begins, and to nearby pedestrian ways at the other ends.
5. **Any input:** raw data, data with matches already removed, or data with scores already attached.
6. **Keep the measures for each match.** Which OSM entities matched, and how well. Reviewing needs
   this, and so will a later "merge into existing feature" workflow.
7. **Stay fast** on city-sized datasets. Compute lazily, and cache the results.

## Non-Goals (initial scope)

- Merging tags or geometry from new data into existing OSM features (Goal 6 keeps the data for it).
- Moving the work to a worker. Start on the main thread, measure, then decide.
- The reverse query, "which OSM features overlap third-party data" (Spatial Step 4).
- Exact buffer polygons. Coverage boxes plus a precise refine step are enough
  (see [spatial-system.md §5](./spatial-system.md)).
- Multi-part features. `actionRapidAcceptFeature` only handles `parts[0]` today, and conflation
  will do the same at first.
- Converting schemas. Data reaches OSM tagging through the existing data dictionary. Conflation
  compares **after** that mapping (see [Rules](#rules)).

## Design

### Ownership and lifecycle

`ConflationSystem` is a core system (`modules/core/ConflationSystem.ts`, id `conflation`).
- **Required dependencies:** `editor` (the OSM caches and events), `rapid` (the dataset catalog and
  rules), `spatial` (queries).
- **Optional dependencies:** `scheduler`, to spread recomputation across idle time. Without it, the
  system recomputes synchronously, on demand.

It is a system and not a free module because its results are runtime state. They have to be thrown
away when the OSM data changes, when the rules change, or on `resetAsync()`.

`SpatialSystem` keeps its hard rule: it knows nothing about conflation. `ConflationSystem` passes it
query boxes and refine predicates.

### What it compares against

OSM data comes from the **`editor_stable`** caches: the data index for points and areas, and
`editor_stable-segments` for lines. Stable changes only when the user finishes an edit, so
conflation won't churn while the user is dragging a node. Accepting a feature is a finished edit, so
it shows up in stable right away.

**Unknown is not missing.** If OSM data isn't loaded yet where a feature lies (`OsmService.isDataLoaded`),
the feature's status is `unknown`. It is drawn the way it is drawn today, and recomputed when the data
arrives. We must never hide a feature, or show it as missing, because of a gap in what we've downloaded.

### Target features

The matcher should compare against *features*, not raw OSM ways. OSM spreads one feature across
several entities. The usual case is a multipolygon: its outer and inner ways are untagged closed ways
that report `geometry() === 'line'`, while the tags (`building=retail`) sit on the relation. Taken at
face value, a sidewalk along a building drawn this way "matches a line" with no tags.

`OsmWay.asFeature(graph)` answers "what is this way, really?" It returns `{ entity, geometry, tags }`:
the way itself if it has interesting tags, otherwise the parent multipolygon it belongs to (geometry
`'area'`, the relation's tags). The matcher checks geometry and tags against that feature and records
candidates under the feature's ID. So a building made of two closed outers is one candidate, the
building relation, which is also what a later merge step needs.

Other parts of Rapid answer the same question on their own today (styling, filtering, several
validators), each slightly differently; moving them to `asFeature` is tracked separately. Longer
term, the matcher should see generic `{ kind, tags, coords }` features from an index built for that
purpose, with OSM as one adapter. That would also allow matching one dataset against another.

### Rules

Each dataset gets a `conflation` settings object. The dataset's `conflated` boolean is the on/off
switch: the user (or a service) sets up the rules, then the user can switch it off to see the raw
data, and back on to see the result of the rules.

```ts
interface ConflationSettings {
  showMatched: boolean;           // draw matched features in a muted style (off by default)
  rules: ConflationRule[];
}

// A ConflationRule defines the conditions under which a source feature (from the dataset)
// and a target feature (from OSM) are considered the same thing.
interface ConflationRule {
  source: { geometry: 'point' | 'line' | 'area'; props?: PropMatcherProps[] };
  target: { geometry: 'point' | 'line' | 'area'; props?: PropMatcherProps[] };
  sameKeys?: string[];   // property keys whose values must be present and equal on both sides
  sameDist: number;      // "same": target within this many meters of the source (0 = touching or inside)
  sameAngle?: number;    // "same", lines only: heading difference in degrees (default 30)
  nearDist?: number;     // "near" (needs review): within this many meters (default sameDist, no review band)
  nearAngle?: number;    // "near", lines only (default sameAngle)
}
```

The words **source** and **target** match the data dictionary's terms: the source is the dataset's
feature, the target is the feature already in the basemap (OSM today). Keeping the rule in these terms,
rather than OSM's, leaves room to match one dataset against another later.

**How the fields combine:**
1. **Within a rule, every condition must hold (AND)** for "same": geometry and props on each side,
   `sameKeys`, and the distance and angle limits.
2. **Across rules, any one rule saying "same" is enough (OR).** Rules are alternative definitions of
   "the same thing". A dataset with sidewalks and crossings can have a rule for each, and one rule can
   say that the source's `living_street` counts as the target's `path`.
3. **Every source feature is tested**, if some rule covers its geometry. Failing a rule's
   `source.props` means that rule can't say "same" for it; it doesn't mean "no result". A feature no
   rule could call "same" comes out New. Only a feature whose geometry no rule covers gets no result.
4. **Source props are checked after the data mapping.** The data mapping translates source attributes
   into the target's vocabulary, the same way it does when a feature is accepted. Vocabulary fixes can
   go there, or in a second rule. A dataset without a mapping uses its raw properties.
5. **Distances are measured from the source to the target.** Lines are sampled along their length, so
   this measures how much of the source is already mapped. For an area target, the distance is to its
   edge, and 0 if the source is inside. So `sameDist: 0` means "touching or inside".
6. **Geometry has to agree with `target.geometry`.** OSM represents both lines and areas as ways; the
   target's geometry comes from `OsmWay.asFeature`, so a building edge (even an untagged multipolygon
   outer) is an area, and a `line` target never matches it. `point` targets match OSM points and vertices.

**What rules can express**, from least to most specific (columns show what differs from a plain
line-to-line rule with `sameDist: 3, sameAngle: 30, nearDist: 6, nearAngle: 30`):

| Request | `source` | `target` | `sameKeys` | Distances |
|---|---|---|---|---|
| A nearby line counts, regardless of tagging | `{ geometry: 'line' }` | `{ geometry: 'line' }` | | |
| Both have `highway`, any value | `props: [{ key: 'highway' }]` | `props: [{ key: 'highway' }]` | | |
| Both have the same `highway` value | | | `['highway']` | |
| Both are footways | `props: [{ key: 'highway', value: 'footway' }]` | same as source | | |
| Same `highway`, but never match private OSM ways | | `props: [{ key: 'access', op: '!=', value: 'private' }]` | `['highway']` | |
| A crossing never matches a sidewalk | | | `['highway', 'footway']` | |
| Source `living_street` counts as target `path` or `footway` | `props: [{ key: 'highway', value: 'living_street' }]` | `props: [{ key: 'highway', op: 'in', value: ['path', 'footway'] }]` | | (a second rule) |
| An address point counts if it falls inside a building | `{ geometry: 'point' }` | `{ geometry: 'area', props: [{ key: 'building' }] }` | `['addr:housenumber']` | `sameDist: 0` |
| A POI counts if it's within 25 m of the same kind of POI | `{ geometry: 'point' }` | `{ geometry: 'point' }` | `['amenity']` | `sameDist: 25` |

The point and area rows are part of the design, but only lines are matched so far.

**Room to grow** without changing this shape: a `minOverlap` field for percent overlap (on the
external tools' list, and useful for area-to-area), and fuzzy `sameKeys` entries such as
`{ key: 'name', similarity: 0.8 }` for POI names.

`target.props` is also how a user answers questions like "does a road tagged `sidewalk=both` count as a
sidewalk?" That kind of match can't be joined to, because there is no sidewalk geometry to connect to
(see Open Questions).

**Defaults** (`conflationDefaults()`): one rule per geometry type, source and target the same kind,
with no property conditions. Lines: `sameDist` 3, `sameAngle` 30, `nearDist` 6, `nearAngle` 30.
Points: `sameDist` 3, `nearDist` 6. Areas: `sameDist` 0. Conflation starts disabled, so existing
behavior doesn't change until the user turns it on.

**Persistence** (Step 6): the settings store only holds string leaves, so `toJSON()`/`fromJSON()`
need to encode the rules. Custom datasets will save `conflation` with everything else. Service-provided
datasets save a subset that the user can customize, which gains `conflation` and loses `conflated`.
The old `conflated` value is dropped when settings load. It never had any effect, so there is
nothing to migrate.

### Stage 1: candidates and measures

Each source line is sampled with `part.computeCoverage(spacing)` (cached for each radius), where the
spacing is the smallest `sameDist` among the line rules (at least 1 m). That sets the resolution of
runs. Each sample's query box reaches out to the largest `nearDist`, so "near" targets are found too.
The query has two phases: a quick bounding-box search over the RBush index (`SpatialSystem`), then
a precise test in `ConflationSystem` (a plain filter), using `vec*` and `geom*` helpers from
`@rapid-sdk/math`. Each segment's distance and angle are computed once, then checked against every
rule whose source conditions the feature passes, and the target's geometry, props and `sameKeys`
are checked per rule (cached per target feature).

| Third-party | Phase 1: query boxes vs. | Phase 2: kept per box or feature |
|---|---|---|
| **Point** | data index | OSM nodes within the limits (`vecLength`), and OSM areas that contain the point (`geomPointInPolygon`) |
| **LineString** | `segments` index, **one query per box** | for each OSM way, its closest segment to the box center (point-to-segment distance via `vecProject`) and that segment's heading difference from the box's `angle`. Opposite directions count as the same heading. |
| **Polygon** | data index (extent grown by `nearDist`) | OSM areas that intersect the polygon (`geomPolygonIntersectsPolygon`) |

Each candidate pair (new feature, OSM entity) gets these **measures**:

| Measure | Lines | Polygons | Points |
|---|---|---|---|
| `distance` (m) | mean distance from matched box centers to the OSM way | distance between centroids | distance to node, or 0 if inside the area |
| `angle` (°) | mean heading difference over matched boxes | n/a | n/a |
| `overlap` (0–1) | share of the new line's length whose boxes match this OSM way | intersection area ÷ smaller area | n/a |
| `intersects` | the two geometries cross | the two areas intersect | inside the area |
| `tags` | some rule's conditions passed (always true for kept candidates) | same | same |

**The angle test matters for sidewalks.** At a corner, the crossing sidewalk lies within `sameDist` of
every sidewalk that meets it. Without the angle test, the end of every sidewalk would look matched.
Each `CoverageBox` already carries its `angle` for this reason.

**Except for stubs.** A source line shorter than a rule's `sameDist` is judged by distance only for
that rule (and its other conditions, like `sameKeys`, still apply). Its heading is unreliable: a
1 cm line has a meaningless one. Network datasets like OSW split lines into an edge at every
junction, curb ramp and crossing node, so stubs are common: in the agency sidewalk data we tested,
about 9% of the lines are under 1 m and 2% under 10 cm. Stubs are never thrown away by length, since
some short edges are real (a curb-ramp connector carrying tactile-paving information); one with
nothing allowed nearby still comes out New.

Distances are converted from meters to world units with `geoMetersToWorld` at the feature's latitude,
the same conversion `computeCoverage` uses.

### Scoring

> **Provisional.** The external, server-side matching tools already compute a score from these same
> parameters. The goal is for Rapid to offer the same capabilities and use the **same formula**, so
> the same data gets the same result everywhere. We're gathering the details. This doesn't block
> anything: until we have them, Rapid uses the simple formula below, behind a single function, so it
> can be swapped out.

**"Same" and "near".** Each coverage box is triaged by the best target near it, across all rules:

| Box status | Condition (some rule whose other conditions hold, for the closest segment of a target) |
|---|---|
| `matched` | distance ≤ `sameDist` **and** heading difference ≤ `sameAngle` |
| `uncertain` | otherwise, distance ≤ `nearDist` **and** heading difference ≤ `nearAngle` |
| `unmatched` | neither |

*Why does `nearAngle` default to `sameAngle`?* An earlier version loosened the angle for "near" too
(30° to 60°). Trying it on real sidewalk data in the browser showed that every corner then produced a
"needs review" stretch: the crossing and the next sidewalk are 3–4 m away at 30–40°. Any stretch that
needs review sends the whole line to the review queue, so partly mapped sidewalks went to review
instead of offering their new part. A line heading 40° away is going somewhere else, so by default
it isn't "almost the same". A rule can still set a looser `nearAngle`.

```text
box score       = 1 (matched), 0.5 (uncertain), 0 (unmatched)
feature score   = mean box score
candidate score = (its matched boxes + 0.5 × its uncertain boxes) ÷ all boxes
```

The score is for ranking and reporting. Triage comes from the box statuses, not from a threshold on
the score.

*Why not a threshold on a combined score?* An earlier draft used `overlap × (1 − distance/sameDist)`
with "matched above 0.8" and "review above 0.3". With agency sidewalks running 1–2 m off OSM and a
3 m buffer, true matches scored about 0.5 and would all have gone to review. A sidewalk that is half
mapped would also have gone to review, instead of showing its missing half as new. Limits per box
avoid both problems and are easy to explain: "within 3 m and 30° is already mapped, within 6 m and
30° needs review."

### Stage 3: triage status

| Status | UI label | Feature condition | Shown as |
|---|---|---|---|
| `matched` | Already mapped | every box is matched | hidden (muted if `showMatched` is on) |
| `uncertain` | Needs review | any box is uncertain | highlighted, and listed in the review queue |
| `unmatched` | New | otherwise: some boxes are unmatched | shown as today (partial lines as their runs), offered for accept |
| `unknown` | — | OSM data isn't loaded at one of the boxes | shown as today, and not cached |

**Partial lines are about geometry, not confidence.** Consecutive boxes with the same status form
**runs**. A line with matched runs and unmatched runs is **partial**: its status is `unmatched` (there is
new data to offer), its unmatched runs are offered as new, and its matched runs are treated like an
already-mapped feature. If any run is uncertain, the whole line goes to the review queue.

**Short runs are absorbed.** A run that isn't matched, is shorter than the sample spacing, and sits next to a
matched run is treated as matched. These are almost always misalignment at the ends of a match,
such as a new sidewalk that overshoots the OSM one by a meter or two.

### Match records

```ts
type ConflationStatus = 'unknown' | 'unmatched' | 'uncertain' | 'matched';

interface ConflationResult {
  dataID: DataID;
  status: ConflationStatus;
  score: number;                      // feature score, 0–1
  partial: boolean;                   // LineString: some runs matched, some not
  candidates: ConflationCandidate[];  // sorted best first
  boxes?: BoxMatch[];                 // LineString only: one entry per coverage box, in order
  runs?: LineRun[];                   // LineString only: every run, in order along the line
}

interface ConflationCandidate {
  entityID: EntityID;                 // the OSM feature: a way, or e.g. a multipolygon relation
  score: number;
  measures: { distance: number; angle: number; overlap: number; intersects: boolean; tags: boolean };
}

interface BoxMatch {
  coord: Vec2;                        // box center, world coordinates
  status: ConflationStatus;           // matched, uncertain, or unmatched
  entityIDs: EntityID[];              // OSM features that matched this box at its status, closest first
  wayIDs: EntityID[];                 // for each feature, the way whose segment matched (what a run can join)
}

interface LineRun {
  status: ConflationStatus;           // matched, uncertain, or unmatched
  coords: Vec2[];                     // WGS84 sub-line of the original geometry
  startJoin?: JoinPoint;              // set when this end meets a matched run, or an allowed target line
  endJoin?: JoinPoint;
  datum?: GeoJSONData<ConflationRunProps>;   // runs that aren't matched, when there are several runs:
                                             // just this stretch, to draw, select and accept on its own
}

interface ConflationRunProps extends GeoJSONProps {   // plus id, datasetID, serviceID, geojson
  sourceID: DataID;                   // the source feature this run is part of
  startJoin?: JoinPoint;
  endJoin?: JoinPoint;
}

interface JoinPoint {
  wayID: EntityID;                    // the OSM way to connect to
  loc: Vec2;                          // the endpoint projected onto that way
  nodeID?: EntityID;                  // an existing node within tolerance, if any (reuse it)
  edge?: [EntityID, EntityID];        // otherwise, the segment that `loc` is on (add a node there)
}
```

A run's data element has an id based on where the run starts along the line
(`${dataID}~${firstBoxIndex}`), so it stays the same when other parts of the line change.

**Cutting runs out of a line.** A run is cut from the original geometry, not rebuilt from box centers.
`CoverageBox` carries the segment `index` and parameter `t` of its center, so the start and end of a
run map to exact positions on the source line. Boxes are about one sample spacing apart, so where a run that
isn't matched meets a matched run, it is extended to the nearest matched box. That end is then
projected onto the OSM way that matched there (the closest one whose feature is a line; a run never
joins the edge of an area). The projection is the `JoinPoint`.
If an existing node of that way is within 1 m of it, the run joins at that node and no new node is
added. In practice, a run joins an existing node where the OSM way ends, and joins mid-segment
where the new line leaves an OSM way and comes back to it.

**Runs are trimmed to their joins.** After its joins are found, each end of a run is cut at the point
on the run nearest its `JoinPoint`. Without this, the run could reach past where it connects: the
extension into the matched stretch, or a join that snapped to a node up to 1 m back, leaves extra
geometry beyond the connection. Found on real data at a street corner: the new sidewalk's run went
~2 m around the corner past the corner node it joined, which would have added a hook on accept.
In the straight, partly mapped case the trim changes almost nothing. Trimming only ever shortens a
run, and never cuts it down to nothing.

### Inputs

Conflation has to work no matter what the dataset already went through:
- **Raw data:** Rapid computes everything.
- **Data with matches already removed:** Rapid computes anyway. Most features come out `unmatched`,
  and re-matching still catches anything mapped in OSM since the data was prepared, including the
  user's own accepts.
- **Data with scores already attached:** a feature property (configured for each dataset, for
  example `match_score` and `match_osm_id`) can supply the score and candidate. Rapid uses it as long
  as the referenced OSM entity is unchanged in the current graph, and otherwise falls back to its own
  measures. This is a later phase. The input format should come from the external tools' output.

### Caching and invalidation

- Results are cached by `(datasetID, dataID)`. Coverage is cached on each `GeometryPart` (one slot per
  sample spacing). Compiled property matchers are cached per rule side, and dropped by `invalidate()`,
  so a rule edited in place is picked up.
- **`stablechange` and `merge`** from `EditSystem` flush results whose coverage overlaps the extent
  that changed. A first version can simply flush everything and rely on lazy recomputation.
- **A rule change** flushes that dataset's results.
- **Compute lazily:** `getResult(ds, datum)` computes when first asked. The drawing code asks only for
  visible features. If `scheduler` is present, features just outside the viewport can be computed in
  idle time.
- The system emits **`conflationchange`** after flushing, so the drawing code and the review queue
  can update.

### API sketch

```ts
class ConflationSystem extends AbstractSystem {
  // results
  getResult(ds: RapidDataset, datum: AbstractData): ConflationResult | undefined;
  isEnabled(ds: RapidDataset): boolean;

  // accepting
  getJoins(ds: RapidDataset, datum: AbstractData): LineJoins | undefined;   // where an accepted line's ends connect

  // review queue
  getQueue(ds: RapidDataset): ConflationResult[];   // `uncertain` results in the viewport, in a stable spatial order

  // invalidation
  invalidate(datasetID?: DatasetID): void;          // flush one dataset, or all

  // events: 'conflationchange'
}
```

`getResult` returns `undefined` when conflation is off for the dataset, so callers fall back to
today's behavior.

### Drawing (`PixiLayerRapid`)

When conflation is on for a dataset:
- `matched` features are skipped, or drawn in a muted style (35% opacity, no casing) if `showMatched`
  is on.
- `uncertain` features are drawn with a "needs review" highlight: a wider amber casing.
- `unmatched` and `unknown` features are drawn as they are today.
- A line with more than one run is drawn as its `runs`, one Pixi feature per run, with IDs like
  `rapid-${datasetID}-${dataID}-run${i}`. Each run is styled by its own status. A run that isn't
  already mapped is bound to its own data (`LineRun.datum`), so it can be selected and accepted on
  its own; already-mapped runs are bound to the line.
- Already-mapped points and areas are hidden the same way, once their matchers exist (Step 8).

The layer remembers, for each Pixi feature, which result (or run) it was last drawn from, and rebuilds
the feature when that changes. It redraws on `conflationchange`. The `isAcceptedOrIgnored` filter
still applies to features accepted or ignored as a whole.

Styles are constants in `PixiLayerRapid` for now, like the rest of the Rapid layer's styles. Moving
them into style data is in the backlog, with the other external-data styling ideas.

### Review queue

`uncertain` features need a person. The queue is a list of them with next/previous navigation, like
working through validation issues. For the current feature, the inspector shows:
- the new feature and its best candidates, with their measures (distance, angle, overlap) and
  the matched OSM geometry highlighted on the map;
- actions: **Accept as new** (joined to the network), **Same as existing** (adds it to
  `ignoreIDs`, so it's hidden from then on), and later **Merge into existing**.

**The queue covers the viewport only.** It lists the `uncertain` features in the current view, and
features in places where OSM data hasn't loaded yet (`unknown`) join it once the data arrives.
Reviewing a whole dataset means panning across it. That keeps the work in line with what's on screen,
and the system never has to load OSM for an entire city.

### Accepting and joining

**Selecting a run.** When a line has more than one run, each run that isn't already mapped carries
its own `GeoJSONData` (`LineRun.datum`): the run's geometry, the source's properties, and its joins.
`PixiLayerRapid` binds the run's Pixi feature to that data, so clicking it selects just that stretch,
the Rapid inspector shows it like any other feature, and **Add This Feature** adds just that stretch.
The selection and inspector code didn't need to change.

**Partial runs.** Accepting builds a way from the run's coordinates and joins each end that has a
`JoinPoint`:
- If `nodeID` is set, the new way uses that existing node as its endpoint (the end node it would have
  created is dropped).
- Otherwise, the end node moves to `loc` and is inserted into the OSM way's segment (`edge`), using
  `actionAddMidpoint`. If that segment no longer exists, for example because the run's other end was
  just inserted into the same segment, the segment that `loc` lies on now is used instead.
- A join that no longer fits the graph (the way was deleted, or `loc` isn't on it anymore) is skipped,
  and the line is still accepted.

**Line ends.** An end of a line that isn't next to an already-mapped stretch also gets a `JoinPoint`
if it lies within `sameDist` of a target line that some rule allows (`target.geometry` and
`target.props`, ignoring `sameKeys`), at any angle. This is how an accepted crossing connects to the
sidewalks at its ends, including sidewalks accepted a moment ago, since those are in `editor_stable`
by then. It does for these datasets what the optional autoconnect step (a power-user setting) does
only for exactly matching nodes and validator fixes; autoconnect still runs afterwards if enabled.

**Plumbing.** `ConflationSystem.getJoins(ds, datum)` returns `{ start, end }` for a run's data, or for
a whole source line that is a single run. `UiRapidInspector` passes that to
`actionRapidAcceptFeature(datum, joins)`. Without `ConflationSystem`, features are accepted as before.

**Bookkeeping falls out of re-matching.** After a run is accepted, the new OSM way is in
`editor_stable`. Recomputing then marks that part of the source line as matched, so it disappears
without any new state in `RapidSystem`. The run's id goes into `acceptIDs` (as with any accepted
feature), which also hides it right away; the source feature's own id goes in only when it is
accepted whole. Undo needs nothing special either: undoing removes the way, `stablechange` fires,
and the run reappears. **Ignore** works on a run's data the same way.

*Caveat:* this works only if the accepted way satisfies some rule's target conditions and `sameKeys`. If the data mapping gives
the new way tags that don't match, the run would reappear after it's accepted. The
`UiRapidDatasetSettings` page should warn when a dataset's mapped tags don't satisfy its own rules.

### Settings UI (`UiRapidDatasetSettings`)

The existing **Conflation Settings** section keeps its heading, the only place in the UI that says
"conflation". The instruction text under it changes from "how new data is merged or filtered where
it overlaps existing data" to a definition in stage words, roughly:

> Conflation compares this dataset with the OpenStreetMap data already on the map. Rapid **matches**
> each new feature with nearby existing features, **scores** how closely they agree, and **triages**
> them as *Already mapped* (hidden), *Needs review*, or *New*. Then you **act**: add what's new,
> and decide on the rest.

The final wording goes through normal string review (`rapid_dataset_settings.conflation.*`). Below
it, the single "Conflation?" checkbox is replaced by:
- a "Match against OpenStreetMap" switch (`ds.conflated`) and a "Show features that are already
  mapped" switch (`showMatched`) ✅
- a table of rules, one row per rule, read like the data mapping table: source → target geometry,
  "Same Tags" (`sameKeys`), and the "same" and "near" distances and angles. "Add Rule" and "Restore
  Defaults" below it. Invalid fields are outlined, and OK stays disabled until they're fixed. ✅
- still to do: source and target property conditions per rule (a simple `key=value` list to start,
  since `PropMatcher.from` already parses that format). Until then, a rule's `props` are kept as they
  are when the row is edited.
- still to do: a live count of features in each status in the current view, so users can tune
  parameters and see the effect right away (the modal covers the map, see the backlog item about
  live tuning)

**Every dataset's rules can be changed, including datasets from services.** The services used to
send data that was already conflated on their servers; that's buggy, and it's being shut down, so
matching in the browser has to work for their datasets too. A custom dataset saves its rules with its
definition; for a dataset from a service or an asset file, the user's changes (color, `conflated`, and
`conflation`) are saved as a `changes` record in the `DatabaseSystem` `datasets` store (see
[`rapid-system.md`](rapid-system.md)).

Clicking OK invalidates the dataset's results, and they're recomputed on the next draw.

Later kinds of matching, beyond line to line (Steps 8 and later):
- **point → point or area:** a source point matches a target point, or a target area by its centroid
  or by containment.
- **area → line:** a source polygon (for example a sidewalk drawn as an area) is reduced to its
  centerline, and that line is matched against target lines.

## Debug overlay (replaces the prototype)

`PixiLayerDebug`'s Microsoft-buildings check is gone; the polygon matcher (Step 8) replaces it. The
debug layer now shows how conflation sees each enabled dataset that has conflation on: a small dot at
every coverage box, colored by status (green matched, amber uncertain, red unmatched, gray
unknown), and a larger blue dot at every join point. The dots draw in a new `debug-over` scene
group, above the basemap, so lines don't hide them. The layer is off by default. Turn it on from the
console with `rapidContext.systems.gfx.scene.enableLayers('debug')`.

## Rollout Plan

Lines come first throughout. Points and polygons follow the same pipeline at a lower priority.

1. **Coverage.** `GeometryPart.computeCoverage(radius)` + `geoMetersToWorld`. ✅ Done.
2. **Design.** This document. ✅ Done.
3. **Core, lines.** `ConflationSystem` with the rules model, the line matcher, measures, scoring, statuses,
   runs and join points. Add segment `index`/`t` to `CoverageBox`. Unit tests against a real
   `EditSystem`. ✅ Done. Only GeoJSON-backed datasets for now: OSM-backed ones (MapWithAI,
   Esri) keep their geometry in a separate graph and will follow.
4. **Drawing.** `PixiLayerRapid` hides matched lines, draws partial lines as runs, and highlights
   uncertain ones. Replace the `PixiLayerDebug` prototype with the debug overlay. ✅ Done, and
   checked in the browser against real OSM sidewalks with a generated in-memory dataset.
5. **Accepting and joining.** Accept with a run, plus joins for partial runs and for line ends. Test
   the guiding use case from start to finish on the synthetic street-grid fixture. ✅ Done.
6. **Settings UI.** In the Conflation Settings section, add the stage-word definition and replace the
   `conflated` checkbox with the rule fields.
7. **Review queue.** List, navigation, inspector comparison, and the "Same as existing" action.
8. **Points and polygons.** Matchers for the other geometry types.
9. **Pre-scored input, and measuring.** Use external scores. Profile a city-sized dataset, then decide
   on incremental invalidation, idle precompute, and moving work to a worker.

## Testing

- `geomCoverageBoxes` / `computeCoverage`: covered (Step 1).
- **All test data is synthetic.** A small street-grid fixture, generated in code, reproduces the
  real-world patterns above: a sidewalk offset 1–2 m from an OSM sidewalk (matched at 3 m, not at
  1 m), a perpendicular crossing (rejected by the angle test), a sidewalk that is partly mapped (one
  matched run, one unmatched run, and a `JoinPoint` on the OSM way), and crossings whose ends meet
  sidewalks. No real agency data goes in the repo.
- Rules: the three requests the shape was designed around (any tagging; both have `highway`; same
  `highway` value), several `sameKeys`, OR across rules, source conditions that fail (New, not "no
  result"), target exclusions, and source conditions checked after the data mapping.
- Triage: a 1.5 m offset is already mapped at `sameDist` 3, near at `sameDist` 1 / `nearDist` 2,
  and new with no near band. A line within `nearDist` but at 40° is new, not
  needs review. Short overshoots at the end of a match are absorbed.
- Drawing: no automated tests (Pixi needs WebGL). Checked in headless Chromium against live OSM data,
  with an in-memory dataset generated from the OSM sidewalks in view. Nothing was committed.
- Invalidation: `stablechange` and `merge` flush results, and a rule change flushes one dataset.
- `unknown`: no result says `unmatched` or `matched` where OSM data isn't loaded.
- Accepting, through the real accept action and a real `EditSystem`: a partial run's data carries its
  joins; accepting the missing part of a sidewalk reuses the existing sidewalk's end node and leaves
  the whole line already mapped; a detour's run adds two nodes to the existing way (both ends on the
  same segment); a crossing joins the sidewalks at both ends; line ends only join allowed targets;
  and a join that no longer fits the graph is skipped. Runs disappear after recompute, and undo
  brings them back.
- Real-data cases, rebuilt synthetically: a run whose join snapped to a node behind a corner is
  trimmed to end beside that node; a 1 cm stub at a junction is already mapped (distance only), and
  a stub with nothing nearby is still new.

## Resolved Decisions (from review)

- **Vocabulary.** The stages are Match → Score → Triage → Act. In the UI, "conflation" appears only as
  the **Conflation Settings** heading, followed immediately by a definition in stage words. Everything
  else says "Already mapped", "Needs review", "New", or uses the stage verbs. Code keeps "conflation".
- **The review queue covers the viewport only,** and waits for OSM data to load. There is no
  whole-dataset queue.
- **Test data is synthetic,** generated in code. No real agency data goes in the repo.
- **The scoring formula follows the server-side tools,** once we have their definition. That work
  doesn't block anything; the provisional formula is in one function that can be replaced.
- **Lines come first.** Points and polygons follow the same pipeline later.
- **Triage uses limits per box, not thresholds on a score** (decided during Step 3, see [Scoring](#scoring)).
  "Near" (needs review) has its own distance and angle; `nearAngle` defaults to `sameAngle` (decided
  during Step 4 testing).
- **Minimum run length.** A run that isn't matched, is shorter than the sample spacing, and sits next
  to a matched run is treated as matched.
- **No minimum line length; stubs are judged by distance only.** Short source lines are kept (some
  are real, like curb-ramp connectors), but a line shorter than `sameDist` skips the angle test.
- **Runs are trimmed to their joins,** so an accepted run ends where it connects.
- **Join points are the most useful part of the visual feedback** (from live testing). The "needs
  review" band stays for now, but may not be needed in the end; `nearDist` equal to `sameDist`
  turns it off.
- **Rule shape: source and target, "same" and "near"** (decided after testing on real data). Rules
  name conditions for each side, `sameKeys` for values that must agree, and two sets of distance and
  angle limits. Every source feature is tested; rules combine with OR. This replaced an earlier
  `match` block that also acted as a filter on the source, which left features that failed it with no
  result at all.
- **No default tag condition.** Without one, a sidewalk rule matches roads, railways and waterways
  (seen on real data). Only the user can say which OSM features are "the same kind of thing", so the
  default rules have no property conditions and the settings UI (Step 6) asks for them.
- **Conflation runs even without a data mapping, for now.** Without a mapping, the new features' tags
  are their raw properties, and rules with no tag conditions match everything nearby. That makes the
  difference a mapping makes easy to show. Whether to require a mapping or only warn is open.
- **OSM targets are resolved to the feature they represent.** An untagged way in a multipolygon is
  really the relation (an area, with the relation's tags). See [Target features](#target-features).

## Open Questions (for review)

- **Scoring details** (being gathered): is the buffer drawn around the source or the target? Is
  overlap measured one way or both ways? How are the parameters combined into a score?
- **`sidewalk=*` on roads.** Should a sidewalk rule also match roads tagged `sidewalk=*`? Those
  features would be `matched` without anything to join to. They might belong in the `uncertain` status.
- **Polygon threshold.** Is intersection ÷ smaller area the right overlap measure for buildings?
- **Data mapping: require or warn?** Should conflation refuse to run without a data mapping, or run
  and show a warning in the settings UI?
- **Stubs next to a matching line.** Because stubs are judged by distance only, a real stub that sits
  within `sameDist` of an allowed target (e.g. a 2 m curb-ramp connector running from an OSM sidewalk
  to the curb, tagged like a sidewalk) counts as already mapped. Options: skip the angle test only
  where the heading is truly meaningless (well under 1 m), or tell such stubs apart by tags with
  `sameKeys` or `target.props`.
- **Merging short edges.** Network data split at every node loses context when matched edge by edge.
  Matching chains of consecutive edges with the same tags might be more robust.
- **Debug dots for absorbed boxes.** The overlay shows each box's raw status, so a box absorbed into
  a matched run still shows yellow or red. Color it like its run, or mark it distinctly?
- **Which graph.** `editor_stable` is proposed. Is there a case where conflation must reflect
  edits still in progress (`editor_staging`)?
