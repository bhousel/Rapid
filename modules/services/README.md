# Services

Services are extension components that connect to external web services and fetch data. They extend the same `AbstractSystem` base class as core systems.

## Overview

Services handle communication with various APIs to fetch map data, imagery, QA issues, and other information. Most services route their requests through `NetworkSystem` (inflight tracking, dedup, concurrency limits) and keep their tile and data caches in `SpatialSystem`. Heavy parsing (OSM XML/JSON, vector tiles) can be dispatched to a web worker via `WorkerSystem`.

## Key Files

### Map Data Services

| File | Description |
|------|-------------|
| `EsriService.ts` | Esri-hosted datasets (ArcGIS feature services) |
| `MapWithAIService.ts` | Meta's MapWithAI road and building data |
| `OsmService.ts` | OpenStreetMap API (authentication, data fetching, changeset upload) |
| `OvertureService.ts` | Overture Maps Foundation data (PMTiles, extends `VectorTileService`) |
| `VectorTileService.ts` | Vector tile fetching and parsing (MVT tileservers and PMTiles archives) |

### Photo Services

| File | Description |
|------|-------------|
| `MapillaryService.ts` | Mapillary street-level imagery and detections (with the Mapillary-JS viewer) |
| `KartaviewService.ts` | KartaView (OpenStreetCam) imagery |
| `StreetsideService.ts` | Bing Streetside imagery (with the Pannellum panoramic viewer) |

### QA Services

| File | Description |
|------|-------------|
| `KeepRightService.ts` | KeepRight QA tool |
| `OsmoseService.ts` | Osmose QA tool |
| `MapRouletteService.ts` | MapRoulette challenges and tasks |

### Reference Data Services

| File | Description |
|------|-------------|
| `NominatimService.ts` | Nominatim geocoding/search |
| `NsiService.ts` | Name Suggestion Index (NSI presets and tag upgrade suggestions) |
| `TaginfoService.ts` | Taginfo tag statistics |
| `OsmWikibaseService.ts` | OSM Wikibase (Data Items) for tag documentation |
| `WikidataService.ts` | Wikidata entities |
| `WikipediaService.ts` | Wikipedia articles |

### Other Services

| File | Description |
|------|-------------|
| `GeoScribbleService.ts` | GeoScribble annotations |
| `WaybackService.ts` | Esri Wayback imagery |

### Module Files

| File | Description |
|------|-------------|
| `index.ts` | Barrel export and the `services.available` registry |
| `types.ts` | `Services` instances interface and `ServiceConstructor` type |

### Worker Companion Files

| File | Description |
|------|-------------|
| `OsmService.worker.ts` | Worker-side listener for `osmService:fetchAndParse` — handles OSM XML/JSON parsing off the main thread |
| `index.worker.ts` | Barrel that re-exports all service worker listeners for bundling into `worker.ts` |

## Service Lifecycle

Services follow the same lifecycle as systems:

```typescript
await service.initAsync();   // Set up connections
await service.startAsync();  // Begin fetching data
await service.resetAsync();  // Clear caches
```

## Accessing Services

Services are accessed through the context, just like systems:

```typescript
const osm = context.services.osm;
const mapillary = context.services.mapillary;
```
