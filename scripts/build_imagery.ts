import stringify from 'json-stringify-pretty-compact';
import { stat } from 'node:fs/promises';
import { styleText } from 'node:util';
const localeCompare = new Intl.Collator('en').compare;

// This script processes files related to the available imagery:
//  ./data/imagery.json  - sourced from `editor-layer-index`
//  ./data/wayback.json  - sourced from Esri's waybackconfig file in S3

await buildImagery();
await buildWayback();


// Gather the available imagery sources from the editor-layer-index
async function buildImagery() {
  const START = '🏗   ' + styleText('yellow', 'Building imagery…');
  const END = '👍  ' + styleText('green', 'imagery built');

  console.log('');
  console.log(START);
  console.time(END);

  // Load source data
  const imageryFile = './node_modules/editor-layer-index/imagery.json';
  const imageryJSON = await Bun.file(imageryFile).json();

  // Get the file's mtime - this is preserved from the git commit date
  const imageryStats = await stat(imageryFile);
  const imageryDate = imageryStats.mtime.toISOString().slice(0, 10);  // YYYY-MM-DD

  // Ignore imagery more than 30 years old..
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 30);

  const discard = [
    /^osmbe$/,                              // 'OpenStreetMap (Belgian Style)'
    /^osmfr(-(basque|breton|occitan))?$/,   // 'OpenStreetMap (French, Basque, Breton, Occitan Style)'
    /^osm-mapnik-german_style$/,            // 'OpenStreetMap (German Style)'
    /^HDM_HOT$/,                            // 'OpenStreetMap (HOT Style)'
    /^osm-mapnik-black_and_white$/,         // 'OpenStreetMap (Standard Black & White)'
    /^osm-mapnik-no_labels$/,               // 'OpenStreetMap (Mapnik, no labels)'
    /^OpenStreetMap-turistautak$/,          // 'OpenStreetMap (turistautak)'

    /^cyclosm$/,                            // 'CyclOSM'
    /^hike_n_bike$/,                        // 'Hike & Bike'
    /^landsat$/,                            // 'Landsat'
    /^skobbler$/,                           // 'Skobbler'
    /^public_transport_oepnv$/,             // 'Public Transport (ÖPNV)'
    /^tf-(cycle|landscape|outdoors)$/,      // 'Thunderforest OpenCycleMap, Landscape, Outdoors'
    /^qa_no_address$/,                      // 'QA No Address'
    /^wikimedia-map$/,                      // 'Wikimedia Map'

    /^openpt_map$/,
    /^openrailwaymap$/,
    /^openseamap$/,
    /^opensnowmap-overlay$/,

    /^geoscribble/,              // 'geoscribble' overlays (we built a service for this instead)
    /^osmim-/,                   // low zoom osmim imagery
    /^US-TIGER-Roads-201\d/,     // older than 2020
    /^Waymarked_Trails/,         // Waymarked Trails *
    /^OSM_Inspector/,            // OSM Inspector *
    /^EOXAT/                     // EOX AT *  (iD#9807)
  ];

  const supportedWMSProjections = new Set([
    // Web Mercator
    'EPSG:3857',
    // alternate codes used for Web Mercator
    'EPSG:900913',
    'EPSG:3587',
    'EPSG:54004',
    'EPSG:41001',
    'EPSG:102113',
    'EPSG:102100',
    'EPSG:3785',
    // WGS 84 (Equirectangular)
    'EPSG:4326'
  ]);

  const imagery = {} as any;

  // Gather the imagery sources
  for (const source of imageryJSON) {
    const sourceID = source.id;
    if (!sourceID) continue;

    if (imagery[sourceID]) {
      console.warn(`duplicate imagery id = ${sourceID}`);
      continue;
    }

    if (source.type !== 'tms' && source.type !== 'wms' && source.type !== 'bing') {
      // console.log(`discarding ${sourceID}  (type ${source.type})`);
      continue;
    }
    if (discard.some(regex => regex.test(sourceID))) {
      // console.log(`discarding ${sourceID}  (discard regex)`);
      continue;
    }

    const props = {
      id: sourceID,
      name: source.name,
      type: source.type,
      template: source.url
    } as any;

    // Some sources support 512px tiles
    if (sourceID === 'mtbmap-no') {
      props.tileSize = 512;
    }

    // Some WMS sources are supported, check projection
    if (source.type === 'wms') {
      let projection;
      if (Array.isArray(source.available_projections)) {
        projection = source.available_projections.find((p: string) => supportedWMSProjections.has(p));
      }
      if (!projection) {
        // console.log(`discarding ${sourceID}  (no supported projection)`);
        continue;
      }
      // if (sources.some(other => other.name === source.name && other.type !== source.type)) continue;
      props.projection = projection;
    }


    let startDate, endDate, isValid;

    if (source.end_date) {
      endDate = new Date(source.end_date);
      isValid = !isNaN(endDate.getTime());
      if (isValid) {
        if (endDate <= cutoffDate) {
          // console.log(`discarding ${sourceID}  (${endDate.toDateString()} too old)`);
          continue;
        }
        props.endDate = endDate;
      }
    }

    if (source.start_date) {
      startDate = new Date(source.start_date);
      isValid = !isNaN(startDate.getTime());
      if (isValid) {
        props.startDate = startDate;
      }
    }

    const extent = source.extent || {};
    if (extent.min_zoom || extent.max_zoom) {
      props.zoomExtent = [
        extent.min_zoom || 0,
        extent.max_zoom || 22
      ];
    }

    if (source.zoomRange) {
      props.zoomRange = source.zoomRange;
    }

    if (extent.polygon) {
      // Workaround for editor-layer-index weirdness..
      // Add an extra array nest to each element in `extent.polygon`
      // so the rings are not treated as a bunch of holes:
      //   what we get:  [ [[outer],[hole],[hole]] ]
      //   what we want: [ [[outer]],[[outer]],[[outer]] ]
      const parts = extent.polygon.map((ring: unknown) => [ring]);
      props.feature = {
        type: 'Feature',
        properties: { id: sourceID },
        geometry: {
          type: 'MultiPolygon',
          coordinates: parts
        }
      };

    } else if (extent.bbox) {
      props.feature = {
        type: 'Feature',
        properties: { id: sourceID },
        geometry: {
          type: 'Polygon',
          coordinates: [[    // outer, wound counterclockwise
            [extent.bbox.min_lon, extent.bbox.min_lat],
            [extent.bbox.max_lon, extent.bbox.min_lat],
            [extent.bbox.max_lon, extent.bbox.max_lat],
            [extent.bbox.min_lon, extent.bbox.max_lat],
            [extent.bbox.min_lon, extent.bbox.min_lat]
          ]]
        }
      };
    }

    const attribution = source.attribution || {};
    if (attribution.url) {
      props.terms_url = attribution.url;
    }
    if (attribution.text) {
      props.terms_text = attribution.text;
    }
    if (attribution.html) {
      props.terms_html = attribution.html;
    }

    for (const prop of ['best', 'default', 'description', 'encrypted', 'icon', 'overlay', 'tileSize']) {
      if (source[prop]) {
        props[prop] = source[prop];
      }
    }

    imagery[sourceID] = props;
  };

  const data = {
    assetID: `editor_layer_index`,
    assetVersion: imageryDate,
    imagery: sortObject(imagery)
  };

  await Bun.write('./data/editor_layer_index.json', stringify(data) + '\n');
  console.timeEnd(END);
}


// Fetch the wayback config file from Esri's S3 bucket.
// We'll mirror the wayback config file, it's not available everywhere - see Rapid#1445
async function buildWayback() {
  const START = '🏗   ' + styleText('yellow', 'Building wayback');
  const END = '👍  ' + styleText('green', 'wayback built');

  console.log('');
  console.log(START);
  console.time(END);

  const WAYBACK_CONFIG_FILE_PROD = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
  // const WAYBACK_CONFIG_FILE_DEV = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/dev/waybackconfig.json';

  await fetch(WAYBACK_CONFIG_FILE_PROD)
    .then(response => {
      if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
      if (response.status === 204 || response.status === 205) return;
      return response.json();
    })
    .then(data => {
      return Bun.write('./data/wayback.json', stringify({ wayback: data }) + '\n');
    });

  console.timeEnd(END);
}


// Returns an object with sorted keys and sorted values.
// (This is useful for file diffing)
function sortObject(obj: Record<string, unknown>): Record<string, unknown> | null {
  if (!obj) return null;

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort(localeCompare);
  for (const k of keys) {
    sorted[k] = obj[k];
  }
  return sorted;
}
