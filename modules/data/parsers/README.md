# Parsers

Parsers for converting external data formats into Rapid's internal data structures.

## Overview

These parsers handle responses from the OpenStreetMap API or from OSM data files.
The parsers return standardized parser results (`ParserResult`), see `types.ts` for details.

Besides OSM elements (nodes, ways, relations), the parsers also handle changesets, notes, users, user blocks, preferences, and the `/capabilities` (`api`, `policy`) and `/map` (`bounds`) responses.

Neither parser depends on the browser DOM (the XML parser uses `@xmldom/xmldom`), so they can run inside a web worker. In practice OSM parsing is usually dispatched off the main thread by `core/NetworkSystem.worker.ts` and `services/OsmService.worker.ts`.

## Key Files

| File | Description |
|------|-------------|
| `OsmJSONParser.ts` | Parses OSM JSON format responses |
| `OsmXMLParser.ts` | Parses OSM XML format responses |
| `types.ts` | TypeScript type definitions for parser interfaces |
| `index.ts` | Barrel export file |

## OSM Formats

The OSM API supports two response formats:

### JSON Format
More efficient to parse, avoids DOM overhead:
```json
{
  "elements": [
    { "type": "node", "id": 123, "lat": 40.7, "lon": -74.0, "tags": {} }
  ]
}
```

### XML Format
Traditional format, still widely used:
```xml
<osm>
  <node id="123" lat="40.7" lon="-74.0">
    <tag k="name" v="Example"/>
  </node>
</osm>
```

## Usage

```typescript
import { OsmJSONParser, OsmXMLParser } from './parsers/index.ts';

// `parse()` accepts either raw text or an already-parsed object/document
const jsonParser = new OsmJSONParser();
const jsonResults = jsonParser.parse(jsonData, { filter: ['node', 'way', 'relation'] });

const xmlParser = new OsmXMLParser();
const xmlResults = xmlParser.parse(xmlText);
```

Each parser instance remembers the IDs it has already seen and skips them by default (`skipSeen: true`). Call `reset()` to clear that cache.

Rapid's `OsmService` prefers JSON when available (`preferJSON = true`) for better performance.
