# Current Work

## This branch (`conflation-system`)
Data IDs (steps 1–5), the validation audit and the graph-geometry rollout have all landed (see
`completed.md`). Bryan wants to land this branch for testers before starting the multiselection design
(`backlog.md`), to keep conflation in focus. Next: a release check in the debug Chrome on real data
(accept with joins, autoconnect, undo/redo, Autofix All, panning while editing, QA and photo layers,
backup restore, a faked upload conflict), then merge to main.

## Bug hunt (Nov 3): open issues
Found by `/bughunt` before handing the branch to testers. Status: *new* (this branch) or *main too*;
*confirmed* (a repro) or *reading* (read in the code only). Repros were in the session scratch folder
(`hunt-*/`), which doesn't last; each item says enough to repro again. Coverage that came back clean:
~1,400 seeded random `EditSystem` histories (edits, commits, appends, transactions, undo/redo,
checkpoints, tile merges, `updateBase`) checking emits, shapes, both indexes, segments, node memos,
parent lists and the session difference after every step; two live soaks on Ballard data (~180 real
actions, 45k entities loaded mid-run); backup round trips; `affects()` vs `complete()` over 1,500 seeds.

### High: fix before testers
1. **iD#2085 restores miss redo edits and checkpoints.** `Graph.rebase` only checks `stack.at(-1)`
   (staging) for deleted nodes. Delete a node, undo, load a tile with a way through it, redo:
   `OsmEntity n2 not found` (render, delete way, multipolygon join). 4–9% of random histories.
   `Graph.ts:804`. *Main too (wider now: checkpoints, return edit); confirmed.* Fix: gather restore IDs
   from every graph in the stack that deleted the node (and didn't delete the way), not just the head.
2. **A dev-API session can be restored and uploaded against live OSM.** Session records don't store
   the API; the source switch isn't remembered, so every load starts on live. v4 restore fetches
   `baseVersions` from live (same IDs, unrelated features), and Save may overwrite live data without a
   409. `EditSystem._saveSessionAsync` (:2371), `restoreSessionAsync`, `UiSourceSwitch.ts:26`.
   *New; reading.* Fix: store `apiURL` on each session; filter or refuse a restore that doesn't match.
3. **MapRoulette: typing a comment replaces Cancel/Submit with the four action buttons.** `changeInput`
   calls `_saveButtons` (should be `_submitButtons`), and joins keyed by `d.key` now see a new datum.
   `UiMapRouletteEditor.ts:233`. *New; confirmed.* Fix: call `_submitButtons`; key single-datum joins
   by `d.id`.
4. **MapRoulette: action clicks write the editor's stale datum over the cached task.** The details
   reload and refetch on every click; if the task was selected before its challenge loaded,
   `instruction`/`description`/`isVisible` are lost for good (details show the error text; after Cancel
   the marker disappears). `UiMapRouletteEditor.ts:671`, `UiMapRouletteMenu.ts:283`. *New; confirmed.*
   Fix: start from `maproulette.getTask(task.id) ?? task`.
5. **Cancel on the conflict screen still keeps the user's deletion.** `updateBase` runs during detection,
   so the next Save deletes the other mapper's v2 without asking. `UploaderSystem.ts:450`, `:766`.
   *New; confirmed.* Fix: update the base only when "Leave Deleted" is actually chosen.
6. **A line that is one whole new run is accepted untrimmed.** No piece datum is made for a `[0,1]`
   run, so accept uses the source geometry; its ends spike ~1 m back across the sidewalk they join.
   `ConflationSystem.ts:833-852`, `rapid_accept_feature.ts:67-98`. *New; confirmed.* Fix: give a
   whole-line run with joins a datum too (or have `getJoins` carry the trimmed coords).
7. **With "show already mapped" on, a matched run is bound to the whole line.** Add puts in the full
   line on top of the existing sidewalk and the accepted piece; Ignore hides the line's pending new
   pieces. `PixiLayerRapid.ts:592` (`run.datum ?? d`). *New; confirmed.* Fix: a non-actionable datum for
   matched runs, or refuse Add/Ignore for a line that has runs.
8. **Conflicts that leave nothing to upload keep the session; it's offered for restore next time.**
   `SaveMode.ts:348` (`_resultNoChanges`), then `_reset` nulls `_sessionID`. *New; confirmed.*
   Fix: `editor.clearBackup()` in the no-changes path.
9. **Undoing a tag change on a new relation deletes the relation and loses the redo.** Undo re-enters
   select, and `SelectMode.exit()` cleans up the now-untagged relation with a new commit.
   `SelectMode.ts:232-252`. *Main too; confirmed.* Fix: skip the cleanup when the exit comes from a
   history jump (stable changed since the mode was entered).

### Medium
10. **"Use theirs" on a way reverts the user's changes to all its nodes**, including ones that didn't
    conflict and are shared with other ways. `UploaderSystem.ts:779-790`. *iD has it too; confirmed.*
11. **Counter-based data IDs (GeoScribble, vector tiles) go into `id=` and edit selections**, so after a
    reload or a shared link they name a different feature. `SelectMode.ts:187`, `GeoJSONData.ts:46`,
    `GeoScribbleService.ts:146`. *New; confirmed.* Fix: keep unstable IDs out of `id=` and recorded
    selections; give GeoScribble a deterministic key.
12. **Backups saved by `main` recorded accepts without the dataset prefix** (`w-123`, not
    `fbRoads:w-123`). Restoring one shows accepted features again, and they can be added twice.
    `_upgradeEditProps`, `RapidSystem.ts:895`. *New; reading.* Fix: prefix in the upgrade from the edit's
    `sources.data[0]`.
13. **Default conflation rules join line ends to any line** (fences, streams, power lines, boundaries).
    `ConflationSystem.ts:269`, `:717-741`. *Design choice, but makes bad edits.* Fix: default
    `sameKeys: ['highway']`, or only join with rules that have target conditions.
14. **Ctrl/⌘+↑↓ with a mixed selection selects parents/children and also pans the map.**
    `MapInteractionBehavior.ts:160` doesn't check `defaultPrevented`. *New; confirmed.*
15. **After an upload ends with -6 ("can't tell"), the open changeset is reused**, so `changes_count` no
    longer tells whether a later upload landed; a later save can delete a session whose newer edits
    never uploaded. `OsmService.ts:1406`, `:1556`. *New; reading.* Fix: drop `openChangesetID` on -6.
16. **Conflation results are cached by data ID**, so a new datum with the same ID gets the old runs.
    Latent until vector tile stitching returns, or a dataset reloads with changed geometry.
    `ConflationSystem.ts:385`. *New; confirmed.* Fix: key by datum object (WeakMap).
17. **Some piece IDs don't parse back:** zero-length lines (`@0-0`), and lines over ~20 km (4 decimals).
    Ignore/Accept doesn't hide them. `ConflationSystem.ts:239`. *New; confirmed.*
18. **Area-key schema changes don't flush conflation results** (building edges can stay "lines").
    *New; reading.* Fix: `invalidate()` on `schemachange`.

### Low
19. Both ends of a run snap to the same node, so the accepted way is closed (`rapid_accept_feature.ts:121`).
    *Confirmed; contrived.*
20. A join to a segment that still exists doesn't check `loc` is still on it (`rapid_accept_feature.ts:130`).
21. Pieces are cleared by `ds.id` but cached by `spatialID` (`ConflationSystem.ts:438` vs `:875`); a
    dataset with `conflation` but no `rules` throws in `UiRapidDatasetSettings._checkConflation`.
22. Undo during a drag/move selects the newest edit's `selection` (maybe offscreen), `MapSystem.ts:481`.
    *Main too; confirmed.*
23. Drag, draw and add-point edits record their working selection as `selectionBefore`
    (`DragNodeMode.ts:352`). *Main too.*
24. A successful upload reported as -1 "Connection Switched" clears the upload mark (`OsmService.ts:2400`).
    Very hard to trigger.
25. "Keep mine" after the default "Use theirs" can leave the parent way edited (`merge_remote_changes.ts`).
26. Osmose editor's `_updateIssue` has the same stale-datum pattern as 4 (`UiOsmoseEditor.ts:223`).
27. An iD#2085 restore of a frozen stable that's also `_headQueuedGraph` isn't validated again in the
    head cache (`validateAsync` sees "caught up").
28. `graph.geometry()` for a new way passed to a graph that doesn't have it reads an undefined shape
    (falls back to the passed object's `baseGeometry`). No caller does this today.

### Already in `main`
29. After a new note is saved, the "new note" editor stays up (looks up the removed `-1`); a second Save
    could post a duplicate note. `SelectMode.ts:333-340`.
30. Note and KeepRight Save clicks may be lost: the textarea's blur re-joins the buttons under the pointer.
31. The walkthrough leaves a duplicate session (reset, then `fromJSONAsync`); restoring it later
    duplicates an upload. `UiIntro.ts:336`.
32. "Duplicate tab" copies `sessionStorage`, so two tabs can share a session (`_isLiveElsewhere`).
33. Undo right after pressing "2" (before the first click) is silently swallowed (`DrawLineMode.ts:233`).
34. `AbstractPixiLayer.bindData` wipes parent/child links on every rebind (`:220`).
35. Restoring a backup can move counters backward, including `v`, `graph` and `changeset` (`EditSystem.ts:1833`).
36. On the conflict screen, Save is only enabled through `scheduler?.setTimeout` (`UiConflicts.ts:191`).

Not a bug: a history graph that isn't current and hasn't caught up with the base gives stale searches,
and its own `geometry()` is just as stale. That's the documented design, and nothing searches one.

## Active: what an edit records (`EditSystem`)
Design: [`design/edit-system.md`](../design/edit-system.md), started Oct 26. Edits need to record more
than OSM graph changes. Done: undone (redo) edits aren't saved, and a session undone back to nothing
is deleted (step 2). Step 3 (Oct 27): `Edit<P>` is a graph plus a props bag with an optional `type`;
`commit(props)` everywhere passes a `stringID` (+ `stringParams`) instead of translated text, and
`edit.label` translates it; `getUndoEdit()`/`getRedoEdit()` replace `get*Annotation()`, and
`edit.isLabeled(label)` replaces comparing translated strings; operations have `editLabel()` (was
`annotation()`); Rapid accept/ignore are `RapidAcceptEditProps`/`RapidIgnoreEditProps`; `hasWork()`
decides backups, the beforeunload prompt and the source switcher warning. Backup items now hold `props`
(still version 3; old items convert via `_legacyEditProps`). Checked live: an ignore-only session is
backed up with its typed props, and undoing it deletes the session.
Step 4 (Oct 27): edits record `extent`, `selection` and `selectionBefore` (by layer, `EditSelection`;
`selectedIDs` is gone); `MapSystem` moves only when the change isn't in view; undo restores the
selection before, redo the selection after (a Rapid feature is found again on the `rapid` layer); one
more redo returns to where the user was (`EditSystem.returnEdit`, never in the history). Worked out
with Bryan, with Steve Ruiz's undo/redo threads as prior art (in the doc). Checked live.
Step 5 (Oct 27): backups are v4, saving `baseVersions` instead of base entities; restore fetches them
with `OsmService.loadEntityVersionsAsync` (versioned multi-fetch, splits a chunk on 404), falling back
to the current version, then the version before a deletion. No API, no restore: it fails, keeps the
session, and flashes `restore.failed` (also at the end of the walkthrough). v3 restore goes through the
same fetch (the `result.data` bug is gone). Checked live with a v3 session in the debug Chrome.
Next: step 6 (edits that use external data on OSM features), when Bryan picks it up. Found: accepting from a custom dataset
records no data source (`ds.dataUsed` is `[]`, and `[] ?? [datasetID]` keeps `[]`; it was `||` before,
same result). PR #5's `EditSystem.dataVersion` fits here (the "did data change?" question); not landed.

## Active: uploading and conflicts (`UploaderSystem`)
Design: [`design/uploader-system.md`](../design/uploader-system.md), started Oct 27 with an audit (iD#7199,
iD PR #12814, Rapid#1361/#1366/#1480). The conflict path had been broken for years, several bugs deep.
Fixed (Oct 27): the check fetches with `loadEntityVersionsAsync` and checks modified + deleted entities;
merges stay in `staging` and are committed before uploading; 409 retries are limited (same entity twice,
3 checks, closed changeset); local deletions merge (`updateBase` for "Leave Deleted", `actionRevert`
restores deleted children); conflict choices are `'local'`/`'remote'`; `SaveMode._resultConflicts` takes
the arguments the uploader emits (the screen never opened before); the download link exists; Escape and
leaving save mode cancel the conflict screen. Checked in headless Chromium with faked upload and fetch.
Finding 8 fixed: `sendChangeset` reports every failure, the upload timeout is 5 minutes, and an
upload with no answer checks the changeset's `changes_count` (`loadChangesetAsync`). Finding 9 fixed:
the session is kept until the upload succeeds, marked while uploading (`markUploadAsync`, via
`sendChangeset`'s `beforeUpload`), and the next tab settles interrupted uploads in `EditSystem.startAsync`
(`_settleUploadsAsync`). Default choice stays "Use theirs" (decided; reason in the design doc).
Left from the audit: the "moved by both" false conflict; a new changeset when the old one was closed.
Testing tip: a fake `sendChangeset` must call its `beforeUpload` argument, or the mark is never written.

## Active: matching third-party data against OSM (`ConflationSystem`)
Top priority. Design: [`design/conflation-system.md`](../design/conflation-system.md), currently proposed and
awaiting a final review. Guiding use case: *accept the part of the sidewalk that is missing, and join it
to the part that exists.*
- ✅ Step 1: `GeometryPart.computeCoverage(radius)` (meters, caches the most recent radius) + `geoMetersToWorld`.
- ✅ Step 2: design doc. The stages are Match → Score → Triage → Act. In the UI, "conflation"
  appears only as the "Conflation Settings" heading, defined right below it in stage words. The statuses
  are "Already mapped", "Needs review" and "New". Code keeps "conflation" (`ConflationSystem`).
  The review queue covers the viewport only. See "Resolved Decisions" in the doc.
- ✅ Step 3: `modules/core/ConflationSystem.ts` matches LineStrings from GeoJSON-backed datasets.
  `RapidDataset.conflation` holds the rules (`conflationDefaults()`), which aren't persisted yet (Step 6).
  Triage is per coverage box ("same", "near", or neither). Runs, join points, and invalidation on
  `stablechange`/`merge` are all in place. Tests: `test/unit/core/ConflationSystem.test.js` (synthetic street grid).
- ✅ Step 4: `PixiLayerRapid` hides matched lines (or mutes them with `showMatched`), draws partial lines
  as their runs (`…-run${i}` features), and gives needs-review lines an amber
  casing. `PixiLayerDebug` now shows conflation boxes and join points in a new `debug-over` group
  (console: `rapidContext.systems.gfx.scene.enableLayers('debug')`).
  Checked in headless Chromium against live OSM sidewalks; the driver script stays outside the repo.
  That testing showed corners producing needs-review stretches, so the "near" angle defaults to the
  "same" angle. Follow-up: line rules only match OSM lines (sidewalks were matching building edges).
- ✅ Step 4b, found while debugging a live session over CDP (see `backlog.md`, "Debugging loop"):
  - Untagged multipolygon outer ways report `geometry() === 'line'`, so sidewalks still matched buildings
    drawn as multipolygons. Fixed: `OsmWay.asFeature(graph)` resolves an untagged multipolygon member to
    its relation (as an area, with the relation's tags). The matcher checks rules against that feature and
    records candidates by feature ID, so two outers of one building are one candidate. Boxes keep both
    `entityIDs` (features) and `wayIDs` (for joins); runs only join ways whose feature is a line.
  - Rules without tag conditions match roads, railways and waterways. Decided: no default tag condition;
    the user sets one. Conflation still runs without a data mapping for now (useful for showing the
    difference a mapping makes). Whether to require a mapping or just warn is still open.
  - `invalidate()` now also drops compiled property matchers, so rules edited in place are picked up.
- ✅ Step 4c: new rule shape, worked out with Bryan against real data. `source`/`target` sides (geometry +
  `props`), `sameKeys`, and "same"/"near" distances and angles (`sameDist`, `sameAngle`, `nearDist`,
  `nearAngle`). Every source feature is tested; rules combine with OR; failing `source.props` means that
  rule can't say "same" (not "no result"). See the request-to-rule table in the design doc's Rules section.
- ✅ Step 5: accepting a run with its joins. Runs that aren't matched get their own `GeoJSONData`
  (`LineRun.datum`, now with a piece ID, see below), which `PixiLayerRapid` binds to the run's feature,
  so selection and the inspector work unchanged. `ConflationSystem.getJoins()` →
  `actionRapidAcceptFeature(datum, joins)` reuses the end node, or inserts a node into the target
  segment (re-finding the segment if the other end's join split it). Line ends also join allowed
  target lines within `sameDist` (crossings connect to sidewalks). Stale joins are skipped.
- ✅ Step 5b, from live testing on real data: runs are trimmed to their joins (a join that snapped to a
  corner node left the run reaching ~2 m around the corner), and lines shorter than `sameDist` skip the
  angle test (OSW data is full of junction stubs; ~9% of lines are under 1 m). No minimum line length:
  some short edges are real. Open: such a real stub next to a matching sidewalk now counts as mapped.
- Next: Step 6, the Conflation Settings UI (rule editing, persistence of `ds.conflation`).
  Persistence: done via settings v2 Steps 1–2 (see [`design/settings-system.md`](../design/settings-system.md)
  and [`design/rapid-system.md`](../design/rapid-system.md)). A custom dataset's conflation settings are
  saved with it in the `DatabaseSystem` `datasets` store whenever `rapid.saveDatasetSettings(ds)` runs.
  ✅ Verified live (Oct 21): Bryan re-added both datasets (sidewalks and crossings), set up their data
  mappings, applied the conflation rules; they persist in IndexedDB across reloads, and accepted lines
  join the OSM basemap at the blue join points.
- Step 6 (Conflation Settings UI) first version, in `UiRapidDatasetSettings`: the definition text, a
  "Match against OpenStreetMap" switch (`ds.conflated` is now THE on/off switch; `conflation.enabled`
  is gone), "Show features that are already mapped", and a rules table like the data mapping table.
  Every dataset is editable, service ones too (their server-side conflation is going away); changes to
  service/asset datasets are `changes` records in the `datasets` store (`rapid.dataset.*` is gone).
  ✅ Tried in the browser on real data (Oct 21): validation, add/remove/restore, OK re-matches and saves
  (0.5 m vs 3 m moved 65 sidewalks in view from matched to needs review), Cancel discards, service
  datasets editable. Still to do: per-side `props` editing, live counts, live tuning; column widths
  in the rules table are uneven (browser auto layout).
- Sampling fix (Oct 21): `geomCoverageBoxes` now spaces samples evenly along the whole line (ends
  included), with headings measured over a ~1-spacing window (`geomHeadingAlong`); run boundaries are
  refined by bisection to 10 cm. Checked live: curves sampled evenly with no "needs review" at corners
  (the old per-segment sampler took 2.2× the samples on curvy sidewalks, 11% more overall); the
  remaining needs-review lines are whole lines 3–6 m from an OSM sidewalk, as intended.
- First demo (Oct 22) went well; people got it once shown the debug view (blue join points). Still hard
  to explain what the feature is. Follow-up (Oct 26): the "near" band (`nearDist`, `nearAngle`) is
  removed, so rules have one distance and angle, and "needs review" (`uncertain`, `getQueue`, the amber
  highlight) is gone too; triage is already mapped or new. `sameKeys` now applies to line-end joins
  (a sidewalk was joining a stream). More feedback expected as people use it.
- JOSM's Conflation plugin (Oct 26): read its source; findings are in "Prior art" in the design doc,
  and likely requests are in `backlog.md` ("Conflation: what JOSM users will ask for").
- Stable IDs (Oct 22): features are `${datasetID}:${isID value ?? hash}:${partIndex}`, pieces of lines
  are `${dataID}@${start}-${end}` (fractions of length, Overture-style). `RapidSystem.actedRanges()`
  gathers what the user accepted or ignored, and conflation cuts those stretches out of the runs, so an
  accepted piece no longer comes back as "already mapped". Changing `isID` reloads the data. Not yet
  tried in the browser. Open: lock `isID` once the user has acted on a dataset (see `rapid-system.md`).
- Settings direction (agreed Oct 21): "everything the user can change is a document", with three kinds
  inside: settings, collections, state. Target: a VS Code-style `settings.json` editor. Written up in
  `design/settings-system.md` (Vocabulary, The target: `settings.json`, Rollout v2 Steps 3–8).
  Planned for after the conflation demo.
- **Test data is synthetic only.** Generate a small street grid in code. Agency sidewalk data typically
  runs about 1–2 m off OSM, so the default `sameDist` is 3 m.
- The scoring formula should eventually match the server-side matching tools. That's being gathered and
  doesn't block the work.

## Next up (after conflation)
- **Validator tests:** `crossing_ways` / `almost_junction` tests run again; one `it.skip` is left in
  `almost_junction.test.js` ("horizontal and tilted road"). See `design/validation-system.md` for the rest.
- **Stored-files management UI** (`DatabaseSystem` Phase 4 design): list stored files with sizes so users
  can free space when `canStoreAsync()` says no. Only `UiRapidAddDataset` calls `canStoreAsync` today.
- **Custom-data consumer ownership**: move the `DragAndDropSystem` consumer registration out of
  `PixiLayerCustomData` (rendering layer, mild smell) into a proper system.
- **Stretch: images → EXIF → photo markers** (future local-photos consumer, wires into `PhotoSystem`).
- **KeyboardSystem phases 2 & 3** (remappable shortcuts).
- Open questions in `design/database-system.md` (DB name/scoping, graceful-degradation doc).
- **agent-practices:** consider adding the "folder-specific `AGENTS.md`" convention to the shared template.
- **Report upstream to Bun:** the transpiler cache key ignores whether a file was compiled as a test (see `quirks.md`).

## Still-open future work
- **Automated testing of `UiSystem` + `UiWhatever` components.** The modal stack + Esc/Backspace
  routing (and `KeyboardSystem` document listeners) can't be unit-tested under bun without a browser.
  Figure out a headless-browser or testable-seam approach.
- **Manual smoke-test** the nested Rapid dataset modals (catalog / add-custom-data / colorpicker) in
  a real browser to confirm stacking, Esc, and close behavior.
- **`CycleHighwayTagOperation`'s module-level `_lastSelectedIDs`.** The one remaining module-level
  mutable global in `operations/`. Consider moving it onto a system per the system-ownership rule.

## Open questions
- Delete the 2 dead quarantined `sections/*.jsx` React demo files + `section.ts`/`uiSection`?
