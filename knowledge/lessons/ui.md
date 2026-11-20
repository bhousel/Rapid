# Lessons: UI classes (`modules/ui`)

From converting the UI to classes and EventEmitter.

- **Inheritance across a registry = load-time circular imports.** When making `UiFieldX extends UiField`, the `extends` clause runs at MODULE LOAD, so `UiField` must be fully defined before any subclass module evaluates. That breaks if `UiField.ts` imports (at top level) anything that transitively imports a subclass — e.g. the `uiFields` registry, or a `const`/regex re-exported from a subclass file. Fix: keep the base class's top-level imports free of the registry and of subclass modules. Move shared constants to a leaf module (`fields/types.ts`), read statics off `this.constructor` instead of the registry, and put the `new Registry[type](...)` factory in the registry module (not on the base). Runtime-only cyclic refs (used inside a method, not at class-definition time) are fine.
- **Base/subclass method-name collisions block inheritance refactors.** A wrapper's fluent getter/setter (`tags(val?)`, an `entityIDs` array property, `options` config) collides with a composed helper's methods of the same name (`tags(t)` render, `entityIDs(ids)` setter, `options(key)` choices). TS flags property-vs-method collisions (TS2425) and same-name overrides. Resolve by renaming the subclass-side render/query methods (`renderContent`, `syncTags`, `_fieldOptions`) — this is usually WHY the composition existed, but it's just naming, not a real blocker.
- **`this.constructor` reaches subclass statics.** `(this.constructor as typeof Base).SOME_STATIC` reads a subclass's static override from a base method — handy for replacing a registry lookup like `registry[this.type].supportsMultiselection`.
- **EventEmitter: `emit` returns `boolean`** — tseep's `emit` returns whether any listeners fired.
  A consumer arrow `x.on('ev', d => this.foo(d))` fails typecheck if `foo` returns non-void.
  Wrap in a block body: `x.on('ev', d => { this.foo(d); })`. (d3 selection `.on` is permissive — no
  wrapper needed for d3 callbacks.)
- **EventEmitter has no namespace syntax** — d3-dispatch's `on('change.spy', fn)` / removal
  `on('event', null)` don't exist. Use a saved handler ref + `.off('event', fn)`. The intro chapters
  wired `EditMenu.on('toggled.intro', h)` and removed with `on('toggled.intro', null)` — converted
  to `let onToggled; ... EditMenu.on('toggled', onToggled)` with `finally { off('toggled', onToggled) }`.
- **EventEmitter method name collision** — A class method named `off()` or `on()` shadows the
  inherited EventEmitter method. `UiFieldLanes` had a no-op `off()` used as a d3 cleanup callback;
  renamed to `_detach()`.
- **EventEmitter accumulates listeners; d3-dispatch replaced them** — d3's `.on('ev', fn)` call
  replaces any existing listener with the same name. EventEmitter's `.on` adds a new listener each
  call. Before converting, audit every consumer wiring site: guarded fresh-instance creation (safe),
  constructor-wired-once (safe), or repeated inside a `render`/`update` call (accumulation bug — must
  use `.off` first, or only wire once).
- **`git mv`, never new-file-plus-leftover.** A rename done as "create `UiFoo.ts` + forget to delete `foo.ts`" leaves the old file as an **untracked** dead duplicate that still imports now-removed symbols. After any rename pass, grep for stale sibling files (`entity_editor.ts` next to `UiEntityEditor.ts`) and check `git status` for `??` orphans.
- **`$`-selection props must be `public`, not `protected`.** The `rapid/protected-underscore` lint rule forces `protected` members to be `_`-prefixed, which collides with the `$var` selection convention. Declare selection state as `public $foo: D3Selection` (matches `UiInspector`/`AbstractUiSection`); keep non-selection protected state `_`-prefixed.
- **Element-`this` d3 handlers → class methods.** `.on('click', function(){ d3_select(this) })` → arrow using `e.currentTarget`. `.each(function(this){ d3_select(this) })` → `.each((_, i, nodes) => d3_select(nodes[i]))`. Leave self-contained element-`this` value/each callbacks as `function(this: any)` when they need no field state.
- **Async re-render guards.** Original factories often used `if (_tags)` (undefined until `tags()` called) to skip a re-render before render. Class fields initialized to `{}` make that guard always-true — guard on render state instead (`if (!this.$input.empty())`).
