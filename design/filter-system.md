# Filter System Design

**Status:** Started Nov 2026, as a record to build on. Sections 1 to 4 describe `FilterSystem` as it
is, with measurements. The quick fixes in section 4 are done (Nov 19). Section 6, a filter that
decides the level of detail, is a direction and a list of open questions: nothing is designed or
built. That work comes after the `pixi-8.23` branch lands.

`FilterSystem` (`modules/core/FilterSystem.ts`) decides which OSM features are hidden from the map.
The user sees it in two places: the **Map Features** list in the Map Data pane
(`UiSectionMapFeatures`), 16 checkboxes from "Points" to "Others", and the **"N hidden features"**
notice in the footer (`UiFilterStatus`).

## Words used here

- **Filter:** a named category of features with a function that says whether an entity belongs to
  it, from the entity's tags and geometry type. There are 16, created in the constructor: `points`,
  `traffic_roads`, `service_roads`, `paths`, `buildings`, `building_parts`, `indoor`, `landuse`,
  `boundaries`, `water`, `rail`, `pistes`, `aerialways`, `power`, `past_future`, `others`.
- **Match:** an entity matches every filter whose function returns true for it, so it can match
  several (a building tagged as a power substation), one, or none. `others` matches a line or area only when
  nothing else did.
- **Hidden filter:** one the user turned off. `boundaries` is hidden by default.
- **Hidden entity:** one that matched at least one filter, where *every* filter it matched is
  hidden. The answer to "is it hidden" is the first of those filters, or `null`.
- **Pass:** one run of a map layer over its data (`design/graphics-system.md`). The OSM layer asks
  about every entity in its cull box on each pass.

## 1. The rules

- **Tags decide, through rulesets.** Most filters test the tags against a ruleset in
  `data/osm_rulesets.json5` (`major_vehicular`, `filter_building`, `filter_water`, …). `points`
  and `others` test the geometry type only. Several leave out features with a lifecycle prefix
  (`construction`, `disused:…`), which `past_future` matches unless the feature is a road or path
  in use.
- **Only downloaded features can be hidden.** An entity without a `version` (the user just made it)
  is always shown.
- **A vertex follows its ways.** A vertex matches nothing itself. It is hidden when every one of
  its parent ways is hidden.
- **A plain member follows its relation** (iD#2548, iD#2887). A way that matched nothing better
  than `others` takes the matches of its parent relation when it belongs to one multipolygon and
  nothing else, or only to boundary relations. That's how the untagged inner ring of a hidden wood
  is hidden too. Relations other than multipolygons (which are areas) and boundaries match nothing.
- **Forced visible.** `forceVisible(entityIDs)` names entities to show whatever the filters say
  (and the members of those that are relations, one level down). Select, move and rotate modes use
  it for the selection, and the KeepRight and Osmose panes for the features of the open issue.
- **Hidden features can't be edited by accident.** `hasHiddenConnections()` says whether an entity
  touches something hidden. Dragging a node and continuing a line refuse when it does, and the
  lasso skips hidden nodes.
- **Where the hidden filters come from:** the setting `filters.disabledFilters` (synced between
  the user's browsers), or `disable_features=` in the URL, which wins for the session without being
  saved (`API.md`).

Only OSM data is filtered. Rapid datasets, custom data and the other layers don't ask.

## 2. Who asks

| Caller | Asks | When |
|---|---|---|
| `PixiLayerOsm.render()` | `filterScene(entities, graph)`: the entities that aren't hidden. It also counts the hidden ones per filter. | Every pass, for everything in the cull box |
| `UiFilterStatus` | `getStats()`: those counts | When it renders |
| `DragNodeMode`, `ContinueOperation`, `Context.hasHiddenConnections()` | `hasHiddenConnections()` | Before an edit |
| `LassoBehavior` | `isHidden()` | For each node in the lasso |
| `SelectMode`, `MoveMode`, `RotateMode`, `UiKeepRightDetails`, `UiOsmoseDetails` | `forceVisible()` | Entering and leaving |
| `UiPresetList` | `isHiddenPreset()`: would a feature with this preset be hidden | Listing presets |
| `UiSectionMapFeatures` | `toggle()`, `enableAll()`, `disableAll()`, `isEnabled()` | The checkboxes |
| `MapSystem` | `clearEntity()` | On `merge` and `stagingchange` (section 3) |

A change to the hidden filters emits `filterchange` and requests a redraw. `MapSystem` marks the
OSM layer dirty on that event.

## 3. What it remembers

`_cache` is a `WeakMap` from an entity to what's known about it:

- `parents`: its parent ways (a vertex) or parent relations (anything else).
- `matches`: the set of filters it matched.
- `hidden`: the answer to "is it hidden", for one set of hidden filters (`hiddenVersion`).

An edited entity is a new object, so it starts with no record, and a record goes away with its
entity. What makes a record stale, and what clears it:

- **The entity's relatives changed** (a way joined a relation, a node joined a way). `MapSystem`
  calls `clearEntity()` for every entity in a staging change's `difference.complete()` (what
  changed, the nodes of changed ways, the members of changed relations, and all their parents),
  and for every entity that arrives in a `merge`.
- **The hidden filters changed.** `_hiddenVersion` counts those changes, and a `hidden` answer is
  only used for the version it was worked out for. The matches stay.
- **`resetAsync()`** starts a new cache.

Vertices have no remembered answer: each asks its parent ways, whose answers are remembered.
Forced-visible entities are checked before the cache, so nothing needs clearing when they change.

**Known gaps:**

- **The cache isn't per graph.** `parents` is whatever the first graph asked about returned. Every
  caller passes the staging graph today.
- **Nothing clears the matches when the schema's rulesets change** (`schemachange`). `MapSystem`
  marks the layers dirty, but an entity keeps the matches it had.
- **The clearing lives in `MapSystem`**, not here: `FilterSystem` relies on another system to
  listen to the editor for it.
- **The counts are a side effect of `filterScene()`.** Each call starts them again from zero, so
  they describe the OSM layer's last pass: its cull box (the view plus 256 px), as of the last
  frame that did a pass. A second caller of `filterScene()` would replace them. Each hidden entity
  is counted once, under the first hidden filter it matched; vertices without interesting tags
  aren't counted.
- **The count per filter isn't the same on every load.** With `traffic_roads` and `paths` both
  hidden, three loads of one view at Staten Island hid the same entities and gave two different
  sets of counts. Probably a tagged vertex shared by a hidden road and a hidden path: it's counted
  under its first parent way's filter, and the parents come in the order the data arrived. (Not
  traced further.)

## 4. What it costs

Measured Nov 19 at Staten Island (z16.5, `points`, `indoor`, `landuse` and `boundaries` hidden,
M4). The cull box holds 84,641 entities: 65,695 vertices, 14,928 areas, 1,837 lines, 2,098 points
and 83 relations. 22,527 of them are hidden, and the layer shows about 18,500 features.

**Before:** `filterScene()` took 24.4 ms, 19.6 of it on the vertices, and was about half of the
OSM layer's pass at every place measured. Two things made it slow:

- **The cache was keyed by `entity.key`**, which builds a string (`${id}v${v}`) on every call.
  Looking up 84,641 entities in a `Map` by `key` takes 12.5 ms; in a `WeakMap` by the object, 1.5.
  (The old cache also kept a record until `clearEntity()` or a reset, so records of old versions
  of edited entities stayed, each holding on to the entity's parents.)
- **Nothing remembered the answer.** Each vertex asked each parent way (1.74 on average), and each
  of those copied the way's set of matches into an array to test it.

**Quick fixes (Nov 19):** the cache is a `WeakMap` keyed by the entity, and a feature's answer is
remembered with its matches. The results are the same: for eight sets of hidden filters over the
95,000 entities around that view, the old and new code show exactly the same entities, and
remembered answers equal answers worked out from an empty cache.

| ms | `filterScene()` step, before → after | OSM pass, before → after |
|---|---|---|
| Seattle | 7.7 → 2.2 | 16.3 → 8.2 |
| Staten Island | 30.0 → 9.8 | 54.8 → 32.3 |
| Užice | 106 → 39.4 | 211 → 144 |

(Medians of redraw frames from `bun run measure --fresh`, in two sessions. In one session at
Staten Island, old build then new: the frame's APP phase 57.1 → 34.5 ms, and a pan frame that does
the pass 100 → 72 ms.)

**What's left of it** (Staten Island, 8.4 ms for `filterScene()` on its own):

- 5.8 ms is the vertices: 1.2 looking up each one's parents, 1.7 asking each parent way for its
  geometry type (needed only to work out a way's answer the first time), 2.2 looking up the
  parents' answers, and the rest the checks before them (`version`, forced visible).
- 2.0 ms is `entity.geometry(graph)` for every entity.

**Options that don't need the rethink:**

- **Don't ask about vertices the layer won't draw.** Done (Nov 19; `graphics-system.md` section
  12, "The vertices that aren't drawn"). The layer draws a vertex when it's "interesting"
  (tagged, an endpoint or an intersection) at effective zoom 16 and up, or when it belongs to a
  selected or hovered way. All 65,695 went through `filterScene()`, then `classify` (4.2 ms),
  then the `vertices` step (5.4 ms), which tested each one. Now the layer leaves out the ones it
  won't draw before it calls `filterScene()` (`OsmNode.vertexKind()`), and asks about the related
  ones by themselves. It still passes every tagged vertex, whatever the zoom, so the counts are
  what they were. The filter step went from 9.2 to 2.6 ms here, and from 48 to 15 in Užice.
- **Remember a vertex's answer too.** It depends on its parents' answers and on the forced-visible
  set, so it needs a version number that both of those bump.
- **Count the hidden features apart from the pass**, when `UiFilterStatus` needs them.
- **Build `entity.key` once.** Other hot loops that use it pay the same cost.

## 5. What's wrong with it as a design

Beyond the gaps in section 3:

- **It answers "show or don't", per broad category.** A scene is either drawn with every building,
  fence and footway in it, or the user hides a whole category by hand. Nothing depends on the zoom
  or on how full the view is.
- **The places that are slow to draw are the places that are too full to edit.** The difficult
  places in `design/graphics-system.md` (Užice, Staten Island, Golmud) are worst cases on purpose,
  and a view with 60,000 features in it is unusable however fast it's drawn.
- **Level-of-detail rules already exist, scattered through the renderer:** nothing below zoom 12
  (`MINZOOM` in three layers), vertices and line markers from effective zoom 16 (`PixiLayerOsm`,
  `PixiFeatureLine`), no vertices or midpoints for a selected feature smaller than 25 px, no label
  along a line smaller than 40 px or around an area smaller than 600 px (`PixiLayerLabels`), a
  virtual pin on an area only when its preset is "interesting enough". Each is a constant in the
  code that uses it.
- **The filters are fixed in the constructor**, though the rules they test are data. Each match
  looks its ruleset up again (`schema.getScope('osm').rulesets.get(…)`).
- **It asks about everything on every pass**, when the answer for an entity only changes with its
  tags, its relatives or the user's choices.

## 6. Where it's heading: level of detail

Bryan's direction (Nov 19): the filter should get smarter about leaving details out at low zooms
and letting them appear at higher ones, instead of only sorting features into broad categories that
are either in or out. Once the scene holds what a mapper can use at that zoom, most of the
rendering problems at the difficult places go away at the source.

**The user has to know that something was left out** (Bryan, Nov 19). In Užice someone mapped
every bollard and tree, and a mapper who arrives there shouldn't have to wait for all of them to
be drawn. But if they're left out silently, the next mapper adds the trees again. So whatever
classifies features by importance also has to say, on the map or beside it, that there's more
detail here than is shown, and what kind. This system should own that.

Nothing here is designed. Questions to answer first:

- **What ranks a feature?** Its tags (through rulesets, as today), its size on screen, its
  preset, how much else is near it, or a mix. Buildings in a dense city and solar panels in a
  field are both "many small areas", and a mapper wants them at different zooms.
- **Hidden by the user and left out for now are different things.** A hidden feature is protected
  from edits (`hasHiddenConnections()`) and counted in the footer. What should a feature left out
  for the zoom be: selectable from the sidebar, protected, counted, drawn simplified or faint?
- **Who decides?** This system, `StyleSystem` (which already matches tags to a style), or the
  layer. The rules in section 5 would move to wherever that is.
- **Pop-in.** A zoom change restyles everything in the cull box already. Features appearing with
  the zoom add to that frame; the frame stats (`RenderFrame`) can say how much.
- **A budget, or thresholds?** Fixed zoom thresholds are predictable. A budget (so many features
  per map tile, the most important first) adapts to the place, and changes what's drawn as the
  user pans.
- **Other data.** Rapid datasets and custom data aren't filtered at all today.
- **Vertices** are 78% of the entities in Staten Island's cull box, and about 1 in 20 of them is
  drawn (about 3,500 of 65,695). Whatever the design, they should be reached through the ways that
  are drawn, not gathered and tested one by one.

## 7. Tests

`test/unit/core/FilterSystem.test.js` covers the matchers, the rules in section 1, the cache and
the settings. Entities made in tests all have `v` 0, so with the old cache two tests that used the
same entity ID shared a record: "hides … member ways on a hidden multipolygon relation" passed
only when the matching tests ran before it. It now tags the relation, the way multipolygons are
tagged, and passes on its own.
