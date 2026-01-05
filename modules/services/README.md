# Services

Services are extension components that connect to external web services and fetch data. They extend the same `AbstractSystem` base class as core systems.

## Overview

Services handle communication with various APIs to fetch map data, imagery, QA issues, and other information. They manage caching, rate limiting, and data parsing.

## Key Files

### Map Data Services

| File | Description |
|------|-------------|
| `EsriService.js` | Esri feature services |
| `MapWithAIService.js` | Meta's MapWithAI road and building data |
| `OsmService.js` | OpenStreetMap API (editing, data fetching) |
| `OvertureService.js` | Overture Maps Foundation data |
| `VectorTileService.js` | Vector tile fetching and parsing |

### Photo Services

| File | Description |
|------|-------------|
| `MapillaryService.js` | Mapillary street-level imagery |
| `KartaviewService.js` | KartaView (OpenStreetCam) imagery |
| `StreetsideService.js` | Bing Streetside imagery |

### QA Services

| File | Description |
|------|-------------|
| `KeepRightService.js` | KeepRight QA tool |
| `OsmoseService.js` | Osmose QA tool |
| `MapRouletteService.js` | MapRoulette challenges |

### Reference Data Services

| File | Description |
|------|-------------|
| `NominatimService.js` | Nominatim geocoding/search |
| `NsiService.js` | Name Suggestion Index |
| `TaginfoService.js` | Taginfo tag statistics |
| `OsmWikibaseService.js` | OSM Wikibase (Data Items) |
| `WikidataService.js` | Wikidata entities |
| `WikipediaService.js` | Wikipedia articles |

### Other Services

| File | Description |
|------|-------------|
| `GeoScribbleService.js` | GeoScribble annotations |
| `WaybackService.js` | Esri Wayback imagery |

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
