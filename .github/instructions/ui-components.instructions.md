---
applyTo: "modules/ui/**"
---

# UI Component Checklist

These are the conventions most often missed when writing or editing a `modules/ui/` component.
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
