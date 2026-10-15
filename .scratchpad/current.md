# Current Work

## Active: matching third-party data against OSM (`ConflationSystem`)
Top priority. Design: [`design/conflation-system.md`](../design/conflation-system.md), currently proposed and
awaiting a final review. Guiding use case: *accept the part of the sidewalk that is missing, and join it
to the part that exists.*
- ✅ Step 1: `GeometryPart.computeCoverage(radius)` (meters, caches the most recent radius) + `geoMetersToWorld`.
- 🔄 Step 2: design doc, revision 3. The stages are Match → Score → Triage → Act. In the UI, "conflation"
  appears only as the "Conflation Settings" heading, defined right below it in stage words. The bands
  are "Already mapped", "Needs review" and "New". Code keeps "conflation" (`ConflationSystem`).
  The review queue covers the viewport only. See "Resolved Decisions" in the doc.
- Next: Step 3, the `ConflationSystem` core for **lines first** (rules, measures, provisional scoring,
  triage bands, runs, segment `index`/`t` on `CoverageBox`).
- **Test data is synthetic only.** Generate a small street grid in code. Agency sidewalk data typically
  runs about 1–2 m off OSM, so the default buffer is 3 m.
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
