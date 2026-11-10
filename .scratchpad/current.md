# Current Work

## This branch (`conflation-system`)
Data IDs (steps 1–5), the validation audit and the graph-geometry rollout have all landed (see
`completed.md`). Bryan wants to land this branch for testers before starting the multiselection design
(`backlog.md`), to keep conflation in focus. Next: a release check in the debug Chrome on real data
(accept with joins, autoconnect, undo/redo, Autofix All, panning while editing, QA and photo layers,
backup restore, a faked upload conflict), then merge to main.

## Bug hunt 2 (Nov 4): open issues
The second `/bughunt` before handing the branch to testers. The first hunt's 36 findings are fixed
(`completed.md`). Status: *new* (this branch) or *main too*; *confirmed* (a repro) or *reading* (read
in the code only). Repros are in the session scratch folder (`hunt2/`), which doesn't last; each item
says enough to repro again. Coverage that came back clean: 400 seeds × 250 steps of random `EditSystem`
histories (emits, shapes, both indexes, segments, node memos, parent lists, session difference), with
2,432 backup round trips compared edit by edit, 1,037 reset-and-restore cycles with editing after,
checkpoint graph integrity and no new-ID reuse; the Graph model test at 3,000 seeds; two live soaks on
Seattle data (280 commits, up to 100k entities, selection and validation checks). The first hunt's
fixes held up, except 9, 10 and 11 (items 7, 22 and 26 below).

Follow-up from the first hunt, not done: after switching to the dev API in the same tab, its dev
sessions aren't offered for restore (restore is only offered at startup, which is always live).

The conflation items (6, 8, 9, 23, 24, 25) moved to "Known bugs" in `design/conflation-system.md`:
conflation is still a work in progress, and comes back after the core systems are stable. The
numbers below keep the hunt's numbering.

### High: fix before testers
1. ✅ **The DB upgrade from v2 to v3 can stop Rapid from starting.** A tab running `main` on the same
   origin holds the v2 database open, and `openDB` has no `blocked`/`blocking` handlers, so
   `database.initAsync()` (and with it `EditSystem` and `RapidSystem` init) never settles. After the
   upgrade, `main` builds on that origin get `VersionError` and fall back to memory (no backups).
   `DatabaseSystem.ts:796`. *New (the bump), confirmed.*
   **Fixed:** handlers for `blocking`/`blocked`/`terminated`/`VersionError` and a `status` getter
   (see "Other tabs and version bumps" in `design/database-system.md`); `UiApiStatus` now stacks
   messages and shows storage problems. No backport to `main` needed: this branch becomes `main`
   (v3.0.0-pre.4).
2. ✅ **Saving again after a -6 ("can't tell") upload loses its upload mark.** If the retry fails before
   uploading (offline at create), `_uploadCallback` clears mark 7 anyway; if it uploads, mark 8 replaces
   mark 7, and its 409 (exactly what happens if changeset 7 landed) clears it. The next tab then offers
   edits that already landed: a duplicate upload. `UploaderSystem.ts:674`, `EditSystem.markUploadAsync`.
   Fix: settle an existing -6 mark before a new upload; only clear a mark for this attempt's changeset.
   *New, confirmed.*
   **Fixed (2, 3 and 18 together):** on -6 the tab lets go of the marked session
   (`releaseSessionAsync`), resets, and asks the user to reload; the reload settles it. So nothing
   edits or re-uploads a marked session, and the mark's `index` is gone. A known failure clears only
   its own changeset's mark. See "Keeping the edits during a save" in `design/uploader-system.md`.
3. ✅ **Settling an upload by history index deletes edits made after an undo.** Marked at index 2, -6,
   then undo + a different edit (index 2 again), close the tab; changeset landed, so the next tab deletes
   the session with the unuploaded edit. `EditSystem.ts:2369` (`record.data.index === upload.index`).
   Fix: record which edit the mark was taken at, not the index. *New, confirmed.*
4. ✅ **"Use theirs" on a way overrides "Keep mine" on its node.** User moves n2 and retags w1; the other
   mapper retags w1 and moves n2. Leave w1 on "Use theirs", pick "Keep mine" on n2: Save reverts w1's
   nodes, so n2 goes back to base (neither version), nothing is left to upload and the session is
   deleted. Related: a shared node's result depends on which conflict the screen showed last.
   `UploaderSystem.ts:839` (`processResolvedConflicts`). *New in practice (main never opened the
   screen), confirmed.*
   ✅ **Fixed (with 19, 20, 22 and "moved by both"):** a node with its own conflict follows its own
   choice (`ownChoiceIDs`); saving the screen applies every choice again; what's left just as the other
   mapper has it goes into the base (`_settleSameAsRemote`). See "Use theirs for a way" in
   `design/uploader-system.md`.
5. ✅ **A restore whose base version was redacted silently reverts another mapper's change.** The base
   falls back to the current version (v2, with their `cuisine=pizza`), so after a 409 the safe merge sees
   only the user's side and uploads without the tag, no conflict. `EditSystem.ts:1999`
   (`_fetchBaseEntitiesAsync`), `merge_remote_changes` `mergeTags`. *New, confirmed.*
   Fixed: edits made to a redacted version are left out, both on restore (the entity stays at the
   current version, the restore screen says so) and at save (`_findRedactedAsync`: a conflict with
   "Use theirs" as the only choice). A fallback way's child nodes are fetched too.
7. ✅ **Redo, and the extra redo that returns to where you were, delete an empty new relation.** The fix for
   first-hunt item 9 only covers undo: at the newest edit there's nothing to redo, and the history jump
   re-enters select, so `exit()` commits "Deleted a relation". Repro: membership "add to new relation"
   (untagged, one member, no role), undo, redo, extra redo. Or: tag r-1, remove the tag, undo, redo.
   `SelectMode.ts:240`. *Return view new; plain redo main too. Confirmed.*
   ✅ **Fixed:** the cleanup is commented out (the comment says why, and what would bring it back);
   `missing_tag` flags an empty relation as an error with a delete fix. See "Render relations" in
   `backlog.md`.

### Medium
10. ✅ **Synced settings read once at startup ignore the value the startup sync pulls,** and the next
    toggle writes the stale value back to the account (A disables `crossing_ways`; B starts, pulls it,
    still shows it enabled; B turns off `almost_junction`, and the account loses A's choice). Validator
    rules (`ValidationSystem.ts:193`), filters (`FilterSystem.ts:153`), imagery favorites
    (`UiSectionBackgroundList.ts:90`); no `settingschange` listener. A `disable_features=` URL param is
    written into the synced setting too. *New, confirmed.*
    ✅ **Fixed:** the three re-read their list on `settingschange`. Filters: the url's
    `disable_features` decides for the session and isn't saved; a user's change saves only the filters
    they changed (a reload always has the url, so saving the whole screen would overwrite the account).
    Area fill, opacity and raw tag editor view still show a pulled value only after a reload.
11. ✅ **An empty value never syncs,** so re-enabling every rule (or filter) stays local and the account
    keeps the old list. `SettingsSystem.ts:888`. *New, confirmed.*
    ✅ **Fixed:** an empty value travels as `""` (`toRemoteValue` / `fromRemoteValue`).
12. ✅ **Sync deletes account keys this build hasn't registered** (a newer build's paths, or `ui.*` and
    `poweruser.*` when those components aren't built), so testers switching builds lose preferences.
    `SettingsSystem.ts:854`. *New, reading.*
    ✅ **Fixed (Nov 9):** the sync leaves keys it doesn't sync alone. Cleaning up the old sync's copies
    is still open: see "Cleanup (open)" in `design/settings-system.md` (systems declaring their local
    settings with a `registerLocal`, `meta` owned by `SettingsSystem`, dead paths in a migration).
    Before that, decide whether `imagery.lastUsed` and `rapid.enabledDatasetIDs` should sync. Truly
    dead now: `rapid.custom.*`, `rapid.dataset.*` (in `DatabaseSystem` now), `ui.restrictions`.
13. ✅ **A failed user-details call resets the sync base,** so the next good sync lets the remote win over
    a newer local change. `SettingsSystem.ts:835`. *New, confirmed.*
    ✅ **Fixed:** the sync stops (`no-user` / `no-preferences`) before touching the base.
14. ✅ **Undo out of a draw mode selects the newest edit's `selection`** (maybe offscreen), not what
    `MapSystem` would (`selectionBefore`, or `mode.selectionBefore` for a same-index undo); non-OSM IDs
    are always dropped. Same class as first-hunt item 22. `DrawLineMode.ts:866`, `DrawAreaMode.ts:825`.
    *Pattern main too, confirmed.*
    ✅ **Fixed:** draw modes call `MapSystem.restoreJumpSelection(prevIndex, currIndex)`, the one rule.
15. ✅ **Redo restores what an operation committed with, not what it then selects:** drag vertex (the
    vertex, not the way), split (the vertex, not the lines), multipolygon merge, extract, delete vertex,
    add member. `DragNodeMode.ts:369`, `SplitOperation.ts:92` and others. *Main too, but `selection` now
    means "after". Reading.*
    ✅ **Fixed:** `selection` is renamed `selectionAfter` (old backups upgrade), and drag, split, extract,
    merge, delete and the membership editor commit with what they select next
    (`test/unit/operations/selection_after.test.js`). Checked live: split, undo, redo.
16. ✅ **`resetAsync()` with no edits re-selects the current selection instead of going to browse**
    (`historyjump(0, 0)` reads as "work in progress thrown away"), possibly data whose cache was just
    cleared. `EditSystem.ts:540`. *New, reading.*
    ✅ **Fixed:** `Context.resetAsync` enters browse mode before resetting the systems.
17. ✅ **Osmose/KeepRight: after an issue is closed, the editor stays up.** SelectMode's `change` handler
    finds no cached issue and returns; a second "done" click falls back to the stale datum,
    `replaceItem` puts the closed issue back on the map, and it posts again (`_closed` counts 2).
    `UiOsmoseEditor.ts:197`, `UiKeepRightEditor.ts:262`, `SelectMode.ts:361`. *Re-adding new, double post
    main too. Confirmed (Osmose).*
    **Fixed:** SelectMode's `change` handlers (notes, KeepRight, Osmose, MapRoulette) return to browse
    mode when the datum is gone from its service's cache, but only if it's still what's selected.
18. ✅ **With no answer, the tab decides "not applied" (-5) right away and reuses the changeset,** while
    `_checkUploadAsync` calls the same state (open, 0 changes, recent) "pending"; a late landing gives
    duplicates. `OsmService.ts:1565` vs `EditSystem.ts:2407`. *New, reading.*
    **Fixed:** `sendChangeset` closes the changeset before counting (cgimap's close fails while an
    upload holds the changeset lock), so -5 is final and the retry opens a new changeset; a failed
    close is -6. `closeChangeset` now reports HTTP errors (`fetchRaw` doesn't reject on them).
19. ✅ **"Deleted by both" brings back the way's nodes the user deleted,** and drops those deletions
    (`actionRevert` now restores deleted children). `merge_remote_changes.ts:324`. *New, confirmed.*
    ✅ **Fixed:** the deletion stays, and the uploader leaves out what's deleted on both sides.
20. ✅ **"Leave Deleted" on a way leaves the other mapper's new nodes as orphans** on OSM.
    `UploaderSystem.ts:464`. *New, reading.*
    ✅ **Fixed:** `_deleteOrphanedNodes` (confirmed by a test first).
21. ✅ **A link with both `id=` and `note=` ends with only the note selected** (`selectNoteID` replaces the
    multiselection, and zooms to z19). `MapSystem.ts:343`, `selectNoteID`. *New, confirmed.*
    ✅ **Fixed** by redoing the layer url params: `note=<id>` is read as part of `id=` (`osm-notes:<id>`);
    a link's `id=` turns on the layers that draw what it selects (`drawsData`/`PixiScene.showData`) and
    downloads notes; layer visibility is saved in settings (`layers.enabled`) with `layers=` as the
    session override; `note=`, `photo_overlay=` and `maproulette=true` are legacy, read once. The
    `notes` layer is now `osm-notes`. Also fixed: `MapRouletteService` listened for `hashChanged`
    (never emitted), so `maproulette=` links never worked.

### Low
22. ✅ **"Use theirs" uploads unchanged copies of shared nodes the other mapper changed** (`force_remote`
    puts in the remote copy, and shared nodes aren't reverted). Side effect of first-hunt item 10.
    `merge_remote_changes.ts:175`. *New, confirmed.*
    ✅ **Fixed:** `_settleSameAsRemote` puts those copies in the base instead.
26. ✅ **Custom-data IDs in `id=` can never be found from a link,** because `data=` is stripped from the
    URL (`toOmit`). `UrlHashSystem.ts:260`. *New, reading.*
    ✅ **Fixed:** `data` follows the url rule: a link's `data=` stays until the layer is turned off or
    other custom data is loaded, and the layer never writes it (`gpx=` is kept as `data=`). Checked
    live: a link with WKT `data=` and a custom `id=` reloads with the feature selected.
27. ✅ **During the walkthrough, the user's session stops heartbeating,** so after 60 s another tab can
    restore it, and both write it after `continueSession`. `UiIntro.ts`. *New, reading.*
    ✅ **Fixed:** `editor.holdSession()` keeps heartbeating it through the walkthrough, and
    `continueSession` keeps its record cached so the heartbeat goes on until the next backup
    (`releaseSession` if the edits can't be given back). Also found: a backup still being written
    when the session was continued wrote the replaced session back; `_saveSessionAsync` now skips it.
28. ✅ **Custom data: a slow URL load can overwrite a newer file,** and the newer one's namespaced cache is
    never cleared. `PixiLayerCustomData.ts:509`. *Leak new, race main too. Reading.*
    ✅ **Fixed:** a url or file load that other custom data replaced is dropped, and `_setFile` clears
    the cache it replaces.
29. ✅ **The history card shows "Note osm-notes:123"** (prints the data ID). `UiHistoryCard.ts:151`.
    *New, reading.*
    ✅ **Fixed:** it shows the note's own ID.

### Already in `main`
30. ✅ **The MapRoulette right-click menu can never submit:** `_getApiKey` calls `osm.loadMapRouletteKey`,
    which doesn't exist, so every click throws. Also reads `osm._userDetails.id` unguarded. Fix: do what
    the editor does (`getUserPreferencesAsync`, `maproulette_apikey_v2`). `UiMapRouletteMenu.ts:313`.
    *Confirmed.*
    ✅ **Fixed differently:** MapRoulette expired the keys in the OSM preferences
    (https://community.openstreetmap.org/t/maproulette-security-incident-october-2026), so all MapRoulette
    auth is commented out and Rapid submits without a key (see "MapRoulette authentication" in
    `backlog.md`). The menu submits directly, and `_userDetails` is read with `?.`.
31. ✅ **Stopping an animated operation partway disables backups for the rest of the tab** (circularize,
    orthogonalize, straighten, reflect, unsquare fix). Any other edit or undo within its 150 ms
    interrupts it; the `'end interrupt'` handler only finishes inside a transaction, so `_inTransition`
    stays set (`immediateBackup` returns early), the promise never settles, and the partial frame is
    committed inside the other edit. `EditSystem.ts:749`. *Confirmed.*
    ✅ **Fixed:** `performAsync` is now `animateAndCommitAsync(action, props)`. It commits the action
    itself, at the end or when interrupted (`end`, `interrupt` or `cancel`), so it's always its own edit
    before whatever interrupted it runs (a caller's `.then(commit)` ran after). No animation in a
    transaction.
32. ✅ **Midpoints keep their old way ID after a merge or split:** they're reused by segment coordinates
    and `feature.data` is set only on create, so dragging one throws (`OsmEntity w2 not found`) and
    clicking one deselects. `PixiLayerOsm.ts:857`, `DragBehavior.ts:203`. *Confirmed (stale ID).*
    ✅ **Fixed:** a midpoint is reused only if its way and nodes are the same, the feature rebinds when
    its data changes, and the link to its way is added every frame (a way's redraw replaces its links)
    and removed when the midpoint isn't drawn. Checked live: split a way, every midpoint matches.
33. ✅ **`clearChildData` never removes children's links back to the parent:** it passes the live set,
    which the first loop empties, and `removeChildData` deletes `childID` instead of `parentID`. Vertices
    of other ways get drawn as related. `AbstractPixiLayer.ts:308`, `:324`. *Confirmed.*
    ✅ **Fixed:** both.
34. ✅ **MapRoulette can post the same comment twice** (Submit again after the comment POST, before the
    PUT). `MapRouletteService.ts:437`. *Reading.*
    ✅ **Fixed:** submitting does nothing while any of the task's requests are in flight, and a comment
    already posted for the task isn't posted again when the user retries after a failed status update.
35. ✅ **For 2.5 s after a successful upload, Escape plus an edit (or closing the tab) makes a new session
    of the uploaded edits,** offered for restore next time. `SaveMode.ts:375`. *Reading.*
    ✅ **Fixed:** after a successful save, Escape stays off, so the reset is the only way out of save mode.
    And after `clearBackup` (an upload, or the source switcher) `hasWork()` is false until the reset:
    no backup and no "Leave site?" prompt for edits already on OSM. Checked live with faked uploader events.
36. ✅ **`#walkthrough=true` with a stored session means no backups for the rest of the tab**
    (`_canRestoreBackup` stays true). `UiSystem.ts:328`. *Reading.*
    ✅ **Fixed:** starting the walkthrough calls `editor.dismissRestore()`. The sessions stay, and are
    offered the next time Rapid starts normally (Bryan: a `walkthrough=true` link is for a class of new users).
37. **Arrow keys:** with a photo viewer open, plain arrows both nudge the selection and step the photo;
    with a focused button, Ctrl/⌘+↑↓ does nothing (`SelectMode._keydown` requires BODY).
    `SelectMode.ts`, `MapInteractionBehavior.ts`. *Reading.*
38. **`y_shaped_connection` isn't revalidated when a road joins or leaves the neighboring node**
    (related entities add parent ways, never sibling nodes). `y_shaped_connection.ts:214`,
    `ValidationCache.ts:198`. *Confirmed.*
39. **A road through a building can give two crossing issues:** with `oneOnly`, each side reports the
    first crossing it finds, and the hash is the segments (4 of 16 orientations). `crossing_ways.ts:525`.
    *Confirmed.*
40. **On a crossing of about 2 m or less, the `curb_nodes` fix retags the crossing as sidewalk**
    (`actionSplit` keeps the ID on the longest part). `curb_nodes.ts:240`. *Reading.*

Not bugs: undoing during an animated operation doesn't commit an empty edit (the promise never settles;
the real problem is item 31). A huge `sameDist` (e.g. 100000) passes validation and makes conflation
crawl. A history graph that isn't current and hasn't caught up with the base gives stale searches, and
its own `geometry()` is just as stale; that's the documented design, and nothing searches one.

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
Left from the audit: a new changeset when the old one was closed. (The "moved by both" false conflict
was fixed with bug hunt 2's items 4, 19, 20 and 22.)
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
- **Mapillary traffic signs share the `mapillary-detections` namespace** with the other detections
  (`MapillaryService.getData` splits them by `object_type`). So a link to a sign can't tell from its
  namespace which layer to turn on, and turns on the detections layer. Store signs in their own
  `mapillary-signs` namespace (removes the filter too); that changes signs' data IDs.
- **Imagery customizations, like the dataset ones.** The imagery offset is for the session only (Nov 9).
  Some sources always need the same offset, so Bryan could see saving an offset per source in a synced
  setting, the way `RapidSystem` keeps the user's changes to each dataset.

## Open questions
- Delete the 2 dead quarantined `sections/*.jsx` React demo files + `section.ts`/`uiSection`?
