# Parsers

Parsers for converting external data formats into Rapid's internal data structures.

## Overview

These parsers handle responses from the OpenStreetMap API or from OSM data files.
The parsers returns standardized parser results, see `types.ts` for details.

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

```javascript
import { OsmJSONParser, OsmXMLParser } from './parsers/index.ts';

const jsonParser = new OsmJSONParser();
const results = jsonParser.parse(jsonData);

const xmlParser = new OsmXMLParser();
const results = xmlParser.parse(xmlDocument);
```

Rapid's `OsmService` prefers JSON when available (`preferJSON = true`) for better performance.
