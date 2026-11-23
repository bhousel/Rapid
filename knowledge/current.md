# Current Work

## `main`
`conflation-system` merged into `main` (PR #7, Nov 16), for testers, before the multiselection design
(`backlog.md`). The version is 3.0.0-pre.4 (Nov 18, `package.json` and `Context.ts`); no tag yet.
Follow-ups from the release check are in `backlog.md`.

## Active: dependency upgrades (from the Nov 18 and Nov 20 checkups)
Landed (see `completed.md`): the first batch, CDN pins from `package.json`, maplibre-gl 6, the e2e tests,
pixi.js 8.23, and Bryan's own packages (country-coder 6, location-conflation 4, osm-community-index 7,
node-diff3 4, osm-auth 4). Careful with `cloc`: its real versions end in `-cloc`, so `bun update`
"upgrades" `2.12.0-cloc` to a 2022 `2.11.0`.

Still to do:
- **id-tagging-schema 7.3 + name-suggestion-index 8, together** (NSI 8 needs schema 7; we already call
  `buildIDPresets()`). NSI 9 (ESM-only, its own `Preset` types) is in NSI's changelog but not on npm yet.
  **Not with pinhead 16:** schema 7.3 uses 4 icons pinhead 16 renamed (`bagel_seeded`,
  `person_running_after_person`, `person_squatting_and_person_reaching_up`,
  `person_wearing_martial_arts_belt_front_kicking`), and `build_data.ts` drops missing icons silently.
- **`bunfig.toml`'s `minimumReleaseAgeExcludes`**: country-coder and location-conflation are past the
  3-day window now and can come off the list.
- **Regression from the CDN pins: road fields missing.** At runtime the tagging schema went from 6.6 to
  6.19.2, where `sidewalk`, `cycleway`, `parking/side/parking` and `parking/side/orientation` have type
  `directionalCombo`, which Rapid doesn't support (iD's rename and generalization of the `cycleway` field;
  Rapid's `UiFieldCycleway` is the old one). `SchemaSystem` drops them, with an "Unable to resolve
  referenced fieldID" warning. Also unsupported in 6.19: `date` (5 fields) and `colour` (3). Later.
- **Hold:** cldr 49 (drops 109 locales, e.g. `dv`, `nv`, `pap`, `skr` lose native names in `languages.json`).
- **Left in `bun audit`:** postcss 5 via `postcss-selector-prepend` (2 high, 4 moderate; build-only, and
  it reads only our own CSS). That package hasn't changed since 2022; `postcss-prefix-selector` (postcss 8)
  or a few lines of our own in `scripts/build_css.ts` would replace it. Dependabot alerts are off for the repo.
- **CI:** `build` and `e2e` run on pushes and PRs to `main`. `deploy` and `pages` are disabled by hand in
  the Actions UI; `deploy.yml` still has Bun 1.3.6, a plain `bun install`, and Facebook's AWS role and S3
  bucket. Left as is on purpose (Bryan, Nov 18): it won't work, and that's fine for now.
- **Old branches:** `overture_sidebar` (Dec 2024, unmerged), `release` (2.5.x) and `upstream` (Jul 2025)
  on the fork are left to look at. `esm-deps` (local) is merged.
- **`RELEASE.md`** still describes Facebook's release flow (`deploy.yml`, facebook/Rapid links).

## Rendering: what's next
`pixi-8.23` (PR #10) and `label-avoids` (PR #11) are merged (`completed.md`); the plans and measurements
are in [`design/graphics-system.md`](../design/graphics-system.md). What's left is under "Pixi rendering
follow-ups" in `backlog.md`.

**Active, on `linebuilder_refactor`: a line builder of our own** (section 15 has the direction, the
order of work, Bryan's decisions and the measurements). Done: steps 1 to 6, 8 and 9.
- The stroke mesh (`modules/geo/stroke.ts`); lines' casings and strokes, areas' outlines, halos and
  the lasso drawn from it (`modules/pixi/lib/LineMesh.ts`). A zoom in Užice allocates half of what
  it did.
- A line hit by its distance from the pointer (`LineHitArea`); `lineToPoly()` and `DashLine` gone.
- Partial fills as bands of real geometry (`modules/geo/band.ts`, with `clipper2-ts`): no stencil
  masks, 44 to 76% fewer draw calls in the three places, no more time on a zoom.
- Step 6 (committed, `6860f8d1d` and `9edfa2381`):
  - The OSM layer finds its features under the pointer through the spatial index
    (`PixiLayerOsm.hitTest()`, `PixiScene.hitTest()`): a pointer event in Užice is 0.07 ms of
    hit test where Pixi's walk took 8.
  - Its lines are drawn in two batches a level (`modules/pixi/lib/LineBatch.ts`, a `Mesh` with
    our own shader): every casing, then every stroke (Bryan's decision; he likes the look).
  - A line that its batches draw isn't in Pixi's scene. A hovered line draws itself meanwhile
    (its glow is a filter on its container), and a line with oneway arrows stays in the scene.
- Step 8 (committed, `4f906a9af` and `26cf4e07f`): areas in two batches, every fill
  (`lib/FillBatch.ts`) and then every outline; points, vertices and the pins of areas in one
  (`lib/PointBatch.ts`), sized in pixels and kept upright by the shader. Pixi's tickers are
  off. Labels and the avoid grid ask a point where it's drawn.
- Step 9 (not committed yet, Nov 23): the markers along lines (oneway arrows, the triangles of
  a line with sides) are a strip in the strokes' batch, drawn by the lines' fragment shader.
  With it:
  - An area under 20 pixels is its fill alone, with no outline (Bryan: fine, something is
    drawn, and a hover shows the outline).
  - A hovered area's fill is tinted halfway to the hover's yellow, and twice as opaque (Bryan
    asked for a tint "for now"). **He hasn't seen how it looks.**
  - Arrows point back along a way tagged `oneway=-1`. They didn't before: **Bryan hasn't been
    asked**, it was wrong and a few lines to fix.
  - Every OSM feature is out of Pixi's scene, except what's hovered, highlighted, or a vertex
    of the selection.

Next: nothing of section 15's order of work is left. Candidates, for Bryan to pick: hovers and
selections drawn (and animated) by the shaders (his idea, Nov 23; `backlog.md`), the other
layers' features in batches, or numbers from weaker hardware. Step 7 (a worker) was skipped as
probably unnecessary (Bryan). Bryan (Nov 23): fewer draw calls are a result in themselves,
since the M4 we measure on hides their cost. `renderer=canvas` is blank since the lines became
meshes, and stays that way (`quirks.md`).

Waiting on Pixi: pixijs#12437 (every `LineMesh` is always batched until it's fixed).

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
