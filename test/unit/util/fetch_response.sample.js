// Sample data for fetch_response tests

export const json5WithComments = `{
  // This is a comment
  unquoted: 'value',
  hexColor: 0xFF00FF,
  trailing: 'comma',
}`;

export const json5Expected = {
  unquoted: 'value',
  hexColor: 0xFF00FF,
  trailing: 'comma'
};

export const json5WithHex = `{
  key: 'value',
  number: 0xDECAF,
}`;

export const json5HexExpected = {
  key: 'value',
  number: 0xDECAF
};

export const jsoncWithComments = `{
  // Single-line comment
  "key": "value",
  /* Multi-line
     comment */
  "number": 42
}`;

export const jsoncExpected = {
  key: 'value',
  number: 42
};

export const jsoncNested = `{
  // Comment at the top
  "enabled": true,
  "config": {
    // Nested comment
    "option": "value"
  }
}`;

export const jsoncNestedExpected = {
  enabled: true,
  config: {
    option: 'value'
  }
};

export const geojsonData = `{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [0, 0]
  },
  "properties": {
    "name": "test"
  }
}`;

export const geojsonExpected = {
  type: 'Feature',
  geometry: {
    type: 'Point',
    coordinates: [0, 0]
  },
  properties: {
    name: 'test'
  }
};

export const xmlData = `<?xml version="1.0"?>
<root>
  <item id="1">Test</item>
</root>`;

export const svgData = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
  <circle cx="5" cy="5" r="4"/>
</svg>`;

export const htmlData = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body><p>Hello</p></body>
</html>`;

