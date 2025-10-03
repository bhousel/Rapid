/* eslint-disable quotes */

export const waybackConfig = {
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

export const tilemap13161 = {
  "valid": true,
  "location": { "left": 19237, "top": 24688, "width": 1, "height": 1 },
  "data":[1]
};

export const tilemap9203 = {
  "valid": true,
  "location": { "left": 19237, "top": 24688, "width": 1, "height": 1 },
  "data":[1],
  "select":[10]
};

export const tilemap10 = {
  "valid": true,
  "location": { "left": 19237, "top": 24688, "width": 1, "height": 1 },
  "data":[1]
};

export const metadata = {
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
        "SRC_DATE2": 1568851200000,
        "NICE_DESC": "Maxar",
        "SRC_DESC": "WV02",
        "SAMP_RES": 0.29999999999999999,
        "SRC_ACC": 4.0599999999999996
      }
    }
  ]
};
