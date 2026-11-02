# Graph Versions and Geometry Design

How `Graph` keeps versions of the data, and where the things computed from a version live: geometry,
memoized answers and spatial indexes. Today they're written onto data objects that every version
shares, and keeping a version costs time and memory that grow with the size of the edit, not the size
of the change. This design fixes findings 1 (shared geometry) and 2 (the wrong spatial index) of the
[validation audit](validation-system.md#the-october-2026-audit), the bugs listed below, and the cost of
keeping versions. It gives Rapid one way to ask for anything's geometry: `graph.geometry(entity)`.

> **Status:** In progress (October 2026): steps 0-4 done. After step 3 the rest was put in a new
> order (November 2026): backups first, then derived data in records in two steps. Measured in two rounds: a survey of
> today's costs and bugs, then three competing designs, each prototyped and reviewed for correctness
> and for performance (in JavaScriptCore and V8). See [Open questions](#open-questions).

## Words used here

- **Geometry** (`modules/lib/Geometry.ts`): an entity's shape, kept in WGS84 (`orig`) and in world
  coordinates (`world`, z16), with extents and `GeometryPart`s (and their lazy hulls, centroids, …).
- **Graph** (`modules/lib/Graph.ts`): a version of the OSM data. Every graph reads as one consistent
  version. Only staging and scratch graphs are written to.
- **Base**: the downloaded data, shared by every graph of a data source.
- **Derive**: make a graph from another (`new Graph(other)`).
- **Commit** (`graph.commit()`): recompute what changed since the last commit. This is about the
  graph's caches, not `editor.commit()`, which adds an edit to the history.
- **Rebase** (`graph.rebase()`): add downloaded entities to the base, as if every graph had them all
  along.
- **L**: the number of entities a graph has changed from base. It grows with the session's edits.
- **Lineage** (new): one data source's base, plus what all of that source's graphs share.
- **Record** (new): what one graph says differently from base about one ID.
- **Closure**: everything a change can affect, which a commit recomputes (today's
  `Difference.complete()`).

## The problem

### Derived data is written onto shared objects

Entities are immutable: changing one makes a new object. But a way's or relation's geometry depends on
more than the object: on its child nodes, which live in the graph, and on its tags (removing
`barrier=fence` and adding `building=yes` turns a line into an area). So `commit()` recomputes the
geometry of what changed, and the code making changes decides when to commit, so the work is batched.

The bug is **where the result is written: onto the entity object, which every graph that has the
entity shares.** A way the user hasn't touched is one object, in base, stable, staging and every graph
in the history. The user moves one of its nodes, and the staging commit recomputes the way's geometry
onto that shared object, so base and stable see the moved shape too. Whoever wrote last wins, for
every graph: `commit()` and `rebase()`, `MapSystem` on every `stagingchange`, `SchemaSystem`'s hack,
`MapWithAIService`, and validators' scratch graphs.

**Memoized answers have the same problem.** `entity.transient(name, fn)` memoizes answers on the
object, and many take a graph: a node's point or vertex, `isEndpoint`, `isShared`, `isInteresting`,
`parentIntersectionWays`, `isOnAddressLine`; a way's and a relation's GeoJSON; `presetMatch`. The first
graph to ask decides the answer for every graph. They moved there from a memo table per graph in
59b8558a, because a table that starts empty in every new graph was too slow; they need to be right
per graph without losing that.

They're also slow to hit: `transient()` builds an `${id}v${v}` key string on every call (100-430 ns).
With the key already built, the same lookup takes about 15 ns, and a Map or WeakMap keyed by the
entity takes 5-6 ns (V8). An APP pass at z17.5 in central Paris makes about 88k of these calls.

### Keeping a version costs O(L)

- Deriving a graph copies three Maps of local changes: 0.35 ms at L=10k, 2 ms at L=50k (V8).
- `commit()` runs a `Difference` over both graphs' local caches and then copies the graph as
  `previous`. A Difference costs about 100 ns per entity at L=10k, and more per entity beyond that
  (38 ms at L=100k).
- A drag pointermove runs 3 Differences and 3 snapshots, plus 4 more snapshots for a multipolygon
  member, through `osmJoinWays`. A discrete edit runs 6-7 Differences (plus one in validation) and 5
  snapshots. At L=10k, Differences are about 92% of moving a building (MoveMode), and nearly all of
  dragging one of its vertices.
- Every graph in the history keeps its own copy of all edits so far, plus `previous`: 861 MB of heap
  (8.0M Map entries) after accepting 200 roads of 99 nodes each (L=20k).
- Every tile merge fixes up every history graph's parent sets (`_updateRebased`): 57-74 ms at 300
  edits. `ValidationSystem` walks every edited ID on each merge (`_validateEditsNearAsync`). `toBackup`
  walks every history graph's local cache: 815 ms after 200 roads.
- A validator's scratch graph copies and commits L: 12-266 ms per validated way.
- `EditSystem` keeps three full OSM spatial indexes (base, stable, staging). On a synthetic base of
  220k entities they took 88 MB and another 117 MB, and every merge inserts into all three.

### Bugs found while measuring

| Bug | What happens | Fixed in step |
|---|---|---|
| A stale `isInteresting` memo, and `complete()` leaving out the members of non-multipolygon relations | Straighten deletes a node just added to a bus route as a stop, and the route with it if that was its only member | 0 (memo), 1 (`complete()`) |
| Shared geometry | Validators on stable judge staging's shapes; undo leaves a way's extent where its node was moved | 4 |
| Graph-dependent memos on shared objects | `presetMatch`, point or vertex, `isEndpoint` answer for whichever graph asked first | 2 |
| The staging index syncs before geometry is recomputed | After undo, revert or MoveMode a feature keeps a stale box and disappears | 1 |
| Rebase leaves geometry stale, in both directions | A multipolygon whose members arrive in later tiles keeps the first tile's shape and box; a new way through a node the user moved gets the base shape in stable and staging | 5 |
| Nested relations | An action's commit builds a relation before a member relation (a country boundary before its state subarea) and leaves it stale; only `MapSystem`'s second recompute repairs it | 1 |
| In-place writes to shared objects | `toBackup` and `toIntroGraph` round live node locs, and `toIntroGraph` rewrites live relation members' IDs; `UiMeasurementCard` rewinds memoized GeoJSON; `OsmRelation` writes `role` onto members' memoized GeoJSON; `editor.changes(action)` changes the stable history graph | 0 |
| `context.copyGraph` is the live staging graph | Copy a feature, delete it, then paste: `OsmEntity n1 not found`. Edit it before pasting, and the edited shape is pasted | 0 |
| `Geometry.setData` resets parts in place | Pixi features hold emptied parts | 0 |
| `_connectSplitWays` changes `props.nodes` in place | The dataset's parent ways never learn the new nodes; the feature disappears after a zoom | 0 |
| `SchemaSystem`'s hack | Recomputes everything under an empty schema (buildings become lines and stay lines); `schemachange` clears no memos | 5 (memos in 2) |
| Old stable graphs use staging's index | `almost_junction` throws (`OsmEntity w-10 not found`), so the way loses its `almost_junction` issues; `crossing_ways` misses crossings; `close_nodes` reports nodes that aren't in the graph | 0, by construction in 6 |
| `FilterSystem._cache` | Its invalidation never clears anything | 0 |
| `PixiLayerOsm._midpoints` | Never set, so every frame makes new midpoint data | 0 |
| `merge_remote_changes` rebases from staging | No `merge` event, and the indexes aren't updated | 5 |
| A forced update of a way the user deleted (the uploader keeping a deletion) | `staging.parentWays(node)` throws `OsmEntity w1 not found` | 3 |
| O(L) bookkeeping per perform | 10k `editor.perform` calls take about 17 s | 1, 3 |

## What we keep

- **Cached world coordinates.** Before them, code moved points around in loops, projected and
  unprojected to screen coordinates (different whenever the viewport changed), and made a lot of graph
  copies. Code reads cached world coordinates; it doesn't project in a loop.
- **The code making changes decides when to recompute.** `commit()` (and `rebase()` for downloaded
  data) is where Rapid decides what's out of date: what changed in value (loc, nodes, members or tags,
  compared as `Difference` does today) and everything that depends on it. Beyond that we don't judge
  whether a change "matters": a changed child or member means recompute.
- **A node's geometry is always current**, and a validator can rely on the geometry of the graph it's
  given being current. If it isn't, that's a bug in the code that handed it over.
- **Versions as the API.** The rest of Rapid keeps calling `hasEntity`, `parentWays`, `childNodes`,
  `replace`, `commit` and `rebase`. The 46 commit calls in actions (38 files) run unchanged.

## Design

### 1. Graphs share structure

Today a derived graph copies its parent's local Maps. Instead, the graphs of one data source share
structure, like the persistent data structures of functional languages:

- A **lineage** per data source holds the mutable base (today's base cache: entities, parent ways and
  relations), the base's derived data, the spatial index, and a **slot table**: a native Map from ID
  to a small integer, given out the first time a kept graph writes that ID.
- A **graph** is an immutable tree of **records**: a 32-way persistent vector indexed by slot. A record
  holds what that graph says differently from base about one ID: its entity (or that it's deleted),
  the overridden ways and relations that contain it, its geometry, its memoized answers and its
  version.
- **Reading** is `slots.get(id)`. An ID no kept graph has written misses and goes straight to base.
  Otherwise at most 4 array loads find the record.
- **Deriving** shares the tree: O(1). **Writing** copies the path to the slot (at most 4 arrays of 32),
  or changes it in place while the graph still owns those tree nodes, because nothing else has seen
  them.
- **Comparing** two graphs walks both trees and skips the subtrees they share: O(changes). That
  replaces every `Difference` scan, every snapshot and `previous`. `Difference` keeps its API and its
  meaning (entity values compared as today); the walk only finds the candidates.
- **History** keeps what each version changed, and shares the rest: O(changes).
- **Parent ways** are base's parent ways that this graph doesn't override, plus the overridden ways
  its record lists (the same for relations). A merge never patches a graph's parent sets, so
  `_updateRebased` goes.

Rules that keep it correct:
- Only the graph that owns a tree node may change it in place. Deriving gives both graphs new owner
  tokens, so neither changes what they share. (Emitting and pushing into the history don't need to:
  a graph that's been emitted or pushed is either derived from right away or frozen.)
- History graphs are frozen: `replace`, `remove`, `revert` and `load` throw on them. Only a rebase's
  fix-ups (section 5), iD#2085 restores included, may rewrite one.
- A record that says nothing different from base (after a revert) is cleared, not kept.
- Slot pollution by graphs that are never kept (validators' scratch graphs, `disabled()` checks)
  turned out small once writes that change nothing were skipped (step 0): validating a whole real
  tile gave out 64 slots. In the prototype, merge-time validation alone gave slots to a quarter of
  a synthetic base, mostly through such writes, so a small overflow Map for scratch graphs was
  planned; it isn't needed.
- A graph's first write of a way or relation costs its length, not O(1): each child's record lists
  the graph's own parents (all of them, since base's record of that parent no longer counts).
  Storing only the parents added and removed compared with base would make it O(1), but then a
  forced rebase of a way a graph overrides would need fix-ups again.

**Why a slot vector and not a hash trie keyed by ID.** JavaScript can't reach the engine's cached
string hash, so a hash trie hashes the ID itself. In JavaScriptCore that made lookups 2.4-3.8× slower
than a Map (about 5× on hits), with 1.5-3.2× the slot vector's memory. The slot table lets the engine
hash, and doubles as a filter for IDs nobody has edited.

**Measured** (prototype, JavaScriptCore, L=10k): lookups of mostly-base IDs 15 vs 14 ns in order and 36
vs 35 ns shuffled; in V8 46-47 vs 45-47 ns. Derive 0.1-0.2 µs vs 86 µs (0.35 ms in V8). A diff of one
change 0.6 µs (0.6-2.3 µs from L=1k to 100k), vs 1.1 ms for today's Difference at L=10k and 38 ms at
L=100k.

### 2. Commit after the actions

- `EditSystem._perform` runs the actions, then commits staging (before step 1 it committed *before*
  them, and actions don't always commit at the end). `stagingchange` always arrives with staging's
  derived data current, so `MapSystem` stops recomputing, and in step 6 stops touching.
- If an action throws, `_perform` rolls staging back to how it was when the perform began (a savepoint
  in the journal; six actions commit partway through, so the last commit isn't enough) and rethrows.
  Before step 1 the half-done action stayed in staging, and the next perform committed it into the
  next edit.
- `commit()` builds the closure from what changed in value since its last commit: the changed IDs;
  the old and new nodes of changed ways; a changed relation's added, removed and re-roled members, or
  all of its members when its tags changed or it is a multipolygon; the parent ways of changed IDs;
  and parent relations, recursively. Before step 1, `complete()` added members only for
  multipolygons, half of the straighten data loss. Only multipolygon members get new geometry: the
  others' doesn't depend on the relation. A write that changes nothing (an equal copy) keeps the
  previous geometry and answers.
- Each ID in the closure gets a new record in this graph: geometry recomputed, memoized answers
  cleared, a new version.
- **Relation geometry is built members first**, wherever it's computed: commit, rebase, a graph's
  fix-ups, and the schema recompute. A relation in a membership cycle is built from its leaf members
  with a "seen" set, as `OsmRelation.asGeoJSON` does, never from a member relation's stored geometry.
  Today `MapSystem`'s second recompute repairs nested relations that a commit built in the wrong order,
  so removing it needs this.
- Inside an action, before its commit, way and relation geometry is as of the last commit (node
  geometry is always current). Code that reads geometry after changing the graph commits first, as
  autoconnect already does. Memoized answers are only read and stored on committed graphs. A graph
  with uncommitted writes computes them directly.

### 3. Where derived data lives

Each answer lives with what it depends on:

| Derived data | Depends on | IDs the graph hasn't changed | IDs the graph changed |
|---|---|---|---|
| Node geometry | the node object | on the node | on the node |
| Way and relation geometry | the object, its nodes or members, area keys | on the base object | in the record |
| Topology answers: point or vertex, `isEndpoint`, `isShared`, intersections, `isOnAddressLine`, filter matches | parent ways and relations, and their tags | on the base object | in the record, stored on first read |
| Object-only answers: line or area, the segment list | the object, the schema | fields on the object, stamped with the schema generation | same |
| `presetMatch`, `vertexMatch` | tags, plus point or vertex, address line and location from the graph | on the object, keyed by those inputs and the schema generation (preset location sets only change when the schema merges) | same |
| `isInteresting` | relation membership, tags | not memoized (0.17 µs; it guards deletions) | same |
| Hull, centroid, POI, area, coverage | one part's shape | on the immutable `GeometryPart` | same |
| Version ("rerender it") | all of the above | the object's `v` or the base's | in the record |

- **The base's derived data lives on the base object.** A base object belongs to one lineage, which
  is the only writer of those fields (at rebase and schema changes). A separate base map would add a
  second lookup by ID to every read; the draft's `base.geometries` measured 2-3× today's read.
- **Memoized answers survive new graphs.** A derived graph shares its parent's records, so it
  inherits every memoized answer in O(1), and a commit clears only its closure. In V8, an APP pass
  takes 48 ms today, 34 ms with memos kept on the object, 54 ms with a memo table emptied for every
  graph, and 64 ms with no memos.
- **Geometry is never changed after it's stored.** A recompute makes a new `Geometry`, so graphs can
  share one, and Pixi features can keep their parts. `GeometryPart.setData` stops `structuredClone`ing
  arrays its caller just built (46-59% of a way's recompute). It copies the coordinate pairs instead,
  so a node's `loc` is never aliased. Coverage boxes move to a side table so dev builds can freeze
  parts. `OsmNode` computes its geometry once, not twice.
- **Relation geometry is built from its members' geometry, never a copy of it** (decided October
  2026). Today a relation's `Geometry` copies every member's coordinates, and `commit()` and
  `rebase()` rebuild every relation whose members changed: dragging a vertex of a street in 70 bus
  routes rebuilds all 70 on every pointermove (16 ms in V8), though route relations aren't drawn, and
  each version would keep about 13 MB of route shapes for that street.
  - A relation other than a multipolygon references its members' `GeometryPart`s (immutable from
    step 2), and its extent and index box are the union of theirs. Building it means gathering
    references, so the 70 routes cost about 70 box unions. Nested relations gather from their member
    relations, members first.
  - A multipolygon still joins its member ways into rings, from their coordinates. Which ways go in
    which ring, in what order and direction, depends only on member and node IDs, so that ring
    structure is cached and reused while only coordinates change: a vertex drag re-reads coordinates
    instead of joining again. Today joining is nearly all of the Louvre's 42.7 ms per recompute (V8).
  - Multipolygons stay computed at commit and rebase: they're drawn every frame, as areas with holes.
  - If other relations still cost too much before composition lands, they can be built on first
    read instead of at commit (index box from the members' boxes) as a stopgap. On shared objects
    that's only safe for a graph whose shape nobody else reads, so prefer landing composition.
- **`graph.geometry(entity)`** works for nodes, ways, relations and later any data. It takes the
  entity, like `parentWays` and `childNodes`, and answers for this graph's version of `entity.id` (dev
  builds assert it's the same object). Callers with only an ID use `graph.geometry(graph.entity(id))`.
  `graph.extent(entity)` replaces `entity.extent()`. For a node it's an `instanceof` check (free) and
  the node's own geometry: a node's shape depends only on the node, so it's never stored per graph.

### 4. Rendering: `v` still means "rerender it", per graph

`graph.version(entity)` is the record's version, else the base's, else `entity.v`. It changes whenever
something meaningful about the entity changes in that graph: its props (a new object, as today), or
its geometry or topology (a new record, at commit or rebase).

- `PixiLayerOsm` keeps its `feature.v !== version` checks, with `graph.version(entity)`, and binds
  `graph.geometry(entity).parts[i]`.
- Undo works by construction: the older graph's records carry their own geometry and older versions.
- `stagingchange` carries the IDs whose records changed, and `merge` the downloaded IDs plus every ID
  whose base data changed. `MapSystem` marks them dirty and redraws. That covers changes in topology
  only (a vertex becoming shared, a new multipolygon member).
- `touch()` on an object a graph holds goes (`MapSystem` on `stagingchange`, `EditSystem` at merge,
  `MapWithAIService`). It changes the object, and its key, for every graph that holds it, base
  included.

### 5. Rebase

Rebase belongs to the lineage: graphs aren't passed in.

1. The base entities and parent sets are updated as today, and so is the lineage's index.
2. The base data of everything whose topology the download changed is marked stale: memos cleared,
   version bumped, geometry recomputed (members first). That's the base parents of what arrived (a
   relation whose members arrive in a later tile), and the existing children and members of what
   arrived (a node a new way passes through; for a forced update, the old children and the new).
   Every graph that doesn't override them sees the change at once.
3. Graphs whose own edits interact with what arrived (a new way through a node the user moved, an
   edited relation gaining members) are found through the slot table, in O(arrived × children)
   whatever the history's length. Usually there are none. Such a graph updates its derived data by
   running the commit closure for those IDs: stable and staging right away, and the other graphs
   `EditSystem` keeps (the history, its checkpoints, the return edit) when undo, redo or a revert makes
   them current. Their entities don't wait: the restores in item 4 reach them at once. A graph with
   uncommitted writes keeps them pending.
   - **No other graph is updated** (decided November 2026). Rebase and every validator call are
     synchronous, so a graph only lives through a rebase if it's held across an `await` or an idle
     callback. Validation doesn't hold one: each chunk of jobs reads `cache.graph` when it runs, and
     `_head.graph` follows stable (`validateAsync` runs on every `stablechange`, and a merge rebases
     stable before the chunks after it run). The older stable it keeps (`_headQueuedGraph`) is only
     diffed, by entity. Today the one graph held across awaits is the uploader's remote graph, which
     reads entities only: it sees base's new entities, as today.
   - So derived data from a graph that missed a rebase is never read, and dev builds assert that on
     `graph.geometry()` and memo reads (each graph remembers the lineage's rebase count when it was
     last brought up to date). `hasEntity` has no such check: reads stay as cheap as they are.
   - A validation worker, if validation moves to one, isn't affected: it can't share these objects, so
     it validates its own copy of a slightly older stable.
   - The earlier plan updated any other graph "on first use", which needed a check on every read.
4. iD#2085: a node that a graph deleted comes back when a downloaded way uses it, unless that graph
   deleted the way too. This applies to every graph, redo graphs included. Restored IDs go into the
   next emit and the session difference (section 8).

Measured (prototype, an 11k-entity tile with 5 new ways through nodes the user moved): the rebase and
staging's update take 16.5-19.2 ms, against 14.5-17.7 ms for today's rebase with a 12-graph history.
The difference is that it doesn't grow with the history: in a separate benchmark with 300 edits,
today's `_updateRebased` alone takes 57-74 ms per merge.

### 6. When the schema changes

- Every `schemachange` bumps a schema generation. Memoized answers that read the schema recompute when
  they see a newer one.
- Geometry is checked only after a schema load finishes. `resetAll`'s emit with an empty schema is
  ignored, and the check is skipped when the area keys and area rulesets didn't change. NSI's merge
  can't change area keys (`areaKeys()` skips suggestion presets), so it costs only the generation bump.
  A full recompute would take about 0.6 s in central Paris.
- The check compares each way's stored type (line or area) with the new answer. That catches geometry
  built during a schema load too, while there were no area keys. Checking every way is estimated at
  about 7 ms in JavaScriptCore and 15 ms in V8 for 31k ways.
- A way that flips is recomputed, then its parent relations, transitively and members first. A graph
  holding records for one updates them the same way as for a rebase: stable and staging at once,
  the other graphs `EditSystem` keeps when they become current, and only on committed graphs.
- `SchemaSystem`'s hack goes.

### 7. Spatial indexes for any graph (finding 2)

- One OSM index per lineage (and one for segments), built from the base data. The lineage updates it
  inside every rebase, so a rebase from anywhere (a merge, a restore, the uploader) is indexed. Items
  carry IDs, and hits are resolved through the graph being queried.
- Small overlays for stable and staging hold the boxes and segments of what they changed, updated from
  each emit's diff.
- A query on stable or staging takes the base hits for IDs that have no entity or geometry record in
  that graph, plus its overlay. For any other graph (an older stable, a graph inside an action, a
  scratch graph), it takes the nearest overlay, corrected by the diff between that overlay's graph and
  this one: drop what changed, and test the changed entities directly. Since step 3 that diff is
  structural, so the correction starts without a cache; one keyed by graph, overlay version and
  rebase can come later if measurements ask for it. Queries need a committed graph.
- `spatialIDForGraph` and its fallback to staging go. A graph from another lineage throws.
- This isn't the old `Tree`: nothing flips to match the graph asked. Overlays update incrementally, and
  another graph costs its distance from the nearest overlay (10-40 µs for 50 changes).
- Measured (JavaScriptCore, synthetic): an 8.2k-hit query takes 0.21-0.27 ms, against 0.09 ms for a
  full copy. A view of central Paris would pay about +0.3-0.5 ms per frame (estimate). An overlay
  builds in 1.4-6.5 ms, against 47-62 ms per full copy. Two of the three index copies go (117 MB for
  a synthetic 220k-entity base), and with them two thirds of the index work per merge.

### 8. EditSystem

- Emits diff the graph emitted last against the current one: O(changes), with no snapshots or keys.
  `EditSystem` keeps the changes it hasn't emitted yet across commits, so an emit after a transaction
  (paste, drawing, the entity editor, Autofix All) covers everything since the last one.
- **The session difference (base to stable) is kept up to date** from every change to stable's
  entities, including a merge's iD#2085 restores. A forced update rebuilds it, as `updateBase` does
  today. It keeps an iterable set of the edited IDs:
  - `ValidationSystem`'s "did the user change this" check (`_completeDiff`) only calls `.has()`, so
    that becomes a lookup.
  - `_validateEditsNearAsync` walks every edited ID on each merge. From step 9 that walk becomes a
    query of the stable overlay over the merged area.
  - The summary count (`UiSaveTool`, `UrlHashSystem`, `UiSectionValidationStatus`) is kept
    incrementally, and the save panel's list is computed when shown.

  Before step 1 the difference, `complete()` and `summary()` were rebuilt on every stable change: 18 ms
  at L=10k and 107 ms at L=50k in V8. Since step 1 only `complete()` and `summary()` are rebuilt, when
  asked for, and `validateAsync` asks for `complete()` on every stable change: 6.7 ms and 2.3 ms at
  L=20k (Bun, after step 3). Step 5 makes them incremental.
- An edit's extent comes from the entity diff, not the record diff: moving a node on a country border
  mustn't zoom undo out to the whole country.
- `editor.changes(action)` runs on a derived graph.
- Validation runs on base and the current stable (`_head.graph` advances when stable changes during a
  round).
- Backups (v4, rewritten in step 5) save each edit's own changes, taken from the entities in its
  records, never by recomputing geometry or memos. The result is cached on the edit, and dropped when
  a rebase changes that graph's entities (an iD#2085 restore, a forced update). Restore is
  O(changes). v3 backups still restore.

### 9. Other data

- One lineage per Rapid dataset, in place of `MapWithAIService`'s `Graph` per dataset.
  `_connectSplitWays` makes a new survivor way with `update()` and force-rebases it, instead of
  changing `props.nodes` in place.
- GeoJSON and markers get lineages with only a base. Their geometry depends only on the object, like
  a node's, so `graph.geometry(data)` returns its own. Services stop changing data in place; they
  rebase updated objects instead.
- Conflation: if Rapid features get versions of their own (accepted pieces, partial accepts, undo),
  their lineage gets records too, with nothing new to build.

## What it costs

| | Today | Prototype |
|---|---|---|
| Drag a building vertex, L=10k / 50k | 3.1 / 21-48 ms | 0.02 / 0.03 ms |
| Drag a vertex of a 2,010-node multipolygon, L=10k | 10 ms | 3.3 ms (the multipolygon recompute itself) |
| A discrete edit, L=10k | 36-41 ms (22-27 ms without the session summary) | 0.25 ms, or 13 ms while the summary is O(L) |
| A validator's scratch graph, per way, L=10k / 50k | 78-86 / 266 ms | 0.05-0.07 ms |
| An APP pass at z17.5, central Paris (V8) | 48 ms | about 35-38 ms (estimate) |
| A tile merge with a 300-edit history | 119-136 ms | about 32-36 ms (estimate, synthetic tile without relations) |
| Heap after accepting 200 roads (one harness) | 861 MB | 41 MB, of which 31 MB is the entities themselves |

Graph work in JavaScriptCore unless noted. The reviews re-ran the key paths in V8 (Node 22): the
journal's drag win holds (0.03-0.08 ms against 3.7-21 ms), and slot-table lookups match today's Map
lookups. Big relations stay expensive: one recompute of the Louvre's multipolygon takes 42.7 ms in V8
(Chrome, real Paris data); see open questions.

## Alternatives considered

- **The first draft**: `base` and `local` geometry maps in `GraphCache`. Every read pays a second
  lookup (2-3× today's), and copying `local.geometries` into every graph doubles history memory.
- **Evolve today's Graph**: a change journal, plus per-graph maps of geometry overrides and topology
  stamps. The journal is right and is step 1 here. But every per-graph map is copied on derive and
  kept by every graph in the history. That cost 13 MB per edit for a street in 70 bus routes; stamp
  maps grew to 10-40× L after tag edits; and a merge whose tile overlaps edits allocated for every
  history graph (+600 MB per merge, 5× slower, in V8). Fixing those needs structural sharing, which is
  this design.
- **One materialized head, other versions as deltas**: undo moves the head, and history is kept as
  deltas (JOSM's idea, with Rapid's versions kept as the API). It's fastest at the head, but
  everything else got slower. A scratch graph over base rebuilt a map of every history delta (0.8-8.7
  ms against 0.02-0.04 ms). On an older version, parent lookups for nodes of ways changed since were
  58× slower with 2,000 changes in between, and grew with the distance. And one shared head widens the
  damage of any bug. Its best ideas are kept: slim nodes, parent lookups that don't allocate,
  `presetMatch` keyed by its graph inputs, and indexes in layers.
- **JOSM's model** (one mutable dataset plus a command history): Rapid reads several versions at once.
  It renders staging while validating stable, runs what-ifs inside actions, and uploads a fixed
  version. Each of those would need a snapshot, which is a version store again.
- **No memo tables** (compute topology answers directly): about 2× an object memo in V8, so an APP pass
  of about 41-46 ms instead of about 35-38 (both estimates).

## Who reads geometry today

An inventory of `modules/` (October 2026), to size the change. **135 call sites in 66 files** read or
write cached geometry outside `modules/data/`:

| | Sites | Graph in scope | No graph |
|---|---|---|---|
| `.geoms` reads | 103 | 51 | 2 OSM, 8 mixed, 42 GeoJSON/markers |
| `.extent()` / `.intersects()` | 20 | 16 | 1 OSM, 2 mixed, 1 GeoJSON |
| `.updateGeometry()` | 12 | 6 (OSM) | 6 (GeoJSON/markers, in services) |

- **OSM readers almost all have the right graph already.** 73 sites do; 3 more need one passed in
  (`move`'s `nodeLocal`, `SelectBehavior._doDoubleClick`, `MapSystem.selectEntityID`). By area:
  rendering (`PixiLayerOsm`), actions (18 sites in 10 files), validators (11), modes (11), UI (5),
  `intersection.ts`.
- **About 30 of the reads (29 sites) are a node's world coordinates** (`geoms.parts[0].world.coords`),
  the biggest group. Reading them from a field on the node takes about 5 ns, against 49 ns through
  that chain.
- **Mixed sites (10) read Rapid features**, which are OSM entities in `MapWithAIService`'s graph for
  their dataset, not staging, next to GeoJSON and markers: `PixiLayerRapid`, `SelectMode.enter`,
  `UiSectionSelectionList`, `UiRapidInspector`. They move to their dataset's graph in step 2.
- **GeoJSON and markers (49 sites)** have no graph: the photo, notes and QA layers, custom data,
  `VectorTileService`, `ConflationSystem`. Step 10.
- **Indirect readers:** `AbstractData.extent()` (WGS84 `geoms.orig.extent`), with 19 direct callers,
  plus `utilTotalExtent` (16, all pass a graph) and `ValidationIssue.extent(graph)` (4).
  `SpatialSystem.replaceData` takes every index's boxes from `geoms.world.extent`.
- **Rendering keeps `GeometryPart` references.** Pixi features bind `entity.geoms.parts[i]` and rebind
  when `entity.v` changes; `PixiLayerLabels` reads them too. They'll bind
  `graph.geometry(entity).parts[i]` and rebind when `graph.version(entity)` changes.

## Rollout

Each step ships on its own and leaves the app working, with tests that pin what it fixes. Steps 1 and
2 are needed whichever storage we end up with; step 3 is the big one.

0. **Pin the bugs, and fix what doesn't need the design.**
   - Port the repros to unit tests, marked todo until their step lands.
   - `isInteresting` stops being memoized (the data loss).
   - `toBackup` and `toIntroGraph` copy locs before rounding, and `toIntroGraph` copies relation
     members before renaming their IDs. `UiMeasurementCard` rewinds a copy; `OsmRelation` sets `role`
     on a copy; `editor.changes(action)` runs on `new Graph(stable)`; `context.copyIDs` keeps
     `new Graph(staging)` instead of the live staging graph, and paste centers on the copied nodes'
     locations rather than a way's shared extent.
   - `_connectSplitWays` uses `update()` and a forced rebase.
   - `updateGeometry()` stores a new `Geometry` instead of resetting the old one.
   - `MapSystem` clears the filter cache before touching; `PixiLayerOsm` keeps its midpoints.
   - `actionSyncCrossingTags` and `outdated_tags` skip writes that change nothing.
   - `ValidationSystem` validates the current stable; `waySegments` and `close_nodes` resolve hits
     through the graph.
1. **Change journal, on today's storage.**
   - Graphs record what they change since their last commit, and `commit()` builds its closure from
     that, with the members of changed relations. `previous` and its snapshots go. History graphs are
     frozen.
   - An iD#2085 restore during a merge is a recorded write (the one write a frozen history graph
     accepts), and its IDs go into the next emit.
   - `_perform` commits after the actions, and rolls staging back if an action throws. `EditSystem`
     emits from the journals (same `Difference` API and meaning), keeps unemitted changes across
     commits, and recomputes the emitted set's geometry before syncing the staging index. `MapSystem`
     stops recomputing. Relation geometry is built members first.
   - The session difference is kept up to date incrementally.
   - This removes the O(L) Differences per perform and edit and fixes the stale staging boxes. It
     also halves the history's maps (846 to 430 MB after 200 roads, measured in another harness).
   - **Done.** At L=10k (Bun, no validation or backup), a DragNodeMode pointermove went from 3.2 to
     0.03-0.07 ms and a discrete edit (perform and commit) from 7.5 to 0.1-0.2 ms. A MoveMode or
     RotateMode frame reverts first, and each revert derives a new staging graph, an O(L) copy until
     step 3: about 0.2-0.3 ms. Decisions made while landing it:
     - A throwing action rolls staging back to the start of the perform (a savepoint), not to its
       last commit: six actions commit partway through.
     - `complete()` doesn't depend on the order of the changes any more (a parent already in the
       result is still recursed from). A changed relation brings its added, removed and re-roled
       members, or all of them when its tags changed. For a commit, members of relations other
       than multipolygons aren't recomputed: their geometry doesn't depend on the relation.
     - A nested `OsmRelation.asGeoJSON` call doesn't use the member relation's memo, so cycles are
       right in any order.
     - When staging is replaced (undo, redo, revert, commit), the emit recomputes what differs from
       the graph whose shapes the shared objects hold. Graphs track which one recomputed last (the
       lineage's `geometryWriter`): usually it's the graph emitted last, so a commit recomputes
       nothing. Otherwise (a transaction that committed, then undid), it recomputes everything
       written since the last emit.
     - Multipolygons are built before other relations, since their shape comes only from ways.
     - The rebase reaches every graph we may return to: the history, the checkpoints' histories,
       the return edit and staging. Restores emit right away.
     - `osmJoinWays` copies the graph only when it reverses a way, and `snapshot()` is gone.
     - Still O(L): deriving a graph (each revert, undo, redo and commit), until step 3. Lazily and
       at most once per stable change or merge: the session difference's
       `complete()` (read by `ValidationSystem` to credit the user's issues) and `summary()` (the
       save count). Making them incremental is the next step for long sessions.
2. **Immutable geometry, memos without key strings, `graph.geometry()`.**
   - A recompute stores a new `Geometry`, without `structuredClone`; node geometry is built once.
   - Relations other than multipolygons reference their members' parts instead of copying them
     (section 3). Multipolygon ring reuse is a follow-up, measured on its own.
   - A schema generation, bumped on every `schemachange`. `transient()` goes. Object-only answers
     become fields stamped with the generation, and `presetMatch` and `vertexMatch` are keyed by their
     graph inputs and the generation.
   - A set in the base cache lists the IDs whose topology any graph has changed: every commit adds its
     closure. Outside the set, the topology answer stored on the base object holds for every graph.
     Inside it, answers are computed directly until step 7 stores them in records. Rebase clears the
     answers of everything whose topology it changed (section 5).
   - `graph.geometry(entity)` and `graph.extent(entity)` arrive, returning what `entity.geoms` has for
     now. Readers move to them: validators and `ValidationSystem` first, then the index sync, actions,
     modes, rendering and UI. Rapid features (`PixiLayerRapid`, `SelectMode`,
     `UiSectionSelectionList`, `UiRapidInspector`, the dataset's index) use their dataset's graph.
   - This fixes the memos that answer for the wrong graph, and should cut an APP pass by about a
     quarter (estimate).
   - **Done.** Measured in Bun: memo reads (point or vertex, `isEndpoint`, line or area) 3.4× faster
     (42k reads in 0.57 instead of 1.94 ms); a drag pointermove on a street in 70 bus routes from 4.03
     to 0.20 ms. How it landed:
     - `entity.memo(graph, key, fn)` replaces `transient()`. Each object has its own memos (a copy
       starts without), dropped when the schema's `generation` changes. An answer that depends on a
       graph is memoized only when `graph.canShareAnswers(id)`: the lineage's set of IDs whose
       topology a commit changed doesn't have it, and the graph has no uncommitted writes.
     - `presetMatch` is memoized per geometry (point, vertex, line, area), so it answers for whichever
       graph asks; `vertexMatch` reads the address line from the graph each time.
     - A rebase clears the memos of the children and members of what arrived (and of the copies a
       forced rebase replaced), and of the ways and relations (recursively) that contain it. An
       arrived way through a node some graph changed joins the set.
     - Scratch copies that commit (`outdated_tags`, `ambiguous_crossing_tags`, `actionJoin.disabled`)
       add their closures to the set for good, and become `geometryWriter`, which skips step 1's
       fast path on the next undo or redo. Measured on a Tokyo tile, validating everything marked
       36 IDs, so it's left as is; `geometryWriter` goes in step 6, and the set in step 7.
     - Copies share their `Geometry` (a recompute stores a new one); a node copied at the same
       location keeps it. Destroying a data element doesn't destroy its `Geometry`, which copies and
       relations may share.
     - Readers moved, including Rapid features through `mapwithai.graph(datasetID)`. What still reads
       `.geoms` directly is GeoJSON and markers (step 10) and `SpatialSystem.replaceData` (step 9).
     - For step 6: `move`'s `removeDuplicateVertices` reads the geometry of a node it just removed,
       and `outdated_tags`, `orthogonalize.disabled` and `move` read geometry from graphs with
       uncommitted writes; records must cover those. `presetMatch` also depends on the entity's
       location (preset location sets), which isn't in its key: today `updateGeometry` clears it,
       but once a shared way can have different shapes per graph, key it by location too (or by
       the location sets there).
3. **Graphs share structure.**
   - Lineage, slot table, and records with entities and parent lists. Derive is O(1); diffs are
     structural; parent ways use the formula; `_updateRebased` goes (its iD#2085 restores stay).
   - The readers of `graph.local` and `graph.base` move to methods: `UiFeatureList`, `toBackup`,
     `toIntroGraph`, `revert`, `merge_remote_changes`, `missing_tag`, `Difference`, and
     `SchemaSystem.resetAll`'s hack until step 8 removes it.
   - Benchmark lookups, derive, diffs and memory in Chrome first: the prototype was mostly measured in
     JavaScriptCore.
   - This makes derive O(1) and history memory O(changes). In the prototype, the heap after accepting
     200 roads went from 861 MB to 41 MB, 31 MB of which is the entities. It also removes the merge
     fix-ups and the throw after a forced update.
   - **Done.** The benchmark first, in V8 (Node 22, the prototype's code): lookups of mostly-base IDs
     62 vs 57 ns for today's Map at L=10k, and 95 vs 78 ns at L=100k; of edited IDs 27 vs 27 and 58
     vs 44 ns. Derive 0.1-0.4 µs instead of 0.9-12 ms. A diff of one change 0.4-1.7 µs instead of
     0.8-10 ms. The hash trie measured 2-4× slower, so the slot vector stayed. Then the real thing,
     accepting 200 roads of 99 nodes (L=20k), with no validation or backup:

     | | Bun, before → after | V8, before → after |
     |---|---|---|
     | MoveMode frame (revert, then perform) | 1.26 → 0.03 ms | 1.75 → 0.05 ms |
     | Discrete edit (perform and commit) | 1.24 → 0.03 ms | 1.78 → 0.04 ms |
     | Undo and redo | 2.16 → 0.05 ms | 3.46 → 0.07 ms |
     | Heap of the history | 370 → 68 MB | 248 → 82 MB |

     A DragNodeMode pointermove stays at 0.02-0.07 ms (step 1 made it flat).
     How it landed:
     - `modules/lib/PersistentVector.ts`: the 32-way trie with owner tokens. Deriving gives both
       graphs new tokens, so neither changes what they share.
     - `GraphRecord` per ID: `isLocal`, `entity`, and the graph's own `parentWays`/`parentRels` that
       contain the ID. Once a graph has its own version of a way, base's record of that way's nodes
       doesn't count for it, so its own list holds all of the way's nodes.
     - `graph.local` is gone. `graph.isLocal(id)`, `graph.localEntities()` (O(edits), for backups
       and the feature search) and `graph.diffIDs(other)` (structural) replace it; `Difference`
       without candidates uses `diffIDs`. `graph.base` stays: the base cache is shared and mutable.
     - Slots aren't polluted: validating a whole real tile (19.5k entities, every validator) gave
       out 64 slots, so scratch graphs don't need an overflow Map.
     - The cost (review, a real Tokyo tile with 300 edits): reading every ID from a graph with edits
       is about 30% slower (an ID with a slot takes about 27 instead of 10 ns; the base graph pays
       nothing). Whole passes come out even, since `parentWays` no longer copies a Set: a
       render-like pass 1.55 vs 1.80 ms (Bun) and 2.33 vs 2.31 ms (V8); eight validators over the
       tile 67 vs 73 ms (Bun) and 179 vs 168 ms (V8). `parentWays` keeps base's order, with a
       graph's own version of a parent in its place (callers take `parents[0]`).
**The order from here was revised after step 3** (November 2026). Steps 1-3 made an edit itself cheap
(0.04 ms at L=20k), so what's left that a user feels is the backup after every edit, which needs
none of the steps that were before it. Derived data in records was split in two, since each half
pays off on its own and is easier to review and bisect. The old numbers were: 4 derived data in
records (now 6 and 7), 5 rebase (now 8), 6 spatial indexes (now 9), 7 backups (now 5), 8 other data
(now 10).

4. **The reference model test, in the repo.** The model test that checked step 3 (random derives,
   writes, rollbacks, freezes, commits, forced rebases and restores, against Maps copied per version)
   ran from a scratch folder. It becomes a seeded unit test that runs in about a second, so steps 5-8
   are checked against it as they land. Steps 6 and 8 extend it with derived data.
   - **Done.** `test/unit/lib/graph_model.test.js`: 25 histories of 150 steps on up to 10 graphs by
     default (about 1 s); `GRAPH_MODEL_SEEDS`, `GRAPH_MODEL_STEPS` and `GRAPH_MODEL_SEED0` run longer
     or replay one seed. 1,000 × 200 passes in 54 s. Each check compares `hasEntity`, `isLocal`,
     parent ways and relations (exactly once each), `childNodes`, `localEntities`, `diffIDs` (never
     missing a change) and `Difference` (exact) for every graph and pair of graphs. Broken on purpose,
     it fails within the first seed: parent lists that count a graph's old versions, graphs sharing an
     owner token, and a rebase without iD#2085 restores.
5. **Backups and the session difference.**
   - Backup v4, rewritten: each edit's own changes (`diffIDs` against the edit before it, structural
     since step 3), cached on the edit, so a backup is O(changes since the last one) and restore is
     O(changes). v3 still restores. The format keeps the number 4 (decided October 2026): this Rapid
     hasn't been released, and the only v4 backups are in the shared debug Chrome, which get deleted
     when this lands. Rapid 2.5.7 (rapideditor.org) writes v3, so v3 restore stays.
   - The session difference keeps `complete()` and `summary()` up to date as stable changes (section 8),
     instead of rebuilding them when asked.
   - Needs nothing from the steps after it: rebases already reach every graph `EditSystem` keeps (step
     1), so a restore can drop the cached backup of the edits it changed.
   - Measured after step 3 (Bun, L=20k, 200 roads): `toBackup()` takes 1,105 ms, and `deferredBackup`
     runs it one second after every edit; `complete()` 6.7 ms (asked for by `validateAsync` on every
     stable change) and `summary()` 2.3 ms. An edit itself takes 0.04 ms.
6. **Geometry and versions in records.**
   - Records get geometry and versions. Base data lives on base objects. `graph.version(entity)`
     arrives.
   - `entity.geoms`, `extent()` and `intersects()` throw on ways and relations (nodes keep theirs), so a
     reader that didn't move fails loudly instead of reading another graph's shape.
   - `MapSystem` and `EditSystem` stop touching objects in place; `PixiLayerOsm` rebinds on
     `graph.version(entity)`. `geometryWriter` and the emit's recompute of what differs from it go.
   - `graph.verify()` (see Testing) arrives here, since this is where derived data can be stale in one
     graph and not another.
   - This fixes shared geometry (finding 1).
7. **Memoized answers in records.**
   - Topology answers for IDs a graph changed are stored in its records, on first read.
   - The lineage's set of IDs whose topology changed goes, and with it `graph.canShareAnswers()`. The
     set only grows during a session, so today more and more reads go unmemoized.
   - Measure first how many reads take the unmemoized path in a long session, to know what this buys.
8. **Rebase and schema changes.** The lineage rebases in both directions. Stable and staging update
   at once, and the other graphs `EditSystem` keeps when they become current (section 5). iD#2085
   restores reach every graph. `merge_remote_changes` goes through `editor.merge`. Geometry is
   recomputed only for line/area flips, and `SchemaSystem`'s hack goes.
9. **Spatial indexes for any graph.** One index per lineage, overlays for stable and staging, and the
   diff correction (no cache to start with). `spatialIDForGraph` goes, and `_validateEditsNearAsync`
   queries the stable overlay. This fixes finding 2 by construction.
10. **Other data.** Rapid datasets, then GeoJSON and markers, as lineages; services stop changing data
    in place.

Then, each measured on its own:
- **Slim nodes.** World coordinates live on the node; a full `Geometry` is built only when asked for,
  and Pixi builds its point parts from the coordinates. A node takes 182 B instead of 1,416 B. Node
  `Geometry` is 75-78% of a node's memory today (about 215 MB in central Paris). Against today's code,
  `update()` takes 1.6 instead of 3.2 µs, and way geometry built from nodes' world coordinates is 3-6×
  faster. Part of both already lands in step 2, so on top of it the gain is about 2.4 to 1.6 µs per
  update and 1.2-2.8× per way build (estimate).
- **Parent lookups that don't allocate** (`forEachParentWay`, `hasParentWays`): 0.5 µs instead of
  1.0-1.1 µs.
- **Multipolygon ring reuse** (section 3, "Relation geometry is built from its members'"): cache
  the ring structure and re-read only coordinates while they're the only thing that changed.

## Testing

- **Property tests against a reference model** (`test/unit/lib/graph_model.test.js`, from step 4).
  The model is today's semantics, with Maps copied per version. The tests run random replaces, removes, reverts, derives, commits, undos and redos,
  `commitAppend`, rebases (forced too) and restores. They compare `hasEntity`, parent ways and
  relations, and the `Difference`'s changes, `complete()` and `summary()`. The review of the prototype
  ran 22 million `hasEntity` checks against such a model, and 12,000 random edits, commits and
  unforced rebases against brute-force parent sets, geometry and memos. With forced rebases on, it
  found stale memos.
- **`graph.verify()`** recomputes all derived data from scratch (geometry, memoized answers, index
  hits) and compares. It runs after every step of the property tests, on staging, stable, history
  graphs and scratch graphs.
- **The session difference** equals a fresh `Difference(base, stable)` after merges with restores and
  forced updates.
- **Count operations, not milliseconds**: entries copied per derive, `Geometry`s built per merge, O(L)
  scans per event, slots given out by merge-time validation. Wall-clock limits are flaky and missed
  the regressions the reviews found.
- **Fixtures that broke the prototypes**: a tile that overlaps edits; tag edits on long ways; a street
  in 70 bus routes; a large multipolygon; nested and cyclic relations; iD#2085 restores, including a
  backup round trip after one; `commitAppend`; paste and draw-click transactions; an action that
  throws.

## Open questions

- **Memory of big shapes in the history:** each version keeps the geometry of what it changed (0.4 MB
  per edit of a 2,010-node multipolygon). Drop it from versions far back, and recompute it on undo?
- **Which graphs to validate, after step 9:** once any graph is answered correctly, should validation
  check the graph captured when a round starts, instead of following the current stable? That graph
  would live through rebases, so step 8's rule (section 5) would need it brought up to date too, or
  handed to a worker as a copy.
- **An entity's lineage:** an object stays in one lineage for its whole life. Accepting, pasting and
  the walkthrough all make new objects. Setting `entity.lineage` and its slot once would let
  `graph.geometry()` skip the slot lookup, and let dev builds assert that OSM and dataset objects never
  mix.
