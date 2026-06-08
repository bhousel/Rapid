import { select as d3_select } from 'd3-selection';
import { AbstractSystem } from '../core/AbstractSystem.ts';
import {
  DEG2RAD, Extent, Tiler, geoMetersToLat, geoMetersToLon,
  geomRotate, geomPointInPolygon, projWgs84ToWorld, vecLength
} from '@rapid-sdk/math';
import { MarkerData, GeoJSONData } from '../data/index.ts';
import { uiIcon } from '../ui/icon.js';
import { utilQsString } from '@rapid-sdk/util';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { GeoJSONProps } from '../data/GeoJSONData.ts';
import type { MarkerProps } from '../data/MarkerData.ts';
import type { Quad, Tile, Vec2 } from '@rapid-sdk/math';


/** Properties for Streetside bubble (photo) markers */
export interface StreetsideBubbleProps extends MarkerProps {
  /** Compass angle (heading) in degrees */
  ca: number;
  /** When the bubble was captured */
  captured_at: string;
  /** Who captured the bubble (always 'microsoft') */
  captured_by: string;
  /** Previous bubble ID in the sequence */
  pr?: PhotoID;
  /** Next bubble ID in the sequence */
  ne?: PhotoID;
  /** Whether this is a panoramic image */
  isPano: boolean;
}

/** Properties for Streetside sequence GeoJSONData data */
export interface StreetsideSequenceProps extends GeoJSONProps {
  /** Ordered array of bubble IDs in this sequence */
  bubbleIDs: PhotoID[];
  /** Whether this sequence contains panoramic images */
  isPano: boolean;
  /** Capture date, copied from the first bubble */
  captured_at?: string;
  /** Capture author, copied from the first bubble */
  captured_by?: string;
}

/** A Streetside bubble MarkerData with typed props */
export type StreetsideBubble = MarkerData<StreetsideBubbleProps>;

/** A Streetside sequence GeoJSONData with typed props */
export type StreetsideSequence = GeoJSONData<StreetsideSequenceProps>;

/** Zoom level used by the tiler for loading Streetside bubble data */
const TILEZOOM = 16.5;
/** Number of extra tiles to request around the viewport to allow connecting sequences */
const TILEMARGIN = 2;


/** Internal cache for Streetside tile data */
interface StreetsideCache {
  /** Set of bubble PhotoIDs not yet assigned to a sequence */
  unattachedBubbles: Set<PhotoID>;
  /** Map of bubble PhotoID to the set of SequenceIDs it belongs to */
  bubbleHasSequences: Map<PhotoID, Set<SequenceID>>;
  /** Cached metadata fetch promise (fetched only once) */
  metadataPromise: Promise<unknown> | null;
  /** Last viewport version that was processed, avoids redundant work */
  lastv: number | null;
}

/** Options for Pannellum scene configuration */
interface SceneOptions {
  /** Panorama type, e.g. 'cubemap' */
  type: string;
  /** Array of 6 data URLs for cubemap faces */
  cubeMap: string[];
  /** Whether to disable keyboard controls in the viewer */
  disableKeyboardCtrl: boolean;
  /** Whether to show the fullscreen button */
  showFullscreenCtrl: boolean;
  /** Whether the panorama loads automatically */
  autoLoad: boolean;
  /** Whether to show the compass indicator */
  compass: boolean;
  /** Momentum friction after interaction stops (1 = stop immediately) */
  friction: number;
  /** Minimum horizontal field of view in degrees (max zoom in) */
  minHfov: number;
  /** Maximum horizontal field of view in degrees (max zoom out) */
  maxHfov: number;
  /** Default horizontal field of view in degrees */
  hfov: number;
  /** Default compass yaw angle in degrees */
  yaw: number;
  /** Offset to align north, set from the bubble's compass angle */
  northOffset?: number;
  /** Initial pitch angle in degrees */
  pitch?: number;
}

/** Info about a single image tile to be loaded */
interface ImgInfo {
  /** Cubemap face code (e.g. '01' for front, '02' for right) */
  face: string;
  /** URL to fetch the image tile from */
  url: string;
  /** X pixel offset for drawing on the canvas */
  x: number;
  /** Y pixel offset for drawing on the canvas */
  y: number;
}

/** Result from loading a single image */
interface ImageLoadResult {
  /** The image info that was loaded */
  imgInfo: ImgInfo;
  /** Load status: 'ok' or 'error' */
  status: string;
}


/**
 * `StreetsideService` loads streetside photos and coverage information from
 * various Microsoft/VirtualEarth APIs.
 *
 * It also manages the embedded Pannellum panoramic photo viewer.
 * @see https://pannellum.org/documentation/api
 *
 * Events available:
 * - `imageChanged`   - fired when a new image is visible in the viewer
 * - `bearingChanged` - fired when the viewer has been panned, receives the bearing value in degrees.
 * - `fovChanged`     - fired when the viewer has been zoomed, receives the fov value in degrees.
 */
export class StreetsideService extends AbstractSystem {

  /** Promise tracking Pannellum asset loading */
  protected _loadPromise: Promise<void> | null;
  /** Internal cache for tile data, inflight requests, and sequence state */
  protected _cache: StreetsideCache;
  /** Whether high-resolution imagery is enabled */
  protected _hires: boolean;
  /** Canvas resolution in pixels per face (512, 1024, 2048, or 4096) */
  protected _resolution: number;
  /** Counter for the current Pannellum scene ID */
  protected _currScene: number;
  /** The Pannellum viewer instance */
  protected _viewer: any;
  /** Auto-incrementing counter for generating sequence IDs */
  protected _nextSequenceID: number;
  /** Photo ID to select once its data has been fetched */
  protected _waitingForPhotoID: PhotoID | null;
  /** Configuration options passed to Pannellum when creating scenes */
  protected _sceneOptions: SceneOptions;
  /** Tiler instance configured for Streetside tile requests */
  protected _tiler: Tiler;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'streetside';
    this.requiredDependencies = new Set<SystemID>(['assets', 'l10n', 'network', 'photos', 'spatial']);
    this.optionalDependencies = new Set<SystemID>(['gfx', 'ui']);
    this.autoStart = false;

    this._loadPromise = null;

    this._cache = {} as StreetsideCache;
    this._hires = false;
    this._resolution = 512;    // higher numbers are slower - 512, 1024, 2048, 4096
    this._currScene = 0;
    this._viewer = null;
    this._nextSequenceID = 0;
    this._waitingForPhotoID = null;

    this._sceneOptions = {
      type: 'cubemap',
      cubeMap: [],
      disableKeyboardCtrl: true,
      showFullscreenCtrl: false,
      autoLoad: true,
      compass: true,
      friction: 1,    // don't keep moving after interaction stops
      minHfov: 10,    // zoom in degrees:  20, 10, 5
      maxHfov: 90,    // zoom out degrees
      hfov: 45,       // default field of view degrees
      yaw: 0          // default compass angle
    };

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this._keydown = this._keydown.bind(this);
    this._step = this._step.bind(this);
    this._setupCanvas = this._setupCanvas.bind(this);

    this._tiler = ((new Tiler().zoomRange(TILEZOOM) as Tiler).margin(TILEMARGIN) as Tiler).skipNullIsland(true) as Tiler;
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = super.initAsync()
      .then(() => this.resetAsync());
  }


  /**
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    const context = this.context;
    const eventManager = context.systems.gfx?.eventManager;
    const ui = context.systems.ui;

    // create ms-wrapper, a photo wrapper class
    let $wrapper: D3Selection = context.container().select('.photoviewer .middle-middle')
      .selectAll('.ms-wrapper')
      .data([0]);

    const $$wrapper: D3EnterSelection = $wrapper.enter()
      .append('div')
      .attr('class', 'photo-wrapper ms-wrapper')
      .classed('hide', true);

    $$wrapper
      .append('div')
      .attr('id', 'rapideditor-viewer-streetside');

    // add .photo-footer
    const $$footer: D3EnterSelection = $$wrapper
      .append('div')
      .attr('class', 'photo-footer');

    $$footer
      .append('div')
      .attr('class', 'photo-options');

    $$footer
      .append('div')
      .attr('class', 'photo-attribution');

    // add .photo-controls
    const $$controls: D3EnterSelection = $$wrapper
      .append('div')
      .attr('class', 'photo-controls-wrap')
      .append('div')
      .attr('class', 'photo-controls');

    $$controls
      .append('button')
      .on('click.back', () => this._step(-1))
      .call(uiIcon('#fas-backward-step'));

    $$controls
      .append('button')
      .on('click.forward', () => this._step(1))
      .call(uiIcon('#fas-forward-step'));


    // create working canvas for stitching together images
    $wrapper = $wrapper.merge($$wrapper) as D3Selection;
    $wrapper.call(this._setupCanvas);

    // Register viewer resize handler
    ui?.PhotoViewer.on('resize', () => {
      if (this._viewer) this._viewer.resize();
    });

    eventManager?.on('keydown', this._keydown);

    return this._startPromise = this._loadAssetsAsync()
      .then(() => { this._started = true; });
//      .catch(err => {
//        if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
//        this._startPromise = null;
//      });
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    const context = this.context;
    const network = context.systems.network!;
    const spatial = context.systems.spatial!;

    network.abortMatching(id => id.startsWith('streetside'));
    spatial.clearMatching(id => id.startsWith('streetside'));

    this._cache = {
      unattachedBubbles: new Set<PhotoID>(),
      bubbleHasSequences: new Map<PhotoID, Set<SequenceID>>(),
      metadataPromise: null,
      lastv: null
    };

    return Promise.resolve();
  }


  /** Public accessor for the embedded Streetside viewer instance.
   * @return  The Streetside viewer instance
   */
  public get viewer(): any {
    return this._viewer;
  }


  /**
   * Get already loaded image data that appears in the current map view
   * @return Array of image data
   */
  public getImages(): MarkerData[] {
    const spatial = this.context.systems.spatial!;
    return spatial.getVisibleData('streetside-images').map(hit => hit.contents) as MarkerData[];
  }


  /**
   * Get already loaded sequence data that appears in the current map view
   * @return Array of sequence data
   */
  public getSequences(): GeoJSONData[] {
    const spatial = this.context.systems.spatial!;
    return spatial.getVisibleData('streetside-sequences').map(hit => hit.contents) as GeoJSONData[];
  }


  /**
   * Schedule any data requests needed to cover the current map view
   */
  public loadTiles(): void {
    const context = this.context;
    const network = context.systems.network!;
    const spatial = context.systems.spatial!;
    const viewport = context.viewport;
    const cache = this._cache;

    if (cache.lastv === viewport.v) return;  // exit early if the view is unchanged
    cache.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const needTiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    const neededIDs = new Set<RequestID>(needTiles.map(tile => `streetside-${tile.id}`));
    network.abortMatching(id => id.startsWith('streetside') && !neededIDs.has(id));

    // Issue new requests..
    for (const tile of needTiles) {
      const tileID = tile.id;
      const requestID = `streetside-${tileID}` as RequestID;
      if (spatial.hasTile('streetside-images', tileID) || network.isInflight(requestID)) continue;

      // Promise.all([this._fetchMetadataAsync(tile), this._loadTileAsync(tile)])
      this._loadTileAsync(tile);
    }
  }


  /**
   * Shows the photo viewer, and hides all other photo viewers
   */
  public showViewer(): void {
    const $viewer: D3Selection = this.context.container().select('.photoviewer')
      .classed('hide', false);

    const isHidden = $viewer.selectAll('.photo-wrapper.ms-wrapper.hide').size();

    if (isHidden) {
      $viewer
        .selectAll('.photo-wrapper:not(.ms-wrapper)')
        .classed('hide', true);

      $viewer
        .selectAll('.photo-wrapper.ms-wrapper')
        .classed('hide', false);
    }
  }


  /**
   * Hides the photo viewer and clears the currently selected image
   */
  public hideViewer(): void {
    const context = this.context;
    context.systems.photos!.selectPhoto(null);

    const $viewer: D3Selection = context.container().select('.photoviewer');
    $viewer
      .classed('hide', true)
      .selectAll('.photo-wrapper')
      .classed('hide', true);

    this.emit('imageChanged');
  }


  /**
   * Note:  most code should call `PhotoSystem.selectPhoto(layerID, photoID)` instead.
   * That will manage the state of what the user clicked on, and then call this function.
   * @param imageID - the id of the image to select
   * @param bubbleID
   * @return Promise that resolves to the image after it has been selected
   */
  public selectImageAsync(bubbleID: Nullable<PhotoID>): Promise<MarkerData | void> {
    if (!bubbleID) {
      this._updatePhotoFooter(null);  // reset
      return Promise.resolve();  // do nothing
    }

    const context = this.context;
    const spatial = context.systems.spatial!;

    const $wrapper: D3Selection = context.container().select('.photoviewer .ms-wrapper');
    $wrapper.selectAll('.pnlm-load-box')   // display "loading.."
      .style('display', 'block')
      .style('transform', 'translate(-50%, -50%)');

    // It's possible we could be trying to show a photo that hasn't been fetched yet
    // (e.g. if we are starting up with a photoID specified in the url hash)
    const bubble = spatial.getData<MarkerData<StreetsideBubbleProps>>('streetside-images', bubbleID);
    if (!bubble) {
      this._waitingForPhotoID = bubbleID;
      return Promise.resolve();
    }

    this._sceneOptions.northOffset = bubble.props?.ca ?? 0;

    this._updatePhotoFooter(bubbleID);

    const streetsideImagesApi = 'https://ecn.t0.tiles.virtualearth.net/tiles/';

    const asNumber = parseInt(bubbleID, 10);
    let bubbleIdQuadKey = asNumber.toString(4);
    const paddingNeeded = 16 - bubbleIdQuadKey.length;
    for (let i = 0; i < paddingNeeded; i++) {
      bubbleIdQuadKey = '0' + bubbleIdQuadKey;
    }
    const imgUrlPrefix = streetsideImagesApi + 'hs' + bubbleIdQuadKey;
    // const imgUrlSuffix = '.jpg?g=6338&n=z';
    const imgUrlSuffix = '?g=13305&n=z';

    // Cubemap face code order matters here: front=01, right=02, back=03, left=10, up=11, down=12
    const faceKeys = ['01','02','03','10','11','12'];

    // Map images to cube faces
    const quadKeys = this._getQuadKeys();
    const faces = faceKeys.map(faceKey => {
      return quadKeys.map(quadKey => {
        const xy = this._qkToXY(quadKey);
        return {
          face: faceKey,
          url: imgUrlPrefix + faceKey + quadKey + imgUrlSuffix,
          x: xy[0],
          y: xy[1]
        };
      });
    });

    return this._loadFacesAsync(faces)
      .then(() => {
        if (!this._viewer) {
          this._initViewer();
        } else {
          // make a new scene
          this._currScene++;
          let sceneID = this._currScene.toString();
          this._viewer
            .addScene(sceneID, this._sceneOptions)
            .loadScene(sceneID);

          // remove previous scene
          if (this._currScene > 2) {
            sceneID = (this._currScene - 1).toString();
            this._viewer
              .removeScene(sceneID);
          }
        }

        return bubble; // pass the image to anything that chains off this Promise
      });
  }


  /**
   * Update the photo attribution section of the image viewer
   * @param bubbleID - the new bubbleID
   */
  protected _updatePhotoFooter(bubbleID: Nullable<PhotoID>): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const photos = context.systems.photos!;
    const spatial = context.systems.spatial!;
    const $wrapper: D3Selection = context.container().select('.photoviewer .ms-wrapper');

    // Options Section
    const $options: D3Selection = $wrapper.selectAll('.photo-options');

    // .hires checkbox
    let $label: D3Selection = $options.selectAll('.hires')
      .data([0]);

    // enter
    const $$label: D3EnterSelection = $label.enter()
      .append('label')
      .attr('for', 'ms-hires-input')
      .attr('class', 'hires');

    $$label
      .append('input')
      .attr('type', 'checkbox')
      .attr('id', 'ms-hires-input')
      .on('click', e => {
        e.stopPropagation();

        this._hires = !this._hires;
        this._resolution = this._hires ? 1024 : 512;
        $wrapper.call(this._setupCanvas);

        const viewstate = {
          yaw: this._viewer.getYaw(),
          pitch: this._viewer.getPitch(),
          hfov: this._viewer.getHfov()
        };

        this._sceneOptions = Object.assign(this._sceneOptions, viewstate);
        this.selectImageAsync(photos.currPhotoID);  // reselect
      });

    $$label
      .append('span');

    // update
    $label = $label.merge($$label) as D3Selection;
    $label.selectAll('#ms-hires-input')
      .property('checked', this._hires);

    $label.selectAll('span')
      .text(l10n.t('photos.hires'));


    // Attribution Section
    const $attribution: D3Selection = $wrapper.selectAll('.photo-attribution').html('&nbsp;');  // clear DOM content

    const bubble = spatial.getData<StreetsideBubble>('streetside-images', bubbleID as string);
    if (!bubble) return;

    const props = bubble.props;

    if (props.captured_by) {
      $attribution
        .append('span')
        .attr('class', 'captured_by')
        .text(props.captured_by);

      $attribution
        .append('span')
        .text('|');
    }

    if (props.captured_at) {
      $attribution
        .append('span')
        .attr('class', 'captured_at')
        .text(l10n.displayShortDate(props.captured_at));

      $attribution
        .append('span')
        .text('|');
    }

    const loc = props.loc;

    $attribution
      .append('a')
      .attr('class', 'image-link')
      .attr('target', '_blank')
      .attr('href', `https://www.bing.com/maps?cp=${loc[1]}~${loc[0]}&lvl=17&dir=${props.ca}&style=x&v=2&sV=1`)
      .text('bing.com');
  }


  /**
   * Load the Pannellum JS and CSS files into the document head
   * @return Promise resolved when both files have been loaded
   */
  protected _loadAssetsAsync(): Promise<void> {
    if (this._loadPromise) return this._loadPromise;

    const assets = this.context.systems.assets!;

    // Tell the AssetSystem what to load..
    const latestPath = 'https://cdn.jsdelivr.net/npm/pannellum@2/build';
    const localPath = 'data/modules/pannellum';

    assets.registerAsset('pannellum_css', {
      latest: `${latestPath}/pannellum.min.css`,
      local:  `${localPath}/pannellum.css`  // note no .min
    });
    assets.registerAsset('pannellum_js', {
      latest: `${latestPath}/pannellum.min.js`,
      local:  `${localPath}/pannellum.js`  // note no .min
    });

    return this._loadPromise = new Promise<void>((resolve, reject) => {
      let count = 0;
      const loaded = () => {
        if (++count === 2) resolve();
      };

      const $head: D3Selection = d3_select('head');

      $head.selectAll('#rapideditor-pannellum-css')
        .data([0])
        .enter()
        .append('link')
        .attr('id', 'rapideditor-pannellum-css')
        .attr('rel', 'stylesheet')
        .attr('crossorigin', 'anonymous')
        .attr('href', assets.getAssetURL('pannellum_css'))
        .on('load', loaded)
        .on('error', reject);

      $head.selectAll('#rapideditor-pannellum-js')
        .data([0])
        .enter()
        .append('script')
        .attr('id', 'rapideditor-pannellum-js')
        .attr('crossorigin', 'anonymous')
        .attr('src', assets.getAssetURL('pannellum_js'))
        .on('load', loaded)
        .on('error', reject);
    });
  }


  /**
   * Initializes the Pannellum viewer
   */
  protected _initViewer(): void {
    if (!('pannellum' in globalThis)) throw new Error('pannellum not loaded');
    if (this._viewer) return;  // already initted

    this._currScene++;
    const sceneID = this._currScene.toString();
    const options = {
      'default': { firstScene: sceneID },
      scenes: {} as Record<string, SceneOptions>
    };
    options.scenes[sceneID] = this._sceneOptions;


    const imageChanged = () => {
      this.emit('imageChanged');
    };

    const fovChanged = () => {
      this.emit('fovChanged', this._viewer.getHfov());
    };

    this._viewer = (globalThis as any).pannellum.viewer('rapideditor-viewer-streetside', options);
    this._viewer.on('load', imageChanged);
    this._viewer.on('zoomchange', fovChanged);

    this.context.container().select('#rapideditor-viewer-streetside')
      .on('pointerdown.streetside', () => {
        d3_select(window)
          .on('pointermove.streetside', () => {
            this.emit('bearingChanged', this._viewer.getYaw());
          });
      })
      .on('pointerup.streetside pointercancel.streetside', () => {
        d3_select(window)
          .on('pointermove.streetside', null);
      });
  }


  /**
   * Handler for keydown events on the window, but only if the photo viewer is visible.
   * @param e - A DOM KeyboardEvent
   */
  protected _keydown(e: KeyboardEvent): void {
    const context = this.context;
    const eventManager = context.systems.gfx?.eventManager;
    const photos = context.systems.photos!;

    // Test environment?
    if (!eventManager) return;
    // Ignore keypresses unless we actually have a Mapillary photo showing
    if (!photos.isViewerShowing() || photos.currPhotoLayerID !== 'streetside') return;
    // Ignore modified keypresses (user might be panning or rotating)
    if (eventManager.modifierKeys.size) return;

    // Only allow key navigation if the user doesn't have something
    // more important focused - like a input, textarea, menu, etc.
    const activeElement = document.activeElement?.tagName ?? 'BODY';
    if (activeElement !== 'BODY') return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      this._step(-1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      this._step(1);
    }
  }


  /**
   * Step to the next bubble in the sequence
   * @param stepBy - 1 to step forward, -1 to step backward
   */
  protected _step(stepBy: number): void {
    const context = this.context;
    const photos = context.systems.photos!;
    const spatial = context.systems.spatial!;

    const currBubbleID = photos.currPhotoID;
    const selected = spatial.getData<StreetsideBubble>('streetside-images', currBubbleID);
    if (!selected) return;

    let nextID = (stepBy === 1 ? selected.props.ne : selected.props.pr) as PhotoID;
    const yaw = this._viewer.getYaw() as number;
    this._sceneOptions.yaw = yaw;

    const ca = (selected.props.ca ?? 0) + yaw;
    const origin = selected.props.loc;

    // construct a search trapezoid pointing out from current bubble
    const meters = 35;
    const p1: Vec2 = [
      origin[0] + geoMetersToLon(meters / 5, origin[1]),
      origin[1]
    ];
    const p2: Vec2 = [
      origin[0] + geoMetersToLon(meters / 2, origin[1]),
      origin[1] + geoMetersToLat(meters)
    ];
    const p3: Vec2 = [
      origin[0] - geoMetersToLon(meters / 2, origin[1]),
      origin[1] + geoMetersToLat(meters)
    ];
    const p4: Vec2 = [
      origin[0] - geoMetersToLon(meters / 5, origin[1]),
      origin[1]
    ];

    let poly: Quad = [p1, p2, p3, p4, p1];

    // rotate it to face forward/backward
    const angle = (stepBy === 1 ? ca : ca + 180) * DEG2RAD;
    poly = geomRotate(poly, -angle, origin);

    const extent = new Extent();
    for (const loc of poly) {
      extent.extendSelf(projWgs84ToWorld(loc));
    }

    // find nearest other bubble in the search polygon
    let minDist = Infinity;
    const hits = spatial.getDataAtBox('streetside-images', extent.bbox());
    for (const hit of hits) {
      const bubble = hit.contents as StreetsideBubble;
      if (bubble.id === selected.id) continue;
      if (!geomPointInPolygon(bubble.loc!, poly)) continue;

      let dist = vecLength(bubble.loc!, selected.loc);
      const theta = (selected.props.ca ?? 0) - (bubble.props.ca ?? 0);
      const minTheta = Math.min(Math.abs(theta), 360 - Math.abs(theta));
      if (minTheta > 20) {
        dist += 5;  // penalize distance if camera angles don't match
      }

      if (dist < minDist) {
        nextID = bubble.id;
        minDist = dist;
      }
    }

    const nextBubble = spatial.getData('streetside-images', nextID);
    if (!nextBubble) return;

    photos.selectPhoto('streetside', nextBubble.id);
    this.emit('imageChanged');
  }


  /**
   * Process the response from the tile fetch.
   * @param tile - Tile data
   * @param bubbles - Response data
   */
  protected _gotTile(tile: Tile, bubbles: any): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const photos = context.systems.photos!;
    const spatial = context.systems.spatial!;
    const cache = this._cache;

    spatial.addTiles('streetside-images', [tile]);   // mark as loaded

    if (!Array.isArray(bubbles)) return;
    if ((bubbles as any).error) throw new Error((bubbles as any).error);

    // [].shift() removes the first element, some statistics info, not a bubble point
    bubbles.shift();
    if (!bubbles.length) return;

    let selectBubbleID: PhotoID | null = null;
    const toLoad: MarkerData[] = [];
    for (const bubble of bubbles) {
      const bubbleID = bubble.id.toString();
      if (this._waitingForPhotoID === bubbleID) {
        selectBubbleID = bubbleID;
        this._waitingForPhotoID = null;
      }

      if (spatial.hasData('streetside-images', bubbleID))  continue;  // skip duplicates
      if (!Number.isFinite(bubble.lo) || !Number.isFinite(bubble.la)) continue;  // skip bubbles without valid coordinates

      const loc = spatial.preventCoincidentLoc('streetside-images', [bubble.lo, bubble.la]);
      const props = {
        type:         'photo',
        serviceID:    this.id,
        loc:          loc,
        id:           bubbleID,
        ca:           bubble.he,
        captured_at:  bubble.cd,
        captured_by:  'microsoft',
        pr:           bubble.pr?.toString(),  // previous
        ne:           bubble.ne?.toString(),  // next
        isPano:       true
      };

      toLoad.push(new MarkerData(context, props));
      cache.unattachedBubbles.add(bubbleID);
    }

    spatial.addData('streetside-images', toLoad);
    this._connectSequences();

    if (selectBubbleID) {
      photos.selectPhoto();                              // deselect
      photos.selectPhoto('streetside', selectBubbleID);  // reselect
    }

    gfx?.deferredRedraw();
  }


  /**
   * Call this sometimes to connect unattached bubbles into sequences.
   * Note that this algorithm has changed, as we seem to get different data.
   * The API we are using is undocumented :(
   */
  protected _connectSequences(): void {
    const context = this.context;
    const spatial = context.systems.spatial!;
    const unattachedBubbles = this._cache.unattachedBubbles;     // Set<PhotoID>
    const bubbleHasSequences = this._cache.bubbleHasSequences;   // Map<PhotoID, Set<SequenceID>>
    const touchedSequenceIDs = new Set<SequenceID>();  // sequences that we touched will need recalculation

    // Get bubbles that haven't been added to a sequence yet.
    // Note: sort numerically to minimize the chance that we'll start assembling mid-sequence.
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const toAttach = Array.from(unattachedBubbles).sort(collator.compare);

    const _updateCaches = (sequence: any, bubble: any): void => {
      const sequenceID = sequence.id;
      const bubbleID = bubble.id;
      touchedSequenceIDs.add(sequenceID);
      unattachedBubbles.delete(bubbleID);

      let seqs = bubbleHasSequences.get(bubbleID);
      if (!seqs) {
        seqs = new Set<SequenceID>();
        bubbleHasSequences.set(bubbleID, seqs);
      }
      seqs.add(sequenceID);
    };


    for (const currBubbleID of toAttach) {
      if (!unattachedBubbles.has(currBubbleID)) continue;  // done already

      // Get current bubble (the one we are trying to attach)
      const currBubble = spatial.getData<StreetsideBubble>('streetside-images', currBubbleID);
      if (!currBubble) {  // missing? shouldn't happen
        unattachedBubbles.delete(currBubbleID);
        continue;
      }

      // Get adjacent bubbles (if possible)
      const prevBubbleID = currBubble.props.pr;
      const prevBubble = prevBubbleID && spatial.getData<StreetsideBubble>('streetside-images', prevBubbleID);
      const nextBubbleID = currBubble.props.ne;
      const nextBubble = nextBubbleID && spatial.getData<StreetsideBubble>('streetside-images', nextBubbleID);

      // Try to link current bubble to the previous bubble's sequence.
      // Prefer a sequence where the current bubble follows the previous bubble at the end of the sequnce.
      // But accept any sequence we can make, they don't always link in both directions.
      if (prevBubbleID && prevBubble) {
        const trySequenceIDs = bubbleHasSequences.get(prevBubbleID) ?? new Set<SequenceID>();
        for (const sequenceID of trySequenceIDs) {
          const sequence = spatial.getData<StreetsideSequence>('streetside-sequences', sequenceID);
          if (!sequence) continue;
          const bubbleIDs = sequence.props.bubbleIDs;  // we will update bubbleIDs in-place
          const beginID = bubbleIDs.at(0);
          const endID = bubbleIDs.at(-1);
          if (prevBubbleID === endID) {
            bubbleIDs.push(currBubbleID);   // append current bubble to end
            _updateCaches(sequence, currBubble);
            break;
          } else if (prevBubbleID === beginID) {
            bubbleIDs.unshift(currBubbleID);  // prepend current bubble to beginning
            _updateCaches(sequence, currBubble);
            break;
          }
        }
      }

      // Try to link current bubble to the next bubble's sequence.
      // Prefer a sequence where the current bubble precedes the next bubble at the beginning of the sequnce.
      // But accept any sequence we can make, they don't always link in both directions.
      if (nextBubbleID && nextBubble) {
        const trySequenceIDs = bubbleHasSequences.get(nextBubbleID) ?? new Set<SequenceID>();
        for (const sequenceID of trySequenceIDs) {
          const sequence = spatial.getData<StreetsideSequence>('streetside-sequences', sequenceID);
          if (!sequence) continue;
          const bubbleIDs = sequence.props.bubbleIDs;  // we will update bubbleIDs in-place
          const beginID = bubbleIDs.at(0);
          const endID = bubbleIDs.at(-1);
          if (nextBubbleID === beginID) {
            bubbleIDs.unshift(currBubbleID);  // prepend current bubble to beginning
            _updateCaches(sequence, currBubble);
            break;
          } else if (nextBubbleID === endID) {
            bubbleIDs.push(currBubbleID);   // apppend current bubble to end
            _updateCaches(sequence, currBubble);
            break;
          }
        }
      }

      // If neither of those worked (i.e. current bubble still "unattached"),
      // Start a new sequence at the current bubble.
      if (unattachedBubbles.has(currBubbleID)) {
        const sequenceNum = this._nextSequenceID++;
        const sequenceID = `s${sequenceNum}`;
        const props = {
          id:         sequenceID,
          type:       'sequence',
          serviceID:  this.id,
          bubbleIDs:  [],
          isPano:     true,
          geojson: {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'LineString' as const,
              coordinates: [] as number[][]
            }
          }
        };

        const sequence: StreetsideSequence = new GeoJSONData(this.context, props as Partial<StreetsideSequenceProps>);
        spatial.addData('streetside-sequences', sequence);

        const bubbleIDs = sequence.props.bubbleIDs;  // we will update bubbleIDs in-place
        bubbleIDs.push(currBubbleID);
        _updateCaches(sequence, currBubble);

        // Include previous and next bubbles if we have them loaded
        if (prevBubbleID && prevBubble) {
          bubbleIDs.unshift(prevBubbleID);  // prepend previous bubble to beginning
          _updateCaches(sequence, prevBubble);
        }
        if (nextBubbleID && nextBubble) {
          bubbleIDs.push(nextBubbleID);  // append next bubble to end
          _updateCaches(sequence, nextBubble);
        }
      }
    }

    // Any sequences that we touched, bump version number and recompute the coordinate array
    for (const sequenceID of touchedSequenceIDs) {
      const sequence = spatial.getData<StreetsideSequence>('streetside-sequences', sequenceID);
      if (!sequence) continue;
      const bubbles = sequence.props.bubbleIDs
        .map((bubbleID: PhotoID) => spatial.getData<StreetsideBubble>('streetside-images', bubbleID));

      // We will update the properties in-place.. hope this is ok.
      sequence.props.captured_at = bubbles[0]?.props.captured_at;
      sequence.props.captured_by = bubbles[0]?.props.captured_by;
      const feature = sequence.props.geojson as GeoJSON.Feature;
      feature.geometry = { type: 'LineString', coordinates: bubbles.map(bubble => bubble?.loc ?? [0, 0]) };

      sequence.updateGeometry().touch();
      spatial.replaceData('streetside-sequences', sequence);
    }
  }


  /**
   * Fetches Bing Streetside imagery metadata for the tile's location.
   * https://learn.microsoft.com/en-us/bingmaps/rest-services/imagery/get-imagery-metadata
   * @param tile - The tile to fetch metadata for
   * @return  A promise for the metadata, or nothing if already fetched
   */
  protected _fetchMetadataAsync(tile: Tile): Promise<unknown> | void {
    const cache = this._cache;
    if (cache.metadataPromise) return cache.metadataPromise;  // only fetch it once

    const [lon, lat] = tile.wgs84Extent.center();
    const metadataURLBase = 'https://dev.virtualearth.net/REST/v1/Imagery/MetaData/Streetside';
    const metadataKey = 'AoG8TaQvkPo6o8SlpRVmBs7WJwO_NDQklVRcAfpn7P8oiEMYWNY59XHSJU81sP1Y';
    const metadataURL = `${metadataURLBase}/${lat},${lon}?key=${metadataKey}`;

    const network = this.context.systems.network!;
    cache.metadataPromise = network.fetch<any>(metadataURL)
      .then(data => {
        if (!data) throw new Error('no data');
        return data;
      });
  }


  /**
   * bubbles:   undocumented / unsupported API?
   * see Rapid#1305, iD#10100
   * @param tile
   */
  protected _loadTileAsync(tile: Tile): Promise<void> {
    const network = this.context.systems.network!;
    const requestID = `streetside-${tile.id}` as RequestID;

    if (network.isInflight(requestID)) return Promise.resolve();

    const [w, s, e, n] = tile.wgs84Extent.rectangle();
    const MAXRESULTS = 2000;

    const bubbleURLBase = 'https://t.ssl.ak.tiles.virtualearth.net/tiles/cmd/StreetSideBubbleMetaData?';
    const bubbleKey = 'AuftgJsO0Xs8Ts4M1xZUQJQXJNsvmh3IV8DkNieCiy3tCwCUMq76-WpkrBtNAuEm';
    const bubbleURL = bubbleURLBase + utilQsString({ north: n, south: s, east: e, west: w, count: MAXRESULTS, key: bubbleKey }, false);

    return network.fetch<string>(bubbleURL, { requestID })
      .then(data => this._gotTile(tile, JSON.parse(data)))  // Content-Type is 'text/plain' for some reason
      .catch(err => {
        if (err.name === 'AbortError') return;  // ok
        if (err instanceof Error) console.error(err);   // eslint-disable-line no-console
      });
  }


  /**
   * Loads a single image tile and draws it onto the corresponding face canvas.
   * @param imgInfo - Info about the image tile to load
   * @return Promise resolving with the load result status
   */
  protected _loadImageAsync(imgInfo: ImgInfo): Promise<ImageLoadResult> {
    return new Promise(resolve => {
      const face = imgInfo.face;
      const canvas = document.getElementById(`rapideditor-canvas${face}`) as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;

      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, imgInfo.x, imgInfo.y);
        resolve({ imgInfo: imgInfo, status: 'ok' });
      };
      img.onerror = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        resolve({ imgInfo: imgInfo, status: 'error' });
      };
      img.setAttribute('crossorigin', '');
      img.src = imgInfo.url;
    });
  }


  /**
   * Loads all image tiles for one cubemap face and assembles them into a data URL.
   * @param imageGroup - Array of image tile infos for a single face
   * @return Promise resolving when the face has been stitched
   */
  protected _loadFaceAsync(imageGroup: ImgInfo[]): Promise<{ status: string }> {
    return Promise.all(imageGroup.map(d => this._loadImageAsync(d)))
      .then(data => {
        const face = data[0].imgInfo.face;
        const canvas = document.getElementById(`rapideditor-canvas${face}`) as HTMLCanvasElement;
        const which: Record<string, number> = { '01': 0, '02': 1, '03': 2, '10': 3, '11': 4, '12': 5 };
        this._sceneOptions.cubeMap[which[face]] = canvas.toDataURL('image/jpeg', 1.0);
        return { status: `face ${face} ok` };
      });
  }


  /**
   * Loads all six cubemap faces in parallel.
   * @param faceGroup - Array of 6 face image groups
   * @return Promise resolving when all faces have been loaded
   */
  protected _loadFacesAsync(faceGroup: ImgInfo[][]): Promise<{ status: string }> {
    return Promise.all(faceGroup.map(d => this._loadFaceAsync(d)))
      .then(() => { return { status: 'this._loadFacesAsync done' }; });
  }


  /**
   * Called when setting up the viewer, creates 6 canvas elements to load image data into,
   * so that it can be stitched together into a photosphere.
   * @param $selection
   */
  protected _setupCanvas($selection: D3Selection): void {
    $selection.selectAll('#rapideditor-stitcher-canvases')
      .remove();

    // Add the Streetside working canvases. These are used for 'stitching', or combining,
    // multiple images for each of the six faces, before passing to the Pannellum control as DataUrls
    $selection.selectAll('#rapideditor-stitcher-canvases')
      .data([0])
      .enter()
      .append('div')
      .attr('id', 'rapideditor-stitcher-canvases')
      .attr('display', 'none')
      .selectAll('canvas')
      .data(['canvas01', 'canvas02', 'canvas03', 'canvas10', 'canvas11', 'canvas12'])
      .enter()
      .append('canvas')
      .attr('id', (d: string) => `rapideditor-${d}`)
      .attr('width', this._resolution)
      .attr('height', this._resolution);
  }


  /**
   * Converts a quadkey string to pixel coordinates for canvas placement.
   * @param qk - Quadkey string (e.g. '0123')
   * @return [x, y] pixel coordinates
   */
  protected _qkToXY(qk: string): Vec2 {
    let x = 0;
    let y = 0;
    let scale = 256;
    for (let i = qk.length; i > 0; i--) {
      const key = qk[i-1];
      x += (+(key === '1' || key === '3')) * scale;
      y += (+(key === '2' || key === '3')) * scale;
      scale *= 2;
    }
    return [x, y];
  }


  /**
   * Returns an ordered array of quadkey strings for tiling a cubemap face
   * at the current resolution. The number of tiles scales with resolution.
   * @return Array of quadkey strings
   */
  protected _getQuadKeys(): string[] {
    const dim = this._resolution / 256;
    let quadKeys: string[];

    if (dim === 16) {
      quadKeys = [
        '0000','0001','0010','0011','0100','0101','0110','0111',  '1000','1001','1010','1011','1100','1101','1110','1111',
        '0002','0003','0012','0013','0102','0103','0112','0113',  '1002','1003','1012','1013','1102','1103','1112','1113',
        '0020','0021','0030','0031','0120','0121','0130','0131',  '1020','1021','1030','1031','1120','1121','1130','1131',
        '0022','0023','0032','0033','0122','0123','0132','0133',  '1022','1023','1032','1033','1122','1123','1132','1133',
        '0200','0201','0210','0211','0300','0301','0310','0311',  '1200','1201','1210','1211','1300','1301','1310','1311',
        '0202','0203','0212','0213','0302','0303','0312','0313',  '1202','1203','1212','1213','1302','1303','1312','1313',
        '0220','0221','0230','0231','0320','0321','0330','0331',  '1220','1221','1230','1231','1320','1321','1330','1331',
        '0222','0223','0232','0233','0322','0323','0332','0333',  '1222','1223','1232','1233','1322','1323','1332','1333',

        '2000','2001','2010','2011','2100','2101','2110','2111',  '3000','3001','3010','3011','3100','3101','3110','3111',
        '2002','2003','2012','2013','2102','2103','2112','2113',  '3002','3003','3012','3013','3102','3103','3112','3113',
        '2020','2021','2030','2031','2120','2121','2130','2131',  '3020','3021','3030','3031','3120','3121','3130','3131',
        '2022','2023','2032','2033','2122','2123','2132','2133',  '3022','3023','3032','3033','3122','3123','3132','3133',
        '2200','2201','2210','2211','2300','2301','2310','2311',  '3200','3201','3210','3211','3300','3301','3310','3311',
        '2202','2203','2212','2213','2302','2303','2312','2313',  '3202','3203','3212','3213','3302','3303','3312','3313',
        '2220','2221','2230','2231','2320','2321','2330','2331',  '3220','3221','3230','3231','3320','3321','3330','3331',
        '2222','2223','2232','2233','2322','2323','2332','2333',  '3222','3223','3232','3233','3322','3323','3332','3333'
      ];

    } else if (dim === 8) {
      quadKeys = [
        '000','001','010','011',  '100','101','110','111',
        '002','003','012','013',  '102','103','112','113',
        '020','021','030','031',  '120','121','130','131',
        '022','023','032','033',  '122','123','132','133',

        '200','201','210','211',  '300','301','310','311',
        '202','203','212','213',  '302','303','312','313',
        '220','221','230','231',  '320','321','330','331',
        '222','223','232','233',  '322','323','332','333'
      ];

    } else if (dim === 4) {
      quadKeys = [
        '00','01',  '10','11',
        '02','03',  '12','13',

        '20','21',  '30','31',
        '22','23',  '32','33'
      ];

    } else {  // dim === 2
      quadKeys = [
        '0', '1',
        '2', '3'
      ];
    }

    return quadKeys;
  }

}
