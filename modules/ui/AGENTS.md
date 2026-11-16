# UI Component Checklist

These are the conventions most often missed when writing or editing a `modules/ui/` component.
(For an overview of what's in this folder, see [`README.md`](README.md).)
**Verify every item below on any component you touch** — this list exists because these keep slipping through review.

## 1. Render method — capture the parent selection

Unless the component is a documented exception (below), the named `render` captures its parent on the
first call and infers it afterward:

```ts
/**
 * Accepts a parent selection, and renders the content under it.
 * (The parent selection is required the first time, but can be inferred on subsequent renders)
 * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
 */
public render($parent: D3Selection | null = this.$parent): void {
  if ($parent instanceof selection) {
    this.$parent = $parent;
  } else {
    return;   // no parent - called too early?
  }
  // ...
}
```

Requires `import { selection } from 'd3-selection';` and a `public $parent: D3Selection | null;`
initialized to `null` in the constructor.

**Documented exceptions** keep `render($selection)` or `render()` — but the JSDoc MUST say *why*
(who owns the target selection):
- **Modal children** — the owner renders into `modal.$content` (a `D3Selection`). Treat it like any
  other handed-down selection; `render()` typically takes no argument since `$content` is captured
  at `show()` time.
- **"Props passed down" components** handed their target by a parent on each render (fields, save-flow
  sub-components), one-shot modal creators, menus, and per-row/per-item renderers.

## 2. Relocalization — set localized strings on the UPDATE selection, never on enter

Enter (`$$`) runs once; anything localized set there will NOT update when the locale changes.

- Put `.text(...)`, `.html(...)`, and `.attr('title' | 'placeholder' | 'aria-label' | 'alt', ...)` —
  anything derived from `l10n.t(...)` / `l10n.tHtml(...)` — on the **merged/update** selection, not on `$$`.
- Enter is for **structure only**: `.append(...)`, static `.attr('class', ...)`, static `.on(...)`.

```ts
// enter — structure only (no localized text)
const $$row = $row.enter().append('div').attr('class', 'row');
$$row.append('h3');

// update — localized text here so it re-localizes on language change
$row = $row.merge($$row);
$row.select('h3').text(l10n.t('some.title'));
```

## 3. System dependencies

- Capture every system in a local at the **top** of the function, **alphabetically**, before the logic.
- **Optional systems** (`scheduler`, `ui`, `locations`) — capture as optional (no `!`) and provide a
  fallback so the work still happens when the system is absent. **Never write `context.systems.scheduler!`
  in a UI component.**

```ts
const scheduler = context.systems.scheduler;  // optional
if (scheduler) {
  scheduler.setTimeout('some-id', fn, { ms: 10 });
} else {
  fn();
}
```

## 4. JSDoc

- Every `public`/`protected` method gets a JSDoc block.
- Document **every parameter** with `@param name - description`. Do NOT put a TypeScript `{type}` in the
  JSDoc — the signature carries the type. A method taking `$selection` must have `@param $selection - …`.
- Say what it does / why; don't restate the code.

## 5. Naming

- `$`-prefix d3 selection variables and parameters (`$parent`, `$wrap`, `$selection`).
- `$$`-prefix enter selections (`$$row`, `$$header`).

## 6. Data the component shows

- **Never change a datum's `props` in place** (a QA issue's status, a task's comment). Make a new one with
  `update({ ... })`, store it in the service's cache (`replaceItem`), and make it the component's
  `datum`. The map layer redraws it.
- **Update from the cached copy, not the datum you were given.** The datum a component got when it was
  selected goes stale as loaders store newer copies (challenge details, task geometry). Start from
  `service.getTask(datum.id) ?? datum`, or the update drops what they loaded.
- **Key a component's own sections by the datum's `id`, not its `key`.** `key` changes with every new
  version, so a join keyed on it removes the section and enters a new one: the user loses focus and
  what they typed, the section shows "Loading" again, and a click is lost when a blur makes the new
  version (pressing Save blurs the textarea, the buttons are replaced, and the click lands on nothing).
  Keyed by `id`, a new version updates it, so anything that depends on the datum goes on the update
  selection. Display-only sections that build their content on enter (headers, details) can stay keyed
  by `key`, so a new version rebuilds them.
- **After an async load, use what the load returns**, not the datum bound to an element before it:
  the loaded details are on a new object.
