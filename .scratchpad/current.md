# Current Work

## UI module refactor — branch `ui_refactors`

All major refactor waves on this branch are now committed and pushed. See `completed.md` for
a reverse-chronological history. The `modules/ui/` conversion table in `AGENTS.md` is current.

## Future work
- **Automated testing of `UiSystem` + `UiWhatever` components.** The modal stack + Esc/Backspace routing
  now live on `UiSystem`; we can't unit-test that under bun without instantiating a full `UiSystem`
  (currently needs a browser). The raw standalone Esc/Backspace modal tests were dropped for this reason.
  Figure out a way to exercise `UiSystem`-owned behavior (headless browser? a testable stack seam?).
- **Manual smoke-test** the nested Rapid dataset modals (catalog / add-custom-data / colorpicker) in a
  real browser to confirm stacking, Esc, and close behavior.
- **`CycleHighwayTagOperation`'s module-level `_lastSelectedIDs`.** Now that `operations/` is classes, this is the
  one remaining module-level mutable global there. Consider moving it onto a system (edit/undo state?) per
  the system-ownership rule — out of scope for the conversion, left with a comment.

## Open questions
- Delete the 2 dead quarantined `sections/*.jsx` React demo files + `section.ts`/`uiSection`?
