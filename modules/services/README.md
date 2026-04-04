# Services

Services are extension components that connect to external web services and fetch data. They extend the same `AbstractSystem` base class as core systems.

## Overview

Services handle communication with various APIs to fetch map data, imagery, QA issues, and other information. They manage caching, rate limiting, and data parsing.

## Key Files

### Map Data Services

| File | Description |
|------|-------------|
| `EsriService.ts` | Esri feature services |
| `MapWithAIService.ts` | Meta's MapWithAI road and building data |
| `OsmService.ts` | OpenStreetMap API (editing, data fetching) |
| `OvertureService.ts` | Overture Maps Foundation data |
| `VectorTileService.ts` | Vector tile fetching and parsing |

### Photo Services

| File | Description |
|------|-------------|
| `MapillaryService.ts` | Mapillary street-level imagery |
| `KartaviewService.ts` | KartaView (OpenStreetCam) imagery |
| `StreetsideService.ts` | Bing Streetside imagery |

### QA Services

| File | Description |
|------|-------------|
| `KeepRightService.ts` | KeepRight QA tool |
| `OsmoseService.ts` | Osmose QA tool |
| `MapRouletteService.ts` | MapRoulette challenges |

### Reference Data Services

| File | Description |
|------|-------------|
| `NominatimService.ts` | Nominatim geocoding/search |
| `NsiService.ts` | Name Suggestion Index |
| `TaginfoService.ts` | Taginfo tag statistics |
| `OsmWikibaseService.ts` | OSM Wikibase (Data Items) |
| `WikidataService.ts` | Wikidata entities |
| `WikipediaService.ts` | Wikipedia articles |

### Other Services

| File | Description |
|------|-------------|
| `GeoScribbleService.ts` | GeoScribble annotations |
| `WaybackService.ts` | Esri Wayback imagery |

### Worker Companion Files

| File | Description |
|------|-------------|
| `OsmService.worker.ts` | Worker-side listener for `osmService:fetchAndParse` — handles OSM XML/JSON parsing off the main thread |
| `index.worker.ts` | Barrel that re-exports all service worker listeners for bundling into `worker.ts` |

## Service Lifecycle

Services follow the same lifecycle as systems:

```javascript
await service.initAsync();   // Set up connections
await service.startAsync();  // Begin fetching data
await service.resetAsync();  // Clear caches
```

## Accessing Services

Services are accessed through the context, just like systems:

```javascript
const osm = context.services.osm;
const mapillary = context.services.mapillary;
```
