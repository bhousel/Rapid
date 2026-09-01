import { AbstractSystem } from './AbstractSystem.ts';
import {
  DEG2RAD, RAD2DEG, TAU, Extent, numClamp, numWrap, projWgs84ToWorld,
  vecRotate, vecSubtract, WORLD_HALF, WORLD_SCALE } from '@rapid-sdk/math';
import { MarkerData } from '../data/MarkerData.ts';
import { selection } from 'd3-selection';
import { utilTotalExtent } from '../util/util.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { Difference } from '../lib/Difference.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { TransformProps, Vec2 } from '@rapid-sdk/math';

type AreaFillMode = 'wireframe' | 'partial' | 'full';

const MIN_Z = 2;
const MAX_Z = 24;


/**
 * `MapSystem` maintains the map state and provides an interface for manipulating the map view.
 *
 * Properties available:
 * - `highlightEdits`  `true` if edited features should be shown in a special style, `false` otherwise
 * - `areaFillMode`    one of 'full', 'partial' (default), or 'wireframe'
 * - `wireframeMode`   `true` if fill mode is 'wireframe', `false` otherwise
 *
 * Events available:
 * - `mapchange`  Fires on any change in map display options (wireframe/areafill, highlightedits)
 */
export class MapSystem extends AbstractSystem {

  /** Available area-fill modes, in display order */
  public readonly areaFillOptions: AreaFillMode[];

  /** Whether edited features are rendered with a highlight overlay */
  protected _highlightEdits: boolean;
  /** The currently active area-fill mode ('wireframe', 'partial', or 'full') */
  protected _currFillMode: AreaFillMode;
  /** The most-recently used non-wireframe fill mode, used when toggling out of wireframe */
  protected _toggleFillMode: AreaFillMode;
  /** Keyboard shortcut strings for map operations (populated during startAsync) */
  protected _keys: string[] | null;

  /** D3 selection of the parent container element that holds the map canvas */
  public $parent: D3Selection | null;


  /**
   * @constructor
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'map';
    this.requiredDependencies = new Set<SystemID>(['editor', 'gfx']);
    this.optionalDependencies = new Set<SystemID>(['filters', 'l10n', 'rapid', 'schema', 'settings', 'urlhash']);

    // display options
    this.areaFillOptions = ['wireframe', 'partial', 'full'];
    this._highlightEdits = false;      // whether to style edited features differently
    this._currFillMode = 'partial';    // the current fill mode
    this._toggleFillMode = 'partial';  // the previous *non-wireframe* fill mode

    this._keys = null;

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this._hashChanged = this._hashChanged.bind(this);
    this._updateHash = this._updateHash.bind(this);
    this._setupKeybinding = this._setupKeybinding.bind(this);
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const editor = context.systems.editor!;
    const filters = context.systems.filters;
    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n;
    const rapid = context.systems.rapid;
    const schema = context.systems.schema;
    const settings = context.systems.settings;
    const urlhash = context.systems.urlhash;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          gfx.initAsync(),
          l10n?.initAsync(),
          settings?.initAsync(),
          urlhash?.initAsync()
        ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        this._currFillMode = (settings?.get('map.areaFill') || 'partial') as AreaFillMode;           // the current fill mode
        this._toggleFillMode = (settings?.get('map.areaFillToggle') || 'partial') as AreaFillMode;  // the previous *non-wireframe* fill mode

        // Scene will exist after gfx init
        const scene = gfx.scene!;

        // Setup Event Handlers..
        // Note: We want MapSystem's hashchange listener registered as early as possible
        // because so many other parts of Rapid rely on the map location being set correctly.
        urlhash?.prependListener('hashchange', this._hashChanged);

        gfx
          .on('draw', () => {
            this._updateHash();
          });

        editor
          .on('merge', (entityIDs: EntityID[]) => {
            if (entityIDs) {
              scene.dirtyData('osm', entityIDs);
            }
            // Do we need this here?  OsmService calls `deferredRedraw` as tiles are loaded.
            // We would only need it if there can be delay between when tiles are loaded 'merge' is emitted.
            gfx.deferredRedraw();
          })
          .on('stagingchange', (difference: Difference) => {
            const complete = difference.complete();
            const graph = editor.staging.graph;
            for (const entity of complete.values()) {
              if (entity) {      // may be undefined if entity was deleted
                entity.touch();  // bump .v in place, rendering code will pick it up as dirty
                filters?.clearEntity(entity);  // clear feature filter cache
                if (difference.didChange.geometry) {
                  entity.updateGeometry(graph);
                }
              }
            }
            gfx.immediateRedraw();
          })
          .on('historyjump', (prevIndex: number, currIndex: number) => {
            // This code occurs when jumping to a different edit because of a undo/redo/restore, etc.
            const prevEdit = editor.history[prevIndex];
            const currEdit = editor.history[currIndex];

            // Counterintuitively, when undoing, we might want the metadata from the _next_ edit (located at prevIndex).
            // If that edit exists (it might not if we are restoring) use that one, otherwise just use the current edit
            const didUndo = (currIndex === prevIndex - 1);
            const edit = (didUndo && prevEdit) ?? currEdit;
            if (!edit) return;

            // Reposition the map if we've jumped to a different place.
            const t0 = context.viewport.transform.props;
            const t1 = edit.transform;
            if (t1 && (t0.x !== t1.x || t0.y !== t1.y || t0.z !== t1.z || t0.r !== t1.r)) {
              this.transformEase(t1);
            }

            // Switch to select mode if the edit contains selected ids.
            // Note: draw modes need to do a little extra work to survive this,
            //  so they have their own `historyjump` listeners.
            const modeID = context.mode?.id ?? '';
            if (/^draw/.test(modeID)) return;

            // For now these IDs are assumed to be OSM ids.
            // Check that they are actually in the stable graph.
            const graph = edit.graph;
            const checkIDs = edit.selectedIDs ?? [];
            const selectedIDs = checkIDs.filter((entityID: EntityID) => graph.hasEntity(entityID));
            if (selectedIDs.length) {
              context.enter('select-osm', { selection: { osm: selectedIDs }} );
            } else {
              context.enter('browse');
            }
          });

        filters?.on('filterchange', () => {
          scene.dirtyLayers('osm');
        });

        rapid?.on('datasetchange', () => {
          scene.dirtyLayers('rapid');
        });

        schema?.on('schemachange', () => {
          scene.dirtyLayers(['osm', 'rapid']);
        });

        l10n?.on('localechange', () => {
          this._setupKeybinding();
          scene.dirtyScene();    // labeled features can be on any layer
        });

        this._setupKeybinding();
      });
  }


  /**
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return  Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param  $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent: D3Selection | null = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const gfx = context.systems.gfx!;

    // Everything in here runs one time (on enter).
    // The 'main-map' is an absolutely positioned container that fills the space where the map will go.
    const $$mainmap: D3EnterSelection = $parent.selectAll('.main-map')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'main-map')
      // Suppress the native right-click context menu
      .on('contextmenu', (e: PointerEvent) => e.preventDefault())
      // Suppress swipe-to-navigate browser pages on trackpad/magic mouse – iD#5552
      .on('wheel.map mousewheel.map', (e: WheelEvent) => e.preventDefault());

    // The `supersurface` is a wrapper div that we temporarily transform as the user zooms and pans.
    // This allows us to defer actual rendering until the browser has more time to do it.
    // At regular intervals we reset this root transform and actually redraw the map.
    const $$supersurface: D3EnterSelection = $$mainmap
      .append(() => gfx.supersurface)
      .attr('class', 'supersurface');

    // Content beneath the supersurface may be transformed and will need to rerender sometimes.
    // This includes the Pixi WebGL canvas and the right-click edit menu

    // Historically `surface` was the root of the SVG DOM - Now it's the Pixi WebGL canvas.
    // Things that will not work anymore:
    //  - d3 selecting surface's child stuff
    //  - css classing surface's child stuff
    //  - listening to events on the surface
    $$supersurface
      .append(() => gfx.surface)
      .attr('class', 'surface');

    // The `overlay` is a div that is transformed to cancel out the supersurface.
    // This is a place to put things _not drawn by pixi_ that should stay positioned
    // with the map, like the editmenu.
    $$supersurface
      .append(() => gfx.overlay)
      .attr('class', 'overlay');
  }


  /**
   * This sets up the keybinding, replacing existing if needed
   */
  protected _setupKeybinding(): void {
    const context = this.context;
    const keybinding = context.keybinding();
    const l10n = context.systems.l10n;
    if (!l10n) return;

    if (Array.isArray(this._keys)) {
      keybinding.off(this._keys);
    }

    const wireframeKey = l10n.t('shortcuts.command.wireframe.key');
    const highlightEditsKey = l10n.t('shortcuts.command.highlight_edits.key');
    this._keys = [wireframeKey, highlightEditsKey];

    context.keybinding()
      .on(wireframeKey, (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.wireframeMode = !this.wireframeMode;
      })
      .on(highlightEditsKey, (e: KeyboardEvent) => {
        e.preventDefault();
        this.highlightEdits = !this.highlightEdits;
      });
  }


  /**
   * Respond to any changes appearing in the url hash
   * @param  currParams - The current hash parameters
   * @param  prevParams - The previous hash parameters
   */
  protected _hashChanged(currParams: Map<string, string>, prevParams: Map<string, string>): void {
    const context = this.context;
    const scene = context.systems.gfx!.scene!;  // exists after init

    // map
    const newMap = currParams.get('map');
    const oldMap = prevParams.get('map');
    if (!newMap || newMap !== oldMap) {
      let zoom = 2;
      let lat = 0;
      let lon = 0;
      let ang = 0;
      if (typeof newMap === 'string') {
        const parts = newMap.split('/', 4).map(Number);
        if (Number.isFinite(parts[0])) zoom = parts[0];
        if (Number.isFinite(parts[1])) lat = parts[1];
        if (Number.isFinite(parts[2])) lon = parts[2];
        if (Number.isFinite(parts[3])) ang = parts[3];
      }

      zoom = numClamp(zoom, MIN_Z, MAX_Z);
      lat = numClamp(lat, -90, 90);
      lon = numClamp(lon, -180, 180);
      // Why a '-' here?  Because "bearing" is the angle that the user points, not the angle that north points.
      ang = numWrap(-ang, 0, 360);

      this.setMapParams([lon, lat], zoom, ang * DEG2RAD);   // will eventually call setTransformAsync
    }

    // id
    const newIds = currParams.get('id');
    const oldIds = prevParams.get('id');
    if (newIds !== oldIds) {
      if (typeof newIds === 'string') {
        const ids = newIds.split(',').map(s => s.trim()).filter(Boolean);
        const modeID = context.mode?.id;
        if (ids.length && modeID !== 'save') {
          this.selectEntityID(ids[0]);  // for now, just the select first one
        }
      }
    }

    // note
    // Support opening notes layer with a URL parameter:
    //  e.g. `note=true`  -or-
    //  e.g. `note=<noteID>`
    const newNote = currParams.get('note') || '';
    const oldNote = prevParams.get('note') || '';
    if (newNote !== oldNote) {
      let isEnabled = false;
      let noteID = null;

      const vals = newNote.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      for (const val of vals) {
        if (val === 'true') {
          isEnabled = true;
          continue;
        }
        // Try the value as a number, but reject things like NaN, null, Infinity
        const num = +val;
        if (Number.isFinite(num)) {
          isEnabled = true;
          noteID = num;  // for now, just select the first one
          break;
        }
      }

      if (noteID) {
        this.selectNoteID(noteID);
      } else if (isEnabled) {
        scene.enableLayers('notes');
      } else {
        scene.disableLayers('notes');
      }
    }
  }


  /**
   * Push changes in map state to the urlhash.
   * This gets called on 'draw', so fairly frequently
   */
  protected _updateHash(): void {
    const context = this.context;
    const scene = context.systems.gfx!.scene!;
    const urlhash = context.systems.urlhash;
    const viewport = context.viewport;
    if (!urlhash) return;

    // map
    const [lon, lat] = viewport.centerLoc();
    const transform = viewport.transform;
    const zoom = transform.zoom;
    // Why a '-' here?  Because "bearing" is the angle that the user points, not the angle that north points.
    const ang = numWrap(-transform.r * RAD2DEG, 0, 360);
    const precision = Math.max(0, Math.ceil(Math.log(zoom) / Math.LN2));
    const EPSILON = 0.1;

    const zoomStr = zoom.toFixed(2);
    const latStr = lat.toFixed(precision);
    const lonStr = lon.toFixed(precision);
    const angStr = ang.toFixed(1);  // degrees

    let val = `${zoomStr}/${latStr}/${lonStr}`;
    if (Math.abs(ang) > EPSILON) {
      val += `/${angStr}`;
    }

    urlhash.setParam('map', val);


    // note
    const layer = scene.layers.get('notes');
    let noteID;
    const [pair] = context.selectedData();  // get the first thing in the Map()
    const [datumID, datum] = pair || [];
    if (datum instanceof MarkerData && datum.serviceID === 'osm') {
      noteID = datumID;
    }

    // `note=true` -or- `note=<noteID>`
    if (layer?.enabled) {
      if (noteID) {
        urlhash.setParam('note', noteID);
      } else {
        urlhash.setParam('note', 'true');
      }
    } else {
      urlhash.setParam('note', null);
    }
  }


  /**
   * Returns the [x,y] pixel at the center of the viewport
   * @return  [x,y] pixel at the center of the viewport
   */
  public centerPoint(): Vec2 {
    return this.context.viewport.center();
  }


  /**
   * Returns the current [lon,lat] location at the center of the viewport
   * @return  [lon,lat] location at the center of the viewport
   */
  public centerLoc(): Vec2 {
    return this.context.viewport.centerLoc();
  }


  /**
   * Gets the current [x,y] pixel location of the pointer
   * (or center of map if there is no readily available pointer coordinate)
   * @return  [x,y] pixel location of pointer (or center of the map)
   */
  public mouse(): Vec2 {
    const gfx = this.context.systems.gfx;
    return gfx?.eventManager?.coord?.map || this.centerPoint();
  }


  /**
   * Gets the current [lon,lat] location of the pointer in WGS84 coordinates.
   * (or center of map if there is no readily available pointer coordinate)
   * @return  [lon,lat] WGS84 coordinate of pointer (or center of the map)
   */
  public mouseLoc(): Vec2 {
    return this.context.viewport.unproject(this.mouse());
  }


  /**
   * Gets the current [x,y] location of the pointer in world coordinates.
   * (or center of map if there is no readily available pointer coordinate)
   * @return  [x,y] world coordinate of pointer (or center of the map)
   */
  public mouseWorld(): Vec2 {
    const gfx = this.context.systems.gfx;
    return gfx?.eventManager?.coord?.world ?? this.context.viewport.screenToWorld(this.centerPoint());
  }


  /**
   * Set/Get the map transform
   * IF setting, will schedule an update of map transform.
   * All convenience methods for adjusting the map go through here.
   * @param  t2         Transform Object with `x`,`y`,`z`,`r` properties.
   * @param  duration   Duration of the transition in milliseconds, defaults to 0ms (asap)
   * @return map transform -or- this
   */
  public transform(t2?: TransformProps, duration?: number): TransformProps | this {
    if (t2 === undefined) {
      return this.context.viewport.transform.props;
    }

    // Avoid tiny or out of bounds rotations
    t2.r = numWrap((+(t2.r || 0).toFixed(3)), 0, TAU);   // radians

    const gfx = this.context.systems.gfx;
    gfx?.setTransformAsync(t2, duration ?? 0);
    return this;
  }


  /**
   * Newer Promise-returning version of `transform()`
   * @param   t2        Transform Object with `x`,`y`,`z`,`r` properties.
   * @param   duration  Duration of the transition in milliseconds, defaults to 0ms (asap)
   * @return  Promise that resolves when the transform has finished changing
   */
  public setTransformAsync(t2: TransformProps, duration: number = 0): Promise<TransformProps> {
    // Avoid tiny or out of bounds rotations
    t2.r = numWrap((+(t2.r || 0).toFixed(3)), 0, TAU);   // radians

    const gfx = this.context.systems.gfx;
    return gfx!.setTransformAsync(t2, duration);
  }


  /**
   * Set loc, zoom, and rotation at the same time.
   * @param  loc2      [lon,lat] to set the center to
   * @param  z2        Number to set the zoom to
   * @param  r2        Number to set the rotation to (in radians)
   * @param  duration  Duration of the transition in milliseconds, defaults to 0ms (asap)
   * @return this
   */
  public setMapParams(loc2?: Vec2, z2?: number, r2?: number, duration: number = 0): this {
    const context = this.context;
    const view = context.viewport;
    const center = view.center();
    const loc1 = view.centerLoc();
    const t1 = view.transform;
    const z1 = t1.zoom;
    const r1 = t1.r;

    if (loc2 === undefined) loc2 = loc1;
    if (z2 === undefined)   z2 = z1;
    if (r2 === undefined)   r2 = r1;

    // Bounds and precision checks
    loc2[0] = numClamp(loc2[0] || 0, -180, 180);
    loc2[1] = numClamp(loc2[1] || 0, -90, 90);
    z2 = numClamp((+(z2 || 0).toFixed(2)), MIN_Z, MAX_Z);
    r2 = numWrap((+(r2 || 0).toFixed(3)), 0, TAU);  // radians

    if (loc2[0] === loc1[0] && loc2[1] === loc1[1] && z2 === z1 && r2 === r1) {  // nothing to do
      return this;
    }

    // convert that coordinate back to screen coordinate at z2
    // worldToScreen formula: screen = (world - WORLD_HALF) * 2^(z - WORLD_ZOOM) + [tx, ty]
    // For center to land on `world`: tx = center - (world - WORLD_HALF) * k2 / 2^WORLD_ZOOM
    const world = projWgs84ToWorld(loc2);
    const k2 = 2 ** z2;
    const x2 = -((world[0] - WORLD_HALF) * k2 / WORLD_SCALE) + center[0];
    const y2 = -((world[1] - WORLD_HALF) * k2 / WORLD_SCALE) + center[1];

    return this.transform({ x: x2, y: y2, z: z2, r: r2 }, duration) as this;
  }


  /**
   * Promise-returning version of `setMapParams()`
   * @param  loc2      [lon,lat] to set the center to
   * @param  z2        Number to set the zoom to
   * @param  r2        Number to set the rotation to (in radians)
   * @param  duration  Duration of the transition in milliseconds, defaults to 0ms (asap)
   * @return Promise that resolves when the transform has finished changing
   */
  public setMapParamsAsync(loc2?: Vec2, z2?: number, r2?: number, duration: number = 0): Promise<TransformProps> {
    const context = this.context;
    const view = context.viewport;
    const center = view.center();
    const loc1 = view.centerLoc();
    const t1 = view.transform;
    const z1 = t1.zoom;
    const r1 = t1.r;

    if (loc2 === undefined) loc2 = loc1;
    if (z2 === undefined)   z2 = z1;
    if (r2 === undefined)   r2 = r1;

    // Bounds and precision checks
    loc2[0] = numClamp(loc2[0] || 0, -180, 180);
    loc2[1] = numClamp(loc2[1] || 0, -90, 90);
    z2 = numClamp((+(z2 || 0).toFixed(2)), MIN_Z, MAX_Z);
    r2 = numWrap((+(r2 || 0).toFixed(3)), 0, TAU);  // radians

    if (loc2[0] === loc1[0] && loc2[1] === loc1[1] && z2 === z1 && r2 === r1) {  // nothing to do
      return Promise.resolve(t1);
    }

    // convert that coordinate back to screen coordinate at z2
    // worldToScreen formula: screen = (world - WORLD_HALF) * 2^(z - WORLD_ZOOM) + [tx, ty]
    // For center to land on `world`: tx = center - (world - WORLD_HALF) * k2 / 2^WORLD_ZOOM
    const world = projWgs84ToWorld(loc2);
    const k2 = 2 ** z2;
    const x2 = -((world[0] - WORLD_HALF) * k2 / WORLD_SCALE) + center[0];
    const y2 = -((world[1] - WORLD_HALF) * k2 / WORLD_SCALE) + center[1];

    return this.setTransformAsync({ x: x2, y: y2, z: z2, r: r2 }, duration);
  }


  /**
   * Set/Get the map center
   * @param  loc2      [lon,lat] to set the center to
   * @param  duration  Duration of the transition in milliseconds, defaults to 0ms (asap)
   * @return map center -or- this
   */
  public center(loc2?: Vec2, duration?: number): Vec2 | this {
    if (loc2 === undefined) {
      return this.centerLoc();
    } else {
      return this.setMapParams(loc2, undefined, undefined, duration ?? 0);
    }
  }


  /**
   * Set/Get the map zoom
   * @param  z2        Number to set the zoom to
   * @param  duration  Duration of the transition in milliseconds, defaults to 0ms (asap)
   * @return map zoom -or- this
   */
  public zoom(z2?: number, duration?: number): number | this {
    if (z2 === undefined) {
      return this.context.viewport.transform.zoom;
    } else {
      return this.setMapParams(undefined, z2, undefined, duration ?? 0);
    }
  }


  /**
   * Pan the map by given pixel amount
   * @param  delta     [dx,dy] amount to pan the map
   * @param  duration  Duration of the transition in milliseconds, defaults to 0ms (asap)
   * @return this
   */
  public pan(delta: Vec2, duration: number = 0): this {
    const t = this.context.viewport.transform;
    const [dx, dy] = vecRotate(delta, -t.r, [0, 0]);   // remove any rotation
    return this.transform({ x: t.x + dx, y: t.y + dy, z: t.z, r: t.r }, duration) as this;
  }


  /**
   * Adjust the map to fit to see the given entity or entities
   * @param  entities  Entity or Array of entities to fit in the map view
   * @param  duration  Duration of the transition in milliseconds, defaults to 0ms (asap)
   * @return this
   */
  public fitEntities(entities: OsmEntity | OsmEntity[], duration: number = 0): this {
    let extent;

    const editor = this.context.systems.editor;
    const graph = editor!.staging.graph;

    if (Array.isArray(entities)) {
      extent = utilTotalExtent(entities, graph);
    } else {
      extent = entities.extent();
    }
    if (!extent || !isFinite(extent.area())) return this;

    const z2 = numClamp(this.trimmedExtentZoom(extent), 0, 20);
    return this.setMapParams(extent.center(), z2, undefined, duration);
  }


  /**
   * Selects an entity by ID, loading it first if needed
   * @param  entityID  - entityID to select
   * @param  fitEntity - Whether to force fit the map view to show the entity
   */
  public selectEntityID(entityID: EntityID, fitEntity: boolean = false): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const scene = context.systems.gfx!.scene!;
    const viewport = context.viewport;

    if (!entityID) {
      context.enter('browse');
      return;
    }

    const gotEntity = (entity: OsmEntity) => {
      const selectedIDs = context.selectedIDs();
      if (context.mode?.id !== 'select-osm' || !selectedIDs.includes(entityID)) {
        scene.enableLayers('osm');
        context.enter('select-osm', { selection: { osm: [entity.id] }} );
      }

      const entityExtent = entity.extent();
      if (!entityExtent) return;
      const entityZoom = Math.min(this.trimmedExtentZoom(entityExtent), 20);  // the zoom that best shows the entity
      const isOffscreen = (entityExtent.percentContainedIn(viewport.visibleExtent()) < 0.8);
      const isTooSmall = (viewport.transform.zoom < entityZoom - 2);

      // Can't reasonably see it, or we're forcing the fit.
      if (fitEntity || isOffscreen || isTooSmall) {
        this.fitEntities(entity);
      }
    };

    const currGraph = editor.staging.graph;
    let entity = currGraph.hasEntity(entityID);
    if (entity) {   // have it already
      gotEntity(entity);
    } else {   // need to load it first
      context.loadEntityAsync(entityID)
        .then(() => {  // At this point we expect it to be merged..
          entity = currGraph.hasEntity(entityID);
          if (!entity) return;  // give up
          gotEntity(entity);
        });
    }
  }


  /**
   * Selects a note by ID, loading it first if needed
   * @param  noteID  - noteID to select
   */
  public selectNoteID(noteID: number | string): void {
    const context = this.context;
    const osm = context.services.osm as any;
    const scene = context.systems.gfx!.scene!;

    if (!noteID || !osm) {
      context.enter('browse');
      return;
    }

    osm.loadNoteAsync(noteID)
      .then((note: MarkerData) => {
        if (!note.loc) return;
        scene.enableLayers('notes');
        const selection = new Map<DataID, MarkerData>().set(note.id, note);
        context.enter('select', { selection: selection });
        this.centerZoomEase(note.loc, 19);
      });
  }


  // convenience methods for zooming in and out
  /**
   * Zooms in by the given number of zoom levels with a short ease.
   * @param delta - Number of zoom levels to add
   * @return  `this` for chaining
   */
  protected _zoomIn(delta: number): this  { return this.setMapParams(undefined, ~~(this.zoom() as number) + delta, undefined, 250); }
  /**
   * Zooms out by the given number of zoom levels with a short ease.
   * @param delta - Number of zoom levels to subtract
   * @return  `this` for chaining
   */
  protected _zoomOut(delta: number): this { return this.setMapParams(undefined, ~~(this.zoom() as number) - delta, undefined, 250); }

  /** Zooms in by 1 zoom level with a short ease.
   * @return  `this` for chaining
   */
  public zoomIn(): this        { return this._zoomIn(1); }
  /** Zooms in by 4 zoom levels with a short ease.
   * @return  `this` for chaining
   */
  public zoomInFurther(): this { return this._zoomIn(4); }
  /** Returns `true` if the map can still zoom in (i.e. current zoom < MAX_Z).
   * @return  `true` if the map can zoom in further
   */
  public canZoomIn(): boolean  { return (this.zoom() as number) < MAX_Z; }

  /** Zooms out by 1 zoom level with a short ease.
   * @return  `this` for chaining
   */
  public zoomOut(): this        { return this._zoomOut(1); }
  /** Zooms out by 4 zoom levels with a short ease.
   * @return  `this` for chaining
   */
  public zoomOutFurther(): this { return this._zoomOut(4); }
  /** Returns `true` if the map can still zoom out (i.e. current zoom > MIN_Z).
   * @return  `true` if the map can zoom out further
   */
  public canZoomOut(): boolean  { return (this.zoom() as number) > MIN_Z; }

  /**
   * Sets the map center and zoom (no easing).
   * @param loc2 - Target center as `[lon, lat]`
   * @param z2 - Target zoom level
   * @param duration - Transition duration in milliseconds (default 0)
   * @return  `this` for chaining
   */
  public centerZoom(loc2: Vec2, z2: number, duration: number = 0): this  { return this.setMapParams(loc2, z2, undefined, duration); }

  // convenience methods for the above, but with easing
  /**
   * Eases the map to the given transform.
   * @param t2 - Target transform properties
   * @param duration - Transition duration in milliseconds (default 250)
   * @return  The current transform, or `this` for chaining
   */
  public transformEase(t2: TransformProps, duration: number = 250): TransformProps | this  { return this.transform(t2, duration); }
  /**
   * Eases the map to the given center and zoom.
   * @param loc2 - Target center as `[lon, lat]`
   * @param z2 - Target zoom level
   * @param duration - Transition duration in milliseconds (default 250)
   * @return  `this` for chaining
   */
  public centerZoomEase(loc2: Vec2, z2: number, duration: number = 250): this  { return this.setMapParams(loc2, z2, undefined, duration); }
  /**
   * Eases the map to the given center, keeping the current zoom.
   * @param loc2 - Target center as `[lon, lat]`
   * @param duration - Transition duration in milliseconds (default 250)
   * @return  `this` for chaining
   */
  public centerEase(loc2: Vec2, duration: number = 250): this  { return this.setMapParams(loc2, undefined, undefined, duration); }
  /**
   * Eases the map to the given zoom, keeping the current center.
   * @param z2 - Target zoom level
   * @param duration - Transition duration in milliseconds (default 250)
   * @return  `this` for chaining
   */
  public zoomEase(z2: number, duration: number = 250): this  { return this.setMapParams(undefined, z2, undefined, duration); }
  /**
   * Eases the map to fit the given entities within the view.
   * @param entities - A single entity or array of entities to fit
   * @param duration - Transition duration in milliseconds (default 250)
   * @return  `this` for chaining
   */
  public fitEntitiesEase(entities: any | any[], duration: number = 250): this  { return this.fitEntities(entities, duration); }


  /**
   * The "effective" zoom can be more useful for controlling the experience of the user.
   * This zoom is adjusted by latitude.
   * You can think of it as "what the zoom would be if we were editing at the equator"
   * For example, if we are editing in Murmansk, Russia, at about 69° North latitude,
   *  a true zoom of 14.6 corresponds to an effective zoom of 16.
   * Put another way, even at z14.6 the user should be allowed to edit the map,
   *  and it should be styled as if it were z16.
   *
   * @return  effective zoom
   */
  public effectiveZoom(): number {
    const viewport = this.context.viewport;
    const lat = viewport.centerLoc()[1];
    const z = viewport.transform.zoom;
    // geoMetersToLon(1, lat) ∝ 1/cos(lat), so the ratio to equator (cos=1) is just sec(lat).
    // extraZoom = log2(1 / cos(lat)) = -log2(cos(lat))
    const extraZoom = -Math.log2(Math.cos(lat * DEG2RAD));
    return Math.min(z + extraZoom, MAX_Z);
  }


  /**
   * Set/Get the map extent
   * @param  extent  Extent Object to fit the map to
   * @return map extent -or- this
   */
  public extent(extent?: Extent): Extent | this {
    if (extent === undefined) {
      return this.context.viewport.visibleExtent();
    } else {
      return this.setMapParams(extent.center(), this.extentZoom(extent));
    }
  }


  /**
   * Set/Get the map extent, but include some padding for header, footer, etc.
   * @param  extent  Extent Object to fit the map to
   * @return map extent -or- this
   */
  public trimmedExtent(extent?: Extent): Extent | this {
    if (extent === undefined) {
      const headerY = 72;
      const footerY = 30;
// Add 50px overscan experiment, see UISystem.js
// Maybe find a nicer way to include overscan and view padding into places like this.
      // const pad = 10;
      const pad = 70;
      const viewport = this.context.viewport;
      const [w, h] = viewport.dimensions;

      return new Extent(
        viewport.unproject([pad, h - footerY - pad]),  // bottom-left
        viewport.unproject([w - pad, headerY + pad])   // top-right
      );
    } else {
      return this.setMapParams(extent.center(), this.trimmedExtentZoom(extent));
    }
  }


  /**
   * Returns the maximum zoom that will fit the given extent in the map viewport.
   * @param  extent      Extent Object to fit
   * @param  dimensions  [width, height] to fit it in (defaults to viewport)
   * @return zoom
   */
  public extentZoom(extent: Extent, dimensions?: Vec2): number {
    const viewport = this.context.viewport;
    const [w, h] = dimensions || viewport.dimensions;

    const tl = viewport.project([extent.min[0], extent.max[1]]);
    const br = viewport.project([extent.max[0], extent.min[1]]);

    // Calculate maximum zoom that fits extent
    const hFactor = (br[0] - tl[0]) / w;
    const vFactor = (br[1] - tl[1]) / h;
    const hZoomDiff = Math.log(Math.abs(hFactor)) / Math.LN2;
    const vZoomDiff = Math.log(Math.abs(vFactor)) / Math.LN2;
    const zoomDiff = Math.max(hZoomDiff, vZoomDiff);

    const currZoom = viewport.transform.zoom;
    const defaultZoom = Math.max(currZoom, 19);

    return isFinite(zoomDiff) ? (currZoom - zoomDiff) : defaultZoom;
  }


  /**
   * Returns the maximum zoom that will fit the given extent in the map viewport,
   *   but zoomed out slightly to account for header, footer, etc.
   * @param  extent  Extent Object to fit
   * @return zoom
   */
  public trimmedExtentZoom(extent: Extent): number {
// Add 50px overscan experiment, see UISystem.js
// Maybe find a nicer way to include overscan and view padding into places like this.
    const trimW = 140;
    const trimH = 240;
    //const trimW = 40;
    //const trimH = 140;

    const viewport = this.context.viewport;
    const trimmed = vecSubtract(viewport.dimensions, [trimW, trimH]);
    return this.extentZoom(extent, trimmed);
  }


  /**
   * set/get whether to show edited features in a special style
   * @return  `true` if edited features are highlighted
   */
  public get highlightEdits(): boolean {
    return this._highlightEdits;
  }
  /** Sets the `highlightEdits` flag and triggers a scene redraw.
   * @param val - `true` to highlight edited features, `false` to use normal styling
   */
  public set highlightEdits(val: boolean) {
    if (this._highlightEdits === val) return;  // no change

    this._highlightEdits = val;

    const gfx = this.context.systems.gfx!;
    gfx.scene!.dirtyScene();
    gfx.immediateRedraw();
    this.emit('mapchange');
  }


  /**
   * set/get the area fill mode - one of 'full', 'partial' (default), or 'wireframe'
   * @return  Current area fill mode
   */
  public get areaFillMode(): AreaFillMode {
    return this._currFillMode;
  }
  /** Sets the area fill mode ('full', 'partial', or 'wireframe') and persists it to storage.
   * @param val - Desired fill mode: `'full'`, `'partial'`, or `'wireframe'`
   */
  public set areaFillMode(val: AreaFillMode) {
    const context = this.context;
    const gfx = context.systems.gfx!;
    const settings = context.systems.settings;

    const current = this._currFillMode;
    if (current === val) return;  // no change

    if (current !== 'wireframe') {
      this._toggleFillMode = current;
      settings?.set('map.areaFillToggle', current);  // remember the previous *non-wireframe* fill mode
    }

    this._currFillMode = val;
    settings?.set('map.areaFill', val);

    gfx.scene!.dirtyScene();
    gfx.immediateRedraw();
    this.emit('mapchange');
  }


  /**
   * set/get whether the area fill mode is set to 'wireframe'
   * @return  `true` if wireframe mode is active
   */
  public get wireframeMode(): boolean {
    return this._currFillMode === 'wireframe';
  }
  /** Switches wireframe mode on/off (preserves last non-wireframe fill mode for toggle-back).
   * @param val - `true` to enter wireframe mode, `false` to restore the previous fill mode
   */
  public set wireframeMode(val: boolean) {
    if (val) {
      if (this.areaFillMode !== 'wireframe') {
        this.areaFillMode = 'wireframe';
      }
    } else {
      this.areaFillMode = this._toggleFillMode;  // go back to the previous *non-wireframe* fill mode
    }
  }

}
