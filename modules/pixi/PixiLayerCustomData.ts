import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { DOMParser } from '@xmldom/xmldom';
import { Extent } from '@rapid-sdk/math';
import { GeoJSONData } from '../data/GeoJSONData.ts';
import { geojsonFeatures } from '../util/util.ts';
import { gpx, kml } from '@tmcw/togeojson';
import { parse as wktParse } from 'wkt';
import { PixiFeatureLine } from './PixiFeatureLine.ts';
import { PixiFeaturePoint } from './PixiFeaturePoint.ts';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.ts';

import type { Document as XmlDocument } from '@xmldom/xmldom';
import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Viewport } from '@rapid-sdk/math';

const CUSTOM_COLOR = 0x00ffff;


/**
 * This class renders "custom data" - reference traces that should be 'drawn over' the map.
 * This data comes from the 'load custom data' option in the map data sidebar,
 * or may be supplied via a url parameter.
 */
export class PixiLayerCustomData extends AbstractPixiLayer {
  /** Attribution string(s) for the currently loaded custom data */
  protected _dataUsed: string | null;
  /** A FileList from a file picker, waiting to be processed */
  protected _fileList: FileList | null;
  /** FileReader used to read user-selected files asynchronously */
  protected _fileReader: FileReader;
  /** URL template string for a remote tile-based custom data source */
  protected _template: string | null;
  /** Raw WKT string for a custom geometry loaded as text */
  protected _wkt: string | null;
  /** URL of an externally hosted GeoJSON or GPX file to fetch and display */
  protected _url: string | null;
  /** Parsed custom data features ready to render */
  protected _geoData: GeoJSONData[] | null;
  /** Bounding extent of all loaded custom data features */
  protected _geoDataExtent: Extent | null;

  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  public constructor(scene: PixiScene) {
    super(scene);
    this.id = 'custom-data';

    this._dataUsed = null;
    this._fileList = null;
    this._template = null;
    this._wkt = null;
    this._url = null;
    this._geoData = null;
    this._geoDataExtent = null;
    this._fileReader = new FileReader();

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._hashChanged = this._hashChanged.bind(this);
    this._updateHash = this._updateHash.bind(this);
    this._setFile = this._setFile.bind(this);
    this.setFileList = this.setFileList.bind(this);

    // Setup event handlers..
    // drag and drop
    /**
     *
     * @param d3_event
     */
    function over(d3_event: DragEvent): void {
      d3_event.stopPropagation();
      d3_event.preventDefault();
      d3_event.dataTransfer!.dropEffect = 'copy';
    }

    const context = this.context;
    context.container()
      .attr('dropzone', 'copy')
      .on('dragenter.draganddrop', over)
      .on('dragexit.draganddrop', over)
      .on('dragover.draganddrop', over)
      .on('drop.draganddrop', (d3_event: DragEvent) => {
        d3_event.stopPropagation();
        d3_event.preventDefault();
        this.setFileList(d3_event.dataTransfer!.files);
      });

    // hashchange - pick out the 'gpx' param
    this.context.systems.urlhash!
      .on('hashchange', this._hashChanged);

    // layerchange - update the url hash
    scene.on('layerchange', this._updateHash);
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  public reset() {
    super.reset();
    // note: we don't need to call this._clear() to remove custom data here.
    // Custom data can persist through a reset of the graphics system.
  }


  /**
   * Render the GeoJSONData custom data
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  public render(frame: number, viewport: Viewport): void {
    if (!this.enabled || !(this.hasData())) return;

    const vtService = this.context.services.vectortile as any;
    const viewZoom = viewport.transform.zoom;

    let geoData: GeoJSONData[];
    if (this._template && vtService) {   // fetch data from vector tile service
      if (viewZoom >= 13) {  // avoid firing off too many API requests
        vtService.loadTiles(this._template);
      }
      geoData = vtService.getData(this._template);
    } else {
      geoData = this._geoData ?? [];  //geojsonFeatures(this._geojson);
    }

    // Determine which renderer(s) to use for each feature
    const polygons = geoData.filter(d => d.geoms.parts.some(part => part.type === 'Polygon'));
    const lines = geoData.filter(d => d.geoms.parts.some(part => part.type === 'LineString'));
    const points = geoData.filter(d => d.geoms.parts.some(part => part.type === 'Point'));

    this.renderPolygons(frame, viewport, polygons);
    this.renderLines(frame, viewport, lines);
    this.renderPoints(frame, viewport, points);

//    // Now render any extras, like gridlines in square bounding boxes or arbitrary WKT polygons/multipolys.
//    const gridLines = this.createGridLines(lines);
//    const gridStyle = { stroke: { width: 0.5, color: 0x0ffff, opacity: 0.5, cap: 'round' }} as LineStyle;
//    this.renderGridLines(frame, viewport, gridLines, gridStyle);
  }

//
//  /**
//   * createGridLines
//   * Creates grid lines inside the rectangular bounding box, if specified.
//   * @param lines - the line string(s) that may contain a rectangular bounding box
//   * @returns a list of linestrings to draw as gridlines.
//   */
//  createGridLines(lines: GeoJSONData[]): GeoJSON.Feature[] {
//    const context = this.context;
//    const imagery = context.systems.imagery!;
//    const rapid = context.systems.rapid!;
//
//    const numSplits = imagery.numGridSplits;
//    const gridLines: GeoJSON.Feature[] = [];
//
//    // 'isTaskRectangular' implies one and only one rectangular linestring.
//    if (rapid.isTaskRectangular() && numSplits > 0) {
//      const box = lines[0];
//      const geojson = box.props.geojson as GeoJSON.Feature | undefined;
//      const geometry = geojson?.geometry as GeoJSON.LineString | undefined;
//      if (!geometry?.coordinates) return gridLines;
//
//      const coords = geometry.coordinates;
//      const lats = coords.map((f: GeoJSON.Position) => f[0]);
//      const lons = coords.map((f: GeoJSON.Position) => f[1]);
//
//      const minLat = Math.min(...lats);
//      const minLon = Math.min(...lons);
//      const maxLat = Math.max(...lats);
//      const maxLon = Math.max(...lons);
//
//      const latIncrement = (maxLat - minLat) / numSplits;
//      const lonIncrement = (maxLon - minLon) / numSplits;
//
//      // num splits is a grid specificer, so 2 => 2x2 grid, 3 => 3x3 grid, all the way up to 6 => 6x6 grid.
//      for (let i = 1; i < numSplits; i++) {
//        const thisLat = minLat + latIncrement * i;
//        const thisLon = minLon + lonIncrement * i;
//
//        gridLines.push({
//          type: 'Feature',
//          properties: {},
//          geometry: {
//            type: 'LineString',
//            coordinates: [
//              [minLat, thisLon],
//              [maxLat, thisLon],
//            ],
//          },
//          id: numSplits + 'gridcol' + i,
//        });
//        gridLines.push({
//          type: 'Feature',
//          properties: {},
//          geometry: {
//            type: 'LineString',
//            coordinates: [
//              [thisLat, minLon],
//              [thisLat, maxLon],
//            ],
//          },
//          id: numSplits + 'gridrow' + i,
//        });
//      }
//    }
//    return gridLines;
//  }


  /**
   * Renders the custom-data polygon features for this frame.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param polygons - Array of polygon data
   */
  public renderPolygons(frame: number, viewport: Viewport, polygons: GeoJSONData[]): void {
    const l10n = this.context.systems.l10n!;
    const parentContainer = this.scene.groups.get('basemap')!;

    const polygonStyle = {
      fill: { color: CUSTOM_COLOR },
      stroke: { color: CUSTOM_COLOR },
      label: { color: CUSTOM_COLOR }
    } as Partial<MatchedStyle>;

    for (const d of polygons) {
      const dataID = d.id;
      const version = d.v || 0;
      const parts = d.geoms.parts;

      for (let i = 0; i < parts.length; ++i) {
        // Check that this part has coordinates and is a Polygon (we may be part of a FeatureCollection)
        const part = parts[i];
        if (!part.world || part.type !== 'Polygon') continue;

        const featureID = `${this.layerID}-${dataID}-${i}`;
        let feature = this.features.get(featureID) as PixiFeaturePolygon | undefined;

        // If feature existed before as a different type, recreate it.
        if (feature && feature.type !== 'Polygon') {
          feature.destroy();
          feature = undefined;
        }

        if (!feature) {
          feature = new PixiFeaturePolygon(this, featureID);
          feature.style = polygonStyle;
          feature.parentContainer = parentContainer;
        }

        // If data has changed.. Replace it.
        if (feature.v !== version) {
          feature.v = version;
          feature.label = l10n.displayName(d.properties as Record<string, string>);
          feature.geometry = part;
          feature.data = d;
        }

        this.syncFeatureClasses(feature);
        feature.update(viewport);
        this.retainFeature(feature, frame);
      }
    }
  }


  /**
   * Renders the custom-data line features for this frame.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param lines - Array of line data
   * @param styleOverride - Custom style
   */
  public renderLines(frame: number, viewport: Viewport, lines: GeoJSONData[], styleOverride?: Partial<MatchedStyle>): void {
    const l10n = this.context.systems.l10n!;
    const parentContainer = this.scene.groups.get('basemap')!;

    const lineStyle = styleOverride ?? {
      stroke: { color: CUSTOM_COLOR },
      label: { color: CUSTOM_COLOR }
    } as Partial<MatchedStyle>;

    for (const d of lines) {
      const dataID = d.id;
      const version = d.v || 0;
      const parts = d.geoms.parts;

      for (let i = 0; i < parts.length; ++i) {
        // Check that this part has coordinates and is a LineString (we may be part of a FeatureCollection)
        const part = parts[i];
        if (!part.world || part.type !== 'LineString') continue;

        const featureID = `${this.layerID}-${dataID}-${i}`;
        let feature = this.features.get(featureID) as PixiFeatureLine | undefined;

        // If feature existed before as a different type, recreate it.
        if (feature && feature.type !== 'LineString') {
          feature.destroy();
          feature = undefined;
        }

        if (!feature) {
          feature = new PixiFeatureLine(this, featureID);
          feature.style = lineStyle;
          feature.parentContainer = parentContainer;
        }

        // If data has changed.. Replace it.
        if (feature.v !== version) {
          feature.v = version;
          feature.label = l10n.displayName(d.properties as Record<string, string>);
          feature.geometry = part;
          feature.data = d;
        }

        this.syncFeatureClasses(feature);
        feature.update(viewport);
        this.retainFeature(feature, frame);
      }
    }
  }


//  /**
//   * renderGridLines
//   * Render grid lines from raw GeoJSONData features (not wrapped GeoJSONData class instances)
//   * @param frame - Integer frame being rendered
//   * @param viewport - Pixi viewport to use for rendering
//   * @param features - Array of GeoJSONData Feature objects
//   * @param lineStyle - The line style to use
//   */
//  renderGridLines(frame: number, viewport: Viewport, features: GeoJSON.Feature[], lineStyle: LineStyle): void {
//    const parentContainer = this.scene.groups.get('basemap')!;
//
//    for (const d of features) {
//      const dataID = d.id as string;
//      const geometry = d.geometry as GeoJSON.LineString;
//      if (!geometry?.coordinates) continue;
//
//      const featureID = `${this.layerID}-${dataID}`;
//      let feature = this.features.get(featureID) as PixiFeatureLine | undefined;
//
//      // If feature existed before as a different type, recreate it.
//      if (feature && feature.type !== 'LineString') {
//        feature.destroy();
//        feature = undefined;
//      }
//
//      if (!feature) {
//        feature = new PixiFeatureLine(this, featureID);
//        feature.style = lineStyle;
//        feature.parentContainer = parentContainer;
//      }
//
//      // Grid lines don't have versions, always update geometry
//      (feature as any).setCoords({ world: geometry.coordinates });
//
//      this.syncFeatureClasses(feature);
//      feature.update(viewport);
//      this.retainFeature(feature, frame);
//    }
//  }


  /**
   * Renders the custom-data point features for this frame.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   * @param points - Array of point data
   */
  public renderPoints(frame: number, viewport: Viewport, points: GeoJSONData[]): void {
    const l10n = this.context.systems.l10n!;
    const parentContainer = this.scene.groups.get('points')!;

    const pointStyle: Partial<MatchedStyle> = {
      marker: { color: CUSTOM_COLOR, image: 'largeCircle'  },
      icon: { color: CUSTOM_COLOR, image: 'maki-circle-stroked' },
      label: { color: CUSTOM_COLOR }
    };

    for (const d of points) {
      const dataID = d.id;
      const version = d.v || 0;
      const parts = d.geoms.parts;

      for (let i = 0; i < parts.length; ++i) {
        // Check that this part has coordinates and is a Point (we may be part of a FeatureCollection)
        const part = parts[i];
        if (!part.world || part.type !== 'Point') continue;

        const featureID = `${this.layerID}-${dataID}-${i}`;
        let feature = this.features.get(featureID) as PixiFeaturePoint | undefined;

        // If feature existed before as a different type, recreate it.
        if (feature && feature.type !== 'Point') {
          feature.destroy();
          feature = undefined;
        }

        if (!feature) {
          feature = new PixiFeaturePoint(this, featureID);
          feature.style = pointStyle;
          feature.parentContainer = parentContainer;
        }

        // If data has changed.. Replace it.
        if (feature.v !== version) {
          feature.v = version;
          feature.label = l10n.displayName(d.properties as Record<string, string>);
          feature.geometry = part;
          feature.data = d;
        }

        this.syncFeatureClasses(feature);
        feature.update(viewport);
        this.retainFeature(feature, frame);
      }
    }
  }


  /**
   * Return true if there is custom data to display
   * @return `true` if there is a vector tile template or file data to display
   */
  public hasData(): boolean {
    return !!(this._template || Array.isArray(this._geoData));
  }

  /**
   * Reports which data source is currently in use by this layer.
   * @return Array of single element for the data layer currently enabled
   */
  public dataUsed(): string[] {
    return this._dataUsed ? [ this._dataUsed ] : [];
  }


  /**
   * Fits the map view to show the extent of the loaded file data
   */
  public fitZoom(): void {
    const extent = this._geoDataExtent;
    if (!extent) return;

    const map = this.context.systems.map!;
    map.trimmedExtent(extent);
  }


  /**
   * This returns any FileList which we have stored
   * @return Files, or null if none
   */
  public getFileList(): FileList | null {
    return this._fileList;
  }


  /**
   * This sets a FileList which we got from either a drag-and-drop operation or a `<input 'type'='file'>` field.
   * It is Array-like, but we only look at the first one.
   *
   * https://developer.mozilla.org/en-US/docs/Web/API/FileList
   * https://developer.mozilla.org/en-US/docs/Web/API/File
   * https://developer.mozilla.org/en-US/docs/Web/API/FileReader
   * @param fileList - Files to process (only first one is used), or null to reset
   */
  public setFileList(fileList: FileList | null): void {
    this._clear();
    this._fileList = fileList;
    this.scene.disableLayers(this.layerID);  // emits 'layerchange', so UI gets updated

    if (!fileList || !fileList.length) return;

    const file = fileList[0];
    const extension = this._getExtension(file.name);

    this._fileReader.onload = (e: ProgressEvent<FileReader>) => {
      this._fileReader.onload = null;
      this._setFile(e.target!.result as string, extension);
    };
    this._fileReader.readAsText(file);
  }


  /**
   * This checks a url that we got from either the custom data screen or the `data=` or `gpx=` url parameter
   * It decides whether the url looks like a single file to load or a vector tile template url.
   * @param url - The URL to load
   */
  public setUrl(url: string): void {
    const network = this.context.systems.network!;

    this._clear();
    this._url = url;
    this.scene.disableLayers(this.layerID);  // emits 'layerchange', so UI gets updated

    if (!url) return;

    // Strip off any querystring/hash from the url before checking extension
    const testUrl = url.toLowerCase().split(/[?#]/)[0];
    const isTask = testUrl.includes('project') && testUrl.includes('task') && testUrl.includes('gpx');
    const extension = isTask ? '.gpx' : this._getExtension(testUrl);

    if (extension) {   // Looks like a gpx, kml, geojson file.. load it!
      network.fetch<string | XmlDocument | GeoJSON.GeoJsonObject | null>(url)
        .then(data => {
          this._setFile(data, extension);
          if (isTask) {
            this._dataUsed = null;    // A task boundary is not really a data source
            this.context.systems.rapid?.setTaskExtentByGpxData(data as any);
          }
        })
        .catch(e => console.error(e));  // eslint-disable-line

    } else {   // Looks like a vector tile url template
      this._setUrlTemplate(url);
    }
  }


  /**
   * A url template is something we can pass to the Vector Tile service. It can be:
   *   - Mapbox Vector Tiles (MVT) made available from a z/x/y tileserver
   *   - Protomaps .pmtiles single-file archive containing MVT
   * @param url - The URL template
   */
  protected _setUrlTemplate(url: string): void {
    // Test source against OSM imagery blocklists..
    const osm = this.context.services.osm as any;
    if (osm) {
      const blocklists = osm.imageryBlocklists ?? [];
      let fail: boolean;
      let tested = 0;
      let regex;

      for (regex of blocklists) {
        fail = regex.test(url);
        tested++;
        if (fail) return;   // a banned source
      }

      // ensure at least one test was run.
      if (!tested) {
        regex = /.*\.google(apis)?\..*\/(vt|kh)[\?\/].*([xyz]=.*){3}.*/;
        fail = regex.test(url);
        if (fail) return;   // a banned source
      }
    }

    this._template = url;
    // strip off the querystring/hash from the template, it often includes the access token
    this._dataUsed = 'vectortile:' + url.split(/[?#]/)[0];
    this.scene.enableLayers(this.layerID);  // emits 'layerchange', so UI gets updated
  }


  /**
   * This function is either called from the `FileReader` onload callback, or the `fetch` then chain.
   * It can accept:
   *  - a `string` of text data, in which case it will be parsed according to the given extension.
   *  - a `Document` parsed by `xmldom.DOMParser` (like we would receive from `utilFetchResponse`),
   *  - an `Object`, in the case of JSON/GeoJSON.
   * All files get converted to GeoJSON.
   * @param data - The file data
   * @param extension - The file extension
   */
  protected _setFile(data: string | XmlDocument | GeoJSON.GeoJsonObject | null, extension: string | null | undefined): void {
    if (!data) return;

    const isString = (typeof data === 'string');
    let geojson: GeoJSON.GeoJsonObject | undefined;
    switch (extension) {
      case '.gpx':
        geojson = gpx(isString ? _parseXML(data as string) : data as XmlDocument);
        break;
      case '.kml':
        geojson = kml(isString ? _parseXML(data as string) : data as XmlDocument);
        break;
      case '.geojson':
      case '.json':
        geojson = isString ? JSON.parse(data as string) : data as GeoJSON.GeoJsonObject;
        break;
    }

    geojson = geojson || {} as GeoJSON.GeoJsonObject;

    if (Object.keys(geojson).length) {
      this._dataUsed = `${extension} data file`;
      this._geoData = [];
      this._geoDataExtent = new Extent();

      // We may have a Feature or a FeatureCollection, coax it to an array of Features.
      const features = geojsonFeatures(geojson as GeoJSON.Feature | GeoJSON.FeatureCollection);
      for (const feature of features) {
        const d = new GeoJSONData(this.context, { geojson: feature });
        this._geoData.push(d);
        const extent = d.extent();
        if (extent) {
          this._geoDataExtent.extendSelf(extent);
        }
      }

      this.fitZoom();
      this.scene.enableLayers(this.layerID);  // emits 'layerchange', so UI gets updated
    }

    /**
     *
     * @param text
     */
    function _parseXML(text: string): XmlDocument {
      return (new DOMParser()).parseFromString(text.trimStart(), 'text/xml');
    }
  }


  /**
   * Return the extension at the end of a filename or url.
   * This only returns the extension if it one of the recognized file types:
   *   '.gpx', '.kml', '.json', '.geojson'
   * @param name - A filename or url
   * @return The extension including the dot '.'
   */
  protected _getExtension(name: string): string | null {
    if (!name) return null;
    const regex = /\.(gpx|kml|(geo)?json)$/i;
    const match = name.match(regex);
    return match?.[0] ?? null;
  }


  /**
   * Respond to any changes appearing in the url hash
   * @param currParams - The current hash parameters
   * @param prevParams - The previous hash parameters
   */
  protected _hashChanged(currParams: Map<string, string>, prevParams: Map<string, string>): void {
    // 'data' (or 'gpx', legacy)
    const newData = currParams.get('data') || currParams.get('gpx');
    const oldData = prevParams.get('data') || prevParams.get('gpx');
    if (newData !== oldData) {
      this._clear();
      if (typeof newData === 'string') {
        // Attempt to parse the data string as a WKT.
        // If it is, treat it as such. If not, treat it as a URL.
        const geojson = this._parseAsWkt(newData);
        if (geojson) {
          this._wkt = newData.toUpperCase();  // convention is to use uppercase
          this._setFile(geojson, '.geojson');
          this._dataUsed = null;  // A wkt area of interest is not really a data source
        } else {
          this.setUrl(newData);
        }
      }
    }
  }


  /**
   * Push changes in custom data url to the urlhash
   */
  protected _updateHash(): void {
    const urlhash = this.context.systems.urlhash!;

    if (!this.enabled) return;

    if (typeof this._wkt === 'string') {
      urlhash.setParam('data', this._wkt);
    } else if (typeof this._url === 'string') {
      // 'gpx' is considered a "legacy" param..
      // We'll only set it if the url really does seem to be for a gpx file
      if (/gpx/i.test(this._url)) {
        urlhash.setParam('gpx', this._url);
      } else {
        urlhash.setParam('data', this._url);
      }
    }
  }


  /**
   * creates WKT Polys from a raw string supplied by the `data` url param.
   *
   * @param wktString - the poly or multipoly string(s) in wkt format
   * i.e. 'POLYGON((-10 10, -10 -10, 10 -10, 10 10, -10 10))'
   * or
   *  'MULTIPOLYGON (((-1.5 1.3, -1.5 1.3, -1.5 1.3, -1.5 1.3, -1.4 1.3, -1.4 1.3, -1.5 1.3)),
   *   ((-1.5 1.3, -1.5 1.3, -1.5 1.3, -1.4 1.3, -1.5 1.3)))'
   * @returns a list containing polygons to draw as a custom shape, or null
   */
  protected _parseAsWkt(wktString: string): GeoJSON.Feature | null {
    const parsedWkt = wktParse(wktString);

    // If it couldn't be parsed, or if it isn't a poly/multipoly, we can't render it.
    if (!parsedWkt || (parsedWkt.type !== 'Polygon' && parsedWkt.type !== 'MultiPolygon')) {
      return null;
    }

    return {
      type: 'Feature',
      geometry: parsedWkt as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      id: 'customWktPoly',
      properties: {}
    };
  }


  /**
   * Clear state to prepare for new custom data
   */
  protected _clear(): void {
    this._dataUsed = null;
    this._fileList = null;
    this._template = null;
    this._wkt = null;
    this._url = null;
    this._geoData = null;
    this._geoDataExtent = null;
  }

}
