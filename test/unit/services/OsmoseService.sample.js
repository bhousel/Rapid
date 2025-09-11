/* eslint-disable quotes */


// data near [10°, 0°]
export const data10 = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [10.0001, 0]
      },
      properties: {
        uuid: '1',
        item: 1070,   // highway intersecting building
        class: 1
      }
    }, {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [10.0002, 0]
      },
      properties: {
        uuid: '2',
        item: 7040,   // unfinished power line
        class: 6
      }
    }, {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [10.0003, 0]
      },
      properties: {
        uuid: '3',
        item: 8300,   // missing stop sign
        class: 52
      }
    }
  ]
};


export const qa_data = {
  osmose: {
    icons: {
      '1070-1': 'maki-home',      // highway intersecting building
      '7040-6': 'temaki-power',   // unfinished power line
      '8300-52': 'temaki-stop'    // missing stop sign
    }
  }
};

// https://osmose.openstreetmap.fr/api/0.3/items/1070/class/1?langs=en-US
export const lang_1070_1 = {
  "categories": [
    {
      "id": 10,
      "title": {
        "auto": "Structure"
      },
      "items": [
        {
          "item": 1070,
          "categorie_id": 10,
          "color": "#FFCC00",
          "flag": "O",
          "title": {
            "auto": "objects overlap"
          },
          "levels": [
            {
              "level": 2,
              "count": 63886272
            },
            {
              "level": 3,
              "count": 15971568
            }
          ],
          "number": [
            63886272,
            15971568
          ],
          "tags": [
            "building",
            "fix:chair",
            "fix:imagery",
            "geom",
            "highway",
            "landuse",
            "power",
            "railway",
            "shop",
            "tree",
            "waterway"
          ],
          "class": [
            {
              "item": 1070,
              "class": 1,
              "title": {
                "auto": "Highway intersecting building"
              },
              "level": 2,
              "tags": [
                "highway",
                "building",
                "geom",
                "fix:imagery"
              ],
              "detail": {
                "auto": "Two features overlap with no shared node to indicate a physical connection or tagging to indicate a vertical separation."
              },
              "fix": {
                "auto": "Move a feature if it's in the wrong place. Connect the features if appropriate or update the tags if not."
              },
              "trap": {
                "auto": "A feature may be missing a tag, such as `tunnel=*`, `bridge=*`, `covered=*` or `ford=*`.\nIf a road or railway intersects a building, consider adding the `layer=*` tag to it.\nWarning: information sources can be contradictory in time or with spatial offset."
              },
              "example": {
                "auto": "![](https://wiki.openstreetmap.org/w/images/d/dc/Osmose-eg-error-1070.png)\n\nIntersection lane / building."
              },
              "source": "https://github.com/osmose-qa/osmose-backend/blob/master/analysers/analyser_osmosis_highway_vs_building.py#L464",
              "resource": null
            }
          ]
        }
      ]
    }
  ]
};

// https://osmose.openstreetmap.fr/api/0.3/items/7040/class/6?langs=en-US
export const lang_7040_6 = {
  "categories": [
    {
      "id": 70,
      "title": {
        "auto": "To map"
      },
      "items": [
        {
          "item": 7040,
          "categorie_id": 70,
          "color": "#B419CB",
          "flag": "|",
          "title": {
            "auto": "power lines"
          },
          "levels": [
            {
              "level": 2,
              "count": 4386311
            },
            {
              "level": 3,
              "count": 35090488
            }
          ],
          "number": [
            4386311,
            35090488
          ],
          "tags": [
            "fix:chair",
            "fix:imagery",
            "power"
          ],
          "class": [
            {
              "item": 7040,
              "class": 6,
              "title": {
                "auto": "Unfinished power distribution line"
              },
              "level": 3,
              "tags": [
                "power",
                "fix:imagery"
              ],
              "detail": {
                "auto": "The line ends in a vacuum, and should be connected to another line or\na transformer (`power=transformer`), a generator (`power=generator`)\nor marked as transitioning into ground (`location:transition=yes`)."
              },
              "fix": null,
              "trap": {
                "auto": "It's possible that disused power features could be disconnected from the network.\nIn which case make use of the `disused:` [lifecycle prefix](https://wiki.openstreetmap.org/wiki/Lifecycle_prefix)."
              },
              "example": null,
              "source": "https://github.com/osmose-qa/osmose-backend/blob/master/analysers/analyser_osmosis_powerline.py#L695",
              "resource": null
            }
          ]
        }
      ]
    }
  ]
};

// https://osmose.openstreetmap.fr/api/0.3/items/8300/class/52?langs=en-US
export const lang_8300_52 = {
  "categories": [
    {
      "id": 80,
      "title": {
        "auto": "Integration"
      },
      "items": [
        {
          "item": 8300,
          "categorie_id": 80,
          "color": "#43FF3C",
          "flag": "F",
          "title": {
            "auto": "traffic signs"
          },
          "levels": [
            {
              "level": 2,
              "count": 87743936
            },
            {
              "level": 3,
              "count": 19260864
            }
          ],
          "number": [
            87743936,
            19260864
          ],
          "tags": [
            "fix:picture",
            "fix:survey",
            "highway",
            "leisure",
            "merge"
          ],
          "class": [
            {
              "item": 8300,
              "class": 52,
              "title": {
                "auto": "Unmapped stop"
              },
              "level": 3,
              "tags": [
                "merge",
                "highway",
                "fix:picture",
                "fix:survey"
              ],
              "detail": {
                "auto": "It is from an open data source, but that is not enough to ensure the quality\nof the data. Review it before integrating the data. You must not do blind imports\ninto OSM, you must do critical review of data integration.\n\nThis is reported from an open data source, without any prior individual\nverification of this data.\n\nTraffic sign (stop) detected by Mapillary, but no nearby tagging of any:\n\n- `highway=stop`"
              },
              "fix": {
                "auto": "If after review you are sure that it is new data and right for\nOpenStreetMap, then you can add it.\n\nAdd the appropriate highway tagging if the imagery is up-to-date and sign detection is correct."
              },
              "trap": {
                "auto": "Be sure that it does not already exist in another place."
              },
              "example": null,
              "source": "https://github.com/osmose-qa/osmose-backend/blob/master/analysers/analyser_merge_traffic_signs.py#L82",
              "resource": null
            }
          ]
        }
      ]
    }
  ]
};
