# Data IDs Design

How Rapid names each piece of data, so it can be found, selected, recorded in the edit history and
put in a URL, wherever it came from.

This isn't one system. It touches every service, `SpatialSystem`, `EditSystem`, the modes and the
renderer. This doc started in October 2026, when we wanted to select data from more than one source
at once, and found that Rapid had no single way to say which data a selection meant.

> **Status:** Step 1 of 6 done (October 2026). The steps and open questions are at the end.

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
     feature (see `featureKey` in `RapidDataset`). A publisher's ID has its colons replaced, so the
     part number below can't be confused with it, and its commas, which separate IDs in `id=`.
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
may only have letters, digits, `_` and `-` (so no `:` or `.`).

**Two kinds of namespace need their own lookup** (a resolver registered with `SpatialSystem`):
- **OSM.** The editable OSM data is special. It has three caches (`editor_base`, `editor_stable`,
  `editor_staging`), holding different versions of the same entities, and its IDs are bare (no
  `osm:`). Bare IDs resolve through `EditSystem`'s staging graph.
- **Vector tiles** (Overture, or a vector tile URL as custom data). These have a cache per zoom
  (`${source}.z${zoom}`), because tiles hold different data at different zooms, often simplified
  at low zooms. The namespace is the source, and the resolver looks in the cache nearest the current
  zoom. A data ID can't include the zoom, or the same building would have a different ID at z15
  and z16. See [Vector tiles](#vector-tiles) for a way to get back to one cache.

**Not true yet** (things to change):
- **Custom data** from a file is held by the renderer (`PixiLayerCustomData._geoData`), not a cache.
  It should go in a cache. Its namespace should be a hash of its URL, or of the file's contents,
  rather than a random UUID: the URL is saved in `data=`, so a link with both `data=` and `id=`
  needs the same namespace every time it loads.
- **Pieces of lines** are kept in `ConflationSystem`'s results. They should go in a
  `${datasetID}.pieces` cache, which conflation clears and fills again after every edit.
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

So the local ID for Overture data could be the GERS ID (at z14) plus a part number, with pieces cut
by tile edges merged on it. When pieces are merged, the merged feature keeps the stable ID, the way
`MapWithAIService` gives a merged way its `orig_id`. The `sources[].record_id` property also names
the OSM features Overture's data came from (e.g. `w240586483@6`), which may help conflation.

## What's there now (October 2026)

As found when this doc started. Step 1 renamed the caches (see [Steps](#steps)), and the other
steps fix the IDs.

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
- **Accept and ignore for Esri data don't survive a restart.** They record `datum.id`, the `w-12`
  that depends on load order, so a restored session can point at a different feature, or none.
  When Esri data is kept as GeoJSON, its local ID is `${layer}-${objectid}`, since object IDs are
  only unique within a layer.
- **A selection keyed by layer** (`EditSelection`, `{ rapid: ['fbRoads:abc:0'] }`) can only be
  found again through the layer that draws it, so only data that's drawn. `MapSystem` retries on
  later redraws to cover for it.
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
- File datasets don't set `namespace` yet: their `id` is still the whole data ID
  (`fbRoads:abc:0`), so `getData()` can't find them until Step 2.

**Step 2: Deterministic IDs everywhere.**
- File datasets: the local ID is `key`, with `:${part}` only for Multi* geometries. Keys taken from
  the publisher replace `:` and `,` (a comma would break `id=` in the URL).
- Pieces of lines go in a `${datasetID}.pieces` cache, which `ConflationSystem` fills on each run.
- Esri keeps its data as GeoJSON, keyed by `${layer}-${objectid}`. This is mostly deleting the
  OSM-building code, since accept already handles `GeoJSONData` from file datasets.
- Custom data moves from `PixiLayerCustomData` into a cache, namespaced by a hash of its URL or the
  file's contents, with `featureKey` for local IDs.
- Vector tiles: keep Overture's GERS ID instead of deleting it (see [Vector tiles](#vector-tiles)).
  Until vector tile data has stable IDs, it can be selected but not saved in a selection that's
  restored later.

**Step 3: Selections are `DataID[]`.**
- Modes keep a `DataID[]`. `selectedIDs()` returns it, and `selectedData()` looks each one up
  with `getData()`, so it's always the current version.
- Layers bind renderables to `d.dataID` (not `d.id`), so `EventTarget.dataID` is the data ID.
- The scene holds the classes (`select`, `hover`) by data ID, and drops its `layerID` argument:
  `scene.setClass('select', dataID)`. Layers ask the scene when they style. Today each layer keeps
  its own class maps, and a mode has to know which layer draws which data.
- Edit props: `selection` and `selectionBefore` become `DataID[]`. `_upgradeEditProps()` flattens
  an `EditSelection` record. File dataset IDs that end in `:0` aren't repaired; only dev builds
  have those, and a stale ID just won't be selected.
- `MapSystem._restoreSelection()` uses `getData()` instead of asking the layers, waits for data
  to load rather than to be drawn, and loads OSM entities that aren't loaded yet.

**Step 4: One select mode.** `'select-osm'` goes away.
- `SelectMode` takes `{ selection: DataID[] }`. What's specific to OSM (vertex navigation,
  parent and child selection, cleaning up empty relations, the merge listener, the check for
  blocked locations) runs on the OSM part of the selection.
- The 28 files that enter `'select-osm'` enter `'select'`.
- `SelectBehavior`: shift-click adds or removes any data, not just OSM.
- For now, the sidebar and the edit menu cover what they do today: one datum shows its inspector,
  an all-OSM selection gets today's multiselection UI and operations, and a mixed selection gets a
  plain list. Step 6 replaces this.

**Step 5: `id=` in the URL takes data IDs.**
- `id=w1,fbRoads:abc,osm-notes:123` selects all of them, not just the first.
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
- Esri keeps its data as GeoJSON (Step 2), which fixes the restart bug.
