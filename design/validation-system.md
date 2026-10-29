# Validation System Design

`ValidationSystem` (`modules/core/ValidationSystem.ts`) **finds problems in the user's edits** (crossing
roads, roads that almost connect, missing tags, …) by running the validators in `modules/validators/`,
and offers fixes for them.

This system is older than the design docs. This doc started in October 2026 with an audit, after
autoconnect (accepting a Rapid feature with `poweruser.autoConnect`) crashed with
`OsmEntity n-2 not found` (see [The October 2026 audit](#the-october-2026-audit)).

> **Status:** Audit done. Fixed: the autoconnect crash, the split-edge problem in `actionAddMidpoint`,
> a throwing validator hiding other issues, Autofix All's transaction, the `curb_nodes` fix,
> `missing_tag`'s severity, and side effects while detecting. The rest of the findings are open (see
> [Rollout](#rollout)).

## Words used here

- **Validator**: a factory, `validateX(context)`, that returns a function `(entity, graph) => { issues }`.
  It should look only at the `graph` it's given.
- **Issue** (`ValidationIssue`): a problem found on one or more entities, with a `loc`, a `hash` that
  tells apart issues of the same kind on the same entities, and fixes.
- **Fix** (`ValidationFix`): a button in the issues pane, run by the user.
- **Autofix** (`issue.autoArgs`, `[action, label]`): an action that fixes the issue without asking.
  The issues pane's "Autofix All" and autoconnect run these.
- **Caches**: `ValidationSystem` keeps one `ValidationCache` of issues for the base graph and one for
  the head (stable) graph, so it can tell which issues the user caused.

## How validation runs

`ValidationSystem` validates the base and stable graphs, never staging, so nothing runs while the
user drags. Entities to validate are queued in chunks of 50 and run in idle callbacks.

Validators also run outside `ValidationSystem`:
- **Autoconnect** (`attemptAutoconnect` in `actions/rapid_accept_feature.ts`) runs `almost_junction` and
  `crossing_ways` on the way just accepted, inside the accept action, and applies their autofixes.
- **Autofix All** (`UiSectionValidationIssues`) applies the autofixes of several issues in one edit.

So a validator can be handed a graph that's in the middle of an action: not base or stable, and not
committed.

## What a graph gives a validator, and what it doesn't

- `graph.replace()` / `remove()` change the graph in place and update its parent ways and relations at
  once. Node `loc`s are always current.
- Geometry (`entity.geoms`, `extent()`) is updated only by `graph.commit()`, and only for what changed
  since the last commit.
- **Way and relation geometry is kept on the entity objects, and the graphs share those objects.** A
  commit on one graph rewrites the geometry that base, stable and staging see (audit finding 1).
- The OSM spatial indexes (`editor_base`, `editor_stable`, `editor_staging`, and their `-segments`
  indexes) are updated by `EditSystem` after an action finishes (`_emitChanges`), never during one.
  `editor.waySegments(extent, graph)` picks the index by graph and falls back to staging for any
  other graph, so inside an action it doesn't see the action's own changes.

## The October 2026 audit

An audit of every validator and `ValidationSystem`. "Checked" means reproduced in a test or traced in
the code; the repros were kept outside the repo.

**Fixed:**
- **Autoconnect validated a way that had changed.** `attemptAutoconnect` ran `crossing_ways` on the
  `way` it had before the `almost_junction` autofix merged its end node away, and threw. It also
  applied every autofix from one validation run, though each fix changes the graph the others were
  found on. Now `autofix()` applies one fix, commits, looks the way up again, and validates again.
- **A stale edge left a node out of the way.** When the edge given to `actionAddMidpoint` had been
  split since it was found (by an earlier fix in the same action), the node was moved onto the road
  but inserted into no way: it looked connected and wasn't. Now the node goes into the piece of the
  edge that its location lies on. This was the second end of a U-shaped road joining the same road
  segment, or one segment crossing two roads.

**Open, most severe first:**
1. **Shared geometry** (checked). Geometry lives on entity objects that every graph shares (see above).
   Moving a node and undoing leaves the way's extent where the node was moved to. Validators that read
   geometry while detecting judge the wrong shape: `unsquare_way` (squareness), `close_nodes` (size),
   `outdated_tags` and `mismatched_geometry` (location), and `ValidationCache.withAllRelatedEntities`.
   `ambiguous_crossing_tags` commits a snapshot of the graph it's checking, which recomputes the
   geometry of every edited entity (so validating one way costs as much as all edits; quadratic over a
   session) and rewrites geometry that staging sees.
2. **The wrong spatial index** (checked). Inside an action, `waySegments` returns the segments from
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
4. **Fixes assume the graph they were found on** (checked; partly fixed). Fixes keep edges, `way`
   objects and a `graph` from detection.
   - ✅ `curb_nodes`' fix split the crossing at the first curb node, then used the crossing as it was
     before for the second, leaving a `barrier=kerb` node in no way. Now it looks up the node and the
     part of the crossing that ends there before each step.
   - ✅ Autofix All ran inside `beginTransaction()` with no `finally`: if a fix threw, the editor stayed
     in the transaction and stopped sending change events. Now it skips an issue whose entities an
     earlier fix removed, and if a fix throws, it drops all the fixes (`editor.revert()`) and always
     ends the transaction. It still applies the autofixes of one validation run in sequence (safer
     since the `actionAddMidpoint` fix); a shared one-at-a-time runner is item 4 below.
   - Open: fix closures that capture the detection-time `graph` or `way` (`almost_junction`'s
     `makeFixes`, `impossible_oneway`, `short_road`).
5. ✅ **`missing_tag` made existing features errors** (traced; fixed). `canDelete` checked
   `entity.v !== undefined`, which is always true in Rapid (`v` defaults to `0`; in iD it was set only
   on edited entities), so an untagged feature already in OSM was an error instead of a warning. Now
   it asks whether the entity differs from the one in the graph's base: a feature the user created
   or changed is an error, one they didn't touch is a warning. (Decided: not `entity.isNew()`, so
   that removing all the tags from an existing feature blocks the upload. The cost is that changing
   an old untagged way, e.g. adding a vertex, makes its missing tags an error too.) `help_request`
   has the same always-true check, harmlessly.
6. **Features near data that isn't loaded are never checked again** (traced). `almost_junction`,
   `impossible_oneway`, `disconnected_way`, `unsquare_way` and `missing_tag` give up when the data
   around a node isn't loaded, and return an empty result instead of a provisional one, so the
   feature isn't validated again when the data arrives.
7. ✅ **Detecting had side effects** (traced; fixed). `short_road` and `y_shaped_connection` built a
   `DeleteOperation` while detecting, which read the staging graph and the viewport and could request
   a map tile, so which fixes were offered depended on where the map was. Now they decide from the
   graph they're given (`y_shaped_connection`: the node is in no other way; `short_road`: the way is in
   no relation), and the fix runs `actionDeleteNode` / `actionDeleteWay` on the staging graph after
   checking again. `DeleteOperation`'s other checks (in view, downloaded, hidden connections, wikidata)
   are for a user deleting what they selected, not a fix for a road they just drew. (`short_road` is
   commented out of `validators/index.ts`, too many false positives.) `missing_tag` and
   `disconnected_way` still use `DeleteOperation`, but only when the issue is shown or the fix runs.
8. Smaller ones:
   - `crossing_ways` hashes the crossing location rounded to 4 decimals (~11 m), so two crossings of
     the same ways within 11 m are one issue.
   - `y_shaped_connection` skips an edge node at index 0 (`idx <= 0` should be `idx < 0`).
   - `revalidateUnsquare` checks staging's entities against the head graph when the head lags.

## Where this is heading

What a validator needs, so it can be run on any graph (including one inside an action):
1. **Spatial queries for the graph it's given.** An index that's current for that graph (e.g. the
   staging index plus the changes in the graph since), or a slow search when there's none. Never the
   staging index for some other graph.
2. **Geometry from the graph.** Node `loc`s, or geometry kept per graph rather than on shared
   entities. A validator never commits the graph it's checking.
3. **Fixes that find their place again.** A fix records what it means (entity IDs and a location) and
   finds the edge or node again when it runs; if the graph doesn't fit anymore, it changes nothing.
4. **A runner that applies one fix at a time**, like `attemptAutoconnect`'s `autofix()`, shared by
   autoconnect and Autofix All.
5. **`ValidationSystem` contains failures**: a try/catch per job, `queuedEntityIDs` released in a
   `finally`, and a provisional result when the data isn't loaded.

## Rollout

1. ✅ Autoconnect applies one autofix at a time; `actionAddMidpoint` handles a split edge (Oct 2026).
2. ✅ Contain failures in `ValidationSystem` (finding 3) and Autofix All's transaction (finding 4);
   `curb_nodes`' fix; `missing_tag`'s `canDelete` (finding 5) (Oct 2026).
3. The smaller items (finding 8).
4. Validate with the right spatial index (finding 2), then fixes that find their place again
   (the rest of finding 4), with one runner for autoconnect and Autofix All.
5. Geometry per graph (finding 1). The biggest change: it's about `Graph` and the data classes, not
   only validation, and needs its own design.
6. Provisional results (finding 6). (✅ No side effects while detecting, finding 7, Oct 2026.)
