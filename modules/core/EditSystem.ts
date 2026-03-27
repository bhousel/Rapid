import { easeLinear as d3_easeLinear } from 'd3-ease';
import { select as d3_select } from 'd3-selection';
import { Extent, geoScaleToZoom } from '@rapid-sdk/math';
import { utilArrayGroupBy, utilObjectOmit, utilSessionMutex } from '@rapid-sdk/util';

import { AbstractSystem } from './AbstractSystem.ts';
import { Difference, Edit, Graph, Tree } from '../lib/index.ts';
import { OsmEntity as OsmEntityClass, createOsmEntity } from '../data/index.ts';
import { uiLoading } from '../ui/loading.js';

import type { Context } from '../Context.ts';
import type { Action } from '../actions/types.ts';
import type { OsmEntity, OsmEntityProps, OsmTags } from '../data/types.ts';
import type { TransformProps, Vec2 } from '@rapid-sdk/math';


/** Options for commit/commitAppend */
export interface CommitOptions {
  /** Annotation describing the edit */
  annotation?: string | Record<string, unknown>;
  /** IDs of selected entities */
  selectedIDs?: EntityID[];
}

/** Sources used during editing */
export interface EditSources {
  /** Imagery sources used */
  imagery?: string[];
  /** Photo sources used */
  photos?: string[];
  /** Data sources used */
  data?: string[];
  /** Index signature for compatibility with Record<string, unknown> */
  [key: string]: unknown;
}

/** Saved checkpoint state */
interface Checkpoint {
  /** Shallow copy of history at checkpoint time */
  history: Edit[];
  /** Index at checkpoint time */
  index: number;
}

/** Changes summary returned by changes() */
export interface ChangesSummary {
  /** Newly created entities */
  created: OsmEntity[];
  /** Modified entities */
  modified: OsmEntity[];
  /** Deleted entities */
  deleted: OsmEntity[];
}

/** Backup JSON structure */
interface BackupJSON {
  version: number;
  entities: unknown[];
  baseEntities: unknown[];
  stack: unknown[];
  nextIDs: Record<string, number>;
  index: number;
  timestamp: number;
}

/** Entity copy - as bag of properties */
interface EntityCopy {
  /** Unique identifier for this data element */
  id: string;
  /** String describing what kind of data element this is (e.g. 'node', 'way', 'relation') */
  type?: string;
  /** OSM tags as key-value string pairs */
  tags?: OsmTags;
  /** Internal version number, used to detect changes */
  v?: number;
  /** OSM visibility attribute - objects with visible=false are considered deleted */
  visible?: boolean;
  /** OSM version attribute, used for conflict detection */
  version?: number;
  /** OSM user who last edited this entity */
  user?: string;
  /** OSM changeset ID */
  changeset?: string;
  /** Timestamp of last edit */
  timestamp?: string;
  /** Location (if an OsmNode) */
  loc?: Vec2;
  /** Nodes (if an OsmWay) */
  nodes?: string[];
  /** Members (if an OsmRelation) */
  members?: Array<{ id: string }>;
  /** Allow extra properties */
  [key: string]: unknown;
}


/**
 * `EditSystem` maintains the history of user edits.
 * (This used to be called 'history', but that word means something else in browsers)
 *
 * This system maintains a Base Graph, a stack of Edit history, and a `staging` Edit.
 *
 * The Base Graph contains the base map state - all map entities that have been loaded
 *   and what they look like before any edits have occurred.
 * As more map is loaded, more map features get merged into the Base Graph.
 *
 * Each entry in the history stack is an `Edit`.  An Edit may contain:
 *  - `annotation`  - undo/redo annotation, a String saying what the Edit did. e.g. "Started a Line".
 *  - `graph`       - Graph at the time of the Edit
 *  - `selectedIDs` - ids that the user had selected at the time (assumed to be OSM)
 *  - `sources`     - sources being used to make the Edit (imagery, photos, data)
 *  - `transform`   - map transform at the time of the Edit
 *
 * Special named Edits:
 *  - `base` - The initial Edit, `history[0]`.
 *     The `base` Edit contains the Base Graph and nothing else.
 *  - `stable` - The latest accepted Edit, `history[index]`.
 *     The `stable` Edit is suitable for validation, backups, saving.
 *  - `staging` - A work-in-progress Edit, not yet added to the history.
 *     The `staging` Edit is used throughout the application to determine the current map state.
 *
 *  The history might look like this:
 *
 *   `base`           …undo    `stable`   redo…
 *  [ Edit0 --> … --> Edit1 --> Edit2 --> Edit3 ]
 *                                 \
 *                                  \-->  EditN
 *                                       `staging` (WIP after `stable`)
 *
 * Code elsewhere in the application can use these methods to make edits and manipulate the history:
 * - `perform(action)` - This performs a bit of work.  Perform accepts a varible number of
 *      "action" arguments. Actions are functions that accept a Graph and return a modified Graph.
 *      All work is performed against the `staging` edit.
 * - `revert()` - This reverts all work in progress by replacing `staging` with a fresh copy of `stable`.
 * - `commit(options)` - This accepts the `staging` work-in-progress edit by adding
 *      it to the end of the history (removing any forward redo history, if any)
 *      Commit accepts an `annotation` (e.g. "Started a line") to say what the edit does.
 * - `commitAppend(options)` - This is just like `commit` but instead of
 *      adding `staging` after `stable`, `staging` replaces `stable`.
 * - `undo()` - Move the `stable` index back to the previous Edit (or `_index = 0`).
 * - `redo()` - Move the `stable` index forward to the next Edit (if any)
 * - `setCheckpoint(checkpointID)` - Save `history` and `index` as a checkpoint to return to later.
 * - `restoreCheckpoint(checkpointID)` - Restore `history` and `index` identified by checkpointID.
 *
 * Code can also wrap calls in a "transaction", which will prevent change events from being emitted.
 * - `beginTransaction()` - Prevents `stagingchange` and `stablechange` events from being emitted.
 * - `endTransaction()` - Marks transaction as complete.  Any `stagingchange` and `stablechange`
 *      events will be emitted that cover the difference from the beginning -> end of the transaction.
 *
 * Events available:
 *   'stagingchange' - Fires on every edit performed (i.e. when `staging` changes),
 *      Receives Difference between old `staging` Graph and new `staging` Graph.
 *   'stablechange' - Fires only when the history actually changes (i.e. when `stable` changes)
 *      Receives Difference between old `stable` Graph and new `stable` Graph.
 *   'historyjump' - Fires on undo/redo/restore.  This is for situations when we may need to
 *      jump the user to a different part of the map and restore a different selection.
 *      Receives `prevIndex` and `currIndex`
 *   'merge'  - Fires when new base entities are merged into the base graph
 *   'backupstatuschange' - Fires when backup status changes, receives `true` if ok, `false` if failed
 */
export class EditSystem extends AbstractSystem {
  private _mutex: ReturnType<typeof utilSessionMutex>;
  private _canRestoreBackup: boolean;
  private _hasWorkInProgress: boolean;

  private _history: Edit[];
  private _index: number;
  private _staging: Edit;

  private _checkpoints: Map<CheckpointID, Checkpoint>;
  private _inTransition: boolean;
  private _inTransaction: boolean;
  private _tree: Tree;

  private _backupStatus: boolean;
  private _stableKey: string | null;
  private _stableSnapshot: Graph | null;
  private _stagingKey: string | null;
  private _stagingSnapshot: Graph | null;
  private _fullDifference: Difference;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);

    this.id = 'editor';     // was 'history'
    this.requiredDependencies = new Set(['spatial', 'storage']);
    this.optionalDependencies = new Set(['gfx', 'imagery', 'photos', 'scheduler']);

    this._mutex = utilSessionMutex('lock');
    this._canRestoreBackup = false;
    this._hasWorkInProgress = false;

    this._history = [];
    this._index = 0;
    this._staging = null!;

    this._checkpoints = new Map();
    this._inTransition = false;
    this._inTransaction = false;
    this._tree = null!;

    this._backupStatus = true;
    this._stableKey = null;
    this._stableSnapshot = null;
    this._stagingKey = null;
    this._stagingSnapshot = null;
    this._fullDifference = null!;

    // Make sure the event handlers have `this` bound correctly
    this.immediateBackup = this.immediateBackup.bind(this);
    this.deferredBackup = this.deferredBackup.bind(this);
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const storage = context.systems.storage;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [ storage?.initAsync() ];
        return Promise.all(prerequisites.filter(Boolean) as Promise<void>[]);
      })
      .then(() => {
        this._reset();

        const isTestEnvironment = (!('window' in globalThis)) || ('assert' in globalThis) || ('expect' in globalThis);
        if (isTestEnvironment) return;

        // Setup event handlers..
        window.addEventListener('beforeunload', (e: BeforeUnloadEvent) => {
          if (this._history.length > 1) {  // user did something
            e.preventDefault();
            this.immediateBackup();
            return (e.returnValue = '');  // show browser prompt
          }
        });

        window.addEventListener('unload', () => this._mutex.unlock());

        // changes are restorable if Rapid is not open in another window/tab and a backup exists in localStorage
        this._canRestoreBackup = this._mutex.lock() && storage!.hasItem(this._backupKey());
      });
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    const prevIndex = this._index;
    this._reset();

    // Emit all events
    this.emit('stagingchange', this._fullDifference);  // will be an empty Difference (this is ok)
    this.emit('stablechange', this._fullDifference);
    this.emit('historyjump', prevIndex, this._index);
    this.emit('backupstatuschange', this._backupStatus);  // emit `true` to clear any previous errors

    return Promise.resolve();
  }


  /**
   * _reset
   * Internal reset of all stored data
   */
  private _reset(): void {
    d3_select(document).interrupt('editTransition');    // complete any transition already in progress
    this.context.systems.scheduler?.cancel('edit-backup');

    // Create a new Base Graph / Base Edit.
    const baseGraph = new Graph(this.context);
    const base = new Edit({ graph: baseGraph });
    this._history = [ base ];
    this._index = 0;

    // Create a work-in-progress Edit derived from the base edit.
    const currGraph = new Graph(baseGraph);
    const staging = new Edit({ graph: currGraph });
    this._staging = staging;
    this._hasWorkInProgress = false;
    this._tree = new Tree(currGraph, 'osm');

    this._stableKey = baseGraph.key;
    this._stableSnapshot = baseGraph.snapshot();
    this._stagingKey = currGraph.key;
    this._stagingSnapshot = currGraph.snapshot();
    this._fullDifference = new Difference(baseGraph, baseGraph);

    this._backupStatus = true;
    this._checkpoints.clear();
    this._inTransition = false;
    this._inTransaction = false;
  }


  /**
   * base
   * The `base` edit is the initial edit in the history.  It contains the Base Graph.
   * It will not contain any actual user edits, sources, annotation.
   * @return The initial Edit containing the Base Graph
   */
  get base(): Edit {
    return this._history[0];
  }

  /**
   * stable
   * The `stable` edit is the latest accepted edit in the history, as indicated by `_index`.
   * The `stable` edit is suitable for validation or backups.
   * Before the user edits anything, `_index === 0`, so the `stable === base`.
   * Note that "future" redo history can continue past the `stable` edit, if the user has undone.
   * @return The latest accepted Edit in the history
   */
  get stable(): Edit {
    return this._history[this._index];
  }

  /**
   * staging
   * The `staging` edit will be a placeholder work-in-progress edit in the chain immediately
   * following the `stable` edit.  The user may be drawing a feature or editing tags.
   * The `staging` edit has not been added to the history yet.
   * @return The `staging` work-in-progress Edit
   */
  get staging(): Edit {
    return this._staging;
  }

  /**
   * tree
   * The tree is a spatial index that keeps itself in sync with the `staging` graph.
   * @return The Tree (spatial index)
   */
  get tree(): Tree {
    return this._tree;
  }

  /**
   * history
   * A shallow copy of the history.
   * @return A shallow copy of the history
   */
  get history(): Edit[] {
    return this._history.slice();
  }

  /**
   * index
   * Index pointing to the current `stable` Edit
   * @return Index pointing to the current `stable` Edit
   */
  get index(): number {
    return this._index;
  }

  /**
   * hasWorkInProgress
   * Is there work in progress in the `staging` edit?
   * @return `true` if there is work in progress in the `staging` edit.
   */
  get hasWorkInProgress(): boolean {
    return this._hasWorkInProgress;
  }


  /**
   * perform
   * This performs a bit of work.  Perform accepts a variable number of "action" arguments.
   * "Actions" are functions that accept a Graph and return a modified Graph.
   * All work is performed against the `staging` work-in-progress edit.
   * If multiple functions are passed, they will be performed in order,
   *   and an `stagingchange` event will be emitted after they have all completed.
   * @param args - Variable number of Action functions to peform
   * @return Difference between before and after of `staging` Edit
   */
  perform(...args: Action[]): Difference | undefined {
    d3_select(document).interrupt('editTransition');    // complete any transition already in progress
    this._perform(args, 1);
    return this._emitChanges();   // only one place in the code uses this return - split operation?
  }


  /**
   * performAsync
   * Promisified version of `perform` that can support eased edits in a transition.
   * This version of `perform` accepts a single Action function argument.
   * If the Action is marked as being "transitionable", run it multiple times with
   *   eased time parameter from 0..1 to create a smooth transition effect.
   * If the Action is not marked as being "transitionable" just run it one time
   *   with `time = 1` and return a resolved promise.
   *
   * @param action - single Action function to perform
   * @return Promise fulfilled when the transition is completed
   */
  performAsync(action: Action): Promise<void> {
    d3_select(document).interrupt('editTransition');    // complete any transition already in progress

    if (typeof action !== 'function') {
      return Promise.reject();
    }

    if (!action.transitionable) {
      this._perform([action], 1);
      this._emitChanges();
      return Promise.resolve();
    }

    const DURATION = 150;

    return new Promise(resolve => {
      d3_select(document)
        .transition('editTransition')
        .duration(DURATION)
        .ease(d3_easeLinear)
        .tween('edit.tween', () => {
          return (t: number) => {
            if (t < 1) {
              this._replaceStaging();
              this._perform([action], t);
              this._emitChanges();
            }
          };
        })
        .on('start', () => {
          this._inTransition = true;
          this._replaceStaging();
          this._perform([action], 0);
          this._emitChanges();
        })
        .on('end interrupt', () => {
          this._replaceStaging();
          this._perform([action], 1);
          this._emitChanges();
          this._inTransition = false;
          resolve();
        });
    });
  }


  /**
   * revert
   * This reverts the `staging` work-in-progress by replacing `staging` with a fresh copy of `stable`.
   * (It's more like what `git reset --hard` does, but we can't call it "reset")
   */
  revert(): Difference | undefined {
    if (!this._hasWorkInProgress) return;

    d3_select(document).interrupt('editTransition');    // complete any transition already in progress
    this._replaceStaging();
    return this._emitChanges();
  }


  /**
   * commit
   * This finalizes the `staging` work-in-progress edit.
   * (It's somewhat like what `git commit` does.)
   *  - Set annotation, sources, and other edit metadata properties
   *  - Add the `staging` edit to the end of the history (at this point `staging` becomes `stable`)
   *  - Finally, create a new empty `staging` work-in-progress Edit
   *
   * Before calling `commit()`:
   *
   *   `base`           …undo    `stable`   redo…
   *  [ Edit0 --> … --> Edit1 --> Edit2 --> Edit3 ]
   *                                 \
   *                                  \-->  EditN0
   *                                       `staging` (WIP after Edit2)
   * After calling `commit()`:
   *
   *   `base`                     …undo    `stable`
   *  [ Edit0 --> … --> Edit1 --> Edit2 --> EditN0 ]
   *                                           \
   *                                            \-->  EditN1
   *                                                 `staging` (WIP after EditN0)
   *
   * @param options - Optional `Object` of options passed
   * @param options.annotation - A String saying what the Edit did. e.g. "Started a Line".
   *   Note that Rapid edits pass an Object as the annotation including more info about the edit.
   * @param options.selectedIDs - Array of selectedIDs
   */
  commit(options: CommitOptions = {}): void {
    d3_select(document).interrupt('editTransition');    // complete any transition already in progress

    const context = this.context;
    const staging = this.staging;

    const annotation = options.annotation ?? '';
    staging.annotation  = annotation as string;
    staging.selectedIDs = options.selectedIDs ?? [];
    staging.sources     = this._gatherSources(annotation);
    staging.transform   = context.viewport.transform.props;

    // Discard forward/redo history if any, and add `staging` after `stable`
    this._history.splice(this._index + 1, Infinity, staging);
    this._index++;
    // (At this point `stable` === `staging`)

    this._replaceStaging();
    this._emitChanges();
  }


  /**
   * commitAppend
   * This is like `commit`, but instead of adding `staging` after stable,
   *   it replaces `stable` with `staging` and does not advance the history.
   * (It's somewhat like what `git commit --append` does.)
   *  - Set annotation, sources, and other edit metadata properties
   *  - Replace the `stable` edit with the `staging` edit (at this point `staging` becomes `stable`)
   *  - Finally, create a new empty `staging` work-in-progress Edit
   *
   * Note:  You can't do this if there are no edits yet - it will throw if you try to append to the `base` edit.
   *
   * Before calling `commitAppend()`:
   *
   *   `base`           …undo    `stable`   redo…
   *  [ Edit0 --> … --> Edit1 --> Edit2 --> Edit3 ]
   *                                 \
   *                                  \-->  EditN0
   *                                       `staging` (WIP after Edit2)
   * After calling `commitAppend()`:
   *
   *   `base`           …undo    `stable`
   *  [ Edit0 --> … --> Edit1 --> EditN0 ]
   *                                 \
   *                                  \-->  EditN1
   *                                       `staging` (WIP after EditN0)
   *
   * @param options - Optional `Object` of options passed
   * @param options.annotation - A String saying what the Edit did. e.g. "Started a Line".
   *   Note that Rapid edits pass an Object as the annotation including more info about the edit.
   * @param options.selectedIDs - Array of selectedIDs
   * @throws Will throw if you try to append to the `base` edit
   */
  commitAppend(options: CommitOptions = {}): void {
    d3_select(document).interrupt('editTransition');    // complete any transition already in progress

    const context = this.context;
    const staging = this.staging;

    if (this._index === 0) {
      throw new Error(`Can not commitAppend to the base edit!`);
    }

    const annotation = options.annotation ?? '';
    staging.annotation  = annotation as string;
    staging.selectedIDs = options.selectedIDs ?? [];
    staging.sources     = this._gatherSources(annotation);
    staging.transform   = context.viewport.transform.props;

    // Discard forward/redo history if any, and replace `stable` with `staging`.
    this._history.splice(this._index, Infinity, staging);
    // (At this point `stable` === `staging`)

    this._replaceStaging();
    this._emitChanges();
  }


  /**
   * undo
   * If there is work-in-progress on the `staging` edit, revert to `stable`
   * Otherwise, move the `stable` index back to the previous Edit (or `_index = 0`).
   * Note that all work-in-progress in the `staging` Edit is lost when calling `undo()`.
   *
   * Before calling `undo()`:
   *
   *   `base`           …undo    `stable`   redo…
   *  [ Edit0 --> … --> Edit1 --> Edit2 --> Edit3 ]
   *                                 \
   *                                  \-->  EditN0
   *                                       `staging` (WIP after Edit2)
   * After calling `undo()`:
   *
   *   `base`  …undo   `stable`   redo…
   *  [ Edit0 --> … --> Edit1 --> Edit2 --> Edit3 ]
   *                       \
   *                        \-->  EditN1
   *                             `staging` (WIP after Edit1)
   */
  undo(): void {
    d3_select(document).interrupt('editTransition');    // complete any transition already in progress

    const prevIndex = this._index;

    if (this._hasWorkInProgress) {
      this.revert();
      this.emit('historyjump', prevIndex, this._index);
      return;
    }

    if (this._index > 0) {
      this._index--;
    }

    if (this._index !== prevIndex) {
      this._replaceStaging();
      this._emitChanges();
      this.emit('historyjump', prevIndex, this._index);
    }
  }


  /**
   * redo
   * Move the `stable` index forward to the next Edit (if any)
   * Note that all work-in-progress in the `staging` Edit is lost when calling `redo()`.
   *
   * Before calling `redo()`:
   *
   *   `base`           …undo    `stable`   redo…
   *  [ Edit0 --> … --> Edit1 --> Edit2 --> Edit3 ]
   *                                 \
   *                                  \-->  EditN0
   *                                       `staging` (WIP after Edit2)
   * After calling `redo()`:
   *
   *   `base`                     …undo    `stable`
   *  [ Edit0 --> … --> Edit1 --> Edit2 --> Edit3 ]
   *                                           \
   *                                            \-->  EditN1
   *                                                 `staging` (WIP after Edit3)
   */
  redo(): void {
    d3_select(document).interrupt('editTransition');    // complete any transition already in progress

    const prevIndex = this._index;
    if (this._index < this._history.length - 1) {
      this._index++;
    }

    if (this._index !== prevIndex) {
      this._replaceStaging();
      this._emitChanges();
      this.emit('historyjump', prevIndex, this._index);
    }
  }


  /**
   * setCheckpoint
   * This saves the `history` and `index` as a "checkpoint" that we can return to later.
   * If the given checkpointID exists, it will be overwritten.
   * @param checkpointID - A string to identify the checkpoint
   */
  setCheckpoint(checkpointID: CheckpointID): void {
    if (!checkpointID) return;
    d3_select(document).interrupt('editTransition');    // complete any transition already in progress

    // Save a shallow copy of history, in case user undos away the edit that `_index` points to.
    this._checkpoints.set(checkpointID, {
      history: this._history.slice(),  // shallow copy
      index: this._index
    });
  }


  /**
   * restoreCheckpoint
   * This returns the `history` and `index` back to the edit identified by the given checkpointID.
   * Note that all work-in-progress in the `staging` Edit is lost when calling `restoreCheckpoint()`.
   * @param checkpointID - A string to identify the checkpoint
   */
  restoreCheckpoint(checkpointID: CheckpointID): void {
    if (!checkpointID) return;
    d3_select(document).interrupt('editTransition');    // complete any transition already in progress

    const prevIndex = this._index;
    const checkpoint = this._checkpoints.get(checkpointID);

    if (checkpoint) {
      this._history = checkpoint.history.slice();   // shallow copy
      this._index = checkpoint.index;

      this._replaceStaging();
      this._emitChanges();
      this.emit('historyjump', prevIndex, this._index);
    }
  }


  /**
   * deleteCheckpoint
   * This removes the checkpoint identified by the given checkpointID.
   * @param checkpointID - A string to identify the checkpoint
   */
  deleteCheckpoint(checkpointID: CheckpointID): void {
    if (!checkpointID) return;
    this._checkpoints.delete(checkpointID);
  }


  /**
   *  merge
   *  Merge new entities into the Base Graph.
   *  (Sorry, but this one is not like what `git merge` does.)
   *
   *  This function is called when we have parsed a new tile of OSM data, we will
   *   receive the new entities and a list of all entity ids that the tile contains.
   *  Can also be called in other situations, like restoring history from
   *    storage, or loading specific entities from the OSM API.
   *  This function can accept an Array of Entities or an Array of props to construct.
   *
   *  @param toMerge - Entities (or props) to merge into base graph (usually only the new ones)
   *  @param seenIDs - Optional set of all entity IDs on the tile (including previously seen ones)
   */
  merge(toMerge: (OsmEntity | OsmEntityProps)[], seenIDs?: Set<EntityID>): void {
    const context = this.context;
    const baseGraph = this.base.graph!;
    const stagingGraph = this.staging.graph!;
    const newIDs = new Set<EntityID>();

    // Collect the Entities, create if necessary...
    const entities: OsmEntity[] = [];
    for (const props of toMerge) {
      let entity: OsmEntity;
      if (props instanceof OsmEntityClass) {
        entity = props;
      } else {
        entity = createOsmEntity(context, props);
      }
      entities.push(entity);

      // Which ones are really new (not in the Base Graph)?
      if (!baseGraph.hasEntity(entity.id)) {
        newIDs.add(entity.id);
      }
    }
    if (!entities.length) return;  // nothing to do


    // Note: I'd like to try to find a way to avoid seenIDs, but we probably need it for now.
    // The emit('merge', seenIDs) below triggers a re-render of all features on a tile,
    // even the previously seen ones. The reason is because new information could cause
    // features to render differently.  An example would be: ways that are members of
    // a large multipolygon could be part of the outer or a hole, and those ways need to
    // redraw even if different ways appear.
    // see https://github.com/facebook/Rapid/commit/4223385
    let effectiveSeenIDs: Set<EntityID>;
    if (seenIDs instanceof Set) {
      effectiveSeenIDs = seenIDs;
    } else {
      effectiveSeenIDs = new Set(entities.map(entity => entity.id));
    }

    // If we are merging in new relation members, bump the relation's version.
    for (const id of effectiveSeenIDs) {
      const entity = stagingGraph.hasEntity(id);
      if (entity?.type !== 'relation') continue;

      for (const member of (entity as any).members) {
        if (newIDs.has(member.id)) {
          (entity as any).touch();  // bump version in place
        }
      }
    }

    // Append staging graph..
    // It's not in the history yet, but it represents the current state of things.
    const graphs = this._history.map(state => state.graph!);
    graphs.push(stagingGraph);

    baseGraph.rebase(entities, graphs, false);  // force = false
    this._tree.rebase(entities, false);         // force = false

    this.emit('merge', effectiveSeenIDs);
  }


  /**
   * beginTransaction
   * Prevents `stagingchange` and `stablechange` events from being emitted.
   * During a transaction, edits can be performed but no `change` events will be emitted.
   * This is to prevent other parts of the code from rendering/validating partial or incomplete edits.
   */
  beginTransaction(): void {
    this._inTransaction = true;
  }


  /**
   * endTransaction
   * This marks the transaction as complete, and allows events to be emitted again.
   * Any `stagingchange` and `stablechange` events will be emitted that cover
   *   the difference from the beginning -> end of the transaction.
   */
  endTransaction(): Difference | undefined {
    this._inTransaction = false;
    return this._emitChanges();
  }


  /**
   * getUndoAnnotation
   * @return The previous undo annotation, or `undefined` if none
   */
  getUndoAnnotation(): string | undefined {
    let i = this._index;
    while (i >= 0) {
      const edit = this._history[i];
      if (edit.annotation) return edit.annotation;
      i--;
    }
  }


  /**
   * getRedoAnnotation
   * @return The next redo annotation, or `undefined` if none
   */
  getRedoAnnotation(): string | undefined {
    let i = this._index + 1;
    while (i <= this._history.length - 1) {
      const edit = this._history[i];
      if (edit.annotation) return edit.annotation;
      i++;
    }
  }


  /**
   * intersects
   * Returns the entities from the `staging` graph with bounding boxes overlapping the given `extent`.
   * @param extent - the extent to test
   * @return Entities intersecting the given Extent
   */
  intersects(extent: Extent): OsmEntity[] {
    return this._tree.intersects(extent, this.staging.graph!);
  }


  /**
   * difference
   * Returns a `Difference` containing all edits from `base` -> `stable`
   * We use this pretty frequently, so it's cached in `this._fullDifference`
   *  and recomputed by the `_emitChanges` function only when `stable` changes.
   * @return The total changes made by the user during their edit session
   */
  difference(): Difference {
    return this._fullDifference;
  }


  /**
   * changes
   * This returns a summery of all changes made from `base` -> `stable`
   * Optionally includes a given action function to apply to the `stable` graph.
   * @param action - Optional action to apply to the `stable` graph
   * @return Object containing `modified`, `created`, `deleted` summary of changes
   */
  changes(action?: Action): ChangesSummary {
    let difference = this._fullDifference;

    if (action) {
      const base = this.base.graph!;
      const head = action(this.stable.graph!);
      difference = new Difference(base, head);
    }

    return {
      created:  difference.created(),
      modified: difference.modified(),
      deleted:  difference.deleted()
    };
  }


  /**
   * hasChanges
   * This counts meangful edits only (modified, created, deleted).
   * For example, we could perform a bunch of no-op edits and it would still return false.
   * @return `true` if the user has made any meaningful edits
   */
  hasChanges(): boolean {
    return this._fullDifference.changes.size > 0;
  }


  /**
   * sourcesUsed
   * This prepares the list of all sources used during the user's editing session.
   * This is called by `commit.js` when preparing the changeset before uploading.
   * @return Object of all sources used during the user's editing session
   */
  sourcesUsed(): { imagery: Set<string>; photos: Set<string>; data: Set<string> } {
    const result: { imagery: Set<string>; photos: Set<string>; data: Set<string> } = {
      imagery: new Set(),
      photos:  new Set(),
      data:    new Set()
    };

    // Start at `1` - there won't be sources on the `base` edit..
    // End at `_index` - don't continue into the redo part of the history..
    for (let i = 1; i <= this._index; i++) {
      const edit = this._history[i];
      for (const which of ['imagery', 'photos', 'data'] as const) {
        for (const val of (edit.sources as EditSources)[which] ?? []) {
          result[which].add(val);
        }
      }
    }

    return result;
  }


  /**
   * toIntroGraph
   * This is used to export the intro graph used by the walkthrough.
   * This function is indended to be called manually by developers.
   * We only use this on very rare occasions to change the walkthrough data.
   *
   * To use it:
   *  1. Start the walkthrough.
   *  2. Get to a "free editing" tutorial step
   *  3. Make your edits to the walkthrough map
   *  4. In your browser dev console run:  `context.systems.editor.toIntroGraph()`
   *  5. This outputs stringified JSON to the browser console (it will be a lot!)
   *  6. Copy it to `data/intro_graph.json` and prettify it in your code editor
   *
   * @returns The stringified walkthrough data
   */
  toIntroGraph(): string {
    const nextID: Record<string, number> = { n: 0, r: 0, w: 0 };
    const permIDs: Record<string, string> = {};
    const graph = this.stable.graph!;
    const result = new Map<string, EntityCopy>();

    // Copy base entities..
    for (const entity of graph.base.entities.values()) {
      if (!entity) continue;
      const copy = _copyEntity(entity);
      result.set(copy.id, copy);
    }

    // Replace base entities with head entities..
    for (const [entityID, entity] of graph.local.entities) {
      if (entity) {
        const copy = _copyEntity(entity);
        result.set(copy.id, copy);
      } else {
        result.delete(entityID);
      }
    }

    // Swap ids in node and member lists..
    for (const entity of result.values()) {
      if (Array.isArray(entity.nodes)) {
        entity.nodes = entity.nodes.map(nodeID => {
          return permIDs[nodeID] ?? nodeID;
        });
      }
      if (Array.isArray(entity.members)) {
        entity.members = entity.members.map(member => {
          member.id = permIDs[member.id] ?? member.id;
          return member;
        });
      }
    }

    // Convert to Object so we can stringify it.
    const obj: Record<string, EntityCopy> = {};
    for (const [k, v] of result) {
      obj[k] = v;
    }
    return JSON.stringify({ dataIntroGraph: obj });


    // Return a simplified copy of the Entity to save space.
    function _copyEntity(entity: OsmEntity): EntityCopy {
      const copy = utilObjectOmit(entity.asJSON(), ['type', 'user', 'v', 'version', 'visible']) as EntityCopy;

      // Note: the copy is no longer an OsmEntity, so it might not have `tags`
      if (copy.tags && Object.keys(copy.tags).length === 0) {
        delete copy.tags;
      }

      if (Array.isArray(copy.loc)) {
        copy.loc[0] = +copy.loc[0].toFixed(6);
        copy.loc[1] = +copy.loc[1].toFixed(6);
      }

      const match = entity.id.match(/([nrw])-\d*/);  // temporary id
      if (match !== null) {
        const nrw = match[1];
        let permID: string;
        do { permID = nrw + (++nextID[nrw]); }
        while (result.has(permID));

        permIDs[entity.id] = permID;
        copy.id = permID;
      }
      return copy;
    }

  }


  /**
   * toJSON
   * Save the edit history to JSON.
   * @return A String containing the JSON, or `undefined` if nothing to save
   */
  toJSON(): string | undefined {
    if (!this.hasChanges()) return;

    const OSM_PRECISION = 7;
    const baseGraph = this.base.graph!;   // The initial unedited graph
    const modifiedEntities = new Map<string, EntityCopy>();  // Map<entityKey, EntityCopy>
    const baseEntities = new Map<EntityID, EntityCopy>();    // Map<entityID, EntityCopy>
    const historyData: Record<string, unknown>[] = [];

    // Preserve the users history of edits..
    for (const edit of this._history) {
      const modified: string[] = [];
      const deleted: EntityID[] = [];

      // watch out: for modified entities we index on "key" - e.g. "n1v1"
      for (const [entityID, entity] of edit.graph!.local.entities) {
        if (entity) {
          const key = entity.key;
          modifiedEntities.set(key, _copyEntity(entity));
          modified.push(key);
        } else {
          deleted.push(entityID);
        }

        // Collect the original versions of edited Entities.
        const original = baseGraph.hasEntity(entityID);
        if (original && !baseEntities.has(entityID)) {
          baseEntities.set(entityID, _copyEntity(original));
        }

        // For modified ways, collect originals of child nodes also. - iD#4108
        // (This is needed for situations where we connect a way to an existing node)
        if (entity && (entity as any).nodes) {
          for (const childID of (entity as any).nodes) {
            const child = baseGraph.hasEntity(childID);
            if (child && !baseEntities.has(child.id)) {
              baseEntities.set(child.id, _copyEntity(child));
            }
          }
        }

        // Collect original parent ways also.
        // (This is needed for situations where we reshape or move a way -
        //  behind the scenes, only the nodes were really modified)
        if (original) {
          for (const parent of baseGraph.parentWays(original)) {
            if (!baseEntities.has(parent.id)) {
              baseEntities.set(parent.id, _copyEntity(parent));
            }
          }
        }
      }

      const sources = (edit.sources ?? {}) as EditSources;

      const item: Record<string, unknown> = {};
      if (modified.length)   item.modified = modified;
      if (deleted.length)    item.deleted = deleted;
      if (edit.annotation)   item.annotation = edit.annotation;
      if (edit.selectedIDs)  item.selectedIDs = edit.selectedIDs;
      if (edit.transform)    item.transform = edit.transform;
      if (sources.imagery)   item.imageryUsed = sources.imagery;
      if (sources.photos)    item.photosUsed = sources.photos;
      if (sources.data)      item.dataUsed = sources.data;
      historyData.push(item);
    }

    return JSON.stringify({
      version: 3,
      entities: [...modifiedEntities.values()],
      baseEntities: [...baseEntities.values()],
      stack: historyData,
      nextIDs: this.context.sequences,
      index: this._index,
      timestamp: (new Date()).getTime()
    });


    // Return a simplified copy of the Entity to save space.
    function _copyEntity(entity: OsmEntity): EntityCopy {
      // omit 'visible'
      const copy = utilObjectOmit(entity.asJSON(), ['type', 'visible']) as EntityCopy;

      // omit 'tags' if empty
      if (copy.tags && Object.keys(copy.tags).length === 0) {
        delete copy.tags;
      }

      // simplify float precision
      if (Array.isArray(copy.loc)) {
        if (entity.isDegenerate()) {
          delete copy.loc;
        } else {
          copy.loc[0] = +copy.loc[0].toFixed(OSM_PRECISION);
          copy.loc[1] = +copy.loc[1].toFixed(OSM_PRECISION);
        }
      }
      return copy;
    }

  }


  /**
   * fromJSONAsync
   * Restore the edit history from a JSON string.
   * Because the restore process can involve fetching additional information from the OSM API,
   *  this function needs to be async, and should be chained after a `context.resetAsync()` to ensure
   *  that we are starting with a clean slate in regards to validation and rendering.
   *
   * @param json - Stringified JSON to parse
   * @return Promise resolved when the restore process is complete
   */
  fromJSONAsync(json: string): Promise<void> {
    const context = this.context;
    const gfx = context.systems.gfx;
    const osm = context.services.osm as any;

    const backup: BackupJSON = JSON.parse(json);

    if (backup.version !== 3) {
      throw new Error(`Backup version ${backup.version} not supported.`);
    }

    // should we assert that the history has been reset?
    // we expect to chain after context.resetAsync() ? we could just call this._reset() ?

    const unpause = gfx?.pause();  // block rendering

    let loading: any;
    const isTestEnvironment = (!('window' in globalThis)) || ('assert' in globalThis) || ('expect' in globalThis);
    if (!isTestEnvironment) {
      loading = uiLoading(context).blocking(true);
      context.container().call(loading);   // block ui
    }

    const __baseEntities = new Map<EntityID, OsmEntity>();        // Map<entityID, Entity>
    const __modifiedEntities = new Map<string, OsmEntity>();      // Map<Entity.key, Entity>  (watch out: entity.key - e.g. 'n1v1')
    const __missingEntityIDs = new Set<EntityID>();               // Set<entityID>

    // Restore the nextIDs..
    // Old: OsmEntity.id.next = backup.nextIDs;
    // New: We store sequences in the context, these will be positive numbers.
    // We might find negative numbers in old backup from before we started doing this.
    const nextIDs = backup.nextIDs || {};
    for (const [k, v] of Object.entries(nextIDs)) {
      (context.sequences as Record<string, number>)[k] = Math.abs(v);
    }

    // Reconstruct base entities..
    for (const props of backup.baseEntities) {
      const entity = createOsmEntity(context, props as OsmEntityProps);
      __baseEntities.set(entity.id, entity);
    }

    // Determine if any nodes are missing and need to be loaded separately..
    for (const entity of __baseEntities.values()) {
      if (!Array.isArray((entity as any).nodes)) continue;  // consider ways only
      for (const nodeID of (entity as any).nodes) {
        if (!__baseEntities.has(nodeID)) {
          __missingEntityIDs.add(nodeID);
        }
      }
    }

    // Reconstruct modified entities..
    for (const e of backup.entities) {
      const entity = createOsmEntity(context, e as OsmEntityProps);
      __modifiedEntities.set(entity.key, entity);
    }

    // Load missing entities from the OSM API
    // When we restore ways, we also need to fetch any missing childNodes
    //  that would normally have been downloaded with those ways.. see iD#2142
    // As added challenges:
    //  - We have to keep the UI blocked while this is happening, because it's destructive to the graphs/edits.
    //  - Callback can be called multiple times, so we have to keep track of how many of the missing nodes we got.
    //  - The child nodes may have been deleted, so we may have to fetch older non-deleted copies
    //
    // A thought I'm having is - if we need to do all this anyway, it might make more sense to just store the
    // base version numbers rather than base entities, then use `loadEntityVersionAsync` to fetch exactly what we need.
    // new: the OSM API now supports a "multi-fetch with version numbers" option.
    const _loadMissingEntitiesAsync = (): Promise<void> => {
      return new Promise((resolve, reject) => {

        if (osm && __missingEntityIDs.size) {
          // Watch out: this callback may be called multiple times..
          // Since switching the osm service methods to async we shouldn't get errors anymore
          //  it will always resolve to whatever was fetched.
          // But: another potential problem is that we'll never actually fetch "redacted" entities
          //  so potential infinite recursion scenerio.
          const _missingEntitiesLoaded = (err: Error | null, result: { data: Array<{ id: string; version: number; visible: boolean }> }) => {
            if (err) {
              reject(err);

            } else {
              const visibleGroups = utilArrayGroupBy(result.data, 'visible');
              const visibles = (visibleGroups as any).true ?? [];      // alive nodes
              const invisibles = (visibleGroups as any).false ?? [];   // deleted nodes

              // Visible (not deleted) are no longer missing and will be merged as base entities..
              for (const props of visibles) {
                const entity = createOsmEntity(context, props);
                __missingEntityIDs.delete(entity.id);
                __baseEntities.set(entity.id, entity);
              }

              // Recurse to load invisible (deleted) entities, need to go back a version to find them..
              for (const props of invisibles) {
                osm.loadEntityVersionAsync(props.id, +props.version - 1)
                  .then((results: { data: Array<{ id: string; version: number; visible: boolean }> }) => _missingEntitiesLoaded(null, results))
                  .catch((err: Error) => reject(err));
              }
            }

            if (!__missingEntityIDs.size) {  // are we done?
              resolve();
            }
          };

          // continue loading missing entities until we have them all
          osm.loadMultipleAsync(__missingEntityIDs)
            .then((results: { data: Array<{ id: string; version: number; visible: boolean }> }) => _missingEntitiesLoaded(null, results))
            .catch((err: Error) => reject(err));

        } else {  // nothing to do
          resolve();
        }

      });
    };


    // Call _finish when we believe we have everything..
    // This merges the base entities, reconstructs history, and unblocks the other parts of the app.
    const _finish = (): void => {

      // Merge base entities into base graph (force = true, as new nodes may affect their parentways extents in tree)
      const baseEntities = [...__baseEntities.values()];
      const baseEntityIDs = new Set(__baseEntities.keys());
      const baseGraph = this.base.graph!;
      baseGraph.rebase(baseEntities, [baseGraph], true);   // force = true
      this._tree.rebase(baseEntities, true);               // force = true

      // Reconstruct the edit history, each Graph derives from the previous one..
      // Start at i = 1, leaving base edit alone, the first edit will have nothing in it.
      let prevGraph: Graph = baseGraph;
      for (let i = 1; i < backup.stack.length; i++) {
        const item = backup.stack[i] as Record<string, unknown>;
        const entities: Record<string, OsmEntity | undefined> = {};
        for (const key of (item.modified ?? []) as string[]) {
          const entity = __modifiedEntities.get(key)!;
          entities[entity.id] = entity;
        }
        for (const entityID of (item.deleted ?? []) as EntityID[]) {
          entities[entityID] = undefined;
        }

        const graph = new Graph(prevGraph).load(entities);
        prevGraph = graph;

        const sources: EditSources = {};
        if (Array.isArray(item.imageryUsed))  sources.imagery = item.imageryUsed as string[];
        if (Array.isArray(item.photosUsed))   sources.photos = item.photosUsed as string[];
        if (Array.isArray(item.dataUsed))     sources.data = item.dataUsed as string[];

        // Handle legacy transform scale parameter, if found
        const transform = item.transform as (TransformProps & { k?: number });
        if (transform?.k) {
          transform.z = geoScaleToZoom(transform.k);
          delete transform.k;
        }

        this._history.push(new Edit({
          annotation:  item.annotation as string,
          graph:       graph,
          selectedIDs: item.selectedIDs as string[],
          sources:     sources,
          transform:   transform
        }));
      }

      this._index = backup.index;
      this._replaceStaging();

      unpause?.();        // unblock rendering, events will start firing now
      loading?.close();   // unblock ui

      // emit events
      this.emit('merge', baseEntityIDs);
      this._emitChanges();
      this.emit('historyjump', 0, this._index);  // send 0 in prevIndex, we are replacing history completely
    };


    return _loadMissingEntitiesAsync()
      .finally(() => _finish());
  }


  /**
   * immediateBackup
   * Backup the user's edits to a JSON string in localStorage.
   * This code runs occasionally as the user edits.
   */
  immediateBackup(): void {
    const context = this.context;
    if (context.inIntro) return;               // Don't backup edits made in the walkthrough
    if (context.mode?.id === 'save') return;   // Edits made in save mode may be conflict resolutions
    if (this._canRestoreBackup) return;        // Wait to see if the user wants to restore other edits
    if (this._inTransition) return;            // Don't backup edits mid-transition
    if (this._inTransaction) return;           // Don't backup edits mid-transaction
    if (!this._mutex.locked()) return;         // Another browser tab owns the history

    const storage = context.systems.storage!;
    const json = this.toJSON();
    if (json) {
      // status will be `true` if the backup succeeded
      const status = storage.setItem(this._backupKey(), json);
      if (status !== this._backupStatus) {
        this._backupStatus = status;
        this.emit('backupstatuschange', this._backupStatus);
      }
    }
  }


  /**
   * deferredBackup
   * Backup the user's edits after a delay.
   * Uses `debounce` to avoid performing backups too frequently.
   */
  deferredBackup(): void {
    const scheduler = this.context.systems.scheduler;
    if (scheduler) {
      scheduler.debounce('edit-backup', () => this.immediateBackup(), { ms: 1000 });
    } else {
      this.immediateBackup();
    }
  }


  /**
   * canRestoreBackup
   * This flag will be `true` if `initAsync` has determined that there is a restorable
   *  backup, and we are waiting on the user to make a decision about what to do with it.
   * @return `true` if there is a backup to restore
   * @readonly
   */
  get canRestoreBackup(): boolean {
    return this._canRestoreBackup;
  }


  /**
   * restoreBackup
   * Restore the user's backup from localStorage.
   * This happens when:
   * - The user chooses to "Restore my changes" from the restore screen
   */
  restoreBackup(): void {
    this._canRestoreBackup = false;

    if (!this._mutex.locked()) return;  // another browser tab owns the history

    const context = this.context;
    const storage = context.systems.storage!;
    const json = storage.getItem(this._backupKey());
    if (json) {
      context.resetAsync()
        .then(() => this.fromJSONAsync(json));
    }
  }


  /**
   * clearBackup
   * Remove any backup stored in localStorage.
   * This happens when:
   * - The user chooses to "Discard my changes" from the restore screen
   * - The user switches sources with the source switcher
   * - A changeset is inflight, we remove it to prevent the user from restoring duplicate edits
   */
  clearBackup(): void {
    this._canRestoreBackup = false;
    this.context.systems.scheduler?.cancel('edit-backup');

    if (!this._mutex.locked()) return;  // another browser tab owns the history

    const storage = this.context.systems.storage!;
    storage.removeItem(this._backupKey());

    // clear the changeset metadata associated with the saved history
    storage.removeItem('comment');
    storage.removeItem('hashtags');
    storage.removeItem('source');
  }


  /**
   * _backupKey
   * Generate a key used to store/retrieve backup edits.
   * It uses `window.location.origin` avoid conflicts with other instances of Rapid.
   * @return The key used to store/retrieve backup edits in localStorage
   */
  private _backupKey(): string {
    const key = globalThis?.location?.origin || 'headless';
    return `Rapid_${key}_saved_history`;
  }


  /**
   * _gatherSources
   * Get the sources used to make the `staging` edit.
   * @param annotation - Rapid edits may optionally use an annotation that includes the data source used
   * @return sources Object containing `imagery`, `photos`, `data` properties
   */
  private _gatherSources(annotation: string | Record<string, unknown>): EditSources {
    const context = this.context;
    const gfx = context.systems.gfx;
    const imagery = context.systems.imagery;
    const photos = context.systems.photos;

    const sources: EditSources = {};

    if (imagery) {
      const imageryUsed = imagery.imageryUsed();
      if (imageryUsed.length)  {
        sources.imagery = imageryUsed;
      }
    }

    if (photos) {
      const photosUsed = photos.photosUsed();
      if (photosUsed.length) {
        sources.photos = photosUsed;
      }
    }

    if (gfx?.scene) {
      const customLayer = gfx.scene.layers.get('custom-data') as any;
      const customDataUsed = customLayer?.dataUsed() ?? [];
      const rapidDataUsed = (annotation as Record<string, unknown>)?.dataUsed as string[] ?? [];
      const dataUsed = [...rapidDataUsed, ...customDataUsed];
      if (dataUsed.length) {
        sources.data = dataUsed;
      }
    }

    return sources;
  }


  /**
   * _perform
   * Internal `_perform`, accepts both Actions array and eased time,
   * Performs the edits and emits no events.
   * @param actions - Array of Action functions to perform
   * @param t - Eased time, should be in the range [0..1]
   */
  private _perform(actions: Action[], t: number = 1): void {
    // for now, call commit() before performing work.
    let graph = this._staging.graph!.commit();
    for (const fn of actions) {
      if (typeof fn === 'function') {
        graph = fn(graph, t);
      }
    }

    this._staging.graph = graph;
    this._hasWorkInProgress = true;
  }


  /**
   * _replaceStaging
   * This replaces the `staging` work-in-progress edit with a fresh copy of `stable`.
   * Rolls back the edits and emits no events.
   */
  private _replaceStaging(): void {
    this._staging = new Edit({ graph: new Graph(this.stable.graph!) });
    this._hasWorkInProgress = false;
  }


  /**
   * _emitChanges
   * Recalculate the differences and emit `stablechange` and `stagingchange` events.
   * @return Difference between before and after of `staging` Edit
   */
  private _emitChanges(): Difference | undefined {
    if (this._inTransaction) return;

    const baseGraph = this.base.graph!;
    const stableGraph = this.stable.graph!;
    const stagingGraph = this.staging.graph!;
    let stagingDifference: Difference | undefined;

    // Note: `this._hasWorkInProgress` is included here because in some cases the graph
    // won't actually change - for example an Action that exits early or "performs" a no-op.
    // We still want to generate an empty Difference and emit 'stagingchange' in these situations.
    if (this._stagingKey !== stagingGraph.key || this._hasWorkInProgress) {
      stagingDifference = new Difference(this._stagingSnapshot!, stagingGraph);
      this._stagingKey = stagingGraph.key;
      this._stagingSnapshot = stagingGraph.snapshot();
      this.emit('stagingchange', stagingDifference);
    }

    if (this._stableKey !== stableGraph.key) {
      this._fullDifference = new Difference(baseGraph, stableGraph);
      const stableDifference = new Difference(this._stableSnapshot!, stableGraph);
      this._stableKey = stableGraph.key;
      this._stableSnapshot = stableGraph.snapshot();
      this.emit('stablechange', stableDifference);
      this.deferredBackup();
    }

    return stagingDifference;  // only one place in the code uses this return - split operation?
  }

}
