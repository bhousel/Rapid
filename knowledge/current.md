# Current Work

## `main`
`conflation-system` merged into `main` (PR #7, Nov 16), for testers, before the multiselection design
(`backlog.md`). The version is 3.0.0-pre.4 (Nov 18, `package.json` and `Context.ts`); no tag yet.
Follow-ups from the release check are in `backlog.md`.

## Active: dependency upgrades (from the Nov 18 and Nov 20 checkups)
Landed (see `completed.md`): the first batch, CDN pins from `package.json`, maplibre-gl 6, the e2e tests,
pixi.js 8.23, Bryan's own packages (country-coder 6, location-conflation 4, osm-community-index 7,
node-diff3 4, osm-auth 4), and id-tagging-schema 7.3 with name-suggestion-index 9 (Bryan, Nov 22;
pinhead stays at 15). Careful with `cloc`: its real versions end in `-cloc`, so `bun update`
"upgrades" `2.12.0-cloc` to a 2022 `2.11.0`.

Still to do:
- **`bunfig.toml`'s `minimumReleaseAgeExcludes`**: country-coder, location-conflation and
  name-suggestion-index (9, Nov 22) are past the 3-day window now and can come off the list; check
  the `@rapid-sdk` packages too.
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
`pixi-8.23` (PR #10), `label-avoids` (PR #11), `linebuilder_refactor` (PR #12) and `graphics-sharpen`
(PR #13, Nov 25) are merged (`completed.md`). How the renderer works is in
[`design/graphics-system.md`](../design/graphics-system.md), and the measurements and plans behind it in
[`design/graphics-system-log.md`](../design/graphics-system-log.md). What's left is under "Pixi rendering
follow-ups" in `backlog.md`, for Bryan to pick. Nothing is active.
- **Planned, for later** (Bryan, Nov 25): a scene per view, with the minimap as one and the turn
  restriction editor back, then the main map off `multiView` ([`design/scene.md`](../design/scene.md)
  section 4).
- **On hold** (Bryan, Nov 24): how many hidden features are kept (147 MB after 50 pans in Bellevue).
  Making features makes more garbage than destroying them (the log's section 20).
- **Waiting on Pixi:** pixijs#12437 (every `LineMesh` is always batched until it's fixed).
- `renderer=canvas` is blank since the lines became meshes, and stays that way (`quirks.md`).

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
