/**
 * A single segment of a key path — an object key (string) or array index (number).
 */
export type KeyPathPart = string | number;

/**
 * Any value that can live in a `TreeStore`. Leaf values are strings (matching
 * `localStorage`, the OSM user-preferences API, and translated strings);
 * intermediate containers are arrays or plain objects.
 */
export type TreeValue = string | TreeValue[] | { [key: string]: TreeValue };

/** The root of a tree — a map of top-level keys to their values. */
export type TreeNode = Record<string, TreeValue>;


// ---------------------------------------------------------------------------
// Key-path primitives — stateless navigation over plain nested objects/arrays.
// This is the same idea as lodash's `get`/`set`/`has`/`unset` "by path". They
// live here (module-private) so `TreeStore` is the single home for tree logic;
// `parsePath` is re-exposed as a static for callers that need parsed segments.
// ---------------------------------------------------------------------------

/**
 * Parses a dotted/bracketed path string into its segments.
 * Object keys become strings; array indices (`[n]`) become numbers.
 * @param path - The path string, e.g. `a.b[0].c`
 * @return An array of path segments
 * @throws Error if the path is empty or contains an invalid array index
 */
function parsePath(path: string): KeyPathPart[] {
  const parts: KeyPathPart[] = [];
  let token = '';

  const flush = (): void => {
    if (token.length) {
      parts.push(token);
      token = '';
    }
  };

  for (let i = 0; i < path.length; i++) {
    const ch = path[i];

    if (ch === '.') {
      flush();
      continue;
    }

    if (ch === '[') {
      flush();
      const close = path.indexOf(']', i);
      if (close === -1) {
        throw new Error(`Invalid key path: ${path}`);
      }
      const index = Number(path.slice(i + 1, close));
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(`Invalid array index in key path: ${path}`);
      }
      parts.push(index);
      i = close;
      continue;
    }

    token += ch;
  }

  flush();

  if (!parts.length) {
    throw new Error('Invalid key path: path is empty');
  }
  return parts;
}


/**
 * Normalizes a path argument to an array of segments.
 * @param path - A path string or a pre-parsed array of segments
 * @return The path segments
 */
function toParts(path: string | KeyPathPart[]): KeyPathPart[] {
  return typeof path === 'string' ? parsePath(path) : path;
}


/**
 * Reads the value at a key path within a nested object/array.
 * @param obj - The object or array to read from
 * @param path - A path string or pre-parsed segments
 * @return The value, or `undefined` if any segment is missing or `obj` is not traversable
 */
function getPath(obj: unknown, path: string | KeyPathPart[]): unknown {
  const parts = toParts(path);

  let curr: unknown = obj;
  for (const part of parts) {
    if (typeof curr !== 'object' || curr === null) return undefined;
    curr = (curr as Record<KeyPathPart, unknown>)[part];
  }
  return curr;
}


/**
 * Tests whether a value exists at a key path.
 * @param obj - The object or array to read from
 * @param path - A path string or pre-parsed segments
 * @return `true` if a value exists at the path
 */
function hasPath(obj: unknown, path: string | KeyPathPart[]): boolean {
  return getPath(obj, path) !== undefined;
}


/**
 * Writes a value at a key path, creating intermediate objects and arrays as needed.
 * A numeric segment creates/uses an array; a string segment creates/uses an object.
 * @param obj - The object or array to write into
 * @param path - A path string or pre-parsed segments (must be non-empty)
 * @param value - The value to write
 * @throws Error if the path is empty
 */
function setPath(obj: object, path: string | KeyPathPart[], value: unknown): void {
  const parts = toParts(path);
  if (!parts.length) {
    throw new Error('Invalid key path: path is empty');
  }

  let curr: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = parts[i + 1];

    if (typeof curr[part] !== 'object' || curr[part] === null) {
      curr[part] = (typeof next === 'number') ? [] : {};
    }
    curr = curr[part];
  }

  curr[parts[parts.length - 1]] = value;
}


/**
 * Deletes the value at a key path.
 * Deleting an array element splices it out (shifting later elements left);
 * deleting an object property removes the key.
 * @param obj - The object or array to delete from
 * @param path - A path string or pre-parsed segments (must be non-empty)
 * @throws Error if the path is empty
 */
function deletePath(obj: object, path: string | KeyPathPart[]): void {
  const parts = toParts(path);
  if (!parts.length) {
    throw new Error('Invalid key path: path is empty');
  }

  let curr: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof curr[part] !== 'object' || curr[part] === null) return;
    curr = curr[part];
  }

  const leaf = parts[parts.length - 1];
  if (Array.isArray(curr) && typeof leaf === 'number') {
    if (leaf >= 0 && leaf < curr.length) {
      curr.splice(leaf, 1);
    }
  } else if (typeof curr === 'object' && curr !== null) {
    delete curr[leaf];
  }
}


/**
 * A `TreeStore` holds a nested tree of string leaves (with array/object
 * containers) and provides path-based access via dotted/bracketed keys, e.g.
 * `imagery.custom[0].template`.
 *
 * It is **domain-agnostic** — it knows nothing about settings, i18n, or storage.
 * The nested representation is optimized for *hot reads* (a `get` is a simple
 * walk), while writes are comparatively rare.
 *
 * Two responsibilities live here so callers don't have to reinvent them:
 * - **Path access**: `get` / `set` / `has` / `unset` (built on this module's
 *   key-path primitives; `parsePath` is exposed as a static).
 * - **Flat serialization**: `toFlat` / `fromFlat` turn the tree into a map of
 *   flat, percent-encoded keys (`imagery.custom[0].template` → value) and back.
 *   This is what a persistence adapter (e.g. `SettingsSystem`) uses to store one
 *   key per leaf; consumers that only read (e.g. localization) never call it.
 *
 * ```ts
 * const store = new TreeStore();
 * store.set('imagery.custom', [{ name: 'Custom', template: 'https://…' }]);
 * const arr = store.get('imagery.custom');   // deep copy of the array
 * for (const [key, value] of store.toFlat()) { … }   // flat key/value pairs
 * ```
 */
export class TreeStore {

  /** The in-memory tree. */
  protected _root: TreeNode;


  /**
   * @constructor
   * @param initial - An optional tree to seed the store (deep-copied)
   */
  public constructor(initial?: TreeNode) {
    this._root = initial ? structuredClone(initial) : {};
  }


  /**
   * Reads the value at a path.
   * Composite values (arrays/objects) are returned as deep copies so callers
   * cannot mutate internal state; string leaves are returned as-is (immutable).
   * @param path - A dotted/bracketed path or pre-parsed segments
   * @return A copy of the value, or `undefined` if the path is not set
   * @throws Error if a string path is malformed
   */
  public get<T = TreeValue>(path: string | KeyPathPart[]): T | undefined {
    const value = getPath(this._root, path);
    if (value === undefined) return undefined;
    return (typeof value === 'object' ? structuredClone(value) : value) as T;
  }


  /**
   * Reads the *live* value at a path without copying — a fast path for read-only
   * hot code (e.g. localization string lookups).
   *
   * ⚠️ If the value is a composite (array/object) the return is a **live
   * reference** into the store; callers MUST treat it as read-only and never
   * mutate it. Use `get` when you need a safe, detached copy.
   * @param path - A dotted/bracketed path or pre-parsed segments
   * @return The live value, or `undefined` if the path is not set
   * @throws Error if a string path is malformed
   */
  public peek<T = TreeValue>(path: string | KeyPathPart[]): T | undefined {
    return getPath(this._root, path) as T | undefined;
  }


  /**
   * Tests whether a value exists at a path.
   * @param path - A dotted/bracketed path or pre-parsed segments
   * @return `true` if a value exists at the path
   * @throws Error if a string path is malformed
   */
  public has(path: string | KeyPathPart[]): boolean {
    return hasPath(this._root, path);
  }


  /**
   * Writes a value at a path, creating intermediate containers as needed.
   * The value is deep-copied on the way in so later external mutation can't
   * reach into the store.
   * @param path - A dotted/bracketed path or pre-parsed segments (non-empty)
   * @param value - The value to store
   * @return This store, for chaining
   * @throws Error if the path is empty or malformed
   */
  public set(path: string | KeyPathPart[], value: TreeValue): this {
    setPath(this._root, path, (typeof value === 'object' ? structuredClone(value) : value));
    return this;
  }


  /**
   * Removes the value at a path. Deleting an array element compacts the array.
   * @param path - A dotted/bracketed path or pre-parsed segments (non-empty)
   * @return This store, for chaining
   * @throws Error if the path is empty or malformed
   */
  public unset(path: string | KeyPathPart[]): this {
    deletePath(this._root, path);
    return this;
  }


  /**
   * Replaces the entire tree with a deep copy of the given one.
   * @param tree - The new tree contents
   * @return This store, for chaining
   */
  public replace(tree: TreeNode): this {
    this._root = structuredClone(tree);
    return this;
  }


  /**
   * Removes all values from the tree.
   * @return This store, for chaining
   */
  public clear(): this {
    this._root = {};
    return this;
  }


  /**
   * Returns a deep copy of the entire tree.
   * @return A structural copy of all values
   */
  public toJSON(): TreeNode {
    return structuredClone(this._root);
  }


  /**
   * Flattens the tree into a map of flat storage keys to string values.
   * Object keys are percent-encoded so structural `.` / `[` / `]` characters stay
   * unambiguous; array elements use `[n]`. Empty arrays and objects produce no
   * keys (they round-trip as absent). Keys are emitted in sorted order for
   * deterministic output.
   * @return A map of flat key to string value
   */
  public toFlat(): Map<string, string> {
    const out = new Map<string, string>();

    const walk = (value: TreeValue, parts: KeyPathPart[]): void => {
      if (Array.isArray(value)) {
        value.forEach((item, i) => walk(item, [...parts, i]));
      } else if (TreeStore.isPlainObject(value)) {
        for (const key of Object.keys(value).sort()) {
          walk(value[key], [...parts, key]);
        }
      } else {
        out.set(TreeStore.pathToFlatKey(parts), value);
      }
    };

    for (const key of Object.keys(this._root).sort()) {
      walk(this._root[key], [key]);
    }
    return out;
  }


  /**
   * Builds a store from flat key/value entries (the inverse of `toFlat`).
   * Entries whose keys can't be parsed are skipped.
   * @param entries - Iterable of `[flatKey, value]` pairs
   * @return A new store populated from the entries
   */
  public static fromFlat(entries: Iterable<[string, string]>): TreeStore {
    const store = new TreeStore();
    for (const [key, value] of entries) {
      const parts = TreeStore.flatKeyToPath(key);
      if (!parts) continue;
      setPath(store._root, parts, value);
    }
    return store;
  }


  /**
   * Parses a dotted/bracketed path string into its segments.
   * Object keys become strings; array indices (`[n]`) become numbers.
   * @param path - The path string, e.g. `a.b[0].c`
   * @return An array of path segments
   * @throws Error if the path is empty or contains an invalid array index
   */
  public static parsePath(path: string): KeyPathPart[] {
    return parsePath(path);
  }


  /**
   * Serializes path segments into a flat key.
   * Object keys are percent-encoded; array indices use `[n]`.
   * @param parts - The path segments
   * @return The flat key
   */
  public static pathToFlatKey(parts: KeyPathPart[]): string {
    let key = '';
    for (const part of parts) {
      if (typeof part === 'number') {
        key += `[${part}]`;
      } else {
        // `encodeURIComponent` escapes `[` and `]` but NOT `.`, so encode dots
        // explicitly to keep object keys unambiguous against the `.` separator.
        key += (key.length ? '.' : '') + encodeURIComponent(part).replace(/\./g, '%2E');
      }
    }
    return key;
  }


  /**
   * Parses a flat key back into path segments (the inverse of `pathToFlatKey`).
   * @param key - The flat key
   * @return The path segments, or `null` if the key is malformed
   */
  public static flatKeyToPath(key: string): KeyPathPart[] | null {
    const parts: KeyPathPart[] = [];
    let token = '';

    const flush = (): void => {
      if (token.length) {
        parts.push(decodeURIComponent(token));
        token = '';
      }
    };

    for (let i = 0; i < key.length; i++) {
      const ch = key[i];

      if (ch === '.') {
        flush();
        continue;
      }

      if (ch === '[') {
        flush();
        const close = key.indexOf(']', i);
        if (close === -1) return null;
        const index = Number(key.slice(i + 1, close));
        if (!Number.isInteger(index) || index < 0) return null;
        parts.push(index);
        i = close;
        continue;
      }

      token += ch;
    }

    flush();
    return parts.length ? parts : null;
  }


  /**
   * Tests whether a value is a plain object (not an array or `null`).
   * @param val - The value to test
   * @return `true` if `val` is a plain object
   */
  public static isPlainObject(val: unknown): val is TreeNode {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
  }


  /**
   * Recursively merges two values, with `override` winning over `base`.
   * Plain objects merge key-by-key; arrays and scalars from `override` replace
   * `base` wholesale. The result is a fresh deep copy (inputs are untouched).
   * @param base - The base value
   * @param override - The value whose keys take precedence
   * @return The merged value
   */
  public static merge(
    base: TreeValue | undefined,
    override: TreeValue | undefined
  ): TreeValue | undefined {
    if (override === undefined) return base;
    if (Array.isArray(override)) return structuredClone(override);

    if (TreeStore.isPlainObject(base) && TreeStore.isPlainObject(override)) {
      const result: TreeNode = structuredClone(base);
      for (const key of Object.keys(override)) {
        const merged = TreeStore.merge(result[key], override[key]);
        if (merged !== undefined) {
          result[key] = merged;
        }
      }
      return result;
    }

    return structuredClone(override);
  }
}
