import { AbstractSystem } from './AbstractSystem.ts';
import {
  DEG2RAD, RAD2DEG, TAU, Extent, numClamp, numWrap, projWgs84ToWorld,
  vecLength, vecRotate, vecSubtract, Viewport, WORLD_HALF, WORLD_SCALE } from '@rapid-sdk/math';
import { MarkerData } from '../data/MarkerData.ts';
import { osmEntityID } from '../data/dataID.ts';
import { selection } from 'd3-selection';
import { utilArrayIdentical, utilArrayUniq } from '@rapid-sdk/util';
import { utilTotalExtent } from '../util/util.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { Difference } from '../lib/Difference.ts';
import type { Edit } from '../lib/Edit.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { TransformProps, Vec2 } from '@rapid-sdk/math';

type AreaFillMode = 'wireframe' | 'partial' | 'full';

const MIN_Z = 2;
const MAX_Z = 24;
/**
 * When showing a change: at this zoom or closer, a change counts as visible.
 * And don't zoom out past this (or past where the user already is) just to fit all of a large change.
 */
const SHOW_MIN_Z = 16;


/**
 * `MapSystem` maintains the map state and provides an interface for manipulating the map view.
 *
 * Properties available:
 * - `highlightEdits` - `true` if edited features should be shown in a special style, `false` otherwise
 * - `areaFillMode`   - one of 'full', 'partial' (default), or 'wireframe'
 * - `wireframeMode`  - `true` if fill mode is 'wireframe', `false` otherwise
 *
 * Events available:
 * - `mapchange` - Fires on any change in map display options (wireframe/areafill, highlightedits)
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
  /** Counts selections restored after undo/redo, so a late one for an older jump gives up */
  protected _selectCount: number;

  /** D3 selection of the parent container element that holds the map canvas */
  public $parent: D3Selection | null;


  /**
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
    this._selectCount = 0;

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

    // Settings that follow the user to other browsers
    settings?.registerSync(['map.areaFill', 'map.areaFillToggle']);

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
            this._historyJumped(prevIndex, currIndex);
          })
          .on('returnview', (edit: Edit) => {
            this._returnViewed(edit);
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
    const keyboard = context.systems.keyboard!;
    const l10n = context.systems.l10n;
    if (!l10n) return;

    if (Array.isArray(this._keys)) {
      keyboard.global.off(this._keys);
    }

    const wireframeKey = l10n.t('shortcuts.command.wireframe.key');
    const highlightEditsKey = l10n.t('shortcuts.command.highlight_edits.key');
    this._keys = [wireframeKey, highlightEditsKey];

    keyboard.global
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
    if (newIds !== oldIds && context.mode?.id !== 'save') {
      const ids = (newIds ?? '').split(',').map(s => s.trim()).filter(Boolean);
      this._restoreSelection(ids, true);   // no ids: browse
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
    const [datum] = context.selectedData().values();  // get the first thing in the Map()
    if (datum instanceof MarkerData && datum.serviceID === 'osm') {
      noteID = datum.id;   // the note's own ID, not its data ID
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
   * Respond to undo, redo and restore: show where the change is, and restore the selection.
   * Undo shows the edit it took back and what was selected before it; redo (or restore) shows the
   * edit it brought back and what was selected after it.
   * See "Showing what changed (viewport)" in `design/edit-system.md`.
   * @param  prevIndex - The history index before the jump
   * @param  currIndex - The history index after the jump
   */
  protected _historyJumped(prevIndex: number, currIndex: number): void {
    const context = this.context;
    const editor = context.systems.editor!;

    const history = editor.history;
    const isUndo = (currIndex < prevIndex && !!history[prevIndex]);
    const edit = isUndo ? history[prevIndex] : history[currIndex];
    if (!edit) return;

    // Same index: only the work in progress was thrown away (e.g. undo while dragging),
    // so there's nothing to show.  Entering a mode below still ends the drag.
    if (prevIndex !== currIndex) {
      const props = edit.props;
      const extent = props.extent && new Extent([props.extent[0], props.extent[1]], [props.extent[2], props.extent[3]]);
      let t2: TransformProps | null = null;
      if (extent) {
        t2 = this.viewForExtent(extent, props.transform);
      } else if (props.transform) {   // e.g. an edit from an older backup
        t2 = props.transform;
      }
      if (t2) {
        this._easeTo(t2);
      }

      // Redo back to the newest edit: if that leaves the map where the user was before they started
      // undoing, the extra redo to take them back isn't needed.
      const returnEdit = editor.returnEdit;
      const returnTransform = returnEdit?.props.transform;
      if (!isUndo && currIndex === history.length - 1 && returnTransform) {
        const t = t2 ?? context.viewport.transform.props;
        if (this._isSameView(t, returnTransform)) {
          editor.clearReturnEdit();
        }
      }
    }

    // Note: draw modes need to do a little extra work to survive this,
    //  so they have their own `historyjump` listeners.
    const modeID = context.mode?.id ?? '';
    if (/^draw/.test(modeID)) return;

    const selection = (isUndo ? edit.props.selectionBefore : edit.props.selection) ?? [];
    this._restoreSelection(selection);
  }


  /**
   * Respond to the extra redo past the newest edit: go back to where the user was before they
   * started undoing, with what they had selected.
   * @param  edit - The return Edit, with the `transform` and `selection` to go back to
   */
  protected _returnViewed(edit: Edit): void {
    const context = this.context;

    const t2 = edit.props.transform;
    if (t2) {
      this._easeTo(t2);
    }

    const modeID = context.mode?.id ?? '';
    if (/^draw/.test(modeID)) return;

    this._restoreSelection(edit.props.selection ?? []);
  }


  /**
   * Select what's in the given selection, or go to browse mode if none of it can be found.
   * OSM entities must be in the stable graph.  Other data is found by its data ID
   * (`SpatialSystem.getData`). Data that comes back on undo may not be there yet (a Rapid feature
   * that's loaded again, or a piece of a line that conflation makes when the line is drawn), so this
   * tries again after the next redraws, adding what it finds to the selection.
   * A selection from a link (`id=` in the URL) also downloads the OSM entities that aren't loaded yet,
   * turns on the OSM layer, and moves the map to them if they aren't in view.  Its other data is
   * selected when it loads (for that, its layer must be on and the data in view), so it waits longer.
   * @param  selection - Data IDs, e.g. `['w1', 'fbRoads:abc']`
   * @param  fromLink - `true` if the selection is from a link
   */
  protected _restoreSelection(selection: DataID[], fromLink: boolean = false): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const gfx = context.systems.gfx!;
    const scene = gfx.scene!;
    const spatial = context.systems.spatial!;

    const count = ++this._selectCount;
    selection = utilArrayUniq(selection.map(dataID => osmEntityID(dataID) ?? dataID));   // `osm:w1` is `w1`
    const isFound = (dataID: DataID): boolean => {
      return osmEntityID(dataID) ? !!editor.stable.graph.hasEntity(dataID) : !!spatial.getData(dataID);
    };

    // OSM entities are in the graph or not, so only other data can arrive later,
    // unless the selection is from a link, which downloads the OSM entities it doesn't have.
    // (Only entities from the OSM API: new ones, like `w-1`, can't be downloaded.)
    const toLoad = fromLink ? selection.filter(dataID => /^[nwr][1-9]\d*$/.test(dataID) && !isFound(dataID)) : [];
    const waiting = new Set<DataID>(selection.filter(dataID => {
      return osmEntityID(dataID) ? toLoad.includes(dataID) : !isFound(dataID);
    }));

    // Whether this is still what's selected (nothing else was selected since, and the user didn't move on)
    let found: DataID[] = [];
    const isCurrent = (): boolean => {
      if (count !== this._selectCount) return false;
      const modeID = found.length ? 'select' : 'browse';
      return context.mode?.id === modeID && utilArrayIdentical(context.selectedIDs(), found);
    };

    // Select what's found, if that's more than before
    const selectFound = (): void => {
      const nowFound = selection.filter(isFound);
      for (const dataID of nowFound) {
        waiting.delete(dataID);
      }
      if (nowFound.length <= found.length) return;

      found = nowFound;
      const graph = editor.staging.graph;
      const entities = found
        .map(dataID => osmEntityID(dataID) ? graph.hasEntity(dataID) : undefined)
        .filter((entity): entity is OsmEntity => !!entity);
      if (fromLink && entities.length) {
        scene.enableLayers('osm');
      }

      context.enter('select', { selection: found });

      if (fromLink && entities.length) {
        const extent = utilTotalExtent(entities, graph);
        if (!this.showsExtent(extent)) {
          this.fitEntities(entities);
        }
      }
    };

    selectFound();
    if (!found.length) {
      context.enter('browse');
    }

    if (toLoad.length) {
      Promise.allSettled(toLoad.map(entityID => context.loadEntityAsync(entityID)))
        .then(() => {
          for (const entityID of toLoad) {
            waiting.delete(entityID);   // loaded, or not there to load
          }
          if (isCurrent()) selectFound();
        });
    }

    if (!waiting.size) return;

    const MAX_TRIES = 5;          // on undo, the data is in its cache already, or made when it's drawn
    const MAX_WAIT_MS = 30000;    // from a link, the data may still be downloading
    const giveUpAt = performance.now() + MAX_WAIT_MS;
    let tries = 0;
    const trySelect = (): boolean => {
      // Give up if another selection was restored since, or the user moved on to something else
      if (!isCurrent()) return true;

      selectFound();
      if (!waiting.size) return true;
      return fromLink ? (performance.now() > giveUpAt) : (++tries >= MAX_TRIES);
    };

    const onDraw = () => {
      if (trySelect()) gfx.off('draw', onDraw);
    };
    gfx.on('draw', onDraw);
  }


  /**
   * Whether the given view shows the given extent well enough that we don't need to move the map:
   * most of it is in the part of the map not covered by the header and footer, and the map isn't
   * zoomed so far out that it's hard to see.  An extent too big to fit counts if any of it is in view.
   * @param  extent - Extent to check, in WGS84 lon/lat
   * @param  t - The view to check (defaults to the current view)
   * @return `true` if the view shows the extent well enough
   */
  public showsExtent(extent: Extent, t?: TransformProps): boolean {
    const viewport = this.context.viewport;
    const view = t ? new Viewport(t, viewport.dimensions) : viewport;

    const z = view.transform.zoom;
    const best = this._bestZoom(extent);
    if (z < this._minShowZoom(extent)) return false;   // too far out to see it

    const visible = this._trimmedExtentOf(view);
    if (z <= best) {
      return extent.percentContainedIn(visible) >= 0.8;
    } else {
      return extent.intersects(visible);   // too big to fit: any of it in view counts
    }
  }


  /**
   * Decide where the map should go to show the given extent, moving only when needed.
   * - If the current view shows the extent well enough, don't move.
   * - Otherwise, if the given transform (e.g. where the user was when they made the edit) shows it, go there.
   * - Otherwise, center on it, keeping the current zoom where possible: zoom out only to fit it
   *   (but not past `SHOW_MIN_Z`), and zoom in only as far as needed to see it.
   * @param  extent - Extent to show, in WGS84 lon/lat
   * @param  transform - A view to prefer, if it shows the extent
   * @return The transform to go to, or `null` if the map doesn't need to move
   */
  public viewForExtent(extent: Extent, transform?: TransformProps): TransformProps | null {
    const viewport = this.context.viewport;

    if (this.showsExtent(extent)) return null;
    if (transform && this.showsExtent(extent, transform)) return transform;

    const t1 = viewport.transform;
    const best = this._bestZoom(extent);
    let z = t1.zoom;
    if (z > best) z = best;                                       // too far in to fit it
    z = Math.max(z, Math.min(t1.zoom, SHOW_MIN_Z));               // but don't zoom way out for it
    z = Math.max(z, this._minShowZoom(extent));                   // too far out to see it

    return this._transformFor(extent.center(), z, t1.r);
  }


  /**
   * Show the given extent, moving the map only when needed (see `viewForExtent`).
   * Nearby moves ease; far moves jump, since a long ease across the map is just a blur.
   * @param  extent - Extent to show, in WGS84 lon/lat
   * @param  transform - A view to prefer, if it shows the extent
   * @return Promise that resolves `true` if the map moved, `false` if not
   */
  public showExtentAsync(extent: Extent, transform?: TransformProps): Promise<boolean> {
    const t2 = this.viewForExtent(extent, transform);
    if (!t2) return Promise.resolve(false);
    return this._easeTo(t2).then(() => true);
  }


  /**
   * How long to take moving the map to the given location and zoom, by how far it is in screens
   * (measured at the lower of the two zooms) and how much the zoom changes.
   * @param  loc2 - Target center as `[lon, lat]`
   * @param  z2 - Target zoom (defaults to the current zoom)
   * @return Milliseconds: 0 if nothing changes, 250 within about a screen, 500 within a few, 1000 beyond
   */
  public easeDuration(loc2: Vec2, z2?: number): number {
    const viewport = this.context.viewport;
    const z1 = viewport.transform.zoom;
    z2 ??= z1;

    const screens = this._screensBetween(viewport.centerLoc(), loc2, Math.min(z1, z2));
    const dz = Math.abs(z2 - z1);

    if (screens < 0.01 && dz < 0.01) {
      return 0;
    } else if (screens <= 1 && dz <= 1) {
      return 250;
    } else if (screens <= 4 && dz <= 2) {
      return 500;
    } else {
      return 1000;
    }
  }


  /**
   * Move the map to the given transform: ease if it's nearby, jump if it's far.
   * @param  t2 - Transform to go to
   * @return Promise that resolves when the map has finished moving
   */
  protected _easeTo(t2: TransformProps): Promise<TransformProps> {
    const viewport = this.context.viewport;
    const loc2 = new Viewport(t2, viewport.dimensions).centerLoc();
    const ms = this.easeDuration(loc2, t2.z);
    return this.setTransformAsync({ ...t2 }, (ms >= 1000) ? 0 : ms);
  }


  /**
   * Whether two views are about the same: centers within a quarter screen, and zooms within one level.
   * @param  t1 - A transform
   * @param  t2 - Another transform
   * @return `true` if the views are about the same
   */
  protected _isSameView(t1: TransformProps, t2: TransformProps): boolean {
    const viewport = this.context.viewport;
    const loc1 = new Viewport(t1, viewport.dimensions).centerLoc();
    const loc2 = new Viewport(t2, viewport.dimensions).centerLoc();
    return Math.abs(t1.z - t2.z) < 1 && this._screensBetween(loc1, loc2, Math.min(t1.z, t2.z)) < 0.25;
  }


  /**
   * How many screens apart two locations are at the given zoom.
   * @param  loc1 - A location as `[lon, lat]`
   * @param  loc2 - Another location as `[lon, lat]`
   * @param  z - The zoom to measure at
   * @return The distance, in screens (the smaller of the viewport's width and height)
   */
  protected _screensBetween(loc1: Vec2, loc2: Vec2, z: number): number {
    const viewport = this.context.viewport;
    const [w, h] = viewport.dimensions;
    const screen = Math.max(1, Math.min(w, h));
    const scale = 2 ** (z - viewport.transform.zoom);   // pixels at `z` per pixel now
    const pixels = vecLength(viewport.project(loc1), viewport.project(loc2)) * scale;
    return pixels / screen;
  }


  /**
   * The zoom that best shows the given extent: fitting it in the trimmed view, but no closer than z20.
   * @param  extent - Extent to show
   * @return The zoom
   */
  protected _bestZoom(extent: Extent): number {
    return numClamp(this.trimmedExtentZoom(extent), MIN_Z, 20);
  }


  /**
   * The zoom below which the given extent is too small to see: 2 levels out from the best zoom,
   * but any change counts as visible at `SHOW_MIN_Z` or closer.
   * @param  extent - Extent to show
   * @return The zoom
   */
  protected _minShowZoom(extent: Extent): number {
    return Math.min(this._bestZoom(extent) - 2, SHOW_MIN_Z);
  }


  /**
   * The transform that centers the map on the given location at the given zoom and rotation.
   * @param  loc - Center as `[lon, lat]`
   * @param  z - Zoom
   * @param  r - Rotation, in radians
   * @return The transform
   */
  protected _transformFor(loc: Vec2, z: number, r: number): TransformProps {
    const center = this.context.viewport.center();
    // worldToScreen formula: screen = (world - WORLD_HALF) * 2^(z - WORLD_ZOOM) + [tx, ty]
    // For center to land on `world`: tx = center - (world - WORLD_HALF) * k / 2^WORLD_ZOOM
    const world = projWgs84ToWorld(loc);
    const k = 2 ** z;
    const x = -((world[0] - WORLD_HALF) * k / WORLD_SCALE) + center[0];
    const y = -((world[1] - WORLD_HALF) * k / WORLD_SCALE) + center[1];
    return { x: x, y: y, z: z, r: r };
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

    return this.transform(this._transformFor(loc2, z2, r2), duration) as this;
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

    return this.setTransformAsync(this._transformFor(loc2, z2, r2), duration);
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
      if (context.mode?.id !== 'select' || !selectedIDs.includes(entityID)) {
        scene.enableLayers('osm');
        context.enter('select', { selection: [entity.id] });
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
        context.enter('select', { selection: [note.dataID] });
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
      return this._trimmedExtentOf(this.context.viewport);
    } else {
      return this.setMapParams(extent.center(), this.trimmedExtentZoom(extent));
    }
  }


  /**
   * The extent that the given view shows, with padding for header, footer, etc.
   * @param  view - The viewport to measure
   * @return The trimmed extent
   */
  protected _trimmedExtentOf(view: Viewport): Extent {
    const headerY = 72;
    const footerY = 30;
// Add 50px overscan experiment, see UISystem.js
// Maybe find a nicer way to include overscan and view padding into places like this.
    // const pad = 10;
    const pad = 70;
    const [w, h] = view.dimensions;

    return new Extent(
      view.unproject([pad, h - footerY - pad]),  // bottom-left
      view.unproject([w - pad, headerY + pad])   // top-right
    );
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
