import { utilObjectOmit, utilQsString, utilStringQs } from '@rapid-sdk/util';
import throttle from 'lodash-es/throttle.js';

import { AbstractSystem } from './AbstractSystem.ts';

import type { Context } from '../Context.ts';
import type { DebouncedFunc } from 'lodash-es';


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
 * Properties you can access:
 *   `initialHashParams`  Map<string, string> containing the initial query params (e.g. `background=Bing` etc)
 *   `doUpdateTitle`     `true` if we should update the document title, `false` if not (default `true`)
 *   `titleBase`         The document title to use (default `Rapid`)
 *
 * Events available:
 *   `hashchange`   Fires on hashchange and when resumed, receives Map(currParams), Map(prevParams)
 *   `paused`       Fires when paused (inherited) — cancels pending hash/title updates
 *   `resumed`      Fires when resumed (inherited) — syncs hash and title, emits `hashchange`
 */
export class UrlHashSystem extends AbstractSystem {
  /** Whether to update the document title */
  doUpdateTitle: boolean;
  /** The base document title to use */
  titleBase: string;
  /** Deferred hash update function (throttled) */
  deferredUpdateHash: DebouncedFunc<() => void>;
  /** Deferred title update function (throttled) */
  deferredUpdateTitle: DebouncedFunc<() => void>;

  /** Initial URL hash parameters at startup */
  private _initParams: Map<string, string>;
  /** Current URL hash parameters */
  private _currParams: Map<string, string>;
  /** Cached window.location.hash */
  private _currHash: string | null;
  /** Previous URL hash parameters */
  private _prevParams: Map<string, string> | null;
  /** Release token from initial pause(), called during init to unpause */
  private _unpauseFn: (() => void) | null;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'urlhash';
    this.optionalDependencies = new Set(['editor', 'l10n', 'map']);

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
    this._initParams = new Map(Object.entries(q));

    this._currParams = new Map(this._initParams);  // make copy
    this._currHash = null;   // cached window.location.hash
    this._prevParams = null;

    // Make sure the event handlers have `this` bound correctly
    this._hashChanged = this._hashChanged.bind(this);
    this._updateHash = this._updateHash.bind(this);
    this._updateTitle = this._updateTitle.bind(this);

    // `leading: false` means that we wait a bit for more updates to sneak in.
    this.deferredUpdateHash = throttle(this._updateHash, 500, { leading: false }) as DebouncedFunc<() => void>;
    this.deferredUpdateTitle = throttle(this._updateTitle, 500, { leading: false }) as DebouncedFunc<() => void>;

    // When paused, cancel any pending throttled updates.
    this.on('paused', () => {
      this._currHash = null;
      this.deferredUpdateHash.cancel();
      this.deferredUpdateTitle.cancel();
    });

    // When resumed, sync the hash and title, and emit 'hashchange'
    // so other code knows what the hash contains.
    this.on('resumed', () => {
      this._currHash = null;
      this._hashChanged();
      this._updateHash();
      this._updateTitle();
    });

    // Start paused, we will resume after all other components
    // are started and ready to receive the hashchange event.
    this._unpauseFn = this.pause();
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const editor = context.systems.editor;

    return this._initPromise = super.initAsync()
      .then(() => {
        // Register event handlers here
        editor?.on('stablechange', this.deferredUpdateTitle);
        context.on('modechange', this.deferredUpdateTitle);
        (_window as Window).addEventListener('hashchange', this._hashChanged);

        // A lot of things will start happening when urlhash emits its
        // first hashchange event.  Chain off Context's initAsync Promise
        // to know when everything has started up and it is ok to do this.
        context.initAsync()
          .then(() => {
            this._unpauseFn?.();
            this._unpauseFn = null;
          });
      });
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return  Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return  Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  /**
   * initialHashParams
   * Get the initial urlhash parameters  (was: `context.initialHashParams`)
   * This were the values that were present when Rapid initally started up.
   * @readonly
   */
  get initialHashParams(): Map<string, string> {
    return this._initParams;
  }


  /**
   * getParam
   * Gets the current parameter value for a given key.
   * @param k - The parameter key to get
   * @return The parameter's current value, or `undefined`
   */
  getParam(k: string): string | undefined {
    return this._currParams.get(k);
  }


  /**
   * setParam
   * Sets a `key=value` pair that will be added to the urlhash params.
   * Values passed as `undefined` or `null` will be deleted from the query params
   * Values passed as empty string '' will remain in the query params
   * @param k - The parameter key to set
   * @param v - The parameter value to set, pass `undefined` to delete the value
   */
  setParam(k: string, v: Nullable<string>): void {
    if (typeof k !== 'string') return;

    if (v === undefined || v === null || v === 'undefined' || v === 'null') {
      this._currParams.delete(k);
    } else {
      this._currParams.set(k, v);
    }

    if (this._started && !this._paused) {
      this.deferredUpdateHash();
    }
  }


  /**
   * _updateHash
   * Updates the hash (by calling `window.history.replaceState()`) to match _currParams;
   * This updates the URL hash without affecting the browser navigation stack.
   */
  _updateHash(): void {
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
   * _updateTitle
   * Updates the title of the tab (by setting `document.title`)
   */
  _updateTitle(): void {
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
   * _hashChanged
   * Called on hashchange event (user changes url manually), and when enabling the hash behavior
   * Receiving code will receive copies of both the current and previous parameters.
   */
  _hashChanged(): void {
    if (!this._started || this._paused) return;

    this._currHash = _window.location.hash;
    const q = utilStringQs(this._currHash);

    if (!this._prevParams) {         // We haven't emitted `hashchange` yet
      this._prevParams = new Map();  // set previous to empty Map, so everything looks new
    } else {
      this._prevParams = this._currParams;   // copy current -> previous
    }

    this._currParams = new Map(Object.entries(q));

    this.emit('hashchange', new Map(this._currParams), new Map(this._prevParams));  // emit copies
  }
}
