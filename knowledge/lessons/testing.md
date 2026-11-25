# Lessons: Testing

Unit, DOM and e2e tests, and checking things live in a browser.

- **MockContext has no services by default** — Guard clauses needed when testing service-dependent features.
- **A fake `sendChangeset` must call its `beforeUpload` argument,** or the upload mark (`markUploadAsync`) is never written and the "settle interrupted uploads" path can't be tested.
- **A reference model encodes the design's rule, not the code's.** The graph model test copied `rebase`'s head-only iD#2085 rule, so it agreed with the bug for weeks while `graph-geometry.md` said "every graph, redo graphs included". When writing a model, take each rule from the design doc (or the user-visible contract), and flag any place where the code disagrees.
- **Give `bun test` folders, not `**` globs, in package.json scripts** — `bun run test` ran the DOM tests' `./test/browser/**/*.js` (now `test/dom`) through a shell without globstar, so it matched one folder level only, and 8 files (Context, `ui/fields`, `ui/sections`) never ran: 90 tests instead of 134. Running that script alone ran them all, which hid it. Fixed Oct 29 by passing the folder. If a test count looks low, compare the "across N files" line.
- **DOMParser in unit tests** — Use `import { DOMParser } from '@xmldom/xmldom'`, not the browser global. Unit tests run without happy-dom (only `test:dom` has the preload).
- **Test sample data** — `*.sample.js` files alongside the test. Import as `import * as SAMPLE from './Foo.sample.js'`.
- **FilterSystem's cache is keyed by the entity object** (a `WeakMap`), not by `entity.key` or `entity.id`. Every entity made in a test has `v` 0, so while the cache was keyed by `key` (`${id}v${v}`), two tests that used the same ID shared a record, and one test passed only when the tests before it had run. If a test fails on its own (`-t "name"`) and passes in its file, look for state keyed by something tests reuse.
- **Run unit test files the way `test:unit` does: no preload.** `bun test --preload ./test/test_setup.js test/unit/...` gives them happy-dom, and `MapillaryService`'s `startAsync` test then tries to load mapillary-js from a CDN and fails. Use `bun test test/unit/...` for unit files.
- **A full pass hides per-frame costs: also time a drag frame** (`editor.perform(actionMoveNode(...))` + `gfx._app()`). A full pass is mostly restyling, and stayed at ~115 ms with every graph memo removed, while a drag frame went from 6 to 10 ms.
- **When a check starts covering more cases, expect older bugs.** Turning on shape checks after rebases in `graph_model.test.js` found three bugs from earlier steps (a frozen graph's restores, an equal-by-value copy's shape, a memo shared after a node arrived). Run thousands of seeds (`GRAPH_MODEL_SEEDS=3000`) after changing `Graph`.
- **Check that new code is covered by breaking it.** In a scratch worktree, break each new piece and run the tests; two of ten pieces weren't covered until tests were added. And compare caches and searches with a brute-force scan on real data in the debug Chrome: that's how duplicate RBush items were found.
- **`_isWater` vs `_isPoint`** — When testing filterScene water counts, use way entities. Point nodes with waterway tags match `_isPoint` first.
- **Validator tests: create after schema init** — Validators hoist schema prerequisites at construction time. Create the validator inside `beforeAll` after `schema.merge()`.
- **Inline schema init pattern for tests** — Import `osm_rulesets.json5` directly (Bun native JSON5 import), create real `SchemaSystem`, init + merge in `beforeAll`. Single source of truth.
- **A removed dependency can silently break unrelated tests via a global side effect.** `EditSystem`'s
  unit tests only passed because constructing `utilSessionMutex` polyfilled a global `document`; once
  it was retired, every `select(document).interrupt(...)` threw. Guarding DOM access was the right fix
  for a CLI build anyway. When removing code, watch for global side effects a green suite leans on.
- **Fire-and-forget async is hard to assert.** `immediateBackup()` kicked off an un-awaited IndexedDB
  write, so tests that read the record immediately raced it. Making the method **return its write
  promise** (callers still ignore it) makes the async work awaitable without changing behavior.
- **Import `'fake-indexeddb/auto'`** (not `'fake-indexeddb'`) at the top of a test that uses IndexedDB:
  it installs the globals `idb` looks up. Use a fixed database name and `clear()` it between tests.
- **Verify Blob round-trips before building on them.** `structuredClone`, `fake-indexeddb` and the
  in-memory mock all keep a Blob's content, but not every browser context does (private browsing), so the
  graceful-degradation path matters.
- **An untested path rots one layer at a time.** The upload conflict path had no tests, and broke
  several times over years (a handler signature in 2023, a return shape in 2025, a staging/stable split
  in between). Each bug hid the next: fixing one would only have shown the one behind it. Drive the
  whole flow end to end (fake the service, not the system) before calling it fixed.
- **Run flows that may throw in your own headless browser, not the developer's Chrome.** A page error
  in the debug Chrome froze its tab (it stopped answering CDP entirely), probably DevTools pausing on
  the exception. Playwright's headless Chromium reports `pageerror`s with stacks instead.
- **Escape in a test snippet can trigger the mode's own Escape.** Pressing Escape to close a dialog in
  save mode left save mode, which made later steps misleading.
- **happy-dom's `document.implementation.createDocument` returns an HTML document with an element
  already in it**, so `JXON.stringify` fails there. `test/dom/ui/UiConflicts.test.js` shims it with
  an empty XML document from `DOMParser`.
- **Hand-picked negative IDs collide with the ones the editor makes.** Actions make new entities with
  `n-1`, `n-2`, …, so a test that adds `n-10` itself can have it replaced by a later test's fix in the
  same edit session (a way stretched from lon 10 to lon 30). Reset the editor between such tests.
  And `validateAsync()` returns the validation already running, so await `_validationPromise` until it's
  `null` before reading issues.
- **Check event-order bugs with real mouse events, in a real browser.** "Pressing Save blurs the
  textarea, the blur replaces the buttons, the click is lost" can't be shown in happy-dom (its
  `click()` fires no mousedown or blur). Playwright attached to the debug Chrome
  (`chromium.connectOverCDP`, then `page.mouse.click`) showed it in one run. Pick a path that writes
  nothing to OSM (a new note's Cancel). The restore prompt covers the map after a reload: "Skip for now"
  keeps the sessions.
- **Validation and backups wait while a backup can be restored** (`editor.canRestoreBackup`). In the
  debug Chrome there usually is one, so live validation checks find no issues and live edits are never
  backed up. Don't touch the stored session: call `editor.dismissRestore()` (it only affects that page,
  and the session is offered again on reload), and undo the run's edits (a session undone back to
  nothing is deleted).
- **Run each new test against the old code** (`git stash push <the fixed files>`, run it, `git stash
  pop`). Three of the bug-hunt tests passed on the old code at first; one because it reloaded data in a
  loop, and `editor.merge` doesn't replace entities that are loaded already. Reset the editor between
  variants. A test meant to show a refactor kept the behavior should pass on both.
- **Put a time-sensitive live check in one `cdp eval` snippet.** Each `bun run cdp` call takes about a
  second, so checking something within the 2.5 s after an upload across two calls finds the reset
  already done.
- **Keep a signed-in live check write-free with a Playwright route, not just stubs.** A script that stays
  attached and calls `context.route('**/*', …)` to abort anything but GET/HEAD/OPTIONS to a non-local
  host also covers reloads and the startup settings sync, which in-page stubs (installed after start)
  can't. Install it on the context before Rapid loads (launch Chrome on `about:blank` with the
  `.chrome-debug` profile, route, then open Rapid).
- **The debug Chrome wears out over long runs.** After hours of driving (and days up), its renderer sat
  at 6 GB and 600% CPU while Rapid's heap was 100 MB: `connectOverCDP` timed out, and reloads failed
  because a startup asset fetch hit NetworkSystem's 30 s timeout. Rapid started fine in a fresh Chrome.
  Rule out the browser before blaming Rapid for a hang that only shows up late in a session.
- **Matched Rapid features drawn with "show already mapped" sit exactly on OSM lines** and take the
  pointer, so a live drawing check that clicks on OSM lines should confirm the hover target first.
- **A flaky test: print what the page saw before explaining it** — `draw.test.js` pressed ⌘Z twice and failed one run in three. Two explanations in a row were wrong (a race for the focus; an undo spent on work in progress), each built from what the code could do. A listener that logged each key with its modifiers and target, and the list of bound keys, showed it in one run: the test browser doesn't say it's a Mac, so undo was bound to ⌃Z, and the test pressed ⌘Z. It had passed when a separate handler in the preset list caught the key.
- **Before faking state in an e2e test, wait until the app isn't in the middle of changing it** — the frame pacing test set a made-up "a pass just finished", and failed 2 runs in 48 when a real frame's DRAW phase came a tick later and replaced it. It waits for two ticks without a new frame first.
- **An e2e step that got slower may only have started sooner** — after frame pacing, "Escape closes the welcome screen" took 2.9 s where it had taken 1.3, and failed its 5 s limit now and then. On the page's own clock the screen closed earlier than before (8.3 s after opening, against 9.1): the test noticed `editor.started` 2.6 s sooner, because the first DRAW phase no longer blocked, and pressed Escape into a page still starting up. Compare times since the page opened (`performance.now()`), not since the step began, before calling it a regression.
- **A timed step can take 0 ms** — headless Chromium's `performance.now()` is coarse, so a test that expects a step's time to be greater than 0 fails now and then. Assert that the time was recorded, not that it's positive.
- **The real mouse reaches the debug Chrome.** It's a window on the developer's screen. Bringing its tab to the front, or taking a screenshot of it, can send the page a `pointerout` (or a move) at wherever the real pointer is, and the hover that a script just made is gone before the picture is taken: "hovered", then a screenshot with no glow, then nothing hovered. It cost an afternoon's worth of wrong theories about Pixi. For a picture of a hover there, set the class in the page (`scene.setClass('hover', id)`, `gfx.requestFrame()`) and hold it while the picture is taken; for a test, use the e2e tests, whose browser has no mouse but Playwright's.
