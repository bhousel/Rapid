import * as PIXI from 'pixi.js';
import { AbstractPixiLayer } from './AbstractPixiLayer.ts';
import { AdjustmentFilter, ConvolutionFilter } from 'pixi-filters';
import { interpolateNumber } from 'd3-interpolate';
import { Tiler, vecScale, WORLD_ZOOM } from '@rapid-sdk/math';

import type { ImagerySource } from '../lib/ImagerySource.ts';
import type { PixiScene } from './PixiScene.ts';
import type { Tile, Viewport } from '@rapid-sdk/math';


/** Filter settings for background imagery */
interface FilterSettings {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
}

/** Tile object with sprite, image, and debug info (extends Tile from @rapid-sdk/math) */
interface CachedTile extends Tile {
  url: string;
  sprite: PIXI.Sprite | null;
  loaded: boolean;
  timestamp: number;
  debug: PIXI.Graphics | null;
  text: PIXI.BitmapText | null;
}

const DEBUGCOLOR = 0xffff00;

// Parameters for use by the convolution filter to sharpen the imagery
const sharpenMatrix = [
     0,      -0.0125,      0,
  -0.0125,    0.5,      -0.0125,
     0,      -0.0125,      0
];


/**
 *
 * Properties you can access:
 *   `isMinimap` - set this to `true` if this is a minimap background layer.
 *
 * @class
 */
export class PixiLayerBackgroundTiles extends AbstractPixiLayer {
  /** Whether this is a minimap background layer */
  isMinimap: boolean;
  /** Filter settings for brightness/contrast/saturation/sharpness */
  filters: FilterSettings;
  /** Blur filter applied when sharpness < 1 */
  blurFilter: PIXI.BlurFilter | null;
  /** Convolution filter applied when sharpness > 1 */
  convolutionFilter: ConvolutionFilter | null;

  private _tileMaps: Map<ImagerySourceID, Map<TileID, CachedTile>>;
  private _failed: Set<string>;
  private _tiler: Tiler;

  /**
   * @constructor
   * @param scene - The Scene that owns this Layer
   */
  constructor(scene: PixiScene) {
    super(scene);
    this.id = 'background';
    this.enabled = true;   // background imagery should be enabled by default

    this.isMinimap = false;
    this.blurFilter = null;
    this.convolutionFilter = null;

    this.filters = {
      brightness: 1,
      contrast: 1,
      saturation: 1,
      sharpness: 1,
    };

    this._tileMaps = new Map();    // Map<ImagerySourceID, Map<TileID, Tile>>
    this._failed = new Set();      // Set<failed tileURLs>
    this._tiler = new Tiler();
  }


  /**
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset(): void {
    super.reset();

    // Items in this layer don't need to be interactive
    const groupContainer = this.scene.groups.get('background')!;
    groupContainer.eventMode = 'none';

    this.destroyAll();
    this._tileMaps.clear();
    this._failed.clear();
  }


  /**
   * Render all of the base and overlay imagery sources in the current view.
   * @param frame - Integer frame being rendered
   * @param viewport - Pixi viewport to use for rendering
   */
  render(frame: number, viewport: Viewport): void {
    const imagery = this.context.systems.imagery;
    if (!imagery) return;

    const groupContainer = this.scene.groups.get('background')!;
    const showSources = new Map<ImagerySourceID, ImagerySource>();

    // Gather the base ImagerySource
    const base = imagery.baseLayerSource() as ImagerySource | null;
    const baseID = base?.key;   // note: use `key` here - for Wayback it will include the date
    if (base && baseID && baseID !== 'none') {
      showSources.set(baseID, base);
    }

    // Gather the overlay ImagerySources
    for (const overlay of imagery.overlayLayerSources()) {
      showSources.set(overlay.id, overlay);
    }

    // Render each imagery source (iterates in insertion order, base then overlays)
    let index = 0;
    for (const [sourceID, source] of showSources) {
      const sourceContainer = this.getSourceContainer(sourceID);
      sourceContainer.zIndex = (source.isLocatorOverlay() ? 999 : index++);

      // If this is the base tile layer (and not minimap) apply the filters to it.
      if (!this.isMinimap && source === base) {
        this.applyFilters(sourceContainer);
      }

      let tileMap = this._tileMaps.get(sourceID);
      if (!tileMap) {
        tileMap = new Map<TileID, CachedTile>();
        this._tileMaps.set(sourceID, tileMap);
      }

      const timestamp = window.performance.now();
      this.renderSource(timestamp, viewport, source, sourceContainer, tileMap);
    }

    // Remove any sourceContainers and data not needed anymore
    // Doing this in 2 passes to avoid affecting `.children` while iterating over it.
    const toDestroy = new Set<ImagerySourceID>();
    for (const sourceContainer of groupContainer.children) {
      const sourceID = sourceContainer.label;
      if (!showSources.has(sourceID)) {
        toDestroy.add(sourceID);
      }
    }

    for (const sourceID of toDestroy) {
      this.destroySource(sourceID);
    }
  }


  /**
   * Render a single ImagerySource layer.
   * @param timestamp - Timestamp in milliseconds
   * @param viewport - Pixi viewport to use for rendering
   * @param source - ImagerySource Object
   * @param sourceContainer - PIXI.Container to render the tiles to
   * @param tileMap - Tiles needed for this tile source
   */
  renderSource(
    timestamp: number,
    viewport: Viewport,
    source: ImagerySource,
    sourceContainer: PIXI.Container,
    tileMap: Map<TileID, CachedTile>
  ): void {
    const context = this.context;
    const textureManager = this.gfx.textureManager!;
    const osm = context.services.osm;
    const t = viewport.transform.props;
    const sourceID = source.key;   // note: use `key` here, for Wayback it will include the date

    // Defensive coding in case nominatim/other reasons cause us to get an invalid view transform.
    if (isNaN(t.x) || isNaN(t.y)) {
      return;
    }

    // The tile debug container lives on the `map-ui` layer so it is drawn over everything
    let showDebug = false;
    let debugContainer: PIXI.Container | undefined;
    if (!this.isMinimap) {
      showDebug = context.getDebug('tile');
      const mapUI = this.scene.layers.get('map-ui') as any;
      debugContainer = mapUI?.tileDebug;
      if (debugContainer) {
        debugContainer.visible = showDebug;
      }
    }

    const tileSize = source.props.tileSize || 256;
    const log2ts = Math.log2(tileSize);
    const z = t.z - (log2ts - 8);   // adjust zoom for tile sizes not 256px (log2(256) = 8)

    // Apply imagery offset to the source container.
    // `source.offset` is in screen pixels at zoom 0, so converting to world
    // units (z = WORLD_ZOOM) means scaling by `2 ** WORLD_ZOOM`.
    const offset = vecScale(source.offset, 2 ** WORLD_ZOOM);
    sourceContainer.position.set(offset[0], offset[1]);

    // Determine tiles needed to cover the view at the zoom we want,
    // including any zoomed out tiles if this field contains any holes
    const needTiles = new Map<TileID, CachedTile>();   // Map<TileID, CachedTile>

    // Make sure the min zoom is at least 1.
    // z=0 causes a bug for Mapbox layers to disappear, these use very large tile size.
    // Also the locator overlay should always show its labels, which start at zoom 1.
    const maxZoom = Math.max(1, Math.ceil(z));         // the zoom we want (round up for sharper imagery)
    const minZoom = Math.max(1, maxZoom - source.props.zoomRange);   // the mininimum zoom we'll accept

    let covered = false;
    for (let tryZoom = maxZoom; !covered && tryZoom >= minZoom; tryZoom--) {
      if (!source.isValidZoom(tryZoom)) continue;  // not valid here, zoom out
      if (source.isLocatorOverlay() && maxZoom > 17) continue;   // overlay is blurry if zoomed in this far

      const tiler = ((this._tiler
        .tileSize(tileSize) as Tiler)
        .skipNullIsland(!!source.props.overlay) as Tiler)
        .zoomRange(tryZoom) as Tiler;
      const result = tiler.getTiles(this.isMinimap ? viewport : context.viewport);  // minimap passes in its own viewport

      let hasHoles = false;
      for (const tile of result.tiles) {
        // skip locator overlay tiles where we have osm data loaded there
        if (!this.isMinimap && tryZoom >= 10 && osm && source.isLocatorOverlay()) {
          const loc = tile.wgs84Extent.center();
          if (osm.isDataLoaded(loc)) continue;
        }

        const url = source.url(tile.xyz);
        if (!url || this._failed.has(url)) {
          hasHoles = true;   // url invalid or has failed in the past
        } else {
          // Create a CachedTile that extends the base tile with our extra properties
          const cachedTile: CachedTile = {
            ...tile,
            url: url,
            sprite: null,
            loaded: false,
            timestamp: timestamp,
            debug: null,
            text: null
          };
          needTiles.set(tile.id, cachedTile);
        }
      }
      covered = !hasHoles;
    }

    // Create a Sprite for each tile
    for (const [tileID, tile] of needTiles) {
      if (tileMap.has(tileID)) continue;   // we made it already

      const tileName = `${sourceID}-${tileID}`;
      const sprite = new PIXI.Sprite();
      sprite.label = tileName;

      sprite.anchor.set(0, 0);  // left, top
      sprite.zIndex = tile.xyz[2];   // draw zoomed tiles above unzoomed tiles
      sprite.alpha = source.props.alpha;
      sourceContainer.addChild(sprite);
      tile.sprite = sprite;
      tileMap.set(tileID, tile);

      // Start loading the image.
      // Use `fetch` + `createImageBitmap` so the PNG/JPEG decode happens off the
      // main thread (browser-internal worker).  The bitmap is already decoded by
      // the time we hand it to the atlas, which only has to upload pixels.
      fetch(tile.url, { mode: 'cors' })
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.blob();
        })
        .then(blob => createImageBitmap(blob))
        .then(bitmap => {
          this._failed.delete(tile.url);
          if (!tile.sprite) {   // tile was destroyed while we were loading
            bitmap.close();
            return;
          }
          const w = bitmap.width;
          const h = bitmap.height;
          tile.sprite.texture = textureManager.allocate('tile', tile.sprite.label, w, h, bitmap) || PIXI.Texture.EMPTY;
          bitmap.close();   // tile atlas copied it into an edge-padded canvas
          tile.loaded = true;
          this.gfx.deferredRedraw();
        })
        .catch(() => {
          this._failed.add(tile.url);
          this.gfx.deferredRedraw();
        });
    }

    // Update or remove the existing tiles
    for (const [tileID, tile] of tileMap) {
      let keepTile = false;

      // Keep this tile if it is in the `needTiles` map.
      if (needTiles.has(tileID)) {
        keepTile = true;
        tile.timestamp = timestamp;

      // Keep base (not overlay) tiles around a little while longer,
      // so they can stand in for a needed tile that has not loaded yet.
      } else if (!source.props.overlay) {
        keepTile = (timestamp - tile.timestamp < 3000);  // 3 sec
      }

      if (keepTile) {   // Tile may be visible
        // Update Tile position and scale
        // Background container draws in world coordinates.
        const [wx, wy] = tile.worldExtent.min;  // left top, world coords
        const tileScale = 2 ** (WORLD_ZOOM - tile.xyz[2]);
        const size = tileSize * tileScale;
        tile.sprite!.position.set(wx, wy);
        tile.sprite!.width = size;
        tile.sprite!.height = size;

        // Optionally, draw the tile debug grid and text.
        // Debug container lives on `map-ui` also in world coordinates.
        if (showDebug && debugContainer && !source.props.overlay) {

          // Display debug tile info
          if (!tile.debug) {
            tile.debug = new PIXI.Graphics();
            tile.debug.label = `debug-${tileID}`;
            tile.debug.eventMode = 'none';
            debugContainer.addChild(tile.debug);
          }

          if (!tile.text) {
            // BitmapText fontSize is fixed at creation.
            tile.text = new PIXI.BitmapText({
              text: tileID,
              style: {
                fontFamily: 'rapid-debug',
                fontSize: 14
              }
            });

            tile.text.label = `label-${tileID}`;
            tile.text.tint = DEBUGCOLOR;
            tile.text.eventMode = 'none';
            debugContainer.addChild(tile.text);
          }

          // Need to apply viewport scale the stroke widths and text.
          // Note that we use the viewport zoom here, not the tile zoom.
          const viewportScale = 2 ** (WORLD_ZOOM - t.z);
          const padding = 2 * viewportScale;
          tile.debug.position.set(wx, wy);                     // left, top
          tile.text.position.set(wx + padding, wy + padding);  // left, top, padded
          tile.text.scale.set(viewportScale, viewportScale);
          tile.debug
            .clear()
            .rect(0, 0, size, size)
            .stroke({ width: 2 * viewportScale, color: DEBUGCOLOR });
        }

      } else {   // tile not needed, can destroy it
        this.destroyTile(tile);
        tileMap.delete(tileID);
      }
    }
  }


  /**
   * Frees all the resources used by all sources
   */
  destroyAll(): void {
    const groupContainer = this.scene.groups.get('background')!;

    // Doing this in 2 passes to avoid affecting `.children` while iterating over it.
    const toDestroy = new Set<string>();
    for (const sourceContainer of groupContainer.children) {
      const sourceID = sourceContainer.label;
      toDestroy.add(sourceID);
    }

    for (const sourceID of toDestroy) {
      this.destroySource(sourceID);
    }
  }


  /**
   * Frees all the resources used by a source
   * @param sourceID - the sourceID to free
   */
  destroySource(sourceID: ImagerySourceID): void {
    const tileMap = this._tileMaps.get(sourceID);
    if (tileMap) {
      for (const [tileID, tile] of tileMap) {
        this.destroyTile(tile);
        tileMap.delete(tileID);
      }
    }
    this._tileMaps.delete(sourceID);

    const groupContainer = this.scene.groups.get('background')!;
    const sourceContainer = groupContainer.getChildByLabel(sourceID);
    if (sourceContainer) {
      sourceContainer.destroy({ children: true });
    }
  }


  /**
   * Frees all the resources used by a tile
   * @param tile - Tile object
   */
  destroyTile(tile: CachedTile): void {
    const textureManager = this.gfx.textureManager!;

    if (tile.sprite) {
      if (tile.loaded) {
        textureManager.free('tile', tile.sprite.label);
      }
      tile.sprite.destroy({ texture: true, textureSource: false });
    }

    if (tile.debug) {
      tile.debug.destroy();
    }
    if (tile.text) {
      tile.text.destroy();
    }

    tile.sprite = null;
    tile.debug = null;
    tile.text = null;
  }


  /**
   * Gets a PIXI.Container to hold the tiles for the given sourceID, creating one if needed.
   * @param sourceID - the sourceID get a container for
   * @return A PIXI.Container to render tiles into
   */
  getSourceContainer(sourceID: ImagerySourceID): PIXI.Container {
    const groupContainer = this.scene.groups.get('background')!;
    let sourceContainer = groupContainer.getChildByLabel(sourceID);
    if (!sourceContainer) {
      sourceContainer = new PIXI.Container();
      sourceContainer.label = sourceID;
      sourceContainer.eventMode = 'none';
      sourceContainer.sortableChildren = true;
      groupContainer.addChild(sourceContainer);
    }
    return sourceContainer;
  }


  /**
   * Adds an adjustment filter for brightness/contrast/saturation and
   * a sharpen/blur filter, depending on the UI slider settings.
   * @param sourceContainer - The PIXI.Container that contains the tiles
   */
  applyFilters(sourceContainer: PIXI.Container): void {
    const adjustmentFilter = new AdjustmentFilter({
      brightness: this.filters.brightness,
      contrast: this.filters.contrast,
      saturation: this.filters.saturation,
    });

    sourceContainer.filters = [adjustmentFilter];

    if (this.filters.sharpness > 1) {
      // The convolution filter consists of adjacent pixels with a negative factor and the central pixel being at least one.
      // The central pixel (at index 4 of our 3x3 array) starts at 1 and increases
      const convolutionArray = sharpenMatrix.map((n, i) => {
        if (i === 4) {
          const interp = interpolateNumber(1, 2)(this.filters.sharpness);
          const result = n * interp;
          return result;
        } else {
          return n;
        }
      });

      this.convolutionFilter = new ConvolutionFilter(convolutionArray);
      sourceContainer.filters= [...sourceContainer.filters, this.convolutionFilter];

    } else if (this.filters.sharpness < 1) {
      const blurFactor = interpolateNumber(1, 8)(1 - this.filters.sharpness);
      this.blurFilter = new PIXI.BlurFilter({
        strength: blurFactor,
        quality: 4
      });
      sourceContainer.filters = [...sourceContainer.filters, this.blurFilter];
    }
  }


  /**
   * @param val - the brightness value
   */
  setBrightness(val: number): void {
    this.filters.brightness = val;
  }

  /**
   * @param val - the contrast value
   */
  setContrast(val: number): void {
    this.filters.contrast = val;
  }

  /**
   * @param val - the saturation value
   */
  setSaturation(val: number): void {
    this.filters.saturation = val;
  }

  /**
   * @param val - the sharpness value
   */
  setSharpness(val: number): void {
    this.filters.sharpness = val;
  }

}
