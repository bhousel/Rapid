/**
 * A persistent vector: an immutable array indexed by small integers ("slots"), that shares
 * structure between versions. It's a 32-way trie: setting a slot copies only the path from the
 * root to that slot (4 arrays of 32 for up to a million slots, 6 at most), and every other subtree
 * stays shared with the previous version. Comparing two versions skips the subtrees they share.
 *
 * A slot's bits pick its path through the tree, 5 bits per level, starting from the top. With two
 * levels (`shift` 5), slot 1000 is at `root[31][8]`, because 1000 = 31 × 32 + 8.
 *
 * Writes may change a tree node in place when the writer owns it: each node remembers the
 * `owner` token of the writer that made it, and nothing else may hold a node while its owner
 * can still write to it. (Clojure calls these "transients".)
 *
 * `Graph` uses one per graph version, indexed by slots that its lineage gives out to entity IDs.
 * @see design/graph-geometry.md section 1
 */


/** An owner token: any object. A tree node made by an owner may be changed in place by it. */
export type VectorOwner = object;

/** A tree node: 32 children (subtrees, or values at the leaves) and, at index 32, its owner */
type VectorNode = Array<unknown>;

/** A version of a persistent vector */
export interface PersistentVector<T> {
  /** The root node, or `null` if empty */
  root: VectorNode | null;
  /** The bit shift of the root level: 0 for a single leaf node, then 5, 10, … */
  shift: number;
  /** Not stored: lets TypeScript keep the value type */
  readonly _type?: T;
}

const BITS = 5;
const WIDTH = 1 << BITS;   // 32
const MASK = WIDTH - 1;
const MAX_SHIFT = 25;      // 6 levels, for slots up to 2^30


/**
 * Makes an empty vector.
 * @return An empty vector
 */
export function vectorEmpty<T>(): PersistentVector<T> {
  return { root: null, shift: 0 };
}


/**
 * Gets the value at a slot.
 * @param vector - The vector
 * @param slot - The slot
 * @return The value, or `undefined` if none
 */
export function vectorGet<T>(vector: PersistentVector<T>, slot: number): T | undefined {
  const shift = vector.shift;
  if (shift < MAX_SHIFT && (slot >>> (shift + BITS)) !== 0) return undefined;   // beyond capacity

  let node = vector.root;
  for (let sh = shift; sh > 0; sh -= BITS) {
    if (!node) return undefined;
    node = node[(slot >>> sh) & MASK] as VectorNode | null;
  }
  return node ? node[slot & MASK] as T | undefined : undefined;
}


/**
 * Sets the value at a slot (`undefined` clears it). If the slot is past the tree's current
 * capacity, the tree first grows taller: the old root becomes the first child of a new root.
 *
 * Callers must keep the returned version. Tree nodes that `owner` made are changed in place,
 * so the old version sees those writes too. That's only safe while nothing but the writer holds
 * the old version, which is why `Graph` gives both graphs new owner tokens when one derives from
 * the other.
 * @param vector - The vector
 * @param slot - The slot
 * @param value - The value
 * @param owner - The writer's owner token: tree nodes it made are changed in place
 * @return The new version (the same object if nothing changed)
 * @throws Error if the slot is beyond the vector's capacity (2^30)
 */
export function vectorSet<T>(vector: PersistentVector<T>, slot: number, value: T | undefined, owner: VectorOwner): PersistentVector<T> {
  if (slot < 0 || slot >= (1 << (MAX_SHIFT + BITS))) {
    throw new Error(`PersistentVector: slot ${slot} is out of range`);
  }
  if (value === undefined && vectorGet(vector, slot) === undefined) return vector;   // nothing to clear

  let root = vector.root;
  let shift = vector.shift;
  while (shift < MAX_SHIFT && (slot >>> (shift + BITS)) !== 0) {   // grow a level
    if (root) {
      const grown = _newNode(owner);
      grown[0] = root;
      root = grown;
    }
    shift += BITS;
  }

  const newRoot = _setIn(root, shift, slot, value, owner);
  if (newRoot === vector.root && shift === vector.shift) return vector;
  return { root: newRoot, shift: shift };
}


/**
 * Calls `fn` for every slot whose value differs between two versions (compared by identity),
 * skipping the subtrees they share.
 * @param a - One version
 * @param b - The other version
 * @param fn - Called with the slot and both values
 */
export function vectorDiff<T>(a: PersistentVector<T>, b: PersistentVector<T>, fn: (slot: number, va: T | undefined, vb: T | undefined) => void): void {
  const shift = Math.max(a.shift, b.shift);
  _diffNode(_liftRoot(a, shift), _liftRoot(b, shift), shift, 0, fn);
}


/**
 * Calls `fn` for every slot that has a value.
 * @param vector - The vector
 * @param fn - Called with the slot and its value
 */
export function vectorForEach<T>(vector: PersistentVector<T>, fn: (slot: number, value: T) => void): void {
  _walk(vector.root, vector.shift, 0, fn);
}


/**
 * Makes an empty tree node that belongs to `owner`.
 * @param owner - The writer's owner token
 * @return A node with 32 empty children
 */
function _newNode(owner: VectorOwner): VectorNode {
  const node = new Array<unknown>(WIDTH + 1);
  node[WIDTH] = owner;
  return node;
}

/**
 * Copies a tree node for a writer that doesn't own it (copy-on-write). The copy shares the
 * original's children and belongs to `owner`, so the writer's later writes can change it in place.
 * @param node - The node to copy, or `null` to make an empty one
 * @param owner - The writer's owner token
 * @return The copy
 */
function _copyNode(node: VectorNode | null, owner: VectorOwner): VectorNode {
  const copy = node ? node.slice() : new Array<unknown>(WIDTH + 1);
  copy[WIDTH] = owner;
  return copy;
}

/**
 * Sets the value at a slot in the subtree under `node`, and returns the subtree's new root.
 * Each call goes down one level. On the way back up, each node on the path is changed in place
 * if `owner` made it, and copied otherwise. Nodes off the path stay shared.
 * If the slot already holds the value, it returns `node` itself, which tells the levels above
 * that nothing changed.
 * @param node - The subtree's root, or `null` if the subtree is empty
 * @param sh - The bit shift of `node`'s level: 0 at the leaves, which hold the values
 * @param slot - The slot
 * @param value - The value (`undefined` clears it)
 * @param owner - The writer's owner token
 * @return The subtree's new root (`node` itself if nothing changed)
 */
function _setIn(node: VectorNode | null, sh: number, slot: number, value: unknown, owner: VectorOwner): VectorNode | null {
  const i = (slot >>> sh) & MASK;
  if (sh === 0) {
    if (node && node[i] === value) return node;
    if (node && node[WIDTH] === owner) {
      node[i] = value;
      return node;
    }
    const copy = _copyNode(node, owner);
    copy[i] = value;
    return copy;
  }

  const child = node ? node[i] as VectorNode | null : null;
  const next = _setIn(child ?? null, sh - BITS, slot, value, owner);
  if (next === child) return node;
  if (node && node[WIDTH] === owner) {
    node[i] = next;
    return node;
  }
  const copy = _copyNode(node, owner);
  copy[i] = next;
  return copy;
}

/**
 * Returns a vector's root raised to a taller tree's height, so that `_diffNode` can walk two
 * versions of different heights level by level. Each extra level is a new node whose first
 * child is the level below, the same shape `vectorSet` makes when it grows a tree. The new
 * nodes are temporary and have no owner, so no writer will ever change them.
 * @param vector - The vector
 * @param shift - The bit shift of the taller tree's root
 * @return The raised root, or `null` if the vector is empty
 */
function _liftRoot<T>(vector: PersistentVector<T>, shift: number): VectorNode | null {
  let root = vector.root;
  for (let sh = vector.shift; sh < shift && root; sh += BITS) {
    const lifted = new Array<unknown>(WIDTH + 1);
    lifted[0] = root;
    lifted[WIDTH] = null;
    root = lifted;
  }
  return root;
}

/**
 * Calls `fn` for every slot whose value differs between two subtrees at the same position.
 * This is where sharing pays off: when both versions hold the same child (by identity), nothing
 * under it can differ, so it's skipped without looking inside. Comparing a graph with the graph
 * it was derived from only visits the paths to the slots it wrote.
 * @param a - The subtree in one version, or empty
 * @param b - The subtree in the other version, or empty
 * @param sh - The bit shift of this level
 * @param offset - The first slot under these subtrees
 * @param fn - Called with the slot and both values
 */
function _diffNode<T>(a: Nullable<VectorNode>, b: Nullable<VectorNode>, sh: number, offset: number, fn: (slot: number, va: T | undefined, vb: T | undefined) => void): void {
  if (a === b) return;
  for (let i = 0; i < WIDTH; i++) {
    const ca = a ? a[i] : undefined;
    const cb = b ? b[i] : undefined;
    if (ca === cb) continue;
    if (sh === 0) {
      fn(offset + i, ca as T | undefined, cb as T | undefined);
    } else {
      _diffNode(ca as Nullable<VectorNode>, cb as Nullable<VectorNode>, sh - BITS, offset + i * (1 << sh), fn);
    }
  }
}

/**
 * Calls `fn` for every slot that has a value in the subtree under `node`, in slot order.
 * Empty subtrees are skipped.
 * @param node - The subtree's root, or empty
 * @param sh - The bit shift of `node`'s level
 * @param offset - The first slot under `node`
 * @param fn - Called with the slot and its value
 */
function _walk<T>(node: Nullable<VectorNode>, sh: number, offset: number, fn: (slot: number, value: T) => void): void {
  if (!node) return;
  for (let i = 0; i < WIDTH; i++) {
    const child = node[i];
    if (child === undefined || child === null) continue;
    if (sh === 0) {
      fn(offset + i, child as T);
    } else {
      _walk(child as VectorNode, sh - BITS, offset + i * (1 << sh), fn);
    }
  }
}
