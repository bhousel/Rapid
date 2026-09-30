# Current Work

No active in-progress task. Working tree is clean on `main`.

## Last landed
`KeyboardSystem` phase 1 — `util/keybinding.ts` is now `core/KeyboardSystem.ts`, an
`AbstractSystem` reachable via `context.systems.keyboard`. See `completed.md`,
[`.github/design/keyboard-system.md`](../.github/design/keyboard-system.md), and
[facebook/Rapid#1076](https://github.com/facebook/Rapid/issues/1076).

## Next up
- **KeyboardSystem phases 2 & 3** (remappable shortcuts — SettingsSystem persistence, then UI).
  Full plan in `backlog.md`.

## Still-open future work
- **Automated testing of `UiSystem` + `UiWhatever` components.** The modal stack + Esc/Backspace
  routing (and now the `KeyboardSystem` document listeners) can't be unit-tested under bun without a
  browser. Figure out a headless-browser or testable-seam approach.
- **Manual smoke-test** the nested Rapid dataset modals (catalog / add-custom-data / colorpicker) in
  a real browser to confirm stacking, Esc, and close behavior.
- **`CycleHighwayTagOperation`'s module-level `_lastSelectedIDs`.** The one remaining module-level
  mutable global in `operations/`. Consider moving it onto a system per the system-ownership rule —
  left with a comment for now.

## Open questions
- Delete the 2 dead quarantined `sections/*.jsx` React demo files + `section.ts`/`uiSection`?
