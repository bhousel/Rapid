# Current Work

## EventEmitter migration — branch `ui_refactors` (uncommitted)

Replaced the legacy `d3_dispatch` + `utilRebind` event pattern with `EventEmitter` from
`tseep/lib/ee-safe` across all UI class components.  42 files changed; not yet committed.

**What changed:**
- `AbstractUiSection` and `AbstractIntroChapter` now `extends EventEmitter` (so all subclasses inherit
  `.on`/`.off`/`.emit` automatically).
- 34 other classes converted: all field internals (`UiFieldX`), `UiField`, `UiChangesetEditor`,
  `UiEntityEditor`, the 3 dispatch-using sections, `UiPresetList`, `UiRapidColorpicker`,
  `UiMapRouletteMenu`, `UiSettingsCustomBackground/Data`, the 4 QA editors, `UiCommit`,
  `UiConflicts`, `UiSuccess`, `UiEditMenu`.
- The 5 intro chapter `EditMenu.on('toggled.intro', h)` / `on('toggled.intro', null)` calls
  converted to saved-handler-ref + `.off('toggled', h)`.
- `SaveMode`'s `.on('cancel', null)` removal idiom → `.off('cancel', this._cancel)`.
- `UiFieldLanes.off()` → `_detach()` to avoid colliding with `EventEmitter.off`.
- One browser test (`wikipedia.test.js`) updated: `on('change.spy', fn)` → `on('change', fn)`.
- `combobox.ts` / `disclosure.ts` still use `d3_dispatch` (factory functions, not classes — left alone).

**UiFieldRestrictions stub (`fields/UiFieldRestrictions.ts`):** converted from all-commented legacy
code to a modern `EventEmitter` class registered in `fields/index.ts`. The `render()` is a stub
(empty `.restriction-container` div + `// todo`) — the old SVG mini-map depended on `modules/svg/`
which was removed. The field is registered in `uiFields` but NOT yet instantiated by
`UiSectionPresetFields` (that block stays commented). `fields/index.ts` indentation fixed (4→2 spaces).

**Verified:** tsc 0 errors / eslint 0 errors (4 pre-existing `todo` warnings) / build OK /
browser 133 pass / unit 3290 pass.

## Open questions
- Delete the 2 dead quarantined `sections/*.jsx` React demo files (currently ignored by all real code)?
