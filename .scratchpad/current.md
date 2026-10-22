# Current Work

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
  (`LineRun.datum`, id `${dataID}~${firstBoxIndex}`), which `PixiLayerRapid` binds to the run's feature,
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
- Settings direction (agreed Oct 21): "everything the user can change is a document", with three kinds
  inside: settings, collections, state. Target: a VS Code-style `settings.json` editor. Written up in
  `design/settings-system.md` (Vocabulary, The target: `settings.json`, Rollout v2 Steps 3–8).
  Planned for after the conflation demo.
- **Test data is synthetic only.** Generate a small street grid in code. Agency sidewalk data typically
  runs about 1–2 m off OSM, so the default `sameDist` is 3 m.
- The scoring formula should eventually match the server-side matching tools. That's being gathered and
  doesn't block the work.

## Last session (Oct 2026): agent tooling for Claude Code
- Reusable prompts became Agent Skills in `.claude/skills/` (via `rapideditor/agent-practices` PR #1 + `/sync`).
  Both Claude Code and VS Code Copilot find them there.
- `.github/instructions/*.instructions.md` became nested `modules/ui/AGENTS.md` and `modules/pixi/AGENTS.md`
  (see `decisions.md` for the why). The folder READMEs link to them.
- Docs refresh: AGENTS.md Testing section, module READMEs, DnD/Database design-doc status.
- Fixed a stale Bun transpiler-cache entry that broke `extract.test.js` (see `quirks.md`).

## Next up (after conflation)
- **Re-enable `crossing_ways` / `almost_junction` validator tests** (still `describe.todo`). They cover the
  `segments` index that line conflation depends on.
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
