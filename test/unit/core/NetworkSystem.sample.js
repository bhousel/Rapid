// Sample data for NetworkSystem tests
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

import { n1 as jsonN1, n2 as jsonN2 } from '../data/parsers/OsmJSONParser.sample.js';
import { n1 as xmlN1, n2 as xmlN2 } from '../data/parsers/OsmXMLParser.sample.js';

export const osmJSONResponse = { elements: [jsonN1, jsonN2] };

export const osmXMLResponse =
`<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="test">
  ${xmlN1}
  ${xmlN2}
</osm>`;


// Build a small MVT fixture: one layer ("test") with a single point feature.
export const tileXYZ = [8647, 8192, 14];  // x, y, z matching geojson-vt tile coords

const pointGeoJSON = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { id: 42, name: 'hello' },
    geometry: { type: 'Point', coordinates: [10.001, 0] }
  }]
};
const tileIndex = geojsonvt(pointGeoJSON);
const tile = tileIndex.getTile(tileXYZ[2], tileXYZ[0], tileXYZ[1]);

export const singlePbf = vtpbf.fromGeojsonVt({ test: tile });


// Sample Mapillary-style multiPbf (images and sequences in same protobuffer, different layers)
const images = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { id: 1, sequence_id: 100, captured_at: 1735689600000 },
    geometry: { type: 'Point', coordinates: [10.001, 0] }
  }, {
    type: 'Feature',
    properties: { id: 2, sequence_id: 100, captured_at: 1735689600000 },
    geometry: { type: 'Point', coordinates: [10.002, 0] }
  }]
};
const sequences = {
  type: 'Feature',
  properties: { id: 100 },
  geometry: { type: 'LineString', coordinates: [[10.001, 0], [10.002, 0]] }
};

export const multiPbf = vtpbf.fromGeojsonVt({
  image:    geojsonvt(images).getTile(tileXYZ[2], tileXYZ[0], tileXYZ[1]),
  sequence: geojsonvt(sequences).getTile(tileXYZ[2], tileXYZ[0], tileXYZ[1])
});
