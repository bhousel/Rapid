/* eslint-disable quotes */

export const waybackConfig = {
  "13534": {
    "itemID": "2de04974bcf148838142e57d74aaf379",
    "itemTitle": "World Imagery (Wayback 2021-06-30)",
    "itemURL": "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/13534/{level}/{row}/{col}",
    "metadataLayerUrl": "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2021_r09/MapServer",
    "metadataLayerItemID": "3d89a062923546ecbaa91909a089a840",
    "layerIdentifier": "WB_2021_R09"
  },
  "13161": {
    "itemID": "d722c8eca54d4adb8087870f5ca0ef78",
    "itemTitle": "World Imagery (Wayback 2018-01-08)",
    "itemURL": "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/13161/{level}/{row}/{col}",
    "metadataLayerUrl": "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2017_r21/MapServer",
    "metadataLayerItemID": "c3fe9d9926454757b79710159519772f",
    "layerIdentifier": "WB_2017_R21"
  },
  "9203": {
    "itemID": "e87756d6de764c20b108f2bc576db1ba",
    "itemTitle": "World Imagery (Wayback 2015-04-15)",
    "itemURL": "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/9203/{level}/{row}/{col}",
    "metadataLayerUrl": "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2015_r06/MapServer",
    "metadataLayerItemID": "944d68755057498c8e63d127d29a27cb",
    "layerIdentifier": "WB_2015_R06"
  },
  "10": {
    "itemID": "903f0abe9c3b452dafe1ca5b8dd858b9",
    "itemTitle": "World Imagery (Wayback 2014-02-20)",
    "itemURL": "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/10/{level}/{row}/{col}",
    "metadataLayerUrl": "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2014_r01/MapServer",
    "metadataLayerItemID": "78e801fab4d24ab9a6053c7a461479be",
    "layerIdentifier": "WB_2014_R01"
  }
};


export const tilemap13534 = {
  "valid": true,
  "location": { "left": 8647, "top": 8192, "width": 1, "height": 1 },
  "data":[1]
};

export const tilemap13161 = {
  "valid": true,
  "location": { "left": 8647, "top": 8192, "width": 1, "height": 1 },
  "data":[1]
};

export const tilemap9203 = {
  "valid": true,
  "location": { "left": 8647, "top": 8192, "width": 1, "height": 1 },
  "data":[1],
  "select":[10]
};

export const tilemap10 = {
  "valid": true,
  "location": { "left": 8647, "top": 8192, "width": 1, "height": 1 },
  "data":[1]
};

export const response13534 = {
  status: 200,
  headers: { 'Content-Type': 'image/jpeg', 'Content-Length': 45071 }
};

export const response13161 = {
  status: 200,
  headers: { 'Content-Type': 'image/jpeg', 'Content-Length': 45071 }
};

export const response10 = {
  status: 200,
  headers: { 'Content-Type': 'image/jpeg', 'Content-Length': 22885 }
};


export const metadata13161 = {
  "displayFieldName": "NICE_NAME",
  "fieldAliases": {
    "SRC_DATE2": "SRC_DATE2",
    "NICE_DESC": "NICE_DESC",
    "SRC_DESC": "SRC_DESC",
    "SAMP_RES": "SAMP_RES",
    "SRC_ACC": "SRC_ACC"
  },
  "fields": [
    {
      "name": "SRC_DATE2",
      "type": "esriFieldTypeDate",
      "alias": "SRC_DATE2",
      "length": 8
    },
    {
      "name": "NICE_DESC",
      "type": "esriFieldTypeString",
      "alias": "NICE_DESC",
      "length": 25
    },
    {
      "name": "SRC_DESC",
      "type": "esriFieldTypeString",
      "alias": "SRC_DESC",
      "length": 25
    },
    {
      "name": "SAMP_RES",
      "type": "esriFieldTypeDouble",
      "alias": "SAMP_RES"
    },
    {
      "name": "SRC_ACC",
      "type": "esriFieldTypeDouble",
      "alias": "SRC_ACC"
    }
  ],
  "features": [
    {
      "attributes": {
        "SRC_DATE2": 1442361600000,   // '2015-09-16T00:00:00.000Z'
        "NICE_DESC": "DigitalGlobe",
        "SRC_DESC": "WV03_VNIR",
        "SAMP_RES": 0.3,
        "SRC_ACC": 4
      }
    }
  ]
};

export const metadata13161Result = {
  captureDate:  '2015-09-16',
  provider:     'DigitalGlobe',
  source:       'WV03_VNIR',
  resolution:   0.3,
  accuracy:     4
};
