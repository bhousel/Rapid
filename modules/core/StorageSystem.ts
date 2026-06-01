import { AbstractSystem } from './AbstractSystem.ts';

import type { Context } from '../Context.ts';


/**
 * Mock storage interface for when localStorage is not available.
 */
interface MockStorage {
  isMocked: true;
  hasItem: (k: string) => boolean;
  getItem: (k: string) => string | undefined;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => boolean;
  clear: () => void;
}

/**
 * Union type for the internal storage - either real localStorage or mock.
 */
type InternalStorage = Storage | MockStorage;


/**
 * `StorageSystem` is a wrapper around `window.localStorage`
 * It is used to store user preferences (good)
 * and the user's edit history (not good)
 *
 * n.b.:  `localStorage` is a _synchronous_ API.
 * We should add another system for wrapping `indexedDB`,
 * which is an _asynchronous_ API, but would allow us to store
 * a whole lot more data, and share it with worker processes.
 * (The user's edit history should go there instead.)
 */
export class StorageSystem extends AbstractSystem {

  /** The underlying localStorage wrapper (or fallback mock) */
  protected _storage: InternalStorage;
  /** In-memory mock storage used when localStorage is unavailable */
  protected _mock: Map<string, string> | null;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'storage';   // was: 'prefs'

    // Note that accessing localStorage may throw a `SecurityError`,
    // or just not exist in a non-browser environment, so fallback to a mock.
    try {
      if (!('localStorage' in globalThis)) {
        throw new Error('No localStorage');
      }
      this._mock = null;
      this._storage = globalThis.localStorage;

    } catch (e) {
      this._mock = new Map();
      this._storage = {
        isMocked: true,
        hasItem: (k: string): boolean => this._mock!.has(k),
        getItem: (k: string): string | undefined => this._mock!.get(k),
        setItem: (k: string, v: string): void => { this._mock!.set(k, v); },
        removeItem: (k: string): boolean => this._mock!.delete(k),
        clear: (): void => { this._mock!.clear(); }
      };
    }
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    return super.initAsync();
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
   * Tests whether a key is present in storage.
   * @param k - String key to check for existance
   * @return `true` if the key is set, `false` if not
   */
  public hasItem(k: string): boolean {
    return !!this._storage.getItem(k);
  }


  /**
   * Retrieves the value stored under a key.
   * @param k - String key to get the value for
   * @return The stored value, or `null` if not found
   */
  public getItem(k: string): string | null {
    return this._storage.getItem(k) ?? null;
  }


  /**
   * Stores a value under a key, handling quota-exceeded errors gracefully.
   * @param k - String key to set the value for
   * @param v - String value to set
   * @return `true` if the write to `localStorage` succeeded, `false` if it failed
   */
  public setItem(k: string, v: string): boolean {
    try {
      this._storage.setItem(k, v);
      return !this._storage?.isMocked;
    } catch (e) {
      console.error('localStorage quota exceeded');  // eslint-disable-line no-console
    }
    return false;
  }


  /**
   * Removes a key and its value from storage.
   * @param k - String key to remove from storage
   */
  public removeItem(k: string): void {
    this._storage.removeItem(k);
  }


  /**
   * Clears all values from the storage
   */
  public clear(): void {
    this._storage.clear();
  }
}
