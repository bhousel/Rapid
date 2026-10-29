# Data IDs Design

How Rapid names each piece of data, so it can be found, selected, recorded in the edit history and
put in a URL, wherever it came from.

This isn't one system. It touches every service, `SpatialSystem`, `EditSystem`, the modes and the
renderer. This doc started in October 2026, when we wanted to select data from more than one source
at once, and found that Rapid had no single way to say which data a selection meant.

> **Status:** Steps 1–3 of 6 done (October 2026). The steps and open questions are at the end.

## Terms

The renderer and the data are two separate sides of Rapid, and it helps to keep their words apart.

**The data side:**
- **Datum**: one `AbstractData` (an `OsmEntity`, `GeoJSONData`, `MarkerData`, …). Services fetch
  data or read it from files, and keep it until `context.resetAsync()` clears it.
- **Namespace**: a set of data whose IDs are unique within it. Each Rapid dataset is one
  (`fbRoads`), OSM is one, and each kind of service data is one (OSM notes, KeepRight issues,
  Mapillary images, …). A namespace's name is the ID of the `SpatialSystem` cache that holds its
  data (see [Looking data up](#looking-data-up)).
- **Local ID**: a datum's ID within its namespace, like `w123` or `abc`. It's what the namespace's
  own code uses, like a `Graph` for its entity IDs and `way.nodes`. The type is `EntityID` for OSM.
- **Data ID**: a datum's ID across all of Rapid, `${namespace}:${localID}`, like `fbRoads:abc`.
  Selections, edits, the URL and the renderer's classes (`select`, `hover`) use it. The type is
  `DataID`, and on `AbstractData` it's the `dataID` property.

**The rendering side:**
- **Renderable**: a pixi object (`AbstractPixiFeature`) drawn for a datum. One datum can have
  several (a polygon's fill and its pin, a line's label), and they come and go as the map moves.
- **Feature ID**: a renderable's ID, unique within its layer. It's built from the data ID plus a
  suffix (`${dataID}:fill`).
- **Layer**: draws renderables for one or more namespaces. The `rapid` layer draws every enabled
  dataset, and `labels` draws for everything.

`EventTarget` (in `AbstractBehavior.ts`) bridges the two sides: given the renderable the user
pointed at, it says which datum that is.

## Goals

- **Data gets the same ID every time it loads**, from a file or the network, in any order.
- **A data ID is unique across all of Rapid.**
- **Any mix of data can be selected together**, and a selection is a plain array of data IDs.
- **Any data can be looked up by its data ID**, from anywhere in Rapid, whether it's drawn or not.
- **Data IDs can go in the URL**, so Rapid can start with several things selected.
- **A datum can have many renderables**, each with its own feature ID.
- **Legacy code keeps working.** Rapid used to have only one source of data, OSM, and a lot of code
  expects every ID to be an OSM entity ID. `DataID` and `EntityID` are both plain strings, so
  TypeScript can't catch a mix-up.

## Rules

1. **A data ID is `${namespace}:${localID}`.**
2. **Namespaces never contain a colon, so split on the first colon only.** Everything after it is the
   local ID, and only the namespace's own code reads it. Local IDs may contain colons
   (`fbRoads:abc:1`, the second part of a MultiPolygon).
3. **A data ID with no colon is in the `osm` namespace.** So an OSM entity's data ID is its entity
   ID (`w123`), and old code, backups and links that use bare OSM IDs keep working. `osm:w123`
   is read as `w123`, so the same entity never has two data IDs.
4. **A namespace decides its own local IDs, but they must be deterministic** (same data, same ID).
   - OSM-like data (OSM itself, or an OSM-like service): the entity ID, e.g. `fbRoads:w-1000000000`.
   - Data that comes as GeoJSON: `key` is the publisher's ID if the data has one, else a hash of the
     feature (see `featureKey` in `modules/data/dataID.ts`). A publisher's ID has its colons replaced,
     so the part number below can't be confused with it, and its commas, which separate IDs in `id=`.
     Esri's is `${layer}-${objectid}`, since object IDs are only unique within a layer.
   - A Multi* geometry is split into separate data, one per part, numbered `${key}:${part}`. A
     single geometry has no part number.
   - Data derived from other data goes in a cache named after its parent's, with a `.` suffix, and
     names itself from its parent: a piece of `fbRoads:abc` is `fbRoads.pieces:abc@0.25-0.5`
     (see `pieceID` in `ConflationSystem`). Dataset IDs can't contain a `.`, so these never clash
     with a dataset.
5. **Never parse a feature ID.** To find a renderable's datum, ask its layer (`_featureHasData`).
   Building feature IDs from data IDs is for readability, not for reading them back.
6. **Selections hold data IDs, not data.** Data gets replaced with newer objects (a note gets a new
   comment, a task changes status), and looking it up by ID always gets the current one.

## Looking data up

Wanted: one call that takes any data ID and returns the datum, `spatial.getData(dataID)`.

**All data lives in a `SpatialSystem` cache. Not everything in a cache is data**, and that's fine:
tiles, labels, way segments and validation results are cached there too.

**A namespace is the ID of the cache that holds its data, and the cache is keyed by local ID.** So
`mapillary-images:123` is `spatial.getItem('mapillary-images', '123')`, and `getData()` needs no
table: split on the first colon and look in that cache. Services keep their own wrappers
(`mapillary.getImage('123')`), but anything that has a data ID can find the datum without knowing
which service it came from.

**This makes cache IDs public names.** Data IDs get saved in backups, in accept and ignore records,
and in links, so renaming a cache would break them. Cache IDs that describe how the data is stored
should be renamed before data IDs ship:
- `rapid-fbRoads-data`, `mapwithai-fbRoads-data` and `esri-…-data` become the datasetID
  (`fbRoads`).
- `keepright-data`, `osmose-data`, `maproulette-data` and `geoscribble-data` drop the `-data`.
- `osm-notes`, `mapillary-images` and the other photo caches are fine as they are.

**Reserved names.** Datasets and services share one set of cache IDs, and the catalog is keyed by
datasetID. Checking the user's new datasetID against what's there today isn't enough: a later
release could ship a dataset or a service cache with the same name. (Before this, `RapidSystem`
handled that clash at startup by deleting the user's saved dataset.) So every dataset the user
adds gets an ID starting with `user-` (`USER_DATASET_PREFIX` in `RapidDataset.ts`), and nothing
Rapid ships may start with `user-`. `UiRapidAddDataset` adds the prefix to what the user types, which
may only have letters, digits, `_` and `-` (so no `:` or `.`). Custom data's namespaces start with
`custom-` (`CUSTOM_NAMESPACE_PREFIX` in `PixiLayerCustomData`), which is reserved the same way.

**Two kinds of namespace need their own lookup** (a resolver registered with `SpatialSystem`):
- **OSM.** The editable OSM data is special. It has three caches (`editor_base`, `editor_stable`,
  `editor_staging`), holding different versions of the same entities, and its IDs are bare (no
  `osm:`). Bare IDs resolve through `EditSystem`'s staging graph.
- **Vector tiles** (Overture, or a vector tile URL as custom data). These have a cache per zoom
  (`${source}.z${zoom}`), because tiles hold different data at different zooms, often simplified
  at low zooms. The namespace is the source, and the resolver looks in the cache nearest the current
  zoom. A data ID can't include the zoom, or the same building would have a different ID at z15
  and z16. See [Vector tiles](#vector-tiles) for a way to get back to one cache.

**What used to be missing** (all fixed now):
- ✅ **Custom data** from a file was held by the renderer (`PixiLayerCustomData._geoData`), not a
  cache (fixed in Step 2). Now it's in a cache whose namespace is `custom-` plus a hash of its URL,
  its WKT, or the file's contents, rather than a random UUID: the URL is saved in `data=`, so a link
  with both `data=` and `id=` needs the same namespace every time it loads.
- ✅ **Pieces of lines** were kept only in `ConflationSystem`'s results (fixed in Step 2). Now they
  also go in a `${datasetID}.pieces` cache, which conflation empties when it flushes its results
  (after every edit) and fills again as it computes them.
- ✅ **Data with no extent was dropped** (fixed in Step 1). `replaceData()` skipped a datum that had
  no extent (a relation whose members aren't loaded, or data whose geometry hasn't been worked out
  yet), so it couldn't be found by ID. Worse, if an older version of it was cached, that one
  stayed, with its old bounding box, so spatial queries kept returning stale data. Now a cache
  keeps every datum in its `items` map, and puts only those with a valid box in the spatial index.

## Vector tiles

Vector tiles are made for fast drawing. A tile at a low zoom may hold simplified geometry, or leave
small features out, and one feature can be cut across several tiles. That's why `VectorTileService`
keeps a cache per zoom and merges the cut pieces back together.

**Stable IDs could get us back to one cache per source.** If every feature has an ID that doesn't
depend on the tile or the zoom, a feature loaded at z16 can simply replace the same feature loaded
at z14 (`replaceData()` already replaces by ID), as long as the cache keeps the higher zoom's
version. No geometry clipping needed. Sources with no stable IDs would keep a cache per zoom, and
can be shown but not accepted.

**Overture has stable IDs (GERS), and we were throwing them away.** Checked in October 2026 against
the `overture-tiles` build profiles and the live `2026-10-21.0` release (buildings, places and
transportation PMTiles, which Rapid finds through Overture's STAC catalog):
- **The GERS ID is the `id` property, but only at tile zoom 14** (the archives' max zoom). Below
  that, a property is kept only for features at least 16px across at that zoom, so at z13 most
  buildings have no properties at all.
- **The MVT feature ID is a 64-bit hash of the GERS ID**, present at every zoom, and the same for
  the same feature at z13 and z14. That's the `origID` Rapid keeps. It can't be turned back into the
  GERS ID, and it's Planetiler's behavior rather than a documented promise.
- **`_processVTResults()` deleted the `id` property** ("If it already has an ID, remove it. We'll
  generate a unique one."), and `_mergePolygons()` deleted it again.
- **Rapid only loads z14 tiles from map zoom 14.5 up** (512px tiles are one zoom lower). Between
  map zoom 14 and 14.5, buildings and roads come from z13 tiles, with no GERS IDs.
- **One GERS ID can be several `GeoJSONData`**: Multi* geometries are split into parts, and a road
  crossing tile edges is one clipped piece per tile (line stitching is commented out). Polygons are
  merged back only when their properties match.

Since Step 2, `VectorTileService` keeps a feature's `id` property as `props.stableID` (and still
leaves it out of the properties, so it never becomes a tag). It's in the property hash that decides
which pieces cut by tile edges get merged, so two features with the same tags but different GERS IDs
are no longer merged. The local ID is still made up per load (`geojson-12`), because the pieces of
one feature share the GERS ID until they're merged.

So the local ID for Overture data could be the GERS ID (at z14) plus a part number, with pieces cut
by tile edges merged on it. When pieces are merged, the merged feature keeps the stable ID, the way
`MapWithAIService` gives a merged way its `orig_id`. The `sources[].record_id` property also names
the OSM features Overture's data came from (e.g. `w240586483@6`), which may help conflation.

## What's there now (October 2026)

As found when this doc started. Step 1 renamed the caches and Step 2 fixed the IDs (see
[Steps](#steps)), except for vector tiles and Streetside sequences.

| Data | `datum.id` today | Deterministic? | Cache | Notes |
|---|---|---|---|---|
| OSM entities | `w123`, `n-1` (new) | Yes | `editor_base`, `_stable`, `_staging` | Already a valid data ID |
| Rapid file datasets | `fbRoads:abc:0` | Yes | `rapid-fbRoads-data` | Becomes `fbRoads:abc` (no part number for a single geometry) |
| Pieces of lines | `fbRoads:abc:0@0.25-0.5` | Yes, until the run's ends move | None (`ConflationSystem`) | Becomes `fbRoads.pieces:abc@0.25-0.5` |
| MapWithAI | `w-1000000000` (server IDs) | Yes | `mapwithai-fbRoads-data` | OSM-like, in a per-dataset `Graph`; also in `props.fbID` |
| Esri | `w-12` (from the same counter as new OSM ways) | **No** | `esri-…-data` | `_parseFeature()` builds a stable `esri-<dataset>-<layer>-<objectid>`, but only puts it in `props.fbID`. The entities are built without an `id`, so they get one from the counter |
| Custom data (file) | `geojson-12` (from a counter) | **No** | None (the pixi layer) | |
| Vector tiles | `geojson-12` (from a counter) | **No** | `${source}.z${zoom}` (was `vt-${source}-z${zoom}`) | Features merged across tile edges are replaced with new ones |
| Streetside sequences | `s12` (from a counter) | **No** | `streetside-sequences` | Rapid builds the sequences itself from the images |
| Notes, KeepRight, Osmose, MapRoulette, Mapillary, … | The service's IDs | Yes | One per kind (`osm-notes`, …) | Not unique across services (notes and tasks are both numbers) |

Known problems this causes:
- ✅ **Accept and ignore for Esri data didn't survive a restart** (fixed in Step 2). They recorded
  `datum.id`, the `w-12` that depends on load order, so a restored session could point at a
  different feature, or none. Esri data is kept as GeoJSON now, with the local ID
  `${layer}-${objectid}`.
- ✅ **A selection keyed by layer** (`EditSelection`, `{ rapid: ['fbRoads:abc:0'] }`) could only be
  found again through the layer that draws it, so only data that's drawn (fixed in Step 3).
- **Selecting OSM and other data together isn't possible**, so `id=` in the URL only selects OSM.

## Legacy code

Since bare IDs are OSM, every OSM entity ID is already a data ID, and code that gets a list of
data IDs and calls `graph.hasEntity(id)` keeps working: it just doesn't find the non-OSM ones.
What breaks is code that calls `graph.entity(id)`, which throws when an ID isn't in the graph. Those
call sites need to take only the OSM IDs, through one helper (e.g. `osmEntityID(dataID)`, which
returns the entity ID, or `undefined` for other namespaces).

**`AbstractData.key` is taken.** It's `${id}v${v}`, a key that changes with the datum's version,
used by d3 data joins. So the data ID is a separate property, `dataID`.

## Steps

Each step is its own commit, and leaves Rapid working with the tests passing.

**✅ Step 1: Data knows its data ID, and `SpatialSystem` can find it.** No change for OSM.
- `modules/data/dataID.ts`: `makeDataID()`, `splitDataID()`, and `osmEntityID(dataID)` (the entity
  ID, or `undefined` for other namespaces).
- `AbstractDataProps.namespace`. The `dataID` getter returns `${namespace}:${id}`, or the bare `id`
  when there's no namespace (OSM). Accepting an OSM-like feature removes `namespace` from the copy,
  along with the other Rapid metadata.
- `SpatialSystem.getData(dataID)`, and `registerResolver()` per namespace. `EditSystem` registers
  `osm` (the staging graph). `VectorTileService` registers each source, looking in its zoom caches
  nearest the current zoom first.
- Caches keep data with no extent in `items` but out of the spatial index, and `replaceData()`
  replaces the older version instead of leaving it.
- Caches renamed: `keepright`, `osmose`, `maproulette`, `geoscribble`; datasets use their datasetID
  (`fbRoads`, `msBuildings`, Esri item IDs, file datasets); vector tiles use `${source}.z${zoom}`.
  Each service sets `namespace` on the data it makes. Services clear their own caches by name
  rather than by prefix.
- The user's datasets get the `user-` prefix (see Reserved names). Services don't need to list
  their namespaces.
- File datasets didn't set `namespace` yet, since their `id` was still the whole data ID
  (`fbRoads:abc:0`). Step 2 fixed that.

**✅ Step 2: Deterministic IDs everywhere.**
- File datasets: the local ID is `key`, with `:${part}` only for Multi* geometries, and `namespace`
  is the datasetID. Keys taken from the publisher replace `:` and `,` (a comma would break `id=` in
  the URL). `featureKey` moved to `modules/data/dataID.ts`, since custom data uses it too.
- Accept and ignore records, `isAcceptedOrIgnored()`, and conflation's results use data IDs
  (`fbRoads:w-123`, `ds:abc`), not `datum.id`.
- The `rapid` layer binds its features to data IDs, since it draws several datasets whose local IDs
  may clash (an interim `AbstractPixiLayer.bindingID()`, gone in Step 3). This broke the `select`
  halo on Rapid data, and the walkthrough's check for the selected road, until Step 3:
  `EventTarget.dataID` was still `datum.id`, so selections held local IDs that no longer matched
  what the layer bound.
- Pieces of lines go in a `${datasetID}.pieces` cache: `pieceID()` puts them there, and
  `parsePieceID()` only reads IDs in a `.pieces` namespace.
- Esri keeps its data as GeoJSON, keyed by `${layer}-${objectid}`. Its `Graph` and OSM-building code
  are gone, and accept converts it like a file dataset's data. Multi* geometries are still skipped,
  as before. Since Esri data is GeoJSON now, conflation could match it too.
- Custom data from a file, a url or WKT goes in a `custom-${hash}` cache, with `featureKey` (by hash)
  for local IDs. The layer draws what's visible in the cache, instead of all of it.
- Vector tiles keep a feature's `id` property (Overture's GERS ID) as `props.stableID` (see
  [Vector tiles](#vector-tiles)). Until vector tile data has stable IDs, it can be selected but not
  saved in a selection that's restored later.
- Left as is: `PixiLayerRapid._getTags()` only reads `@name` from GeoJSON data, so Esri features
  aren't labeled with their raw properties anymore (they rarely had a `name` field anyway).

**✅ Step 3: Selections are `DataID[]`.**
- Modes keep a `DataID[]` (`_selectedIDs`). `selectedIDs` returns a copy, and `selectedData` looks
  each one up with `getData()`, so it's always the current version (a note with a new comment, a
  moved node) and the modes no longer refresh it after each change. `AbstractMode.selection` and
  `dataLayerID()` are gone.
- `SelectMode` takes `{ selection: DataID[] }` and leaves out what `getData()` can't find. The
  OSM-only modes (`select-osm`, `move`, `rotate`) still take `{ selection: { osm: [...] } }` until
  Step 4.
- Every layer binds features to `d.dataID`, and `EventTarget.dataID` is `data.dataID`.
  `bindingID()` is gone. Code that needs a service's own ID uses `data.id`: `photos.selectPhoto()`,
  the service editors' `getNote()`/`getError()`/`getTask()`, and `note=` in the URL.
- The scene holds the classes (`select`, `hover`, `drawing`, `highlight`, `selectphoto`, …) by data
  ID: `scene.setClass('select', dataID)`, `scene.getDataWithClass()`, and `getClasses(dataID)`,
  which `syncFeatureClasses()` reads. Layers keep no class maps. `PhotoSystem` builds a photo's data
  ID from its layer (`${layerID}-images`), and the photo layers' child data uses data IDs.
- Edit props: `selection` and `selectionBefore` are `DataID[]`. `_upgradeEditProps()` flattens the
  old by-layer shape (`LegacyEditSelection`) in backups. File dataset IDs that end in `:0` aren't
  repaired; only dev builds have those, and a stale ID just won't be selected.
- `MapSystem._restoreSelection()` uses `getData()` instead of asking the layers. Data that isn't
  there yet (a Rapid feature still loading, a piece conflation makes when its line is drawn) is
  tried again after the next redraws, as before.
- Not done here: loading OSM entities that aren't loaded yet. On undo and redo they're always in the
  graph, so it moves to Step 5, where `id=` needs it.

**✅ Step 4: One select mode.** `'select-osm'` and `SelectOsmMode` are gone.
- `SelectMode` takes `{ selection: DataID[], newFeature?, focusedParentID? }`. What's specific to
  OSM (vertex navigation, parent and child selection, cleaning up an empty relation, the merge
  listener, the check for blocked locations, `filters.forceVisible()`, `id=`) works on the OSM
  entities in the selection (`_osmIDs`). An `osm:w1` data ID is kept as `w1`.
- The edit menu's operations, and moving and rotating with the arrow keys, need everything selected
  to be OSM; operations only take entity IDs. `MapInteractionBehavior` pans the map with the arrow
  keys otherwise.
- `MoveMode` and `RotateMode` take `{ selection: DataID[] }` too, and keep only the OSM entities.
- The files that entered `'select-osm'` enter `'select'`.
- `SelectBehavior`: clicking and shift-clicking work the same for any selectable data (OSM or
  Rapid data, custom data, markers). Shift-clicking the last selected feature goes to browse mode.
- The sidebar: an all-OSM selection gets the OSM inspector, as before. A single other datum gets its
  editor or inspector. Several features that aren't all OSM get `UiSelectionInspector`, a list
  of what's selected (`UiSectionSelectionList`, now by data ID, which the OSM inspector also uses).
  Step 6 replaces this.
- `MapSystem._restoreSelection()` restores a mix of OSM and other data, adding data that arrives
  later to the selection.
- `UiRapidDatasetSettings` and `UiRapidDatasetToggle` re-enter select mode to refresh the sidebar
  only when the selection has data that isn't OSM, so the OSM inspector keeps its state
  (`newFeature`).

**Step 5: `id=` in the URL takes data IDs.**
- `id=w1,fbRoads:abc,osm-notes:123` selects all of them, not just the first. OSM entities that
  aren't loaded yet are loaded first, and other data is selected once it loads.
- The mode writes every selected data ID back to `id=`.
- Update `API.md`.

**Step 6: Sidebar and edit menu for a multiselection.** This needs its own design, with mockups:
operations on the whole selection (geometric ones, split, merge, …), and an "edit all" choice that
shows today's field and tag editor.

Design docs to update along the way: `spatial-system.md` (`getData()`, resolvers, data with no
extent), `rapid-system.md` (feature IDs), `conflation-system.md` (the pieces cache),
`edit-system.md` (the selection shape), and `modules/modes/README.md`.

## Open questions

1. **More than one OSM-like source at once** (OSM against OpenHistoricalMap, or production against
   the dev API). They'd be namespaces like `ohm:w123`, each with its own graph. Only `osm` can be
   edited for now, and only `osm` gets the bare form.
2. **One cache per vector tile source.** The GERS IDs are there, but only at z14 (see
   [Vector tiles](#vector-tiles)). Data from lower zooms has only the hashed `origID`, so one cache
   would have to key on the hash, or load buildings and roads only at z14.

Settled:
- Where namespaces are looked up: there's no table. A namespace is a `SpatialSystem` cache ID, plus
  resolvers for OSM and vector tiles.
- Reserved names: the user's datasets start with `user-`, which nothing Rapid ships may use.
- A single geometry gets no part number. File datasets' current IDs (`fbRoads:abc:0`) haven't been
  in a release, so saved accept and ignore records don't need migrating.
- Pieces of lines go in `${datasetID}.pieces`.
- Esri keeps its data as GeoJSON (done in Step 2), which fixes the restart bug.
