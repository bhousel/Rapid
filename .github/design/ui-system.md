# UI System Modernization

This document plans a sweeping modernization of everything under `modules/ui/`. The end state is a
uniform set of **TypeScript class components** that follow Rapid's newest conventions, render
idempotently, respond to re-renders and localization changes, and manage their own lifecycle. This
sets us up to eventually swap in a modern component framework (Vue/React) without a big-bang rewrite.

> This is a large, mostly-mechanical conversion. The intent is that an agent can work through it
> **largely unattended**, one cluster at a time, verifying after each step.

## Background

Rapid spun out of iD (~2013), which chose D3.js for all DOM/UI. In 2026 this is dated. We are not
adopting a framework yet, but we want the existing UI code to be uniform, typed, lifecycle-aware,
and relocalization-safe so a future migration is tractable.

Today `modules/ui/` contains three distinct code "levels", which are a deliberate signal encoded in
indentation and filename casing:

- **Level 1 — legacy (pre-ES6).** 4-space indent, `var`, anonymous `function`, D3-idiomatic
  functional closures returning a render function. `snake_case.js` filenames.
  Example: `sections/raw_membership_editor.js`, `combobox.js`.
- **Level 2 — modern functional (ES6).** 2-space indent, `const`/`let`, arrow functions, still the
  D3 closure-returns-render pattern but usually with an explicit named `render(selection)` function.
  `snake_case.js` filenames. Example: `preset_icon.ts`, `entity_editor.js`.
- **Level 3 — modern class (ES6).** 2-space indent, ES6 `class`, `new Foo(context)` lifecycle,
  explicit `render($parent = this.$parent)`, `$`/`$$` selection naming, JSDoc. `CamelCase.js`
  filenames. Example: `UiMapToolbar.js`, `cards/AbstractUiCard.js`.
- **Level 4 — TypeScript class.** The target. Only `core/UiSystem.ts` is here today. Adds
  `D3Selection`/`D3EnterSelection` types, ID types, full typing.

## Goals

1. Every file under `modules/ui/` becomes a **TypeScript class component** (Level 4).
2. Uniform lifecycle: constructed with `new Foo(context)`, `render($parent = this.$parent)`,
   plus `rerender`/`throttledRender` where appropriate.
3. **Idempotent rendering** — every component can be re-rendered top-down at any time (this is how
   `UiSystem` already handles `localechange`, re-rendering the whole tree).
4. **Relocalization-safe** — text content is written in the *update* phase (post-merge), never only
   on *enter*, so a locale switch re-fills all strings.
5. Consistent conventions: `CamelCase` filenames, `Ui`-prefixed class names, `$var` for selections,
   `$$var` for enter selections, `D3Selection`/`D3EnterSelection` types, ID types over `string`,
   dependency access grouped at the top of methods.
6. Event wiring is explicit and cleaned up (subscribe in constructor/init, avoid leaks).
7. No behavior changes — this is a structural/type refactor, verified by the existing test suite.

## Non-Goals

- Introducing Vue/React or a component library (a later step this work enables).
- Redesigning the visual UI or changing user-facing behavior.
- Converting the experimental JSX React demo files (see Quarantine below).
- Reworking CSS.

## Target Conventions (the canonical shape)

Use this as the template for every converted component. It mirrors `UiMapToolbar` + `UiSystem`.

```ts
import { selection } from 'd3-selection';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';


/**
 * The `UiFoo` component renders the Foo section of the interface.
 *
 * @example
 * <div class='foo'>…</div>
 */
export class UiFoo {
  public context: Context;

  // D3 selections
  public $parent: D3Selection | null;

  /**
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    this.context = context;

    // Create child components
    // this.Bar = new UiBar(context);

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);

    // Event wiring (rerender on relevant changes)
    const l10n = context.systems.l10n!;
    l10n.on('localechange', this.rerender);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but is inferred on subsequent renders.)
   * @param $parent - A d3-selection to the HTMLElement this component renders into
   */
  render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const l10n = context.systems.l10n!;

    // Create wrapper div if necessary (enter)
    let $wrap: D3Selection = $parent.selectAll('.foo')
      .data([0]);

    const $$wrap: D3EnterSelection = $wrap.enter()
      .append('div')
      .attr('class', 'foo');

    // update (merge enter into update so text is (re)written every render)
    $wrap = $wrap.merge($$wrap);

    $wrap
      .text(l10n.t('foo.label'));   // localized text written on UPDATE, not enter
  }
}
```

### Conversion rules (apply to every file)

- **Filename:** `snake_case.js` → `CamelCase.ts`. Use `git mv old_name.js NewName.ts` to preserve
  history (per AGENTS.md). Files already `CamelCase.js` → `git mv Foo.js Foo.ts`.
- **Export name:** `uiFooBar` factory → `class UiFooBar`. Keep the same *concept* name. Update the
  `index.js`/barrel export (and rename the barrel to `.ts` as its folder is completed).
- **Factory → class:** the outer `export function uiFoo(context) { … return foo; }` becomes the
  class; closure-scoped `let _x` become `protected _x` fields initialized in the constructor
  (per AGENTS.md: initialize in the constructor, not as field initializers).
- **Getter/setter chains** (`foo.bar = function(val){ if(!arguments.length) return _bar; _bar = val; return foo; }`)
  become either simple `get bar()/set bar()` accessors or plain public fields, depending on whether
  chaining is actually used by callers. Prefer plain fields/accessors; drop the fluent-chaining
  return-`this` pattern unless a caller depends on it.
- **Events:** all UI classes that emit events extend `EventEmitter` from `tseep/lib/ee-safe`.
  Call `super()` first in the constructor, emit via `this.emit('event', ...args)`, consumers use
  `.on('event', handler)` / `.off('event', handler)`. Do **not** use `d3_dispatch` / `utilRebind`.
  (The two factory functions `combobox.ts` and `disclosure.ts` still use `d3_dispatch` — they are
  intentional exceptions, not classes.)
- **Relocalization:** move all `.text(...)`, `.html(...)`, `.attr('title', …)`, tooltip strings, and
  `l10n.t(...)` calls into the post-merge update selection. Enter creates empty structural elements
  only. This is the single most important behavioral upgrade.
- **Selections:** name update selections `$foo`, enter selections `$$foo`. Type them `D3Selection` /
  `D3EnterSelection`. After `.merge()`, the result is `D3Selection` (no `as any` needed).
- **Dependency access:** group `const x = context.systems.x!;` at the top of each method, blank line,
  then logic (per AGENTS.md). Use `?.` for optional systems (`scheduler`, `settings`, `ui`, `locations`).
- **Types:** use ID types (`EntityID`, `PresetID`, etc.) instead of `string` where the name implies it.
  Untyped legacy sub-components may be typed `any` temporarily; prefer real types when cheap.
- **Binding:** bind callback methods in the constructor (`this.render = this.render.bind(this)`).
- **`rerender`/`throttledRender`:** add `rerender = () => this.render()` when the component subscribes
  to events. Add a throttled variant (see existing usages of `throttle`/scheduler debounce) only when
  the component already throttled or clearly needs it (high-frequency map/hover events).
- **Comments:** preserve existing comments (AGENTS.md). Don't add narration. Convert JSDoc `@param {T}`
  → TS-typed `@param` (drop the `{T}`).

### Base classes and shared shapes

- `cards/AbstractUiCard.js` is already a base class → convert to `AbstractUiCard.ts` first; other
  cards extend it.
- Consider (but do not force) a light shared `AbstractUiComponent` interface capturing
  `context`, `$parent`, `render`, `rerender`. Only introduce it if it removes real duplication;
  otherwise keep components independent to avoid premature abstraction (per AGENTS.md).

## Inventory

Counts are approximate line counts. **Level** is the current level; all targets are **Level 4 (TS class)**.

### Already Level 3 (class) — JS→TS conversion only (lowest risk)

Root:
`UiAccount` (203), `UiApiStatus` (184), `UiAttribution` (147), `UiContributors` (130),
`UiDefs` (120), `UiFeatureList` (538), `UiField` (464), `UiFilterStatus` (125),
`UiFullscreen` (112), `UiInfoCards` (138), `UiInspector` (332), `UiMap3dViewer` (47),
`UiMapControls` (84), `UiMapFooter` (109), `UiMapPanes` (84), `UiMapToolbar` (134),
`UiMinimap` (532), `UiOvermap` (94), `UiOvertureInspector` (290), `UiPhotoViewer` (273),
`UiProjectLinks` (108), `UiRapidAddDataset` (314), `UiRapidCatalog` (573),
`UiRapidDatasetToggle` (479), `UiRapidInspector` (606), `UiRapidPowerUserFeatures` (302),
`UiScale` (143), `UiShortcuts` (369), `UiSidebar` (734), `UiSourceSwitch` (103),
`UiSpector` (189), `UiValidatorStatus` (153), `UiVersionInfo` (104), `UiViewOn` (74).

`cards/`: `AbstractUiCard` (100), `UiBackgroundCard` (266), `UiHistoryCard` (406),
`UiLocationCard` (171), `UiMeasurementCard` (323).

`controls/`: `UiBearingControl` (143), `UiGeolocateControl` (240), `UiZoomControl` (160),
`UiZoomToControl` (154).

`tools/`: `UiDownloadTool` (131), `UiDrawModesTool` (228), `UiRapidTool` (161),
`UiSaveTool` (161), `UiUndoRedoTool` (160).

`intro/`: `UiCurtain` (496).

### Level 2 (modern functional) — rewrite to class + TS

Root: `commit` (700), `commit_warnings` (91), `confirm` (37), `conflicts` (338),
`data_editor` (99), `data_header` (54), `detection_details` (73), `detection_header` (73),
`detection_inspector` (87), `disclosure` (149), `edit_menu` (351), `entity_editor` (466),
`form_fields` (147), `icon` (29), `loading` (63), `keepRight_details` (118),
`keepRight_editor` (206), `keepRight_header` (68), `maproulette_details` (273),
`maproulette_editor` (541), `maproulette_header` (55), `maproulette_menu` (361), `modal` (111),
`note_comments` (116), `note_editor` (398), `note_header` (68), `note_report` (42),
`osmose_details` (203), `osmose_editor` (151), `osmose_header` (72), `pane` (139),
`preset_icon` (321), `preset_list` (677), `rapid_colorpicker` (165),
`rapid_first_edit_dialog` (59), `rapid_splash` (101, currently reachable via
`rapid_first_edit_dialog`), `restore` (72), `section` (127), `splash` (103), `success` (410),
`tag_reference` (211), `toggle` (22), `tooltip` (107), `whats_new` (127).

`fields/`: `access` (264), `address` (358), `check` (239), `input` (266), `textarea` (74),
`wikipedia` (321).

`sections/`: `background_display_options` (126), `background_list` (658), `background_offset` (170),
`changes` (136), `color_selection` (102), `colorblind_mode_options` (104), `data_layers` (490),
`entity_issues` (244), `feature_type` (150), `grid_display_options` (80), `map_features` (109),
`map_interaction_options` (91), `map_style_options` (103), `overlay_list` (167),
`photo_overlays` (281), `preset_fields` (152), `privacy` (73), `raw_member_editor` (403),
`raw_tag_editor` (633), `selection_list` (126), `validation_issues` (263),
`validation_options` (94), `validation_rules` (199), `validation_status` (188).

`settings/`: `custom_background` (116), `custom_data` (174).

`panes/`: `background` (26), `help` (461), `issues` (25), `map_data` (23), `preferences` (22).

`intro/`: `area` (478), `building` (759), `helper` (296), `intro` (288), `line` (1062),
`navigation` (662), `point` (519), `rapid` (394), `start_editing` (137), `welcome` (114).

### Level 1 (legacy pre-ES6) — highest-effort rewrite to class + TS

Root: `changeset_editor` (141), `combobox` (515), `flash` (112), `popover` (361),
`field_help` (241, **disabled** — commented out in `index.js` and `UiField`).

`fields/`: `combo` (735), `cycleway` (172), `lanes` (136), `localized` (520), `radio` (339),
`restrictions` (642, **disabled**), `roadspeed` (143), `wikidata` (361).

`sections/`: `raw_membership_editor` (606).

`fields/index.js` (has `export var uiFields` registry — becomes a typed registry object/Map).

### Quarantine — do NOT convert in this pass

- `sections/react_container.jsx` (53) and `sections/ReactComponent.jsx` (41): experimental React
  demo. Only referenced by a **commented-out** import in `panes/background.js`. Leave as-is; note
  for a separate decision (delete or keep as the seed of the future framework migration).

### Barrels / index files (convert last within each folder)

`ui/index.js`, `cards/index.js`, `controls/index.js`, `fields/index.js`, `panes/index.js`,
`sections/index.js`, `settings/index.js`, `tools/index.js`. Rename each to `index.ts` once all
siblings are converted, updating imports (`.js` → `.ts`) and export names (`uiFoo` → `UiFoo`).

### Disabled code — convert (do NOT delete)

`field_help.js` and `fields/restrictions.js` are currently commented out in `index.js`/`UiField`,
but they **will be un-commented eventually**, so convert them to TS classes alongside their peers
(`field_help` with the field system in Phase 2; `restrictions` with the other `fields/*`). Keep them
wired but commented at their call sites exactly as today until they're re-enabled.

## Dependency Clusters & Phasing

Convert **dependency-first** so consumers only ever import already-modernized code. Verify after each
phase (`bun run test:ts` + `bun run lint`, then targeted tests). Each phase is independently
shippable.

### Phase 0 — Prep
- Confirm branch `ui_refactors`.
- Add any shared types file if needed (e.g. `modules/ui/types.ts` for cross-file UI types — only if
  a real shared type emerges; class-specific `FooProps` stay with their class per AGENTS.md).

### Phase 1 — Foundational shared primitives (everything depends on these)
Order matters within the phase:
1. `icon` → `UiIcon` (tiny, pure).
2. `toggle`, `tooltip`, `popover` (tooltip/popover are widely used; popover is Level 1).
3. `disclosure`, `section` (structural wrappers used by all `sections/*`).
4. `modal`, `confirm`, `loading`, `flash` (dialog/overlay primitives).
5. `combobox` (Level 1, 515 lines, used by many fields).
6. `form_fields` (drives field rendering).

### Phase 2 — Field system
- `fields/*` (all field types) — many depend on `combobox`, `combo`, `tag_reference`.
- `tag_reference`.
- `fields/index.js` registry → typed `uiFields` map.
- `UiField` (already Level 3) → TS; it wires the registry.
- Note the interdependencies: `combo` (L1) underpins `access`, `cycleway`, `lanes`, `roadspeed`,
  network/type/semi combos; `localized` (L1) is self-contained but large.

### Phase 3 — Sidebar / inspector cluster
- `sections/*` (raw_tag_editor, raw_member_editor, raw_membership_editor[L1], entity_issues,
  feature_type, preset_fields, selection_list, validation_*).
- `entity_editor`, `preset_list`, `preset_icon`.
- `UiInspector`, `UiOvertureInspector`, `UiSidebar`, `UiFeatureList` (Level 3 → TS).
- `data_editor`, `data_header`.

### Phase 4 — QA / issue editors (parallel-friendly, similar shapes)
- `keepRight_*`, `maproulette_*`, `osmose_*`, `note_*`, `detection_*`.
- These share a header/details/editor triad pattern — convert one triad fully as the reference, then
  replicate.

### Phase 5 — Panes & sections used by panes
- `pane`, `panes/*` (background, help, issues, map_data, preferences).
- Their `sections/*` (background_list, overlay_list, photo_overlays, map_features,
  map_interaction_options, map_style_options, grid/colorblind/background_display_options,
  data_layers, validation_options, validation_rules, validation_status, privacy, changes,
  color_selection, background_offset).
- `settings/custom_background`, `settings/custom_data`.

### Phase 6 — Toolbar, controls, cards, overmap (mostly Level 3 → TS)
- `tools/*`, `controls/*`, `cards/*`, `UiInfoCards`, `UiOvermap`, `UiMapControls`, `UiMapPanes`,
  `UiScale`, `UiMinimap`, `UiMap3dViewer`, `UiPhotoViewer`, `UiSpector`, `UiMapFooter`,
  `UiMapToolbar`, `UiAttribution`, `UiContributors`, `UiSourceSwitch`, `UiProjectLinks`,
  `UiVersionInfo`, `UiViewOn`, `UiApiStatus`, `UiFilterStatus`, `UiValidatorStatus`, `UiAccount`,
  `UiDefs`, `UiFullscreen`.

### Phase 7 — Rapid-specific & dialogs
- `UiRapidAddDataset`, `UiRapidCatalog`, `UiRapidDatasetToggle`, `UiRapidInspector`,
  `UiRapidPowerUserFeatures`, `rapid_colorpicker`, `rapid_first_edit_dialog`, `rapid_splash`.
- `splash`, `whats_new`, `restore`, `success`, `commit`, `commit_warnings`, `conflicts`,
  `changeset_editor`, `edit_menu`.

### Phase 8 — Intro / walkthrough (large, self-contained)

The walkthrough is architecturally unlike the rest of `modules/ui/`: the chapters are **stateful
controllers / promise-based step state machines**, not idempotent `render($parent)` components. They're
also long-standing pain points — brittle, and people have wanted to add chapters or make parts
optional/extendable. So Phase 8 deliberately **departs from the normal D3-component conventions** and
adds structure to make the chapters uniform and extensible.

**Approach: class + shared base, and convert Promises → async/await.**

1. **`helper.ts`** (convert first) — the shared utilities (`icon`, `helpHtml`, `localize`,
   `isMostlySquare`, `transitionTime`, `delayAsync`, `eventCancel`) stay **typed functions** (like the
   other kept primitives). `icon`/`helpHtml` are already imported by 6 converted TS files, so the
   bundler resolves their `./intro/helper.js` imports to `.ts` with no edits.
2. **`UiCurtain.ts`** — straight JS→TS (already a class in the canonical shape).
3. **`AbstractIntroChapter.ts`** (new base class) — encapsulates the machinery every chapter duplicates:
   - public `title` (l10n id), `on('done')` via `EventEmitter`, and `enter()`/`exit()`/
     `restart()` lifecycle.
   - an async **step runner** `_runAsync(step)` (a `while` loop: run step → await → advance to the
     returned next step; on cancel return; on error log + retry the same step — preserving current
     semantics but readable).
   - the four **event-wait hooks** the chapters use — `_onModeChange` (context `modechange`),
     `_onStableChange` / `_onStagingChange` (editor), `_onMapMove` (map `move`) — wired once as listener
     proxies in `enter()` and torn down in `finally`. A chapter simply sets the hooks it needs
     (`this._onModeChange = () => resolve(this._nextStep)`); unused hooks stay null.
   - `_cancelled` / `_rejectStep` state so `exit()` can bail out of the in-flight awaited step.
4. **8 chapter classes** `UiIntroWelcome`/`Navigation`/`Point`/`Area`/`Line`/`Building`/`Rapid`/
   `StartEditing` extending the base (git mv → CamelCase.ts). Closure state → protected fields; each
   `*Async()` step becomes a `protected async _stepAsync(): Promise<IntroStep>` method that `await`s the
   sequential parts and `return await new Promise(...)` for the user-action wait. The `_runAsync` runner
   invokes steps with `.call(this)`, so steps return bare method references. Chapters have no
   interdependencies (only import `helper`), so they're parallelizable.
5. **`UiIntro.ts`** — orchestrator → class. Chapter registry becomes a map of constructors
   (`new UiIntroX(context, curtain)`); keeps the pause/resume, save/restore, nav-bar, and
   enter/finish logic. Preserve the `skipToRapid` option (used by `UiRapidSplash`). Entry method
   `start($parent, { skipToRapid })` (or bound `render`); wire the 5 consumers: `UiSystem`, `UiSplash`,
   `UiRapidSplash`, `UiPaneHelp`, `ui/index.js` barrel.

**Conventions intentionally NOT applied here** (documented departures): no `render($parent)` capture
(chapters use `enter()`/`exit()`); relocalization-on-update N/A (one-shot walkthrough that fully
restarts); typing is intentionally loose (`any`) across the many cross-system touchpoints
(`curtain.reveal` options, editor diffs, entity graphs).

**Verification risk:** there is **no automated test coverage** for the walkthrough (it's interactive).
Verification is tsc/eslint/build **plus a manual browser smoke-test** of the walkthrough (Help pane →
Start the Tutorial, and the Rapid-splash "skip to Rapid" path).

### Phase 9 — Barrels & cleanup
- Convert all `index.js` → `index.ts`, update `ui/index.js` → `ui/index.ts`.
- Update every import site outside `modules/ui/` (`core/UiSystem.ts` imports from `../ui/index.js`;
  fix extensions and any renamed exports).
- Update `AGENTS.md` conversion-status table: `modules/ui/` → ✅ Complete.
- Decide on Quarantine (`.jsx`) and disabled files with the user.

## Cross-cutting concerns

- **Import extensions:** this is a Bun project — TS imports use `.ts`, JS imports use `.js`
  (`allowImportingTsExtensions: true`). During transition, a `.ts` file importing a not-yet-converted
  sibling uses `.js`; flip to `.ts` as each sibling lands.
- **`index.js` from `core/UiSystem.ts`:** currently `import { … } from '../ui/index.js'`. Keep it
  pointing at `index.js` until Phase 9 renames the barrel, then update to `index.ts` and switch the
  factory-style imports (`uiEditMenu`, `uiFlash`, etc.) to class imports.
- **Mixed factory/class during transition:** `UiSystem.initAsync` news up some components and calls
  others as factories (`uiEditMenu(context)`, `uiFlash(context)`). As each converts to a class,
  update its instantiation site to `new UiX(context)` and its call sites to `.render(...)`.
- **Event/relocalization audit:** for each component, before finishing, grep the old code for
  `.text(`, `.html(`, `.attr('title'`, `l10n.t(` on **enter** selections and move them to update.
- **Selections typing:** import `D3Selection`/`D3EnterSelection` from `d3-selection` (aliased in
  `global.d.ts`). Use `selection` (the class) for `instanceof` guards.
- **`any` escape hatch:** untyped legacy collaborators may be `any` (AGENTS.md allows this for
  not-yet-converted code); tighten opportunistically.

## Verification (run after every phase; per AGENTS.md)

1. `bun tsc --noEmit` (or `bun run test:ts`) — types clean.
2. `bun run lint` — no new warnings; **do not** suppress `todo`/`fixme`.
3. `bun run build:js` — build succeeds.
4. `bun run test:unit` and `bun run test:browser` — green (note any pre-existing failures).
5. Spot-check in the running app for the touched cluster (sidebar, panes, intro, etc.).

## Risks & Mitigations

- **Scale (~130 files).** Mitigate with strict dependency-first phasing and per-phase verification;
  each phase is shippable.
- **Hidden coupling via `index.js` barrels** — mitigated by converting barrels last, with no importer
  changes needed (bundler resolves `./foo.js` → `foo.ts`).
- **Relocalization regressions** (text created on enter). Mitigate with the explicit enter→update
  audit step per component and by leaning on `localechange` top-down rerender.
- **`git mv` history preservation.** Always rename via `git mv`, never delete+create.
- **The intro walkthrough** is stateful and hard to test automatically. Convert last, verify manually.
- **Fields registry** (`uiFields`) is central; a mistake breaks the whole editor. Convert it as its
  own careful step with the field types already done.

## Definition of Done

- No `.js`/`.jsx` files remain under `modules/ui/` except the quarantined `.jsx` (pending decision).
- All components are TS classes following the canonical shape.
- `bun run test` passes (lint + unit + browser + type-check).
- `AGENTS.md` conversion table shows `modules/ui/` ✅ Complete.

## Progress log

### Phases 1–3 complete (2026-07-30) — branch `ui_refactors`

- **Phase 1 (primitives):** `icon`, `toggle`, `tooltip`, `popover`, `modal`, `confirm`, `loading`,
  `combobox`, `form_fields`, `flash` (→ `UiFlash` class). `disclosure` and `section` are **kept as
  typed functions** (`uiDisclosure`, `uiSection`) — see decision below.
- **Phase 2 (fields):** all `fields/*` are TS classes (`UiFieldAccess`, `UiFieldCombo`,
  `UiFieldText` [was `input`, also aliased as `Url`/`Identifier`/`Number`/`Tel`/`Email`],
  `UiFieldCheck` [+`Default`/`Oneway`], `UiFieldRadio` [+`Structure`], `UiFieldLocalized`,
  `UiFieldWikidata`, `UiFieldWikipedia`, `UiFieldTextarea`, `UiFieldLanes`, `UiFieldRoadspeed`,
  `UiFieldCycleway`, `UiFieldAddress`). `tag_reference` → `UiTagReference` class. `fields/index.ts`
  registry is a typed `uiFields` map of **class constructors** (`UiFieldConstructor`); `UiField`
  does `new uiFields[type](context, this)` and renders via `.render`. `restrictions`/`field_help`
  stay commented out (bodies converted; wired-but-disabled as before).
- **Phase 3 (sidebar/inspector):** `sections/*` (entity_issues, feature_type, preset_fields,
  raw_tag_editor, raw_member_editor, raw_membership_editor, selection_list, validation_*) are
  classes extending a new `AbstractUiSection` base. `UiEntityEditor`, `UiPresetList`, `UiPresetIcon`,
  `UiInspector`, `UiOvertureInspector`, `UiSidebar`, `UiFeatureList`, `UiDataEditor`, `UiDataHeader`
  are all TS classes.
- **Filenames:** every converted component now uses its `CamelCase.ts` class name
  (`UiFieldAccess.ts`, `UiSectionFeatureType.ts`, `UiTagReference.ts`, …) via `git mv`. Barrels and
  import sites updated. Only still-functional Phase 5 sections (`background_list.js`, `data_layers.js`,
  …) and later-phase files remain `snake_case`.
- **Verified:** `tsc` 0 errors, `eslint` 0 errors (2 pre-existing `todo` warnings), build OK,
  browser 133 pass / unit 3290 pass / 0 fail.

### Decisions & learnings

- **Classes over functions (user preference).** An earlier pass converted fields/`tag_reference` to
  typed *functions*; the user asked to prefer **classes wherever possible**, so those were reworked
  into classes matching the canonical shape. Goal 1 ("every file a TS class") stands. The **only**
  intentional function exceptions are shared, stateless DOM-builders still consumed by unconverted
  JS: `icon`, `toggle`, `tooltip`, `popover`, `combobox`, `form_fields`, **`disclosure`**, `section`.
  Convert `disclosure`/`section` to classes only once their JS consumers (`success.js`, Phase-5
  `.js` sections) are converted, to avoid rippling into unconverted code.
- **`$`-prefixed selection properties must be `public`.** The eslint `naming-convention` rule
  requires `protected` members to be `_`-prefixed, which conflicts with the `$var` selection
  convention. Declare selection state as `public $foo: D3Selection` (matches `UiInspector`,
  `AbstractUiSection`). Non-selection protected state stays `_`-prefixed.
- **Field internals API.** Each `UiFieldX` exposes `render($selection)`, `tags(tags)`, `focus()`,
  optional `entityIDs(ids?)`, and an `on(...)` from its `EventEmitter` base.
  `UiField` calls these; `supportsMultiselection` is a static on the class (e.g. `UiFieldLanes`).
- **`git mv` gotcha.** When a rename is done as *new file + leftover original* instead of a true
  `git mv`, the old `snake_case.ts` lingers as an **untracked** dead duplicate. Five such orphans
  (`entity_editor.ts`, `preset_list.ts`, `preset_icon.ts`, `data_editor.ts`, `data_header.ts`) were
  removed. Always `git mv`, and after a rename pass grep for stale sibling files.
- **Element-`this` d3 handlers → class methods.** Convert `.on('click', function(){ d3_select(this) })`
  to arrows using `d3_event.currentTarget`; convert `.each(function(this){ d3_select(this) })` to
  `.each((_, i, nodes) => d3_select(nodes[i]))`; keep self-contained element-`this` value/each
  callbacks as `function(this: any)` where no field state is needed.

### Phase 4 complete (2026-07-30) — QA / issue editors

- **All five QA families converted** to TS classes (`git mv` to `CamelCase.ts`), verified
  tsc/eslint/build clean, browser 133 / unit 3290 / 0 fail:
  - keepRight: `UiKeepRightHeader/Details/Editor`
  - osmose: `UiOsmoseHeader/Details/Editor`
  - note: `UiNoteHeader/Comments/Report/Editor`
  - detection: `UiDetectionHeader/Details/Inspector`
  - maproulette: `UiMapRouletteHeader/Details/Editor/Menu`
- **Reference triad:** keepRight (`UiKeepRightHeader`, `UiKeepRightDetails`, `UiKeepRightEditor`).- **Class API for QA editors:** each editor exposes a public `datum` property (the marker/error),
  a bound `render($selection)`, and (for editors that post updates) `on('change', …)` via `EventEmitter`.
  Header/details sub-components are plain `public datum` + `render`,
  rendered via `$editor.call(this._header.render)`. This mirrors `UiDataEditor`/`UiDataHeader`.
- **Call-site pattern (replaces the old fluent `.error(datum)` that returned a render fn):**
  - `UiSidebar`: `this.KeepRightEditor.datum = datum; this.show(this.KeepRightEditor.render);`
    and reset with `this.KeepRightEditor.datum = null;`.
  - `SelectMode`: `const ed = new UiKeepRightEditor(context); ed.datum = datum;
    ed.on('change', () => { …; ed.datum = error; Sidebar?.show(ed.render); … });
    sidebarContent = ed.render;`.
- **Replication done (all families):** the same shape was applied to `osmose_*`, `maproulette_*`
  (**+ `maproulette_menu`**, which is owned by `UiSystem` via `showMapRouletteMenu`/`closeMapRouletteMenu`
  and exposes `datum`/`anchorLoc`/`triggerType` props + `close()`), `note_*` (**+ `note_report`**, with
  a wired-once `authchange` rerender), and `detection_*` (`datum` property replaces the old `datum(…)`
  accessor). Consumer branches in `SelectMode.ts`, the `this.XEditor`/`this.show(...)` sites in
  `UiSidebar.ts`, `UiSystem.ts` (menu), and the `ui/index.js` barrel were all updated. Latent
  `this.blur()` bugs in the old element-`this` button handlers were fixed via `d3_event.currentTarget`.

### Phase 5 complete (2026-07-31) — panes & their sections + settings

- **Sections (14):** the remaining `.js` sections became `UiSectionX` classes extending
  `AbstractUiSection` (git mv → CamelCase.ts): `UiSectionMapFeatures`, `MapInteractionOptions`,
  `Privacy`, `MapStyleOptions`, `GridDisplayOptions`, `BackgroundDisplayOptions`, `BackgroundOffset`,
  `OverlayList`, `PhotoOverlays`, `BackgroundList`, `DataLayers`, `ColorSelection`,
  `ColorblindModeOptions`, `Changes`. Each overrides `label()` (returns the l10n string) and
  implements `renderDisclosureContent($selection)` (or `renderContent`); factory-scoped state →
  `protected _x`; helpers → protected methods (bound when passed to `.call`/`.on`); events wired in
  the constructor (`foo.on('event', this.reRender)`).
- **Panes:** `pane` → `UiPane` **base class** (public `key`/`label`/`description`/`iconName`/`sections`;
  methods `renderPane`/`renderToggleButton`/`renderContent`/`togglePane`). The five panes became
  `UiPaneBackground/MapData/Issues/Preferences/Help` subclasses that set their properties in the
  constructor. `UiMapPanes` news them up (`new UiPaneX(context)`).
- **Settings:** `custom_background`/`custom_data` → `UiSettingsCustomBackground`/`UiSettingsCustomData`
  classes (public bound `render($selection)` + `on('change')`); the `UiSectionBackgroundList` and
  `UiSectionDataLayers` consumers now do `new UiSettingsX(context)`, wire `.on('change', …)` on a
  separate line, and call `.render`.
- **Gotcha:** the typed `uiTooltip().title(…)` expects a zero-arg `Functor` — cast
  `(uiTooltip(context) as any)` when passing a datum function `.title(d => …)`.
- Consumers updated: `sections/index.js`, `panes/index.js`, `settings/index.js`, `ui/index.js`
  barrels; `commit.js` (`new UiSectionChanges`). Also removed two more stray untracked orphan `.ts`
  dupes (`feature_type.ts`, `raw_tag_editor.ts`). Verified tsc/eslint/build clean, browser 133 /
  unit 3290 / 0 fail.

### Phase 7 complete (2026-08-01) — Rapid-specific components & dialogs

- **Phase 6 was skipped** (jumped straight to Phase 7); toolbar/controls/cards remain pending.
- **JS→TS (5 already-class files, zero consumer changes needed):** `UiRapidPowerUserFeatures`,
  `UiRapidAddDataset`, `UiRapidCatalog`, `UiRapidDatasetToggle`, `UiRapidInspector`. These were
  already ES6 classes exported by name, so `git mv .js → .ts` + adding TS types/access modifiers was
  enough — importers keep writing `./UiRapidX.js` (bundler resolves to `.ts`) and the class name is
  unchanged, so **no consumer edits**.
- **Factory → class (12 files, git mv → CamelCase.ts):** `splash`→`UiSplash`, `restore`→`UiRestore`,
  `whats_new`→`UiWhatsNew`, `rapid_splash`→`UiRapidSplash`, `rapid_first_edit_dialog`→
  `UiRapidFirstEditDialog`, `commit`→`UiCommit`, `changeset_editor`→`UiChangesetEditor`,
  `commit_warnings`→`UiCommitWarnings`, `success`→`UiSuccess`, `conflicts`→`UiConflicts`,
  `edit_menu`→`UiEditMenu`, `rapid_colorpicker`→`UiRapidColorpicker`. Each: `public constructor(context)`,
  bound `render($selection)`, factory-closure state → `protected _x`, fluent getter/setters return `this`.
  At the time of conversion these components used `d3_dispatch` + `utilRebind` for events; these were
  subsequently replaced with `EventEmitter` (see post-Phase-9 entry below).
- **Consumers wired:** `ui/index.js` barrel (12 exports renamed); `UiSystem.ts`
  (`new UiEditMenu/UiSplash/UiRestore/UiWhatsNew`, `.call(this.EditMenu.render)`);
  `SaveMode.ts` (`new UiCommit/UiConflicts/UiSuccess`, `.on()` on a separate line, `Sidebar.show(x.render)` /
  `$sel.call(x.render)`); `UiRapidDatasetToggle.ts` (`new UiRapidColorpicker`);
  `test/browser/ui/commit_warnings.test.js` (`new Rapid.UiCommitWarnings(context).render`).
- **Key insight:** components passed to `Sidebar.show(fn)` or `$sel.call(fn)` must now pass the bound
  `.render` method (not the instance). Verified tsc/eslint/build clean, browser 133 / unit 3290 / 0 fail.

### Phase 6 complete (2026-08-01) — toolbar, controls, cards, overmap & root components

- Done **after** Phase 7 (Phase 6 had been skipped). All 38 files were **already ES6 classes**, so this
  was a pure JS→TS pass: `git mv .js → .ts` + add TS types/access modifiers, **zero consumer changes**
  (same class names, bundler resolves `.js`→`.ts`; barrels keep re-exporting unchanged).
- **`cards/` (5):** `AbstractUiCard` (→ `abstract class` with `abstract render()`), `UiBackgroundCard`,
  `UiHistoryCard`, `UiLocationCard`, `UiMeasurementCard`.
- **`controls/` (4):** `UiBearingControl`, `UiGeolocateControl`, `UiZoomControl`, `UiZoomToControl`.
- **`tools/` (5):** `UiDownloadTool`, `UiDrawModesTool`, `UiRapidTool`, `UiSaveTool`, `UiUndoRedoTool`.
- **root (24):** `UiMinimap`, `UiShortcuts`, `UiSpector`, `UiOvermap`, `UiInfoCards`, `UiPhotoViewer`,
  `UiMap3dViewer`, `UiMapControls`, `UiMapPanes`, `UiMapToolbar`, `UiMapFooter`, `UiAttribution`,
  `UiContributors`, `UiSourceSwitch`, `UiProjectLinks`, `UiVersionInfo`, `UiViewOn`, `UiApiStatus`,
  `UiFilterStatus`, `UiValidatorStatus`, `UiAccount`, `UiScale`, `UiDefs`, `UiFullscreen`.
- **New ambient decl:** `modules/types/geojson-rewind.d.ts` (`@mapbox/geojson-rewind` has no `@types`;
  the untyped default import only surfaced once `UiMeasurementCard` became `.ts`).
- **Patterns:** declared every `this.x` property with `public`/`protected`; `override` on card-subclass
  `render`; pixi/gfx/tooltip/keybinding collaborators typed `any`; `.node()` → `as HTMLElement | null`;
  d3 merge update-selections annotated `let $x: D3Selection`; vendor APIs (fullscreen, Spector global,
  geolocation) cast `as any`. Verified tsc/eslint/build clean, browser 133 / unit 3290 / 0 fail.
- **Remaining:** Phase 8 (intro/walkthrough) and Phase 9 (final barrel/cleanup).

### Phase 8 complete (2026-07-31) — intro / walkthrough (class + shared base, async/await)

- **`helper.ts`** — the shared utilities stayed typed functions (`icon`, `helpHtml`, `localize`,
  `isMostlySquare`, `transitionTime`, `delayAsync`, `eventCancel`); no importer changes needed.
- **`UiCurtain.ts`** — straight JS→TS (already a class).
- **`AbstractIntroChapter.ts`** (new base) — encapsulates the machinery every chapter duplicated:
  `title`, `on('done')` dispatch, `enter()`/`exit()`/`restart()`, the async step runner `_runAsync`
  (a `while` loop: run step → await → advance; cancel returns; error logs + retries), and the four
  event-wait hooks (`_onModeChange`/`_onStableChange`/`_onStagingChange`/`_onMapMove`) wired once as
  listener proxies in `enter()`. A chapter sets only the hooks it needs; `_rejectStep` lets `exit()`
  interrupt the in-flight awaited step.
- **8 chapter classes** `UiIntroWelcome/Navigation/Point/Area/Line/Building/Rapid/StartEditing` extend
  the base (git mv → CamelCase.ts). Each `*Async()` step became a `protected async _stepAsync():
  Promise<IntroStep | void>` — **Promises converted to async/await** (`.then(new Promise)` → `await …;
  try { return await new Promise(...) } finally {…}`), which makes the previously-brittle step machine
  much more readable/extensible. Steps return bare method refs; `_runAsync` invokes them with
  `.call(this)`. `UiIntroRapid`/`UiIntroStartEditing` override `enter()`/`exit()` (calling `super`) for
  their layer/overlay setup.
- **`UiIntro.ts`** — orchestrator → class; chapter registry is now a map of constructors
  (`new chapterUi[id](context, curtain)`). Entry is `start($parent, skipToRapid)`. Wired 5 consumers:
  `ui/index.js` barrel, `UiSystem`, `UiSplash`, `UiRapidSplash` (uses `skipToRapid`), `UiPaneHelp` —
  all `new UiIntro(context).start(context.container(), …)`.
- **Documented departures:** no `render($parent)` capture (chapters use `enter()`/`exit()`);
  relocalization N/A (one-shot walkthrough); loose `any` typing across cross-system touchpoints.
- **Verified:** tsc/eslint/build clean, browser 133 / unit 3290 / 0 fail, **plus a browser smoke-test**:
  launched the walkthrough (Welcome splash → nav bar with all 8 chapters → Welcome chapter → switched to
  Points → `_addPointAsync` rendered its curtain tooltip), zero walkthrough JS errors.
- **Pre-existing bug noted (not fixed):** `UiCurtain.redrawDarkness` has `mapRect.botom -= 30;` (typo for
  `bottom`) — silently no-ops; left as behavior-preserving.
- **Remaining:** Phase 9 (final barrel/cleanup) + the 3 orphaned `panes/*.js` and 2 quarantined `.jsx`.

### Phase 9 complete (2026-08-03) — barrels & cleanup — 🎉 `modules/ui/` conversion DONE

- **Fixed the `UiCurtain.redrawDarkness` `botom`→`bottom` typo** (from Phase 8 review) — `mapRect` is a
  mutable copy from `_copyRect`, so the intended 30px bottom-toolbar trim now actually applies.
- **Barrels → `.ts`:** `git mv` the 7 `index.js` barrels (`ui/`, `cards/`, `controls/`, `panes/`,
  `sections/`, `settings/`, `tools/`) to `index.ts`. No importer changes needed — external importers
  (`core/UiSystem.ts`, `modules/index.js`) keep their `./ui/index.js` specifiers, which the bundler
  resolves to `.ts` (same mechanism used for every rename this project). The `.ts` barrels keep their
  `.js` re-export specifiers, consistent with the rest of the codebase.
- **Deleted 3 orphaned dead files:** `panes/background.js`, `panes/map_data.js`, `panes/preferences.js`
  (`git rm`) — leftover snake_case dupes from the Phase 5 pane rename, superseded by `UiPaneX.ts` and
  imported nowhere.
- **Left in place (documented):** the 2 quarantined React-demo `sections/*.jsx` (`react_container.jsx`,
  `ReactComponent.jsx` — referenced only by commented imports; React isn't even a dependency) and
  `field_help.ts` (wired-but-commented). `UiFieldRestrictions.ts` was converted to a stub class
  in the post-Phase-9 work (see below).
- **No `.js` files remain under `modules/ui/`**; `AGENTS.md` conversion table flipped to ✅ Complete.
- **Verified:** tsc 0 / eslint 0 errors (2 pre-existing `todo` warnings) / build clean / browser 133 /
  unit 3290 / 0 fail.

### Post-Phase-9 — EventEmitter migration + UiFieldRestrictions stub (2026-08-04)

- **EventEmitter migration (34 classes + 2 base classes):** All UI classes that emitted events via
  `d3_dispatch` + `utilRebind` were converted to extend `EventEmitter` from `tseep/lib/ee-safe`.
  Both `AbstractUiSection` and `AbstractIntroChapter` now `extends EventEmitter` so all their
  subclasses inherit `.on`/`.off`/`.emit` without re-declaring the pattern. The legacy pattern
  (`public dispatch: any`, `public on!`, `utilRebind(this as any, this.dispatch, 'on')`) is gone
  from every converted class. `emit('ev', ...args)` replaces `dispatch.call('ev', that, ...args)`
  (the `that` 2nd argument was dropped — no consumer relied on it). Factory functions
  `combobox.ts`/`disclosure.ts` still use `d3_dispatch` and remain unchanged (not classes).
  Gotchas: tseep `emit` returns boolean so consumer arrow-handlers that return non-void need block
  bodies; d3-dispatch namespace syntax (`toggled.intro`) → saved-handler-ref + `.off`; one test
  used `on('change.spy', fn)` → changed to `on('change', fn)`; `UiFieldLanes` had a concrete
  `off()` that shadowed `EventEmitter.off` → renamed to `_detach()`.
  SaveMode's `.on('cancel', null)` removal idiom → `.off('cancel', this._cancel)`.
  Verified: tsc 0 / eslint 0 errors (4 pre-existing `todo` warnings) / build clean / browser 133 /
  unit 3290 / 0 fail.
- **`UiFieldRestrictions.ts` stub class:** Converted from all-commented legacy code into a modern
  `EventEmitter` class registered in `fields/index.ts` (`restrictions:`). The `render()` method
  creates an empty `.restriction-container` placeholder (the old interactive mini-map depended on
  `svgLayers`/`svgVertices`/`svgLines`/`svgTurns` from the removed `modules/svg/` layer system).
  A `// todo` comment marks where the Pixi reimplementation goes. The field is registered in
  `uiFields` but is still NOT instantiated by `UiSectionPresetFields` — the block stays commented.
- **`fields/index.ts`:** Fixed 4-space indentation → 2-space throughout.

## Definition of Done — ✅ met
The `modules/ui/` TypeScript conversion is complete. Every component is a TS class following the canonical
shape, with one documented, deliberate departure: the intro/walkthrough chapters are `enter()`/`exit()`
state machines (`AbstractIntroChapter` + async/await step runner) rather than `render($parent)` components.
