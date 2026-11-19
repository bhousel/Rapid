# Current Work

## `main`
`conflation-system` merged into `main` (PR #7, Nov 16), for testers, before the multiselection design
(`backlog.md`). The version is 3.0.0-pre.4 (Nov 18, `package.json` and `Context.ts`); no tag yet.
Follow-ups from the release check are in `backlog.md`.

## Active: dependency upgrades (from the Nov 18 checkup)
Landed on Nov 18 (see `completed.md`): the first batch, CDN pins from `package.json`, maplibre-gl 6, and
the e2e tests. Careful with `cloc`: its real versions end in `-cloc`, so `bun update` "upgrades"
`2.12.0-cloc` to a 2022 `2.11.0`.

Still to do, in about this order:
- **CI:** `build` and `e2e` run on pushes and PRs to `main`. `deploy` and `pages` are disabled by hand in
  the Actions UI; `deploy.yml` still has Bun 1.3.6, a plain `bun install`, and Facebook's AWS role and S3
  bucket. Left as is on purpose (Bryan, Nov 18): it won't work, and that's fine for now.
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
- **pixi.js 8.23 (branch `pixi-8.23`, Nov 18).** Bumped; the only change needed was turning off Pixi's
  accessibility layer, which 8.22+ turns on when Tab is pressed (then walks the scene every frame). Checked
  glow and imagery filters across renderer resizes (the 8.21/8.22 regression).
  **`DashLineShader` measured (Nov 18, downtown Seattle z17.5, 2,921 features, 814 dashed footways, M4):**
  swapping those strokes for `SmoothGraphics` + `DashLineShader` took draw calls per frame from 771 to
  2,368 and the DRAW pass's CPU time from 0.8 to 3.0 ms, with no visible difference at that zoom (MSAA on).
  It also supports only one dash and one gap (our boundaries and barriers use four values) and advises
  against round caps. Fine for halos (few), not for styled dashes; `DashLine.ts` stays.
  **The real draw-call cost is the partial area fills:** each is masked with a stencil, so 177 masked fills
  made 707 of the 771 draw calls (64 without masks). GPU time was ~9 ms a frame in all three cases.
  **Next: [`design/graphics-system.md`](../design/graphics-system.md)** (Nov 18), the measurements and the
  plan: frame stats first, a set of difficult places to measure on, then our own line builder for
  partial-fill bands, hit areas and dashes. Steps 1 (frame stats), 2 (`bun run measure` over
  difficult places), 3 (GPU time: mostly fixed costs, see section 6) and 4 (the rendering info card,
  ⌘⇧F) done, and the imagery filter no longer runs at its default settings; next is step 5 (pass the
  `RenderFrame` to the layers' `render()` and `cull()`). Fixes found along the way are in `backlog.md`
  ("Pixi rendering follow-ups").
- **Regression from the CDN pins: road fields missing.** At runtime the tagging schema went from 6.6 to
  6.19.2, where `sidewalk`, `cycleway`, `parking/side/parking` and `parking/side/orientation` have type
  `directionalCombo`, which Rapid doesn't support (iD's rename and generalization of the `cycleway` field;
  Rapid's `UiFieldCycleway` is the old one). `SchemaSystem` drops them, with an "Unable to resolve
  referenced fieldID" warning. Also unsupported in 6.19: `date` (5 fields) and `colour` (3). Later.
- **Hold:** cldr 49 (drops 109 locales, e.g. `dv`, `nv`, `pap`, `skr` lose native names in `languages.json`).
- **Left in `bun audit`:** postcss 5 via `postcss-selector-prepend`; picomatch via `esbuild-visualizer`
  (both build-only).
  Dependabot alerts are off for the repo.
- **Old branches (Nov 18):** local branches and worktrees cleared, and ~67 old branches deleted from the
  fork (merged, Dependabot, or identical on facebook/Rapid). Left to look at: `overture_sidebar` (Dec 2024,
  unmerged), `release` (2.5.x) and `upstream` (Jul 2025).
- **`RELEASE.md`** still describes Facebook's release flow (`deploy.yml`, facebook/Rapid links).

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
