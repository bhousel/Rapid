import { EventEmitter } from 'tseep';
import { select as d3_select } from 'd3-selection';
import { Viewport } from '@rapid-sdk/math';
import { utilUnicodeCharsTruncated } from '@rapid-sdk/util';

import { behaviors } from './behaviors/index.ts';
import { modes } from './modes/index.ts';
import { services } from './services/index.ts';
import { systems } from './core/index.ts';

import type { AbstractData } from './data/AbstractData.ts';
import type { AbstractMode } from './modes/AbstractMode.ts';
import type { Behaviors } from './behaviors/types.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from './lib/Graph.ts';
import type { Modes } from './modes/types.ts';
import type { Services } from './services/types.ts';
import type { Systems } from './core/types.ts';
import type { Vec2 } from '@rapid-sdk/math';
import { utilIterable, type OneOrMore } from './util/iterable.ts';
import { utilKeybinding, type Keybinding } from './util/keybinding.ts';

const MINZOOM = 15;


/**
 * Debug flags for enabling visual debugging overlays.
 */
export interface DebugFlags {
  /** Show tile boundaries */
  tile: boolean;
  /** Show label placement areas */
  label: boolean;
  /** Show imagery bounding polygons */
  imagery: boolean;
  /** Show touch targets */
  target: boolean;
  /** Show downloaded data from OSM */
  downloaded: boolean;
  /** Additional debug flags can be added dynamically */
  [key: string]: boolean;
}

/**
 * OAuth/authentication options for connecting to the OSM API.
 */
export interface PreauthOptions {
  url?: string;
  apiUrl?: string;
  access_token?: string;
  [key: string]: string | undefined;
}

/**
 * API connection configuration for the source switcher.
 */
export interface ApiConnection {
  id: string;
  url: string;
  apiUrl?: string;
  name?: string;
  oauth_consumer_key?: string;
  oauth_secret?: string;
  [key: string]: string | undefined;
}

/**
 * Service interface - for lifecycle management.
 * Services are now TypeScript, but this interface is used for loose lifecycle access.
 */
export interface Service {
  id: string;
  autoStart?: boolean;
  initAsync(): Promise<void>;
  startAsync(): Promise<void>;
  resetAsync(): Promise<void>;
}


/**
 * `Context` contains all the global application state for Rapid
 *  and contains references to all the core components.
 *
 * Events available:
 * - 'modechange'   Fires when changing modes - receives the new mode
 */
export class Context extends EventEmitter {
  /** Application version string (semver format) */
  public version: string;
  /** Version number for the privacy/welcome screen */
  public privacyVersion: number;
  /** Version number for the "what's new" screen */
  public whatsNewVersion: number;

  /** The url for the main rapid.js bundle. */
  public scriptURL: string | null;

  /** Build identifier from CI/CD */
  public buildID: string;
  /** Git SHA from CI/CD */
  public buildSHA: string;
  /** Build date from CI/CD */
  public buildDate: string;

  /** Maximum characters allowed for tag keys */
  public maxCharsForTagKey: number;
  /** Maximum characters allowed for tag values */
  public maxCharsForTagValue: number;
  /** Maximum characters allowed for relation roles */
  public maxCharsForRelationRole: number;

  /** Sequence counters for generating unique IDs */
  public sequences: Record<SequenceID, number>;

  /** Asset origin override ('latest' or 'local') */
  public assetOrigin: 'latest' | 'local' | null;
  /** Asset path override */
  public assetPath: string | null;
  /** Asset file replacement map */
  public assetMap: Record<string, string> | null;

  /** The map viewport (projection, pan, zoom) */
  public viewport: Viewport;
  /** Whether we're in the intro walkthrough */
  public inIntro: boolean;
  /** Container element (D3 selection) */
  public $container: D3Selection;

  /** All initialized systems */
  public systems: Systems;
  /** All initialized modes */
  public modes: Modes;
  /** All initialized behaviors */
  public behaviors: Behaviors;
  /** All initialized services */
  public services: Services;

  /** Currently active mode */
  protected _currMode: AbstractMode | null;
  /** Promise for prepare phase (construct + configure) */
  protected _preparePromise: Promise<void> | null;
  /** Promise for init phase */
  protected _initPromise: Promise<void> | null;
  /** Promise for start phase */
  protected _startPromise: Promise<void> | null;
  /** Promise for reset */
  protected _resetPromise: Promise<void> | null;

  /** Last pointer device type used */
  public lastPointerType: string;
  /** Keybinding manager */
  protected _keybinding: Keybinding;

  /** OAuth/preauth credentials */
  protected _preauth: PreauthOptions | null;
  /** API connections for source switcher */
  protected _apiConnections: ApiConnection[] | null;
  /** Pre-configured locale codes */
  protected _prelocale: string | string[] | null;

  /** Graph snapshot for copy operations */
  protected _copyGraph: Graph | null;
  /** Entity IDs for paste operations */
  protected _copyIDs: EntityID[];
  /** Location for paste operations */
  protected _copyLoc: Vec2 | null;

  /** Debug visualization flags */
  protected _debugFlags: DebugFlags;

  /** Whether embedded mode is enabled */
  protected _embed: boolean | null;


  /** Check if entity has hidden connections (set during init) */
  public hasHiddenConnections!: (entityID: EntityID) => boolean;
  /** Check if editing is allowed (set during init) */
  public editable!: () => boolean;

  /**
   * @constructor
   */
  public constructor() {
    super();

    // this.version = '2.5.3';             // see https://semver.org/ for examples
    this.version = '3.0.0-pre.0';    // see https://semver.org/ for examples

    // If user has not seen this version of our software, we will show them a modal at startup.
    // Just bump these dates to a higher number to get the screen to come back.
    this.privacyVersion = 20201202;    // whether to show the "welcome" screen
    this.whatsNewVersion = 20241222;   // whether show the "what's new" screen

    // The url for the main rapid.js bundle.
    this.scriptURL = (globalThis as any).Rapid?.scriptURL ?? null;

    // These may be set by our continuous deployment scripts, or left empty
    this.buildID = '';
    this.buildSHA = '';
    this.buildDate = '';

    this.maxCharsForTagKey = 255;
    this.maxCharsForTagValue = 255;
    this.maxCharsForRelationRole = 255;

    // Sequence Numbers - for places where we want a next number.
    this.sequences = {};

    // Assets
    this.assetOrigin = null;
    this.assetPath = null;
    this.assetMap = null;

    // Viewport (was: Projection)
    this.viewport = new Viewport();

    // "Systems" are the core components of Rapid.
    this.systems = {};

    // "Modes" are editing tasks that the user are allowed to perform.
    // Each mode is exclusive, i.e. only one mode can be active at a time.
    this.modes = {};
    this._currMode = null;

    // "Behaviors" are groups of event handlers that we can
    // enable and disable depending on what the user is doing.
    this.behaviors = {};

    // "Services" are components that get data from other places
    this.services = {};


    this._preparePromise = null;
    this._initPromise = null;
    this._startPromise = null;
    this._resetPromise = null;

    // User interface and keybinding
    // AFAICT `lastPointerType` is just used to localize the intro? for now - instead get this from pixi?
    // this.lastPointerType = () => _uiSystem.lastPointerType;
    this.lastPointerType = 'mouse';
    this._keybinding = utilKeybinding('context');
    d3_select(document).call(this._keybinding);

    // Connection
    this._preauth = null;
    this._apiConnections = null;
    this._prelocale = null;

    // Copy/Paste
    this._copyGraph = null;
    this._copyIDs = [];
    this._copyLoc = null;

    // Debug
    this._debugFlags = {
      tile: false,        // tile boundaries
      label: false,       // label placement
      imagery: false,     // imagery bounding polygons
      target: false,      // touch targets
      downloaded: false   // downloaded data from osm
    };

    // Container (a d3 selection)
    this.$container = d3_select(null);
    this._embed = null;

    // true/false whether we are in the intro walkthrough
    this.inIntro = false;
  }


  /**
   * Constructs all available components: systems, modes, behaviors, and services,
   * then applies any pre-init configuration (asset paths, locale, etc.).
   * After this resolves, all available components exist
   * and can be configured before calling `initAsync()`.
   * @return  Promise resolved when all components are constructed and configured
   */
  public prepareAsync(): Promise<void> {
    if (this._preparePromise) return this._preparePromise;

    // Construct all the core classes
    for (const [id, System] of systems.available) {
      this.systems[id] = new System(this);
    }

    // AssetSystem
    const assets = this.systems.assets;
    if (this.assetOrigin && assets)  assets.origin = this.assetOrigin;
    if (this.assetPath && assets)    assets.filePath = this.assetPath;
    if (this.assetMap && assets)     assets.fileReplacements = this.assetMap;

    // LocalizationSystem
    const l10n = this.systems.l10n;
    if (l10n && this._prelocale) {   // set preferred locale codes, if we have them
      l10n.preferredLocaleCodes = this._prelocale;
    }

    // FilterSystem
    const filters = this.systems.filters;
    this.hasHiddenConnections = (entityID: EntityID): boolean => {
      const editor = this.systems.editor;
      if (!editor || !filters) return false;
      const graph = editor.staging.graph!;
      const entity = graph.entity(entityID);
      return filters.hasHiddenConnections(entity, graph);
    };

    // MapSystem
    //const map = this.systems.map;
    this.editable = (): boolean => {
      const mode = this._currMode;
      if (!mode || mode.id === 'save') return false;      // don't allow editing during save
      return true;  // map.editableDataEnabled();  // todo: disallow editing if OSM layer is off
    };


    for (const [id, Mode] of modes.available) {
      this.modes[id] = new Mode(this);
    }

    for (const [id, Behavior] of behaviors.available) {
      this.behaviors[id] = new Behavior(this);
    }

    const isTestEnvironment = (!('window' in globalThis)) || ('assert' in globalThis) || ('expect' in globalThis);
    if (!isTestEnvironment) {
      for (const [id, Service] of services.available) {
        this.services[id] = new Service(this);
      }
    }

    return this._preparePromise = Promise.resolve();
  }


  /**
   * Initializes all systems and services.
   * Implicitly calls `prepareAsync()` first if it hasn't been called yet.
   * After this resolves, components are initialized and can accept configuration
   * (e.g. `merge()` calls for schema, styles, imagery), but are not yet running.
   * @return  Promise resolved when all components are initialized
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = this.prepareAsync()
      .then(() => {
        const allSystems = Object.values(this.systems).filter(s => !!s);
        const allServices = Object.values(this.services).filter(s => !!s);
        return Promise.all( allSystems.map(s => s.initAsync()) )
          .then(() => Promise.all( allServices.map(s => s.initAsync()) ))
          .then(() => {
            // Setup the osm connection if we have preauth credentials to use
            const osm = this.services.osm as any;
            return (osm && this._preauth) ? osm.switchAsync(this._preauth) : Promise.resolve();
          });
      })
      .then(() => {});  // void return
  }


  /**
   * Starts all systems and services that have `autoStart` enabled.
   * Implicitly calls `initAsync()` first if it hasn't been called yet.
   * After this resolves, Rapid is fully running.
   * @return  Promise resolved when Rapid is running
   */
  public startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    return this._startPromise = this.initAsync()
      .then(() => {
        const allSystems = Object.values(this.systems).filter(s => !!s);
        const allServices = Object.values(this.services).filter(s => !!s);
        return Promise.all( allSystems.map(s => s.autoStart ? s.startAsync() : Promise.resolve()) )
          .then(() => Promise.all( allServices.map(s => s.autoStart ? s.startAsync() : Promise.resolve()) ));
      })
      .then(() => {});  // void return
  }


  /**
   * Convenience method that calls `prepareAsync()`, `initAsync()`, and `startAsync()`.
   * Equivalent to calling `startAsync()` directly (which chains all steps),
   * but makes the intent clearer for simple use cases.
   * @return  Promise resolved when Rapid is fully running
   */
  public runAsync(): Promise<void> {
    return this.startAsync();
  }


  /**
   * Call after completing an edit session to reset any internal state.
   * @return  Promise resolved when Rapid is finished resetting
   */
  public resetAsync(): Promise<void> {
    if (this._resetPromise) return this._resetPromise;

    const allSystems = Object.values(this.systems).filter(s => !!s);
    const allServices = Object.values(this.services).filter(s => !!s);

    return this._resetPromise = Promise.resolve()
      .then(() => Promise.all( allSystems.map(s => s.resetAsync()) ))
      .then(() => Promise.all( allServices.map(s => s.resetAsync()) ))
      .then(() => {})  // void return
      .finally(() => { this._resetPromise = null; });
  }


  /**
   * Returns the keybinding manager for the application.
   * (not a System yet, but should be one)
   * @return  The keybinding manager
   */
  public keybinding(): Keybinding {
    return this._keybinding;
  }


  /**
   * OAuth/authentication credentials for connecting to the OSM API.
   * Set this before calling `initAsync()` to use preauth credentials.
   * @return  The OAuth/preauth credentials, or null if not set
   */
  public get preauth(): PreauthOptions | null {
    return this._preauth;
  }
  /**
   * Sets OAuth/preauth credentials; copies the object to prevent mutation.
   * @param options - OAuth/preauth credentials, or null to clear
   */
  public set preauth(options: PreauthOptions | null) {
    this._preauth = options ? { ...options } : null;  // copy and remember for init time
  }

  /**
   * Connection options for the source switcher (optional).
   * @return  The available API connections, or null if not configured
   */
  public get apiConnections(): ApiConnection[] | null     { return this._apiConnections; }
  /**
   * Sets the API connections list for the source switcher.
   * @param arr - Available API connections, or null to clear
   */
  public set apiConnections(arr: ApiConnection[] | null)  { this._apiConnections = arr; }


// TODO: For now, this must be set before init, and it will be passed
// to the LocalizationSystem after it has been created but before init.
// We should deprecate setting the locale through Context like this.
// Other methods that locale can be set include:
//  - `locale` param in the urlhash or
//  - directly accessing the LocalizationSystem
// and both of _those_ should be made dynamic so locale can switch while Rapid is running
  /**
   * A string or array of locale codes to prefer over the browser's settings.
   * Must be set before `initAsync()` is called.
   * @return  The preferred locale code(s), or null if not set
   * @deprecated  Set locale via urlhash param or LocalizationSystem instead
   */
  public get locale(): string | string[] | null     { return this._prelocale; }  // remember for init time
  /**
   * Sets the preferred locale codes; must be called before `initAsync()`.
   * @param val - Preferred locale code(s), or null to clear
   */
  public set locale(val: string | string[] | null)  { this._prelocale = val; }


  /**
   * Loads OSM tiles for the current viewport.
   * Will only load tiles if zoom level is sufficient and editing is enabled.
   */
  public loadTiles(): void {
    const editor = this.systems.editor;
    const osm = this.services.osm as any;
    if (!osm || !this.editable()) return;

    const z = this.viewport.transform.zoom;
    if (z < MINZOOM) return;  // this would fire off too many API requests

    osm.loadTiles((err: Error | null, results: any) => {
      if (Array.isArray(results?.data)) {
        editor?.merge(results.data, results.seenIDs);
      }
    });
  }


  /**
   * Loads the OSM tile containing the given location.
   * @param  loc  The [lon, lat] location to load tile for
   */
  public loadTileAtLoc(loc: Vec2): void {
    const editor = this.systems.editor;
    const osm = this.services.osm as any;
    if (!osm || !this.editable()) return;

    osm.loadTileAtLoc(loc, (err: Error | null, results: any) => {
      if (Array.isArray(results?.data)) {
        editor?.merge(results.data, results.seenIDs);
      }
    });
  }


  /**
   * Downloads the full entity and its parent relations from OSM.
   * @param  entityID  The entity ID to load (e.g. 'n123', 'w456', 'r789')
   * @return  Promise resolved when the entity is loaded
   */
  public loadEntityAsync(entityID: EntityID): Promise<void> {
    const editor = this.systems.editor;
    const osm = this.services.osm as any;
    if (!osm) {
      return Promise.resolve();
    }

    return osm.loadEntityAsync(entityID)
      .then((results: any) => {
      if (Array.isArray(results?.data)) {
          editor?.merge(results.data, results.seenIDs);
        }
      })
      .then(() => osm.loadEntityRelationsAsync(entityID))
      .then((results: any) => {
      if (Array.isArray(results?.data)) {
          editor?.merge(results.data, results.seenIDs);
        }
      });
  }


  // String length limits in Unicode characters, not JavaScript UTF-16 code units
  /**
   * Coerces a value to a trimmed, Unicode-normalized string clamped to a maximum length.
   * Used to sanitize free-form OSM tag values before they are stored or uploaded.
   * @param val - Raw value to clean (coerced to a string; `null`/`undefined` become '')
   * @param maxChars - Maximum length in Unicode characters
   * @return  The cleaned string
   */
  protected _cleanOsmString(val: unknown, maxChars: number): string {
    // be lenient with input
    let str: string;
    if (val === undefined || val === null) {
      str = '';
    } else {
      str = String(val);
    }

    // remove whitespace
    str = str.trim();

    // Get diacritic marks into a consistent format, prefer them combined into fewer characters.
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize
    str = str.normalize('NFKC');

    // trim to the number of allowed characters
    return utilUnicodeCharsTruncated(str, maxChars);
  }

  /**
   * Cleans and truncates a string for use as an OSM tag key.
   * @param  val  The value to clean
   * @return  Cleaned string, truncated to max allowed characters
   */
  public cleanTagKey(val: unknown): string {
    return this._cleanOsmString(val, this.maxCharsForTagKey);
  }

  /**
   * Cleans and truncates a string for use as an OSM tag value.
   * @param  val  The value to clean
   * @return  Cleaned string, truncated to max allowed characters
   */
  public cleanTagValue(val: unknown): string {
    return this._cleanOsmString(val, this.maxCharsForTagValue);
  }

  /**
   * Cleans and truncates a string for use as an OSM relation role.
   * @param  val  The value to clean
   * @return  Cleaned string, truncated to max allowed characters
   */
  public cleanRelationRole(val: unknown): string {
    return this._cleanOsmString(val, this.maxCharsForRelationRole);
  }


  /**
   * The current editing mode.
   * Returns `null` until UiSystem.render initializes the map and enters browse mode.
   * @return  The active mode, or null if not yet initialized
   * @readonly
   */
  public get mode(): AbstractMode | null {
    return this._currMode;
  }


  /**
   * Enters the given mode, with an optional bunch of features selected.
   * If the mode could not be entered for whatever reason, falls back to browse mode.
   * @param  modeOrModeID  Mode object or string identifying the mode to enter
   * @param  options       Optional options passed to the new mode
   * @return  The mode that was entered
   */
  public enter(modeOrModeID: AbstractMode | ModeID, options?: object): AbstractMode {
    const gfx = this.systems.gfx;
    const currMode = this._currMode;
    let newMode: AbstractMode | undefined;

    if (typeof modeOrModeID === 'string') {
      newMode = this.modes[modeOrModeID];
    } else {
      newMode = modeOrModeID;
    }
    if (!newMode) {
      console.error(`context.enter: no such mode: ${modeOrModeID}`);  // eslint-disable-line no-console
      newMode = this.modes.browse;  // fallback
    }

    // Exit current mode, if any
    if (currMode) {
      currMode.exit();
      this.$container.classed(`mode-${currMode.id}`, false);
    }

    // Try to enter the new mode, fallback to 'browse' mode
    this._currMode = newMode!;
    const didEnter = this._currMode.enter(options);
    if (!didEnter) {
      this._currMode = this.modes.browse!;
      this._currMode.enter();
    }
    this.$container.classed(`mode-${this._currMode.id}`, true);

    gfx?.immediateRedraw();
    this.emit('modechange', this._currMode);
    return this._currMode;
  }


  /**
   * Returns a Map containing the current selected features.
   * Can contain multiple items of various types (e.g. OSM data, Rapid data, etc.)
   * @return  The current selected features as a `Map(datumID -> datum)`
   */
  public selectedData(): Map<DataID, AbstractData> {
    if (!this._currMode) return new Map<DataID, AbstractData>();
    return this._currMode.selectedData ?? new Map<DataID, AbstractData>();
  }

  /**
   * Returns just the IDs of the selected features.
   * @return  Array of selected entity IDs
   */
  public selectedIDs(): DataID[] {
    if (!this._currMode) return [];
    return this._currMode.selectedIDs || [];
  }


  /**
   * Enables the given behaviors, disabling all others.
   * @param  behaviorIDs  Single behavior ID or array of behavior IDs to enable
   */
  public enableBehaviors(behaviorIDs: OneOrMore<BehaviorID>): void {
    const toEnable = new Set<BehaviorID>(utilIterable(behaviorIDs));

    for (const [behaviorID, behavior] of Object.entries(this.behaviors)) {
      if (!behavior) continue;
      if (toEnable.has(behaviorID)) {  // should be enabled
        if (!behavior.enabled) {
          behavior.enable();
        }
      } else {  // should be disabled
        if (behavior.enabled) {
          behavior.disable();
        }
      }
    }
  }


  /**
   * The graph snapshot used for copy/paste operations.
   * @return  The graph snapshot, or null if nothing has been copied
   */
  public get copyGraph(): Graph | null     { return this._copyGraph; }
  /**
   * Sets the graph snapshot used for copy/paste operations.
   * @param val - Graph snapshot to store, or null to clear
   */
  public set copyGraph(val: Graph | null)  { this._copyGraph = val; }

  /**
   * Entity IDs that have been copied for paste operations.
   * Setting this also captures the current staging graph as `copyGraph`.
   * @return  Array of copied entity IDs
   */
  public get copyIDs(): EntityID[] { return this._copyIDs; }
  /**
   * Sets the entity IDs to paste and captures the current staging graph as `copyGraph`.
   * @param val - Array of entity IDs to paste
   */
  public set copyIDs(val: EntityID[]) {
    this._copyIDs = val;
    this._copyGraph = this.systems.editor!.staging.graph!;
  }

  /**
   * The [lon, lat] location where entities were copied from.
   * @return  The copy origin, or null if not set
   */
  public get copyLoc(): Vec2 | null     { return this._copyLoc; }
  /**
   * Sets the [lon, lat] location from which entities were copied.
   * @param val - [lon, lat] origin of the copied entities, or null to clear
   */
  public set copyLoc(val: Vec2 | null)  { this._copyLoc = val; }


  /**
   * Returns all debug flags.
   * @return  Object containing all debug flags
   */
  public debugFlags(): DebugFlags {
    return this._debugFlags;
  }

  /**
   * Gets the value of a specific debug flag.
   * @param  flag  The debug flag name to check
   * @return  True if the flag is enabled
   */
  public getDebug(flag: string): boolean {
    return flag ? this._debugFlags[flag] ?? false : false;
  }

  /**
   * Sets the value of a specific debug flag and triggers a redraw.
   * @param  flag  The debug flag name to set
   * @param  val   The value to set (defaults to true)
   */
  public setDebug(flag: string, val: boolean = true): void {
    this._debugFlags[flag] = val;
    const gfx = this.systems.gfx;
    if (gfx && gfx.scene) {
      gfx.scene.dirtyScene();
      gfx.immediateRedraw();
    }
  }


  /**
   * Gets or sets the container element as a D3 selection.
   * @param  val  Optional D3 selection to set as the container
   * @return  The container selection (if no argument), or `this` for chaining
   */
  public container(): D3Selection;
  public container(val: D3Selection): this;
  public container(val?: D3Selection): D3Selection | this {
    if (val === undefined) return this.$container;
    this.$container = val;
    this.$container.classed('ideditor', true);
    return this;
  }

  /**
   * The container DOM element.
   * @return  The container Element, or null if not set
   */
  public get containerNode(): Element | null {
    return this.$container.node();
  }
  /**
   * Sets the container from a raw DOM Element (wraps it in a D3 selection).
   * @param val - DOM Element to use as the application container
   */
  public set containerNode(val: Element) {
    this.container(d3_select(val));
  }

  /**
   * Gets or sets whether the editor is in embedded mode.
   * @param  val  Optional boolean to set embedded mode
   * @return  The embed value (if no argument), or `this` for chaining
   */
  public embed(val?: boolean): boolean | null | this {
    if (val === undefined) return this._embed;
    this._embed = val;
    return this;
  }

  /**
   * Returns the next number for the given sequence.
   * Numbers start at 1 and increase by 1 each time `next` is called.
   * @param  sequenceID  Which sequence to get next number from (e.g. 'node', 'way', 'relation')
   * @return  The next number in the sequence
   */
  public next(sequenceID: SequenceID): number {
    const num = (this.sequences[sequenceID] || 0) + 1;
    return this.sequences[sequenceID] = num;
  }
}
