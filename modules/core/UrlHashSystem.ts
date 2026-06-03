import { AbstractSystem } from './AbstractSystem.ts';
import { utilObjectOmit, utilQsString, utilStringQs } from '@rapid-sdk/util';

import type { Context } from '../Context.ts';


/** Mock window type for non-browser environments */
interface MockWindow {
  isMocked: true;
  location: { hash: string };
  history: { replaceState: () => boolean };
  document: MockDocument;
  addEventListener: () => boolean;
  removeEventListener: () => boolean;
}

/** Mock document type for non-browser environments */
interface MockDocument {
  isMocked: true;
  title: string;
}

/** Union of real Window or mocked window */
type WindowLike = Window | MockWindow;
/** Union of real Document or mocked document */
type DocumentLike = Document | MockDocument;

let _window: WindowLike;
let _document: DocumentLike;


/**
 * `UrlHashSystem` is responsible for managing the url hash and query parameters.
 * It updates the `window.location.hash` and document title.
 * It also binds to the hashchange event and responds to changes made by the user directly to the url.
 * Supports `pause()` / `resume()` — when paused, url hash will not respond to changes or emit events.
 * On pause, pending throttled updates are cancelled. On resume, the hash and title are synced.
 *
 * Please see [API.md] for the current list of supported URL parameters.
 *
 * Properties available:
 * - `initialHashParams`  Map<string, string> containing the initial query params (e.g. `background=Bing` etc)
 * - `doUpdateTitle`     `true` if we should update the document title, `false` if not (default `true`)
 * - `titleBase`         The document title to use (default `Rapid`)
 *
 * Events available:
 * - `hashchange`   Fires on hashchange and when resumed, receives Map(currParams), Map(prevParams)
 * - `paused`       Fires when paused (inherited) — cancels pending hash/title updates
 * - `resumed`      Fires when resumed (inherited) — syncs hash and title, emits `hashchange`
 */
export class UrlHashSystem extends AbstractSystem {

  /** Whether to update the document title */
  public doUpdateTitle: boolean;
  /** The base document title to use */
  public titleBase: string;

  /** Initial URL hash parameters at startup */
  protected _initParams: Map<string, string>;
  /** Current URL hash parameters */
  protected _currParams: Map<string, string>;
  /** Cached window.location.hash */
  protected _currHash: string | null;
  /** Previous URL hash parameters */
  protected _prevParams: Map<string, string> | null;
  /** Release token from initial pause(), called during init to unpause */
  protected _unpauseFn: (() => void) | null;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'urlhash';
    this.optionalDependencies = new Set<SystemID>(['editor', 'l10n', 'map', 'scheduler']);

    this.doUpdateTitle = true;
    this.titleBase = 'Rapid';

    // Note that `window`, `document`, or `location` may not exist in a
    // non-browser environment so fallback to a mock.
    try {
      if (!('window' in globalThis)) {
        throw new Error('No window');
      }
      _window = globalThis.window;

      if (!('document' in _window)) {
        throw new Error('No document');
      }
      _document = globalThis.document;

      if (typeof _window.location?.hash !== 'string') {
        throw new Error('No hash');
      }

    } catch (e) {
      _document = {
        isMocked: true,
        title: ''
      };
      _window = {
        isMocked: true,
        location: { hash: '' },
        history:  { replaceState: () => true },
        document: _document,
        addEventListener:    () => true,
        removeEventListener: () => true,
      };
    }

    const q = utilStringQs(_window.location.hash);
    this._initParams = new Map<string, string>(Object.entries(q));
    this._currParams = new Map<string, string>(this._initParams);  // make copy
    this._currHash = null;   // cached window.location.hash
    this._prevParams = null;

    // Make sure the event handlers have `this` bound correctly
    this._hashChanged = this._hashChanged.bind(this);
    this._updateHash = this._updateHash.bind(this);
    this._updateTitle = this._updateTitle.bind(this);
    this._deferredUpdateHash = this._deferredUpdateHash.bind(this);
    this._deferredUpdateTitle = this._deferredUpdateTitle.bind(this);

    // Start paused, we will resume after all other components
    // are started and ready to receive the hashchange event.
    this._unpauseFn = this.pause();
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const editor = context.systems.editor;
    const scheduler = context.systems.scheduler;

    return this._initPromise = super.initAsync()
      .then(() => {
        // When paused, cancel any pending throttled updates.
        this.on('paused', () => {
          this._currHash = null;
          scheduler?.cancel('urlhash-update-hash');
          scheduler?.cancel('urlhash-update-title');
        });

        // When resumed, sync the hash and title, and emit 'hashchange'
        // so other code knows what the hash contains.
        this.on('resumed', () => {
          this._currHash = null;
          this._hashChanged();
          this._updateHash();
          this._updateTitle();
        });

        // Register event handlers here
        editor?.on('stablechange', this._deferredUpdateTitle);
        context.on('modechange', this._deferredUpdateTitle);
        (_window as Window).addEventListener('hashchange', this._hashChanged);
      });
  }


  /**
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    return super.startAsync()
      .then(() => {
        // A lot of things will start happening when urlhash emits its
        // first hashchange event.  Chain off Context's startAsync Promise
        // to know when everything has started up and it is ok to do this.
        this.context.startAsync()
          .then(() => {
            this._unpauseFn?.();
            this._unpauseFn = null;
          });
      });
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return  Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  /**
   * Get the initial urlhash parameters  (was: `context.initialHashParams`)
   * This were the values that were present when Rapid initally started up.
   * @return  Map of parameter keys to their initial values
   * @readonly
   */
  public get initialHashParams(): Map<string, string> {
    return this._initParams;
  }


  /**
   * Gets the current parameter value for a given key.
   * @param k - The parameter key to get
   * @return The parameter's current value, or `undefined`
   */
  public getParam(k: string): string | undefined {
    return this._currParams.get(k);
  }


  /**
   * Sets a `key=value` pair that will be added to the urlhash params.
   * Values passed as `undefined` or `null` will be deleted from the query params
   * Values passed as empty string '' will remain in the query params
   * @param k - The parameter key to set
   * @param v - The parameter value to set, pass `undefined` to delete the value
   */
  public setParam(k: string, v: Nullable<string>): void {
    if (typeof k !== 'string') return;

    if (v === undefined || v === null || v === 'undefined' || v === 'null') {
      this._currParams.delete(k);
    } else {
      this._currParams.set(k, v);
    }

    if (this._started && !this._paused) {
      this._deferredUpdateHash();
    }
  }


  /**
   * Updates the hash (by calling `window.history.replaceState()`) to match _currParams;
   * This updates the URL hash without affecting the browser navigation stack.
   */
  protected _updateHash(): void {
    if (!this._started || this._paused) return;

    // Remove some of the initial-only params that only clutter up the hash
    const toOmit = ['comment', 'source', 'hashtags', 'walkthrough', 'data', 'gpx'];
    const params = utilObjectOmit(Object.fromEntries(this._currParams), toOmit);

    const newHash = '#' + utilQsString(params, true);
    if (newHash !== this._currHash) {
      (_window as Window).history.replaceState(null, this.titleBase, newHash);
      this._currHash = newHash;
    }
  }

  /**
   * Uses `throttle` to avoid performing updates too frequently.
   */
  protected _deferredUpdateHash(): void {
    const scheduler = this.context.systems.scheduler;
    if (scheduler) {
      scheduler?.throttle('urlhash-update-hash', () => this._updateHash(), { ms: 500, leading: false });
    } else {
      this._updateHash();
    }
  }


  /**
   * Updates the title of the tab (by setting `document.title`)
   */
  protected _updateTitle(): void {
    if (!this._started || this._paused) return;
    if (!this.doUpdateTitle) return;

    const context = this.context;
    const editor = context.systems.editor;
    const l10n = context.systems.l10n;
    const graph = editor?.staging?.graph;
    if (!editor || !l10n || !graph) return;

    const changeCount: number = editor.difference().summary().size;

    // Currently only support OSM ids
    let selected: string | undefined;
    const selectedIDs: EntityID[] = context.selectedIDs().filter(id => graph.hasEntity(id));
    if (selectedIDs.length) {
      const firstLabel: string = l10n.displayLabel(graph.entity(selectedIDs[0]), graph);
      if (selectedIDs.length > 1) {
        selected = l10n.t('title.labeled_and_more', { labeled: firstLabel, count: selectedIDs.length - 1 });
      } else {
        selected = firstLabel;
      }
    }

    let format: string | undefined;
    if (changeCount && selected) {
      format = 'title.format.changes_context';
    } else if (changeCount && !selected) {
      format = 'title.format.changes';
    } else if (!changeCount && selected) {
      format = 'title.format.context';
    }

    let title: string;
    if (format) {
      title = l10n.t(format, { changes: changeCount, base: this.titleBase, context: selected });
    } else {
      title = this.titleBase;
    }

    if (_document.title !== title) {
      _document.title = title;
    }
  }


  /**
   * Uses `throttle` to avoid performing updates too frequently.
   */
  protected _deferredUpdateTitle(): void {
    const scheduler = this.context.systems.scheduler;
    if (scheduler) {
      scheduler?.throttle('urlhash-update-title', () => this._updateTitle(), { ms: 500, leading: false });
    } else {
      this._updateTitle();
    }
  }


  /**
   * Called on hashchange event (user changes url manually), and when enabling the hash behavior
   * Receiving code will receive copies of both the current and previous parameters.
   */
  protected _hashChanged(): void {
    if (!this._started || this._paused) return;

    this._currHash = _window.location.hash;
    const q = utilStringQs(this._currHash);

    if (!this._prevParams) {                         // We haven't emitted `hashchange` yet
      this._prevParams = new Map<string, string>();  // set previous to empty Map, so everything looks new
    } else {
      this._prevParams = this._currParams;   // copy current -> previous
    }

    this._currParams = new Map<string, string>(Object.entries(q));

    this.emit(
      'hashchange',
      new Map<string, string>(this._currParams),
      new Map<string, string>(this._prevParams)
    );  // emit copies
  }
}
