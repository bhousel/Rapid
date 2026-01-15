import { EventEmitter } from 'tseep';
import { select as d3_select } from 'd3-selection';
import { Viewport } from '@rapid-sdk/math';
import { utilUnicodeCharsTruncated } from '@rapid-sdk/util';

import { behaviors } from './behaviors/index.js';
import { modes } from './modes/index.js';
import { services } from './services/index.js';
import { systems } from './core/index.ts';

import type { AssetOrigin } from './core/AssetSystem.ts';
import type { D3Selection } from 'd3-selection';
import type { Systems } from './core/types.ts';
import type { Graph } from './lib/Graph.ts';
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
 * Mode interface - represents an editing mode (browse, select, draw, etc.)
 * Modes are still in JavaScript, so this is a loose interface.
 */
export interface Mode {
  id: string;
  selectedData?: Map<string, any>;
  selectedIDs?: string[];
  operations: any[];
  enter(options?: object): boolean;
  exit(): void;
}

/**
 * Behavior interface - bundles of event handlers for user interactions.
 * Behaviors are still in JavaScript, so this is a loose interface.
 */
export interface Behavior {
  id: string;
  enabled: boolean;
  enable(): void;
  disable(): void;
}

/**
 * Service interface - external data sources and APIs.
 * Services are still in JavaScript, so this is a loose interface.
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
 *   'modechange'   Fires when changing modes - receives the new mode
 */
export class Context extends EventEmitter {
  /** Application version string (semver format) */
  version: string;
  /** Version number for the privacy/welcome screen */
  privacyVersion: number;
  /** Version number for the "what's new" screen */
  whatsNewVersion: number;

  /** Build identifier from CI/CD */
  buildID: string;
  /** Git SHA from CI/CD */
  buildSHA: string;
  /** Build date from CI/CD */
  buildDate: string;

  /** Maximum characters allowed for tag keys */
  maxCharsForTagKey: number;
  /** Maximum characters allowed for tag values */
  maxCharsForTagValue: number;
  /** Maximum characters allowed for relation roles */
  maxCharsForRelationRole: number;

  /** Sequence counters for generating unique IDs */
  sequences: Record<string, number>;

  /** Asset origin override ('latest' or 'local') */
  assetOrigin: AssetOrigin | null;
  /** Asset path override */
  assetPath: string | null;
  /** Asset file replacement map */
  assetMap: Record<string, string> | null;

  /** The map viewport (projection, pan, zoom) */
  viewport: Viewport;

  /** All initialized systems */
  systems: Systems;
  /** All initialized modes */
  modes: Record<string, Mode>;
  /** Currently active mode */
  private _currMode: Mode | null;
  /** All initialized behaviors */
  behaviors: Record<string, Behavior>;
  /** All initialized services (not yet converted to TypeScript) */
  services: Record<string, any>;

  /** Promise for initialization */
  private _initPromise: Promise<void> | null;
  /** Promise for reset */
  private _resetPromise: Promise<void> | null;

  /** Last pointer device type used */
  lastPointerType: string;
  /** Keybinding manager */
  private _keybinding: Keybinding;

  /** OAuth/preauth credentials */
  private _preauth: PreauthOptions | null;
  /** API connections for source switcher */
  private _apiConnections: ApiConnection[] | null;
  /** Pre-configured locale codes */
  private _prelocale: string | string[] | null;

  /** Graph snapshot for copy operations */
  private _copyGraph: Graph | null;
  /** Entity IDs for paste operations */
  private _copyIDs: string[];
  /** Location for paste operations */
  private _copyLoc: Vec2 | null;

  /** Debug visualization flags */
  private _debugFlags: DebugFlags;

  /** Container element (D3 selection) */
  $container: D3Selection;
  /** Whether embedded mode is enabled */
  private _embed: boolean | null;

  /** Whether we're in the intro walkthrough */
  inIntro: boolean;

  /** Check if entity has hidden connections (set during init) */
  hasHiddenConnections!: (entityID: string) => boolean;
  /** Check if editing is allowed (set during init) */
  editable!: () => boolean;

  /**
   * @constructor
   */
  constructor() {
    super();

    // this.version = '2.5.3';             // see https://semver.org/ for examples
    this.version = '2.6.0-pre.0';    // see https://semver.org/ for examples

    // If user has not seen this version of our software, we will show them a modal at startup.
    // Just bump these dates to a higher number to get the screen to come back.
    this.privacyVersion = 20201202;    // whether to show the "welcome" screen
    this.whatsNewVersion = 20241222;   // whether show the "what's new" screen

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

    // "Behaviors" are bundles of event handlers that we can
    // enable and disable depending on what the user is doing.
    this.behaviors = {};

    // "Services" are components that get data from other places
    this.services = {};


    this._initPromise = null;
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
   * initAsync
   * Call one time to start up Rapid.
   * Constructs and initializes all systems, modes, behaviors, and services.
   * @return  Promise resolved when Rapid is ready
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    // -------------------------------
    // Construct all the core classes
    // -------------------------------
    for (const [id, System] of systems.available) {
      (this.systems as any)[id] = new System(this);
    }

    // AssetSystem
    const assets = this.systems.assets;
    if (this.assetOrigin && assets)  assets.origin = this.assetOrigin;
    if (this.assetPath && assets)    assets.filePath = this.assetPath;
    if (this.assetMap && assets)     assets.fileReplacements = this.assetMap;

    // LocalizationSystem
    const l10n = this.systems.l10n;
    if (this._prelocale && l10n) {   // set preferred locale codes, if we have them
      l10n.preferredLocaleCodes = this._prelocale;
    }

    // FilterSystem
    const filters = this.systems.filters;
    this.hasHiddenConnections = (entityID: string): boolean => {
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


    // ---------------------------------
    // Initialize all the core classes
    // ---------------------------------
    const allSystems = Object.values(this.systems);
    const allServices = Object.values(this.services);

    return this._initPromise = Promise.resolve()
      .then(() => Promise.all( allSystems.map(s => s!.initAsync()) ))
      .then(() => Promise.all( allServices.map(s => s.initAsync()) ))
      .then(() => {
        // Setup the osm connection if we have preauth credentials to use
        const osm = this.services.osm as any;
        return (osm && this._preauth) ? osm.switchAsync(this._preauth) : Promise.resolve();
      })
      .then(() => Promise.all( allSystems.map(s => s!.autoStart ? s!.startAsync() : Promise.resolve()) ))
      .then(() => Promise.all( allServices.map(s => s.autoStart ? s.startAsync() : Promise.resolve()) ))
      .then(() => {});  // void return
  }


  /**
   * resetAsync
   * Call after completing an edit session to reset any internal state.
   * @return  Promise resolved when Rapid is finished resetting
   */
  resetAsync(): Promise<void> {
    if (this._resetPromise) return this._resetPromise;

    const allSystems = Object.values(this.systems);
    const allServices = Object.values(this.services);

    return this._resetPromise = Promise.resolve()
      .then(() => Promise.all( allSystems.map(s => s!.resetAsync()) ))
      .then(() => Promise.all( allServices.map(s => s.resetAsync()) ))
      .then(() => {})  // void return
      .finally(() => { this._resetPromise = null; });
  }


  /**
   * keybinding
   * Returns the keybinding manager for the application.
   * (not a system yet, but should be one)
   * @return  The keybinding manager
   */
  keybinding(): Keybinding  { return this._keybinding; }


  /**
   * preauth
   * OAuth/authentication credentials for connecting to the OSM API.
   * Set this before calling `initAsync()` to use preauth credentials.
   */
  get preauth(): PreauthOptions | null {
    return this._preauth;
  }
  set preauth(options: PreauthOptions | null) {
    this._preauth = options ? Object.assign({}, options) : null;  // copy and remember for init time
  }

  /**
   * apiConnections
   * Connection options for the source switcher (optional).
   */
  get apiConnections(): ApiConnection[] | null     { return this._apiConnections; }
  set apiConnections(arr: ApiConnection[] | null)  { this._apiConnections = arr; }


// TODO: For now, this must be set before init, and it will be passed
// to the LocalizationSystem after it has been created but before init.
// We should deprecate setting the locale through Context like this.
// Other methods that locale can be set include:
//  - `locale` param in the urlhash or
//  - directly accessing the LocalizationSystem
// and both of _those_ should be made dynamic so locale can switch while Rapid is running
  /**
   * locale
   * A string or array of locale codes to prefer over the browser's settings.
   * Must be set before `initAsync()` is called.
   * @deprecated  Set locale via urlhash param or LocalizationSystem instead
   */
  get locale(): string | string[] | null     { return this._prelocale; }  // remember for init time
  set locale(val: string | string[] | null)  { this._prelocale = val; }


  /**
   * loadTiles
   * Loads OSM tiles for the current viewport.
   * Will only load tiles if zoom level is sufficient and editing is enabled.
   */
  loadTiles(): void {
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
   * loadTileAtLoc
   * Loads the OSM tile containing the given location.
   * @param  loc  The [lon, lat] location to load tile for
   */
  loadTileAtLoc(loc: Vec2): void {
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
   * loadEntityAsync
   * Downloads the full entity and its parent relations from OSM.
   * @param  entityID  The entity ID to load (e.g. 'n123', 'w456', 'r789')
   * @return  Promise resolved when the entity is loaded
   */
  loadEntityAsync(entityID: string): Promise<void> {
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
  private _cleanOsmString(val: unknown, maxChars: number): string {
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
   * cleanTagKey
   * Cleans and truncates a string for use as an OSM tag key.
   * @param  val  The value to clean
   * @return  Cleaned string, truncated to max allowed characters
   */
  cleanTagKey(val: unknown): string {
    return this._cleanOsmString(val, this.maxCharsForTagKey);
  }

  /**
   * cleanTagValue
   * Cleans and truncates a string for use as an OSM tag value.
   * @param  val  The value to clean
   * @return  Cleaned string, truncated to max allowed characters
   */
  cleanTagValue(val: unknown): string {
    return this._cleanOsmString(val, this.maxCharsForTagValue);
  }

  /**
   * cleanRelationRole
   * Cleans and truncates a string for use as an OSM relation role.
   * @param  val  The value to clean
   * @return  Cleaned string, truncated to max allowed characters
   */
  cleanRelationRole(val: unknown): string {
    return this._cleanOsmString(val, this.maxCharsForRelationRole);
  }


  /**
   * mode
   * The current editing mode.
   * Returns `null` until UiSystem.render initializes the map and enters browse mode.
   * @readonly
   */
  get mode(): Mode | null {
    return this._currMode;
  }


  /**
   * enter
   * Enters the given mode, with an optional bunch of features selected.
   * If the mode could not be entered for whatever reason, falls back to browse mode.
   * @param  modeOrModeID  Mode object or string identifying the mode to enter
   * @param  options       Optional options passed to the new mode
   * @return  The mode that was entered
   */
  enter(modeOrModeID: Mode | string, options?: object): Mode {
    const gfx = this.systems.gfx;
    const currMode = this._currMode;
    let newMode: Mode | undefined;

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
    this._currMode = newMode;
    const didEnter = this._currMode.enter(options);
    if (!didEnter) {
      this._currMode = this.modes.browse;
      this._currMode.enter();
    }
    this.$container.classed(`mode-${this._currMode.id}`, true);

    gfx?.immediateRedraw();
    this.emit('modechange', this._currMode);
    return this._currMode;
  }


  /**
   * selectedData
   * Returns a Map containing the current selected features.
   * Can contain multiple items of various types (e.g. OSM data, Rapid data, etc.)
   * @return  The current selected features as a `Map(datumID -> datum)`
   */
  selectedData(): Map<string, any> {
    if (!this._currMode) return new Map();
    return this._currMode.selectedData || new Map();
  }

  /**
   * selectedIDs
   * Returns just the IDs of the selected features.
   * @return  Array of selected entity IDs
   */
  selectedIDs(): string[] {
    if (!this._currMode) return [];
    return this._currMode.selectedIDs || [];
  }


  /**
   * enableBehaviors
   * Enables the given behaviors, disabling all others.
   * @param  behaviorIDs  Single behavior ID or array of behavior IDs to enable
   */
  enableBehaviors(behaviorIDs: OneOrMore<string>): void {
    const toEnable = new Set(utilIterable(behaviorIDs));

    for (const [behaviorID, behavior] of Object.entries(this.behaviors)) {
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
   * copyGraph
   * The graph snapshot used for copy/paste operations.
   */
  get copyGraph(): Graph | null     { return this._copyGraph; }
  set copyGraph(val: Graph | null)  { this._copyGraph = val; }

  /**
   * copyIDs
   * Entity IDs that have been copied for paste operations.
   * Setting this also captures the current staging graph as `copyGraph`.
   */
  get copyIDs(): string[] { return this._copyIDs; }
  set copyIDs(val: string[]) {
    this._copyIDs = val;
    this._copyGraph = this.systems.editor!.staging.graph!;
  }

  /**
   * copyLoc
   * The [lon, lat] location where entities were copied from.
   */
  get copyLoc(): Vec2 | null     { return this._copyLoc; }
  set copyLoc(val: Vec2 | null)  { this._copyLoc = val; }


  /**
   * debugFlags
   * Returns all debug flags.
   * @return  Object containing all debug flags
   */
  debugFlags(): DebugFlags {
    return this._debugFlags;
  }

  /**
   * getDebug
   * Gets the value of a specific debug flag.
   * @param  flag  The debug flag name to check
   * @return  True if the flag is enabled
   */
  getDebug(flag: string): boolean {
    return flag ? this._debugFlags[flag] ?? false : false;
  }

  /**
   * setDebug
   * Sets the value of a specific debug flag and triggers a redraw.
   * @param  flag  The debug flag name to set
   * @param  val   The value to set (defaults to true)
   */
  setDebug(flag: string, val: boolean = true): void {
    this._debugFlags[flag] = val;
    const gfx = this.systems.gfx;
    if (gfx && gfx.scene) {
      gfx.scene.dirtyScene();
      gfx.immediateRedraw();
    }
  }


  /**
   * container
   * Gets or sets the container element as a D3 selection.
   * @param  val  Optional D3 selection to set as the container
   * @return  The container selection (if no argument), or `this` for chaining
   */
  container(): D3Selection;
  container(val: D3Selection): this;
  container(val?: D3Selection): D3Selection | this {
    if (val === undefined) return this.$container;
    this.$container = val;
    this.$container.classed('ideditor', true);
    return this;
  }

  /**
   * containerNode
   * The container DOM element.
   */
  get containerNode(): Element | null {
    return this.$container.node();
  }
  set containerNode(val: Element) {
    this.container(d3_select(val));
  }

  /**
   * embed
   * Gets or sets whether the editor is in embedded mode.
   * @param  val  Optional boolean to set embedded mode
   * @return  The embed value (if no argument), or `this` for chaining
   */
  embed(val?: boolean): boolean | null | this {
    if (val === undefined) return this._embed;
    this._embed = val;
    return this;
  }

  /**
   * next
   * Returns the next number for the given sequence.
   * Numbers start at 1 and increase by 1 each time `next` is called.
   * @param  which  Which sequence to get next number from (e.g. 'node', 'way', 'relation')
   * @return  The next number in the sequence
   */
  next(which: string): number {
    let num = this.sequences[which] || 0;
    return this.sequences[which] = ++num;
  }
}
