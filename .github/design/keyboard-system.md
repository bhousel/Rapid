# Keyboard System Design

This document describes converting Rapid's legacy `utilKeybinding` function module into a
proper core system, `KeyboardSystem`, and lays out a path toward user-remappable shortcuts
persisted through `SettingsSystem`.

Tracked upstream as [facebook/Rapid#1076](https://github.com/facebook/Rapid/issues/1076).

## Problem

Keyboard shortcuts are managed by [`modules/util/keybinding.ts`](../../modules/util/keybinding.ts),
an old d3-style closure module ported from iD (which itself borrowed from
[jwerty](https://github.com/keithamus/jwerty)). It carries a literal `//TODO: make a core system
class for utilKeybinding` note.

`utilKeybinding(namespace)` returns a *callable function object* that plays two distinct roles:

1. **A binding registry** — `.on()`, `.off()`, `.clear()`, `.trigger()` register/fire callbacks
   for key combos like `'⌘Z'`, `'⇧←'`, `'pgup'`.
2. **An event binder** — calling `keybinding($selection)` attaches `keydown` capture + bubble
   listeners to a d3 selection; `.unbind($selection)` removes them and clears the registry.

Pain points:

- **Not a system.** State lives in a closure, outside the lifecycle/dependency model every other
  core component follows. It can't be reset, paused, or depended upon, and violates the
  "runtime state is owned by a system" rule in `AGENTS.md`.
- **Multiple independent instances.** Besides the one global instance, five components each
  `new` up their own `utilKeybinding(...)` and manually bind/unbind it to `document`
  (see [Current State](#current-state)). Each reimplements the same on/off/teardown dance.
- **Reached through two different doors.** Most callers use `context.keybinding()`; others import
  `utilKeybinding` directly (both for instances *and* for the static lookup tables). There's no
  single owner.
- **Dated practices.** A function/`namespace` merge for static data, string-concatenated binding
  ids (`code + '-capture'`), `as any` casts on every d3 `.on()`, hand-rolled numeric `keyCode`
  tables built with `while (++i < …)` loops, and `KeyboardEvent.keyCode` (deprecated) as a
  first-class match path.
- **No path to user remapping.** Combos are hard-coded at every call site; there's no notion of a
  named command, so there's nothing to remap or persist.

## Goals

1. **A real system** — `KeyboardSystem` extends `AbstractSystem`, registered as `keyboard`,
   reachable via `context.systems.keyboard`, participating in the standard lifecycle.
2. **Single owner of the document listeners** — the system installs one capture + one bubble
   `keydown` listener and routes every event through them.
3. **Cover all current cases faithfully** — the global registry *and* the five transient
   per-component registries, including capture-phase bindings, input-field skipping, shift
   priority, and the AltGr workaround.
4. **Modernize** — class fields, module-level `const` tables, prefer `KeyboardEvent.key`, drop the
   `namespace` merge and the `as any` casts, `??`/`?.` throughout.
5. **Scaffold remapping** — introduce optional named commands so a future UI can rebind and
   `SettingsSystem` can persist overrides. (Wiring the actual UI is later work.)

## Non-Goals (for now)

- Building the remapping **UI** — this design only lays the scaffolding. `UiShortcuts` stays
  read-only until a follow-up.
- Changing which keys do what — every current shortcut keeps its current combo and behavior.
- Chords / key sequences (e.g. "g then h") — out of scope.

## Current State

### The global instance

`Context` constructs `utilKeybinding('context')`, binds it to `document`, and exposes it as
`context.keybinding()`. Roughly 15 files call `context.keybinding().on(...)` / `.off(...)` —
mostly UI toggles (info cards, minimap, panes, zoom controls, feature list, sidebar) plus
`MapSystem` and `Map3dSystem`. `mocks.ts` provides a stand-in `keybinding()`.

### The transient instances

Five components create their own namespaced instance and manage its `document` binding by hand:

| Component | Namespace | Lifecycle | Notes |
|-----------|-----------|-----------|-------|
| [`UiSystem`](../../modules/core/UiSystem.ts) | `modal` | bound once in `initAsync` | Esc/Backspace → close top modal |
| [`SelectOsmMode`](../../modules/modes/SelectOsmMode.ts) | `select` | bound on `enter`, unbound on `exit` | vertex nav (`[`, `]`, `{`, `}`, `\`) |
| [`SaveMode`](../../modules/modes/SaveMode.ts) | `SaveMode` | toggled on/off during save flow | Esc (capture) to cancel |
| [`UiRapidInspector`](../../modules/ui/UiRapidInspector.ts) | `UiRapidInspector` | bound in constructor, re-registered on `localechange` | accept/ignore/move/rotate — keys deliberately isolated from the global set |
| [`UiConflicts`](../../modules/ui/UiConflicts.ts) | `conflicts` | toggled on/off | Esc (capture) to cancel |

Every one of these binds to `document`. They coexist today only because each uses a distinct d3
event namespace (`keydown.capture.<namespace>`). This is the key fact that makes a single
system-owned listener viable: **there's only ever one `document`**, so one listener can serve
every registry.

### The static lookup tables

`utilKeybinding` also carries constant data via a merged TS `namespace`:
`keyCodes`, `keys`, `modifierCodes`, `modifierProperties`, `plusKeys`, `minusKeys`. External
readers:

- `UiZoomControl` — iterates `plusKeys` / `minusKeys`.
- `UiPresetList`, `UiFieldCombo` — compare `event.keyCode` against `keyCodes['⌫']`, `keyCodes['↓']`,
  etc.

## Design

### Ownership and lifecycle

`KeyboardSystem` owns exactly one pair of listeners:

```
startAsync()  →  install keydown capture + bubble listeners on document
destroy()     →  remove them
```

- No required dependencies. `settings` and `l10n` are **optional** (persistence / display).
- **Headless/CLI degradation.** If `document` is unavailable (future CLI, some unit tests), the
  system skips listener installation but the registry still works — `trigger()` drives matching
  directly, which is exactly how the current tests exercise it.
- The global registry lives for the app lifetime. `resetAsync()` leaves user bindings intact
  (shortcuts aren't edit-session state); it clears only transient scopes if any leaked.

### Scopes replace the many instances

Instead of five independent `utilKeybinding` objects each hand-binding `document`, the system
holds a set of **scopes**. A scope is just a named group of bindings that can be enabled or
disabled. The single document listener iterates the bindings of all *enabled* scopes.

- A built-in **`global`** scope, reached via `keyboard.global`, is the drop-in home for today's
  `context.keybinding()` shortcuts: `keyboard.global.on(codes, cb)`.
- `keyboard.scope(id)` gets-or-creates a named scope and returns a small handle:

```typescript
interface KeyBindingScope {
  on(codes: OneOrMore<string>, callback: KeybindingCallback, opts?: KeyBindingOpts): this;
  off(codes: OneOrMore<string>, opts?: KeyBindingOpts): this;
  clear(): this;
  enable(): this;    // was: select(document).call(kb)
  disable(): this;   // was: select(document).call(kb.unbind)
}
```

Mapping the current transient users:

| Today | Becomes |
|-------|---------|
| `this.kb = utilKeybinding('select'); this.kb.on(...); select(document).call(this.kb)` | `const scope = keyboard.scope('select'); scope.on(...).enable()` |
| `select(document).call(this.kb.unbind)` | `scope.disable()` (or `keyboard.removeScope('select')`) |
| `select(document).call(this.kb.on('⎋', cb, true))` | `scope.on('⎋', cb, { capture: true }).enable()` |

Because the global listener is always installed, "enable/disable" only toggles whether a scope's
bindings participate in matching — no per-component `document` juggling.

> **Note on the `modal` scope.** Today `UiSystem` binds its modal keybinding once and leaves it
> bound; `_closeTopModal` no-ops when the stack is empty. As a `global`-adjacent always-enabled
> scope this is behaviorally identical, so the modal scope can simply be registered at init and
> left enabled.

### Public API (system)

```typescript
class KeyboardSystem extends AbstractSystem {
  // the built-in `global` scope — application-wide shortcuts register here:
  //   keyboard.global.on(codes, callback, opts)
  get global(): KeyBindingScope;

  // transient/isolated registries
  scope(id: string): KeyBindingScope;
  removeScope(id: string): void;

  // remappable-command scaffolding (phase 1)
  rebind(commandID: CommandID, combo: string): boolean;
  getCommand(commandID: CommandID): KeyCommand | undefined;
  get commands(): KeyCommand[];

  // convenience token sets used by zoom controls
  get plusKeys(): string[];
  get minusKeys(): string[];

  // testing / synthetic events
  trigger(event: Partial<KeyEventLike>): boolean;
}
```

> **Why `keyboard.global.on(...)` and not `keyboard.on(...)`?** `AbstractSystem` extends
> `EventEmitter`, so `on`/`off` are already the event-subscription API (e.g.
> `keyboard.on('bindingschange', …)`). Keybinding *registration* therefore lives on the
> {@link KeyBindingScope} objects — which are plain, non-emitter helpers — reached via
> `keyboard.global` (the default scope) or `keyboard.scope(id)`.

Registration methods live on `KeyBindingScope`:

```typescript
class KeyBindingScope {
  on(codes: OneOrMore<string>, callback: KeybindingCallback, opts?: KeyBindingOpts): this;
  off(codes: OneOrMore<string>, opts?: KeyBindingOpts): this;
  clear(): this;
  enable(): this;
  disable(): this;
}
```

`KeyBindingOpts` replaces the bare positional `capture?: boolean`:

```typescript
interface KeyBindingOpts {
  capture?: boolean;      // match during capture phase
  commandID?: CommandID;  // scaffolding for remapping (see stretch goal)
}
```

Callers currently pass `true` positionally for capture; those few sites (`UiSaveTool`,
`SaveMode`, `UiConflicts`) become `{ capture: true }`.

### Matching semantics (preserved exactly)

The matching logic is faithfully carried over — it's correct and battle-tested:

- **Shift priority.** Shifted bindings are tested before unshifted so `⇧←` beats `←` and `⌘⇧Z`
  beats `⌘Z`; only one callback fires per event.
- **`key`-based matching.** Matching is driven entirely by `KeyboardEvent.key` (lowercased,
  case-insensitive). See [Dropping `keyCode`](#dropping-keycode) below.
- **AltGr workaround.** When both `ctrlKey` and `altKey` are set, skip the ctrl/alt checks
  (iD#4096).
- **Input-field skip.** The bubble handler ignores events whose target is `INPUT`/`SELECT`/
  `TEXTAREA` (capture handlers still fire — that's how Esc-to-cancel works while typing).

One deliberate refinement, **confirmed as desired**: today each registry iterates independently, so
two registries *could* both fire for one event. Routing all scopes through one dispatcher keeps the
"max one callback per event" guarantee **across** scopes — a small correctness improvement.

### Dropping `keyCode`

The legacy code matched on `KeyboardEvent.key` first and fell back to the deprecated numeric
`keyCode` (with a hand-built code table and an ISO-Latin-1 guard). We drop the `keyCode` path
entirely and match purely on `key`:

- Deletes the `KEY_CODES` table and its `while (++i < …)` generators, the `MODIFIER_CODES` /
  `MODIFIER_PROPERTIES` indirection (collapsed into a single symbol → `keyof KeyModifiers` map), and
  every `as any` on the d3 handlers.
- The `KEYS` table (token → `KeyboardEvent.key` value) stays — it's how `'esc'`, `'pgup'`, `'↩'`,
  etc. resolve to real `key` strings.
- **Tradeoff:** the old `keyCode` fallback gave physical-key matching for non-Latin layouts (e.g.
  Cyrillic). Pure `key` matching loses that. If layout-independent shortcuts matter later, the
  modern answer is `KeyboardEvent.code` (physical key), noted as a possible future enhancement — not
  reintroducing `keyCode`.

### Static key tables

These are truly-constant platform/browser data, so per `AGENTS.md` they're fine as module-level
`const` (they're not OSM-domain rulesets):

- `KEYS`, `MODIFIER_MAP`, `PLUS_KEYS`, `MINUS_KEYS` become module-level `const` in
  `KeyboardSystem.ts`, written literally.
- `plusKeys` / `minusKeys` are exposed as system getters for `UiZoomControl`.
- `UiPresetList` / `UiFieldCombo` — which compared `event.keyCode` against numeric codes — are
  migrated to `event.key` comparisons (`'Backspace'`, `'ArrowDown'`, …) as part of this effort.

### Files touched (migration)

- `git mv modules/util/keybinding.ts modules/core/KeyboardSystem.ts`; drop the export from
  `modules/util/index.ts`, add to `modules/core/index.ts` + the `Systems` interface in
  `modules/core/types.ts`, and register `systems.available.set('keyboard', KeyboardSystem)`.
- `Context.ts` — remove `_keybinding` / `keybinding()` outright; the system replaces them.
  `mocks.ts` — swap the `keybinding()` stub for a `keyboard` system entry.
- ~15 global-scope call sites: `context.keybinding()` → `context.systems.keyboard`.
- 5 transient call sites: `utilKeybinding(ns)` → `keyboard.scope(ns)` as tabled above.
- `UiSystem` internal `_modalKeybinding` → modal scope.

## Stretch Goal: Remappable, Persisted Shortcuts

Delivered in phases; only **phase 1 (scaffolding)** is in scope for the initial PR. Phases 2 and 3
are recorded in [`.scratchpad/backlog.md`](../../.scratchpad/backlog.md).

### Phase 1 — command scaffolding (this effort, behind the scenes)

- Add a `CommandID` string-ID type to [`modules/types/ids.ts`](../../modules/types/ids.ts)
  (runtime-validated, globally-declared, like the other ID types).
- Introduce an optional **`commandID`** on bindings (`KeyBindingOpts.commandID`). A command is a
  stable, remappable identity (e.g. `'zoom-in'`, `'undo'`) with a *default* combo — distinct from
  the raw key string a binding matches on.
- The system tracks commands and their current combo, and exposes a `rebind(commandID, combo)` seam
  (the hook phase 3's UI calls and phase 2's persistence hydrates), plus a `bindingschange` event.
- No behavior change yet: call sites that don't pass a `commandID` work exactly as before.

### Phase 2 — persistence via SettingsSystem *(backlog)*

- `settings` is an optional dependency. On start, read an overrides map (e.g. under a
  `keyboard.bindings` settings path: `{ [commandID]: combo }`); on change, write it back.
- Resolution order becomes `userOverride ?? default`; re-register affected bindings and fire
  `bindingschange`. Absent `SettingsSystem` (CLI/tests), fall back to defaults — the work still
  happens.

### Phase 3 — UI *(backlog)*

- Extend `UiShortcuts` (and/or a preferences pane) to capture a new combo, detect conflicts,
  reset-to-default, and call `keyboard.rebind(commandID, combo)`.

Migrating every existing `on('⌘Z', …)` call site to a `commandID` is a broad, mechanical change;
it can land incrementally after the scaffolding exists.

## Testing

- Port [`test/unit/util/keybinding.test.js`](../../test/unit/util/keybinding.test.js) to a
  `KeyboardSystem` unit test: construct the system, register via `on`/`scope`, drive with
  `trigger`, assert callbacks. Existing cases (basic match, wrong-key, last-wins, modifiers,
  shift priority) map directly.
- Add coverage for the newly-centralized behavior: enable/disable scopes, capture-vs-bubble,
  input-field skip, and "one callback per event across scopes".
- Phase 1: a test that a `commandID` `rebind` changes the matched combo and fires `bindingschange`.
- Run `bun run check:ts`, `bun run check:lint`, `bun run test:unit`, and `bun run build:js`.

## Resolved Decisions

1. **Scope handle.** `keyboard.scope(id)` returns a `KeyBindingScope` handle with
   `on/off/clear/enable/disable` — this cleanly models "these keys are only live while in a given
   editing mode".
2. **No compatibility shim.** `context.keybinding()` is removed outright; all call sites move to
   `context.systems.keyboard`.
3. **`event.key`, no `keyCode`.** Matching is `key`-only; `UiPresetList` / `UiFieldCombo` migrate to
   `event.key`. (`event.code` is the future path for layout independence, if needed.)
4. **`CommandID` type.** Commands are identified by a runtime-validated `CommandID` string type in
   `modules/types/ids.ts`, consistent with the other ID types.
