# Current Work

No active in-progress task. Working tree is clean on `main`.

## Last landed (this session)
Full `DatabaseSystem` + `DragAndDropSystem` series for [facebook/Rapid#1078](https://github.com/facebook/Rapid/issues/1078).
See `completed.md` for one-liners, design docs in `.github/design/`, `decisions.md` for the "why".

Key commits:
- `11a9ac381` — `DatabaseSystem` phases 0+1 (`idb` wrapper, `sessions` store, structured backup)
- `c28f834fd` — Phase 2: multi-session restore UI, retire localStorage writes, retire mutex, `UiRestore` rewrite
- `f726a1628` — Phase 2.1: session liveness heartbeat, `sessionStorage` reload-aware, race-free cache
- `9cb032444` — Phase 3: `files` store, native-Blob API on `DatabaseSystem`, schema v1→v2
- `a7b6215ed` — `DragAndDropSystem`: claim-based registry, migrated `PixiLayerCustomData` drop handler

## Next up (open follow-ups from this session)
- **`UiRapidAddDataset` file→dataset flow**: revive the commented-out file block as a high-priority
  `DragAndDropSystem` consumer (the drop-routing plumbing is now in place; the dataset loading logic
  needs to be written/restored).
- **Reload-on-startup for persisted files**: a flow to re-offer `DatabaseSystem` files from the
  previous session (auto-reload or prompt — open question in the design doc).
- **Custom-data consumer ownership**: move the `DragAndDropSystem` consumer registration out of
  `PixiLayerCustomData` (rendering layer, mild smell) into a proper system.
- **Stretch: images → EXIF → photo markers** (future local-photos consumer, wires into `PhotoSystem`).
- **KeyboardSystem phases 2 & 3** (remappable shortcuts — backlogged before this session).
- Open questions in `.github/design/database-system.md` (reload UX, DB name/scoping, graceful-degradation doc).

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
