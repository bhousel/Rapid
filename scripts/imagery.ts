import stringify from 'json-stringify-pretty-compact';
import { styleText } from 'bun:util';


await buildImagery();

// This script processes files used to know what background imagery is available
//  ./data/imagery_overrides.json   - our customizations
//  ./data/imagery.json          - sourced from `editor-layer-index`
//  ./data/wayback.json          - sourced from Esri's waybackconfig file in S3
async function buildImagery() {
  const START = '🏗   ' + styleText('yellow', 'Building imagery…');
  const END = '👍  ' + styleText('green', 'imagery built');

  console.log('');
  console.log(START);
  console.time(END);

  // Load source data
  const imageryFile = './node_modules/editor-layer-index/imagery.json';
  const manualFile = './data/imagery_overrides.json';
  const imageryJSON = await Bun.file(imageryFile).json();
  const manualJSON = (await Bun.file(manualFile).json()).manualImagery;

  // Merge imagery sources - `manualJSON` will override `imageryJSON`
  const sources = new Map();
  for (const source of imageryJSON) {
    if (!source.id) continue;
    if (sources.has(source.id)) {
      console.warn(`duplicate imagery id = ${source.id}`);
    }
    sources.set(source.id, source);
  }
  for (const source of manualJSON) {
    if (!source.id) continue;
    sources.set(source.id, source);
  }

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


  const supportedWMSProjections = [
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
  ];

  const imagery = [];
  for (const [sourceID, source] of sources) {
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
    };

    // Some sources support 512px tiles
    if (sourceID === 'mtbmap-no') {
      props.tileSize = 512;
    }

    // Some WMS sources are supported, check projection
    if (source.type === 'wms') {
      const projection = source.available_projections && supportedWMSProjections.find(p => source.available_projections.indexOf(p) !== -1);
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
      props.polygon = extent.polygon;
    } else if (extent.bbox) {
      props.polygon = [[
        [extent.bbox.min_lon, extent.bbox.min_lat],
        [extent.bbox.min_lon, extent.bbox.max_lat],
        [extent.bbox.max_lon, extent.bbox.max_lat],
        [extent.bbox.max_lon, extent.bbox.min_lat],
        [extent.bbox.min_lon, extent.bbox.min_lat]
      ]];
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

    imagery.push(props);
  };


  imagery.sort((a, b) => a.name.localeCompare(b.name));
  await Bun.write('./data/imagery.json', stringify({ imagery: imagery }) + '\n');


  // We'll mirror the wayback config file, it's not available everywhere - see Rapid#1445
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
