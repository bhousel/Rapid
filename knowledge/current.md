# Current Work

## This branch (`conflation-system`)
Ready to become `main` as v3.0.0-pre.4 (Nov 16), for testers, before the multiselection design
(`backlog.md`). What landed is in `completed.md`; follow-ups from the release check are in `backlog.md`.

## Active: dependency upgrades (from the Nov 18 checkup)
Done in the first batch (Nov 18): removed `@pixi/jsdoc-template` (+ `webdoc.conf.json`) and
`@mapbox/geojson-area` (nothing imported it); happy-dom 21, geojson-vt 5 (a class now: `new GeoJSONVT()` in the
test sample generators), cssnano 9, @transifex/api 8, geojson-rewind 0.6, in-range updates (maplibre-gl 5.24.1,
d3 7.9.2, …), and current Actions pins in `pages.yml` / `deploy.yml`. Careful with `cloc`: its real versions end in
`-cloc`, so `bun update` "upgrades" `2.6.0-cloc` to a 2022 `2.11.0`.

Still to do, in about this order:
- **CI:** workflows enabled on the fork (Nov 18); `deploy` and `pages` disabled by hand in the Actions UI.
  `deploy.yml` still has Bun 1.3.6, a plain `bun install`, and Facebook's AWS role and S3 bucket.
- **CDN pins come from `package.json` now** (Nov 18): `utilCDNPath(name, asset)` and `utilDependencyVersion(name)`
  in `modules/util/dependencies.ts`, the only place that imports `package.json`. The exact version is the range's
  lower bound, which `bun update` keeps equal to the installed version. This moved the runtime to maplibre-gl
  5.24.1 (was 5.15.0), id-tagging-schema 6.19.2 (was 6.6.0), osm-community-index 6.2.1 (was 5.9.3; its JSON moved
  to `dist/json/`), and exact pannellum, mapillary-js and wmf-sitematrix versions. **When a major bump moves files
  in a package, the CDN paths have to change with it.**
- **Bryan's own packages, all ESM-only now:** country-coder 6, location-conflation 4, osm-community-index 7
  (needs location-conflation 4), node-diff3 4 (`===` comparison, stricter `MergeRegion` type in
  `merge_remote_changes.ts`), osm-auth 4 (plan in `backlog.md`; also `err.responseText` in `UploaderSystem.ts`
  becomes dead, since the body is `err.message` now). Wait for `bunfig.toml`'s 3-day window (osm-auth 4.0.0 is from
  Nov 17), or add osm-auth, node-diff3 and osm-community-index to `minimumReleaseAgeExcludes`.
- **id-tagging-schema 7.3 + name-suggestion-index 8, together** (NSI 8 needs schema 7; we already call
  `buildIDPresets()`). NSI 9 (ESM-only, its own `Preset` types) is in NSI's changelog but not on npm yet.
  **Not with pinhead 16:** schema 7.3 uses 4 icons pinhead 16 renamed (`bagel_seeded`,
  `person_running_after_person`, `person_squatting_and_person_reaching_up`,
  `person_wearing_martial_arts_belt_front_kicking`), and `build_data.ts` drops missing icons silently.
- **pixi.js 8.20 → 8.23, as its own batch.** Skip 8.21/8.22 (filter regression on renderer resize, hits our
  Glow/Adjustment/Convolution filters). 8.23 restores Text/Graphics after context loss, fixes GPU leaks, and adds
  `DashLineShader` / `SmoothGraphics` (maybe replaces `modules/pixi/lib/DashLine.ts`).
- **maplibre-gl 6, last.** ESM-only, no `.min.js`/`.min.css`, no `maplibregl` global type. `_loadMapLibreAsync`
  needs a dynamic `import()` of `dist/maplibre-gl.mjs` (worker is a blob, CSP already allows it). Other v6 breaks
  don't touch our usage. `bun audit` keeps flagging 5.24.1 until the advisory notes that 5.24.1 has the fix.
- **Browser tests in a real browser.** Intent: `test/unit/**` runs under Bun, `test/browser/**` is what needs a
  browser. Today `test/browser` runs under Bun with happy-dom, and `test/index.html` (mocha) lists only 18 of its
  38 files by hand; `core/EditSystem.test.js` and `behaviors/MapInteractionBehavior.test.js` import `bun:test`.
  Bryan is open to moving these to Playwright and dropping mocha entirely.
- **Hold:** cldr 49 (drops 109 locales, e.g. `dv`, `nv`, `pap`, `skr` lose native names in `languages.json`).
- **Left in `bun audit`:** mocha's diff, glob, minimatch, serialize-javascript (mocha 12 clears some);
  postcss 5 via `postcss-selector-prepend`; picomatch via `esbuild-visualizer` (all dev/build only).
  Dependabot alerts are off for the repo.
- **Minor, later:** this file's branch section is stale; `decisions.md`, `completed.md` and `lessons.md` are over
  the 40 KB budget (`/reflect`); `package.json` `repository`/`bugs` point at facebook/Rapid; 6 stale local
  branches and ~70 old remote branches.

## Active: matching third-party data against OSM (`ConflationSystem`)
Top priority. Design: [`design/conflation-system.md`](../design/conflation-system.md) (Steps 1–6 first
version done; the doc awaits Bryan's final review). Guiding use case: *accept the part of the sidewalk
that is missing, and join it to the part that exists.*
- **Step 6, Conflation Settings UI, still to do:** per-side `props` editing, live counts, live tuning
  (see "Rapid dataset UI: live tuning" in `backlog.md`), and even column widths in the rules table.
- **Known bugs:** six from the second bug hunt (items 6, 8, 9, 23, 24, 25), listed under "Known bugs" in
  the design doc.
- **Open questions** (in the doc): require a data mapping or only warn; default rules that match any
  line; lock `isID` once the user has acted on a dataset (`design/rapid-system.md`).
- Stable IDs and acted ranges haven't been tried in the browser yet.
- A real short stub next to a matching sidewalk now counts as already mapped (side effect of Step 5b).
- More demo feedback expected as people use it; likely requests are in `backlog.md` ("Conflation: what
  JOSM users will ask for").

## Active: what an edit records (`EditSystem`)
Design: [`design/edit-system.md`](../design/edit-system.md). Steps 2–5 done. Next: step 6 (edits that use
external data on OSM features), when Bryan picks it up. PR #5's `EditSystem.dataVersion` fits here
(the "did data change?" question); not landed.
