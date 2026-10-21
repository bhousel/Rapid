# Rapid System Design

`RapidSystem` (`modules/core/RapidSystem.ts`) manages Rapid's **datasets**: third party data that a
user can review and add to OpenStreetMap. It keeps the catalog of datasets, tracks which ones the
user has added to the Rapid menu and enabled, and works out which features the user has already
accepted or ignored.

This system is older than the design docs. This doc started in October 2026, when datasets
became a collection that asset files can define, and records where it's heading from here.

> **Status:** Dataset assets are done (`datasets=` / `dataset_ids=`, `merge()`, `dataset.schema.json`),
> and the user's custom datasets, with their data mapping and conflation settings, are kept in
> `DatabaseSystem`. Next: export and import of a dataset definition (see
> [`settings-system.md`](settings-system.md), Layered Settings v2, Step 4).

## What it owns

- **The catalog** (`catalog: Map<DatasetID, RapidDataset>`) of every dataset Rapid knows about, and
  their `categories` (free-text keywords used to filter the catalog UI).
- **The menu lists:** `addedDatasetIDs` (on the Rapid menu) and `enabledDatasetIDs` (checked, so
  drawn on the map). `datasets` is the added subset of the catalog.
- **Accepted and ignored features** (`acceptIDs`, `ignoreIDs`). These are recomputed from the edit
  history on every `stablechange`, from the `rapid_accept_feature` and `rapid_ignore_feature`
  annotations, so undo, redo and restoring a session all keep them right.
- A few odds and ends: the task boundary (`setTaskExtentByGpxData`), and whether the user has had
  power-user mode on this session.

Events: `datasetchange` (datasets added, removed, enabled, or the catalog changed) and `taskchanged`.

## Where datasets come from

The catalog is built in layers, each able to replace or delete what the earlier layers defined:

| Layer | Defined by | Data loaded by | User can change | Saved in |
|---|---|---|---|---|
| 1. Services | `MapWithAIService`, `EsriService`, `OvertureService` (`getAvailableDatasets()`) | The service | Color, `conflated`, the conflation rules | `DatabaseSystem` `datasets` store (`changes`) |
| 2. Asset files | `rapid_datasets` (empty), `datasets=`, or `RapidSystem.merge()` | The service if `serviceID` is set, otherwise Rapid, from `sourceUrl` | Color, `conflated`, the conflation rules | `DatabaseSystem` `datasets` store (`changes`) |
| 3. The user | `UiRapidAddDataset` (a URL or a dropped file) | Rapid, from `sourceUrl` or `sourceFileID` | Everything; can delete | `DatabaseSystem` `datasets` store |

Asset files use the same format as imagery, styles and schema (`assetID`, `scopes[]`), with a
`datasets` collection keyed by datasetID, and `null` to delete. The merge rules are the same too (see
API.md, "Rapid Datasets"). Datasets aren't specific to a scope yet; use the `'*'` scope.

### Two independent flags: `custom` and `serviceID`

- **`custom`: who owns the definition.** `true` only for datasets the user added themselves. They can
  edit or delete those; everything else is locked except a few settings like the color.
- **`serviceID`: who loads the data.** If set, that service loads it. If not, Rapid loads the file
  itself (`RapidDataset.setupCustomDatasetAsync()`, despite the name) into the dataset's spatial cache,
  and `PixiLayerRapid` draws it from there.

These are independent. Datasets from asset files are `custom: false`, with or without a `serviceID`.
Later we want custom datasets *with* a `serviceID`: the user's own Esri FeatureServer, or another
OSM-like API to conflate against. See the backlog item "Custom datasets backed by a service" for the
places that still assume a custom dataset has no service.

`assetID` records which asset file defined a dataset, if any.

## Lifecycle

- **`initAsync`:** registers the `rapid_datasets` asset and reads the `datasets=` url parameter
  *now*, then loads the requested dataset assets. Doing this at init means those datasets are already
  in the catalog when the menu lists are set up at startup. (Otherwise `_datasetsChanged()` would
  drop their IDs from `dataset_ids=` as unknown.) At the same time it reads the user's custom datasets
  from the `DatabaseSystem` `datasets` store (`_readCustomDatasetsAsync()`). The records are kept in
  memory, so the rest of startup stays synchronous.
- **`startAsync`:** starts the services and gathers their datasets, then:
  1. `_rebuildCatalog()`: services, then the merged asset inputs in order.
  2. `_setupDatasetLists()`: the added and enabled lists, from `dataset_ids=` or from settings.
  3. `_loadDatasetSettings()`: applies the saved colors, and creates the user's custom datasets.
  4. `_datasetsChanged()`: tidies the lists, saves them, starts any loading that's needed, and emits
     `datasetchange`.
- **`hashchange`:** a changed `datasets=` reloads the assets (rebuild, settings, changed), then
  `dataset_ids=` is applied.

`_rebuildCatalog()` doesn't read the user's custom datasets. It carries them over from the catalog
it's replacing; `_loadDatasetSettings()` is what creates them the first time. A dataset that's still
defined the same way (same datasetID and `assetID`) keeps its instance across rebuilds, so data it has
already loaded isn't fetched again.

## URL parameters

- `datasets=`: assetIDs to load datasets from, like `imagery=`. `default` means the default assets.
  AssetIDs that can't be loaded are skipped with a warning. (Before October 2026, `datasets=` meant
  what `dataset_ids=` means now, so old links land here and are skipped.)
- `dataset_ids=`: datasetIDs to enable. If present, it takes the place of the saved lists, and
  Rapid keeps it up to date as the user changes them.
- `poweruser=true`: remembered for the session (`hadPoweruser()`).

## Decisions

- **Datasets are a collection, not settings.** A dataset with its data mapping and conflation rules is
  an item in the `datasets` collection of a document, and asset files already handle documents
  (layers, `null` deletes, embedding apps supplying their own). This replaced saving the full
  definition as dozens of flat settings keys, which all synced to the OSM account. See the vocabulary
  in [`settings-system.md`](settings-system.md) (documents hold settings, collections and state).
- **`addedDatasetIDs` / `enabledDatasetIDs` are state.** They still live in `SettingsSystem` until
  settings v2 moves state out.
- **An asset file can replace or delete a service's dataset.** That's what an embedding app needs to
  hide datasets that don't apply to its users, the same way it can delete imagery today.
- **Datasets from asset files load their data only once added to the Rapid menu.** That lets an
  asset file list many datasets without fetching them all. (The user's custom datasets still load at
  startup; that should probably become lazy too.)
- **A user dataset whose datasetID an asset also uses** is hidden while that asset is loaded, but
  its saved definition is kept, since the asset may not be loaded next time.
- **What the user saved about a dataset is one record** in the `DatabaseSystem` `datasets` store,
  `{ id, updatedAt, dataset?, changes? }`, written by `saveDatasetSettings()`:
  - `dataset`: the whole definition of a custom dataset the user added, from `RapidDataset.toJSON()`
    (the asset file shape plus `id`, in plain JSON types, including the data mapping and the
    conflation settings).
  - `changes`: the user's changes to a dataset from a service or an asset file: its color,
    `conflated`, and `conflation` (the whole rules object). `_loadDatasetSettings()` applies them
    over the definition. A record whose dataset isn't in the catalog right now is kept.
  - A record can have both, when the user's own dataset shares a datasetID with an asset's dataset.

  This is the "user's changes to collection items" from settings v2, decided field by field (a
  changed field replaces the definition's). Without `DatabaseSystem` (a CLI, some tests), these last
  for the session only. Deleting a custom dataset goes through `deleteCustomDatasetAsync()`, which
  also deletes its stored file.
- **No migration from the old `rapid.custom.*` or `rapid.dataset.*` settings.** That storage never
  shipped, so the user sets those datasets up again; `fromJSON` only takes plain JSON types.
- **The conflation rules of every dataset can be changed**, including datasets from services, whose
  server-side conflation is buggy and being shut down. `conflated` is the on/off switch: the user
  can switch it off to see the raw data, then on again to see the result of the rules.

## Next

1. **Export and import a dataset definition** as a JSON file, in the asset file format, so a team can
   share a dataset with its data mapping and conflation rules. (Settings v2, Step 4.)
2. **Stable IDs for external features**, so that accepted and ignored features survive a restart:
   a content hash or `isID` value plus a part index for features, and linear referencing for pieces
   of lines. See the backlog item "Stable IDs for external data".
3. **Custom datasets backed by a service** (backlog).

## Known rough edges

- `RapidSystem` declares several members with field initializers, unlike the codebase convention
  (initialize in the constructor). The new members follow the convention.
- The file-loading code in `RapidDataset` (`setupCustomDatasetAsync` and helpers) is copied from
  `PixiLayerCustomData` and `VectorTileService`, and says so. It only handles single files
  (`.geojson`, `.json`, `.gpx`, `.kml`), not vector tile URLs.
- The task boundary and power-user tracking don't really belong to datasets.
