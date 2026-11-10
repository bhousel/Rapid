# Validation System Design

`ValidationSystem` (`modules/core/ValidationSystem.ts`) **finds problems in the user's edits** (crossing
roads, roads that almost connect, missing tags, …) by running the validators in `modules/validators/`,
and offers fixes for them.

This system is older than the design docs. This doc started in October 2026 with an audit, after
autoconnect (accepting a Rapid feature with `poweruser.autoConnect`) crashed with
`OsmEntity n-2 not found` (see [The October 2026 audit](#the-october-2026-audit)).

> **Status:** Audit done. Fixed: the autoconnect crash, the split-edge problem in `actionAddMidpoint`,
> a throwing validator hiding other issues, Autofix All's transaction, fixes that assumed the graph
> they were found on, `missing_tag`'s severity, side effects while detecting, the user's edits near
> data that wasn't loaded, the smaller items, and shared geometry (each graph keeps its own shapes
> since step 6 of [`graph-geometry.md`](graph-geometry.md), and after a rebase since its step 8), and
> the wrong spatial index (searches answer for any graph since its step 9), and Autofix All applying
> fixes found on a graph that earlier fixes had changed (one runner, `actionAutofix`, for it and
> autoconnect, November 2026).

## Words used here

- **Validator**: a factory, `validateX(context)`, that returns a function `(entity, graph) => { issues }`.
  It should look only at the `graph` it's given.
- **Issue** (`ValidationIssue`): a problem found on one or more entities, with a `loc`, a `hash` that
  tells apart issues of the same kind on the same entities, and fixes.
- **Fix** (`ValidationFix`): a button in the issues pane, run by the user.
- **Autofix** (`issue.autoArgs`, `[action, label]`): an action that fixes the issue without asking.
  The issues pane's "Autofix All" and autoconnect run these, one at a time (`actionAutofix`).
- **Caches**: `ValidationSystem` keeps one `ValidationCache` of issues for the base graph and one for
  the head (stable) graph, so it can tell which issues the user caused.

## How validation runs

`ValidationSystem` validates the base and stable graphs, never staging, so nothing runs while the
user drags. Entities to validate are queued in chunks of 50 and run in idle callbacks.
- On `stablechange`, the head cache validates what the edit changed, and what's related to it
  (`ValidationCache.withAllRelatedEntities`): the entities in the same issues, the ways connected to
  it, the nodes next to a connection or to a changed node (an issue on a node can depend on the
  connection next to it, like `y_shaped_connection`), and nearby connectivity issues.
- On `merge` (a tile loaded), the base cache validates everything on the tile, and the head cache
  validates the user's edits near it (finding 6).

Validators also run outside `ValidationSystem`:
- **Autoconnect** (`attemptAutoconnect` in `actions/rapid_accept_feature.ts`) runs `almost_junction` and
  `crossing_ways` on the way just accepted, inside the accept action, and applies their autofixes.
- **Autofix All** (`UiSectionValidationIssues`) applies the autofixes of several issues in one edit.

So a validator can be handed a graph that's in the middle of an action: not base or stable, and not
committed.

Both apply fixes with `actionAutofix(targets, canFix?)` (`actions/autofix.ts`). A target is an
entity and a validator to run on it. Each fix changes the graph the other issues were found on (it may
move, merge or remove nodes, and splits segments), so the runner applies one fix, looks the entity up
again, validates it again, and repeats until no autofixable issue is left. It tries each issue ID once,
so a fix that doesn't make its issue go away isn't repeated.
- Autoconnect's targets are the accepted way with `almost_junction`, then with `crossing_ways`. It fixes
  everything they find.
- Autofix All gets its action from `ValidationSystem.autofixAction(issues)`. Its targets are the
  entities the issues were found on (`issue.foundOnID`, which `ValidationSystem` records:
  `ambiguous_crossing` checks a way and lists its nodes, so it isn't always in `entityIds`). It fixes
  only issues of the same kind, on the same entities, as the ones the user was shown, not by ID: a fix
  that splits a segment changes the ID of every other crossing on it. Ignored issues aren't fixed,
  unless a fix changed the ID of one that's the same kind on the same entities as a shown one.
- The single "Autofix" button still runs the issue's own `autoArgs` action. It's found on the stable
  graph, which is the graph the user sees when they click it.

## What a graph gives a validator, and what it doesn't

- `graph.replace()` / `remove()` change the graph in place and update its parent ways and relations at
  once. Node `loc`s are always current.
- A node's geometry (`entity.geoms`, world coordinates) is always current: nodes are immutable, and
  each new node computes its geometry when it's constructed. Validators can rely on it.
- Way and relation geometry depends on their child nodes (and their tags: a way can change from line
  to area), so it's updated by `graph.commit()`, for what changed since the last commit.
  `graph.geometry(entity)` commits first, so it's current even in the middle of an action.
- **Each graph keeps its own way and relation geometry** (since November 2026; before, it was kept on
  the entity objects that every graph shares, audit finding 1). Read it with `graph.geometry(entity)`
  or `graph.extent(entity)`: a way's or a relation's `geoms` and `extent()` throw.
- **Spatial searches answer for the graph they're given** (since November 2026, graph-geometry step 9;
  before, any graph other than base and stable got staging's index, audit finding 2).
  `editor.entitiesInBox(box, graph)` and `editor.waySegments(extent, graph)` work for any graph of the
  editor's lineage, including one inside an action: they commit its uncommitted writes and correct the
  nearest index by what differs.

## The October 2026 audit

An audit of every validator and `ValidationSystem`. "Checked" means reproduced in a test or traced in
the code; the repros were kept outside the repo.

**Fixed:**
- **Autoconnect validated a way that had changed.** `attemptAutoconnect` ran `crossing_ways` on the
  `way` it had before the `almost_junction` autofix merged its end node away, and threw. It also
  applied every autofix from one validation run, though each fix changes the graph the others were
  found on. Now it applies one fix, looks the way up again, and validates again (since November 2026,
  with `actionAutofix`, which Autofix All shares).
- **A stale edge left a node out of the way.** When the edge given to `actionAddMidpoint` had been
  split since it was found (by an earlier fix in the same action), the node was moved onto the road
  but inserted into no way: it looked connected and wasn't. Now the node goes into the piece of the
  edge that its location lies on. This was the second end of a U-shaped road joining the same road
  segment, or one segment crossing two roads.

**Open, most severe first:**
1. ✅ **Shared geometry** (checked; fixed in step 6 of [`graph-geometry.md`](graph-geometry.md)).
   Geometry lived on entity objects that every graph shares.
   Moving a node and undoing leaves the way's extent where the node was moved to. Validators that read
   geometry while detecting judge the wrong shape: `unsquare_way` (squareness), `close_nodes` (size),
   `outdated_tags` and `mismatched_geometry` (location), and `ValidationCache.withAllRelatedEntities`.
   `ambiguous_crossing_tags` commits a snapshot of the graph it's checking, which recomputes the
   geometry of every edited entity (so validating one way costs as much as all edits; quadratic over a
   session) and rewrites geometry that staging sees.
   Now each graph keeps its own shapes in its records, so a snapshot's commit changes only the
   snapshot. Stable and staging catch up with a rebase at once (that design's step 8).
2. ✅ **The wrong spatial index** (checked; fixed in step 9 of [`graph-geometry.md`](graph-geometry.md):
   `editor.entitiesInBox` and `waySegments` answer for whatever graph they're given, and
   `close_nodes` takes entities from the graph). Inside an action, `waySegments` returns the segments from
   before the action. In `ValidationSystem`, a queued job validates the graph that was stable when it
   was queued; once the user commits again, that graph gets the staging index, and `almost_junction`
   throws on a way that only exists in staging (`graph.entity(segmentInfo.wayID)`). `crossing_ways`
   checks with `hasEntity`, so it quietly misses crossings instead. `close_nodes` reads entities from
   the index rather than the graph.
3. ✅ **One throw lost issues for the session** (traced; fixed). `_processQueue` ran a chunk of 50 jobs
   with no try/catch. If one threw, the rest didn't run, but their issues were already uncached and
   their IDs stayed in `queuedEntityIDs`, so they were never queued again. Now `_validateEntity`
   catches a validator that throws (logs it and keeps the other validators' issues; not provisional,
   or a validator that always fails would be retried every 5 seconds), and each job in a chunk is
   caught too. Validators that can still throw: the index mismatch above, `extent()!` in
   `outdated_tags`, `close_nodes` and `mismatched_geometry`.
4. ✅ **Fixes assumed the graph they were found on** (checked; fixed). Fixes kept edges, `way`
   objects and a `graph` from detection.
   - ✅ `curb_nodes`' fix split the crossing at the first curb node, then used the crossing as it was
     before for the second, leaving a `barrier=kerb` node in no way. Now it looks up the node and the
     part of the crossing that ends there before each step.
   - ✅ Autofix All ran inside `beginTransaction()` with no `finally`: if a fix threw, the editor stayed
     in the transaction and stopped sending change events. Now it skips an issue whose entities an
     earlier fix removed, and if a fix throws, it drops all the fixes (`editor.revert()`) and always
     ends the transaction. It still applied the autofixes of one validation run in sequence (safer
     since the `actionAddMidpoint` fix), so a fix found before an earlier one merged a node away no
     longer fit: a road that ended near one road and crossed another was connected at its end, but
     not at the crossing. Since November 2026 it's one action that applies one fix at a time (`actionAutofix`), and
     `perform` drops all of the fixes if one throws (no transaction needed).
   - ✅ Fix buttons that used the detection-time `way`, or the staging graph from when the fixes were
     shown. `perform` changes staging in place and `commit` starts a new one, so that graph misses
     every edit after the next one. `almost_junction`'s connect fix connected the end node as it was
     then, dropping later changes to it; `impossible_oneway`'s and `short_road`'s "continue" fixes
     could start drawing from a node that wasn't the end of the road anymore. Now a fix keeps entity
     IDs and looks them up in the graph it runs on, like `crossing_ways`' fixes already did.
   - ✅ `almost_junction`'s fix and autofix now share one function, which changes nothing unless the
     end node is where it was, still at the end of the road and not connected, and the target way still
     has the edge (e.g. Autofix All, after an earlier fix connected it).
   - Not checked: whether the edge's nodes moved. The node would still be connected, a bit off the
     line.
5. ✅ **`missing_tag` made existing features errors** (traced; fixed). `canDelete` checked
   `entity.v !== undefined`, which is always true in Rapid (`v` defaults to `0`; in iD it was set only
   on edited entities), so an untagged feature already in OSM was an error instead of a warning. Now
   it asks whether the entity differs from the one in the graph's base: a feature the user created
   or changed is an error, one they didn't touch is a warning. (Decided: not `entity.isNew()`, so
   that removing all the tags from an existing feature blocks the upload. The cost is that changing
   an old untagged way, e.g. adding a vertex, makes its missing tags an error too.) `help_request`
   has the same always-true check, harmlessly.
6. ✅ **The user's edits near data that wasn't loaded were never checked again** (checked; fixed).
   `almost_junction`, `impossible_oneway`, `disconnected_way`, `unsquare_way`, `missing_tag` and
   `outdated_tags` give up where the map isn't loaded (`osm.isDataLoaded`) and return no issues.
   - For data nobody edited, that's fine: a merge emits every entity on the tile (`seenIDs`, including
     ones seen before), and the base cache validates them and the ways connected to them again. A way
     that reaches into a tile is in that tile's API response.
   - For the user's edits it wasn't: the head cache was only validated on `stablechange`, for what
     the edit changed. A merge rebases the stable graph in place, so the head cache looked caught up,
     and a road the user drew or accepted isn't in any tile's response. A road accepted past the
     loaded map (or drawn while a tile was slow) kept its empty result until the user edited it again.
   - Now a merge also validates, in the head cache, the user's changed entities that overlap the merged
     nodes (padded 10 m), and the entities related to them (`_validateEditsNearAsync`).
   - Not provisional results: they're retried every 5 seconds, and every way crossing the edge of the
     loaded map would be retried until the user loads the tile, maybe never.
   - Autoconnect still gives up at an end in an unloaded tile, so it doesn't join there. When the tile
     loads, the user sees an `almost_junction` issue instead.
7. ✅ **Detecting had side effects** (traced; fixed). `short_road` and `y_shaped_connection` built a
   `DeleteOperation` while detecting, which read the staging graph and the viewport and could request
   a map tile, so which fixes were offered depended on where the map was. Now they decide from the
   graph they're given (`y_shaped_connection`: the node is in no other way; `short_road`: the way is in
   no relation), and the fix runs `actionDeleteNode` / `actionDeleteWay` on the staging graph after
   checking again. `DeleteOperation`'s other checks (in view, downloaded, hidden connections, wikidata)
   are for a user deleting what they selected, not a fix for a road they just drew. (`short_road` is
   commented out of `validators/index.ts`, too many false positives.) `missing_tag` and
   `disconnected_way` still use `DeleteOperation`, but only when the issue is shown or the fix runs.
8. ✅ Smaller ones (fixed):
   - `crossing_ways` hashed the crossing location rounded to 4 decimals (~11 m), so two crossings of
     the same ways within 11 m were one issue. Now it hashes the two crossing segments (two straight
     segments cross only once). The ID now stays the same when a node of either segment moves, but
     changes when one of the segments is split.
   - `y_shaped_connection` skipped the first node of a way (`idx <= 0`, now `idx < 0`).
   - `revalidateUnsquare` checked staging's entities against the head graph when the head lagged
     (including buildings not in that graph). Now it takes only the IDs from the index and checks each
     building as it is in that graph.

## Where this is heading

What a validator needs, so it can be run on any graph (including one inside an action):
1. ✅ **Spatial queries for the graph it's given.** An index that's current for that graph (e.g. the
   staging index plus the changes in the graph since), or a slow search when there's none. Never the
   staging index for some other graph. (Done in graph-geometry step 9.)
2. ✅ **Geometry from the graph.** Node `loc`s, or geometry kept per graph rather than on shared
   entities. (Done in graph-geometry step 6.) A validator never commits the graph it's checking.
3. **Fixes that find their place again.** A fix records what it means (entity IDs and a location) and
   finds the edge or node again when it runs; if the graph doesn't fit anymore, it changes nothing.
4. ✅ **A runner that applies one fix at a time**, shared by autoconnect and Autofix All
   (`actionAutofix`, November 2026).
5. **`ValidationSystem` contains failures**: a try/catch per job, and `queuedEntityIDs` released in a
   `finally`.

## Rollout

1. ✅ Autoconnect applies one autofix at a time; `actionAddMidpoint` handles a split edge (Oct 2026).
2. ✅ Contain failures in `ValidationSystem` (finding 3) and Autofix All's transaction (finding 4);
   `curb_nodes`' fix; `missing_tag`'s `canDelete` (finding 5) (Oct 2026).
3. ✅ The smaller items (finding 8) (Oct 2026).
4. ✅ Fixes look up their entities in the graph they run on (the rest of finding 4) (Oct 2026).
5. ✅ Validate with the right spatial index (finding 2), with one runner for autoconnect and Autofix All.
   The spatial index in graph-geometry step 9; the runner, `actionAutofix` (Nov 2026).
6. ✅ Geometry per graph (finding 1). The biggest change: it's about `Graph` and the data classes, not
   only validation. Designed in [`graph-geometry.md`](graph-geometry.md), with finding 2; done in its
   step 6 (Nov 2026), and shapes after a rebase in its step 8.
7. ✅ Validate the user's edits again when data loads near them (finding 6), and no side effects while
   detecting (finding 7) (Oct 2026).
