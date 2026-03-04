import { utilArrayUnion, utilArrayUniq } from '@rapid-sdk/util';

import { AbstractSystem } from './AbstractSystem.ts';
import { actionDiscardTags } from '../actions/discard_tags.ts';
import { actionMergeRemoteChanges } from '../actions/merge_remote_changes.ts';
import { actionRevert } from '../actions/revert.ts';
import { createOsmEntity } from '../data/index.ts';
import { Graph } from '../lib/Graph.ts';

import type { Context } from '../Context.ts';
import type { OsmChangeset } from '../data/OsmChangeset.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';


/** Represents an error that occurred during the upload process */
export interface UploadError {
  /** Error message */
  msg: string;
  /** Additional details about the error */
  details?: string[];
}

/** Represents a choice option for resolving a conflict */
export interface ConflictChoice {
  /** Entity ID this choice applies to */
  id: string;
  /** Display text for this choice */
  text: string;
  /** Action to perform when this choice is selected */
  action: () => void;
}

/** Represents a conflict that occurred during the upload process */
export interface UploadConflict {
  /** Entity ID of the conflicting entity */
  id: string;
  /** Display name of the entity */
  name: string;
  /** Details about the conflict */
  details: any[];
  /** Index of the currently chosen resolution (0 or 1) */
  chosen: number;
  /** Available choices for resolving the conflict */
  choices: ConflictChoice[];
}

/** Represents the changes to be uploaded */
export interface UploadChanges {
  /** Entities that were modified */
  modified: OsmEntity[];
  /** Entities that were created */
  created: OsmEntity[];
  /** Entities that were deleted */
  deleted: OsmEntity[];
}


/**
 * `UploaderSystem` handles the process of submitting a changeset to OSM
 *  and dealing with any conflicts that might occur
 *
 * Events available:
 *   // Start and end events are dispatched exactly once each per legitimate outside call to `save`
 *   'saveStarted'        // dispatched as soon as a call to `save` has been deemed legitimate
 *   'saveEnded'          // dispatched after the result event has been dispatched
 *   'willAttemptUpload'  // dispatched before the actual upload call occurs, if it will
 *   'progressChanged'
 *
 *   // Each save results in one of these outcomes:
 *   'resultNoChanges'   // upload wasn't attempted since there were no edits
 *   'resultErrors'      // upload failed due to errors
 *   'resultConflicts'   // upload failed due to data conflicts
 *   'resultSuccess'     // upload completed without errors
 */
export class UploaderSystem extends AbstractSystem {
  /** The current changeset being uploaded (created by uiCommit) */
  changeset: OsmChangeset | null;

  private _origChanges: UploadChanges | null;
  private _discardTags: Record<string, boolean>;
  private _isSaving: boolean;

  // Variables for conflict checking
  private _localGraph: Graph | null;
  private _remoteGraph: Graph | null;
  private _toCheckIDs: Set<EntityID>;
  private _toLoadIDs: Set<EntityID>;
  private _loadedIDs: Set<EntityID>;
  private _conflicts: UploadConflict[];
  private _errors: UploadError[];

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'uploader';
    this.requiredDependencies = new Set(['editor', 'l10n']);
    this.optionalDependencies = new Set(['schema']);

    this.changeset = null;    // uiCommit will create it

    this._origChanges = null;
    this._discardTags = {};
    this._isSaving = false;

    // variables for conflict checking
    this._localGraph = null;
    this._remoteGraph = null;
    this._toCheckIDs = new Set();
    this._toLoadIDs = new Set();
    this._loadedIDs = new Set();
    this._conflicts = [];
    this._errors = [];

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._loadedSome = this._loadedSome.bind(this);
    this._uploadCallback = this._uploadCallback.bind(this);
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
    const l10n = context.systems.l10n;
    const schema = context.systems.schema;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          editor?.initAsync(),
          l10n?.initAsync(),
          schema?.initAsync()
        ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        if (schema) {
          const osmScope = schema.getScope('osm');
          this._discardTags = osmScope.discarded as Record<string, boolean>;
        }
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
    this.changeset = null;
    return Promise.resolve();
  }


  /**
   * isSaving
   * @return `true` if a save operation is in progress, `false` otherwise
   */
  isSaving(): boolean {
    return this._isSaving;
  }


  /**
   * save
   * Begin the save process to upload changes to OSM
   * @param tryAgain - Whether this is a retry attempt after a conflict
   * @param checkConflicts - Whether to check for conflicts before uploading
   */
  save(tryAgain?: boolean, checkConflicts?: boolean): void {
    // Guard against accidentally entering save code twice - iD#4641
    if (this._isSaving && !tryAgain) return;

    const context = this.context;
    const osm = context.services.osm as any;
    if (!osm) return;

    // If user somehow got logged out mid-save, try to reauthenticate..
    // This can happen if they were logged in from before, but the tokens are no longer valid.
    if (!osm.authenticated()) {
      osm.authenticate((err: any) => {
        if (!err) {
          this.save(tryAgain, checkConflicts);  // continue where we left off..
        }
      });
      return;
    }

    if (!this._isSaving) {
      this._isSaving = true;
      this.emit('saveStarted');
    }

    // reset variables
    this._localGraph = null;
    this._remoteGraph = null;
    this._toCheckIDs = new Set();
    this._toLoadIDs = new Set();
    this._loadedIDs = new Set();
    this._conflicts = [];
    this._errors = [];

    // Store original changes, in case user wants to download them as an .osc file
    const editor = context.systems.editor!;
    this._origChanges = editor.changes(actionDiscardTags(editor.difference(), this._discardTags));

    // Attempt a fast upload first.. If there are conflicts, re-enter with `checkConflicts = true`
    if (!checkConflicts) {
      this._tryUpload();
    } else {
      this._startConflictCheck();
    }
  }


  /**
   * _startConflictCheck
   * Start the conflict checking process before upload
   */
  private _startConflictCheck(): void {
    const context = this.context;
    const osm = context.services.osm as any;
    const editor = context.systems.editor!;
    const summary = editor.difference().summary();
    const graph = editor.staging.graph!;

    this._localGraph = graph;
    this._remoteGraph = new Graph(editor.base.graph!);

    // Gather entityIDs to check
    // We will load these from the OSM API into the `remoteGraph`
    this._toCheckIDs = new Set();

    for (const [entityID, item] of summary) {
      if (item.changeType === 'modified') {
        const entity = graph.entity(entityID);
        this._toCheckIDs.add(entityID);   // The modified entity

        for (const child of graph.childNodes(entity as any)) {  // and any children
          if (child.version !== undefined) {
            this._toCheckIDs.add(child.id);
          }
        }
      }
    }

    this._toLoadIDs = new Set(this._toCheckIDs);
    this._loadedIDs = new Set();

    if (osm && this._toLoadIDs.size) {
      this.emit('progressChanged', this._loadedIDs.size, this._toCheckIDs.size);
      osm.loadMultipleAsync(Array.from(this._toLoadIDs))
        .then((results: any) => this._loadedSome(null, results))
        .catch((err: any) => this._loadedSome(err));
    } else {
      this._tryUpload();
    }
  }


  /**
   * _loadedSome
   * Errback-style callback that may be called multiple times.
   * Here we load a batch of remote entities into `remoteGraph`,
   * then expand the search set if needed and schedule more loading.
   * @param  err - Error returned by the `loadMultipleAsync` call
   * @param  results - Data returned by the `loadMultipleAsync` call
   */
  private _loadedSome(err: any, results?: any): void {
    if (this._errors.length) return;   // give up if there are errors

    const l10n = this.context.systems.l10n!;
    const osm = this.context.services.osm as any;

    if (err) {
      this._errors.push({
        msg: err.message || err.responseText,
        details: [ l10n.t('save.status_code', { code: err.status }) ]
      });
      this._didResultInErrors();
      return;
    }

    const loadMoreIDs = new Set<EntityID>();

    for (const props of (results?.data || [])) {
      const entity = createOsmEntity(props) as any;
      this._remoteGraph!.replace(entity);
      this._loadedIDs.add(entity.id);
      this._toLoadIDs.delete(entity.id);

      if (!entity.visible) continue;

      // Because `loadMultiple` doesn't download `/full` like `loadEntity`,
      // expand `_toCheck` set to include children that aren't already being checked..
      if (entity.type === 'way') {
        for (const childID of entity.nodes) {
          if (!this._toCheckIDs.has(childID)) {
            this._toCheckIDs.add(childID);
            this._toLoadIDs.add(childID);
            loadMoreIDs.add(childID);
          }
        }
      } else if (entity.type === 'relation' && entity.isMultipolygon()) {
        for (const member of entity.members) {
          if (!this._toCheckIDs.has(member.id)) {
            this._toCheckIDs.add(member.id);
            this._toLoadIDs.add(member.id);
            loadMoreIDs.add(member.id);
          }
        }
      }
    }

    this.emit('progressChanged', this._loadedIDs.size, this._toCheckIDs.size);

    if (osm && loadMoreIDs.size) {
      osm.loadMultipleAsync(Array.from(loadMoreIDs))
        .then((results: any) => this._loadedSome(null, results))
        .catch((err: any) => this._loadedSome(err));


    } else if (!this._toLoadIDs.size) {  // we have loaded everything, continue to the next step
      this._detectConflicts();
      this._tryUpload();
    }
  }


  /**
   * _detectConflicts
   * Test everything in `_toCheckIDs` for conflicts
   */
  private _detectConflicts(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const editor = context.systems.editor!;
    const osm = context.services.osm as any;
    if (!osm) return;

    const localGraph = this._localGraph!;
    const remoteGraph = this._remoteGraph!;

    for (const entityID of this._toCheckIDs) {
      const local = localGraph.entity(entityID);
      const remote = remoteGraph.entity(entityID);

      if (sameVersions(local, remote)) continue;

      // Try a safe merge first
      const actionSafe = actionMergeRemoteChanges(entityID, {
        localGraph: localGraph,
        remoteGraph: remoteGraph,
        discardTags: this._discardTags,
        formatUser: formatUser,
        localize: l10n.t,
        strategy: 'safe'
      });

      editor.perform(actionSafe);

      const mergeConflicts = actionSafe.conflicts();
      if (!mergeConflicts.length) continue;  // merged safely

      // present options for destructive merging
      const actionForceLocal = actionMergeRemoteChanges(entityID, {
        localGraph: localGraph,
        remoteGraph: remoteGraph,
        discardTags: this._discardTags,
        formatUser: formatUser,
        localize: l10n.t,
        strategy: 'force_local'
      });

      const actionForceRemote = actionMergeRemoteChanges(entityID, {
        localGraph: localGraph,
        remoteGraph: remoteGraph,
        discardTags: this._discardTags,
        formatUser: formatUser,
        localize: l10n.t,
        strategy: 'force_remote'
      });

      const keepMine = l10n.t('save.conflict.' + (remote.visible ? 'keep_local' : 'restore'));
      const keepTheirs = l10n.t('save.conflict.' + (remote.visible ? 'keep_remote' : 'delete'));

      this._conflicts.push({
        id: entityID,
        name: entityName(local),
        details: mergeConflicts,
        chosen: 1,
        choices: [
          { id: entityID, text: keepMine, action: () => editor.perform(actionForceLocal) },
          { id: entityID, text: keepTheirs, action: () => editor.perform(actionForceRemote) }
        ]
      });
    }


    function formatUser(d: string): string {
      return '<a href="' + osm.userURL(d) + '" target="_blank">' + d + '</a>';
    }

    function entityName(entity: any): string {
      return l10n.displayName(entity.tags) || (l10n.displayType(entity.id) + ' ' + entity.id);
    }

    function sameVersions(local: any, remote: any): boolean {
      if (local.version !== remote.version) return false;
      if (local.type === 'way') {
        for (const childID of utilArrayUnion(local.nodes, remote.nodes) as string[]) {
          const a = localGraph.hasEntity(childID);
          const b = remoteGraph.hasEntity(childID);
          if (a && b && a.version !== b.version) return false;
        }
      }
      return true;
    }
  }


  /**
   * _tryUpload
   * This is called when we are ready to attempt a changeset upload.
   * If conflicts or errors exist, present them to the user instead.
   */
  private _tryUpload(): void {
    const context = this.context;
    const osm = context.services.osm as any;
    if (!osm) {
      this._errors.push({ msg: 'No OSM Service' });
    }
    if (!this.changeset) {  // shouldn't happen
      this._errors.push({ msg: 'No OSM Changeset' });
    }

    if (this._conflicts.length) {
      this._didResultInConflicts();

    } else if (this._errors.length) {
      this._didResultInErrors();

    } else {
      const editor = context.systems.editor!;
      const changes = editor.changes(actionDiscardTags(editor.difference(), this._discardTags));
      if (changes.modified.length || changes.created.length || changes.deleted.length) {
        this.emit('willAttemptUpload');
        osm.sendChangeset(this.changeset, changes, this._uploadCallback);
      } else {
        // changes were insignificant or reverted by user
        this._didResultInNoChanges();
      }
    }
  }


  /**
   * _uploadCallback
   * Callback for the changeset upload attempt
   */
  private _uploadCallback(err: any, updatedChangeset?: any): void {
    if (updatedChangeset) {
      this.changeset = updatedChangeset;  // it may have a changeset id now
    }

    if (err) {
      if (err.status === 409) {  // 409 Conflict
        this.save(true, true);   // tryAgain = true, checkConflicts = true
      } else {
        const l10n = this.context.systems.l10n!;
        this._errors.push({
          msg: err.message || err.responseText,
          details: [ l10n.t('save.status_code', { code: err.status }) ]
        });
        this._didResultInErrors();
      }

    } else {
      this._didResultInSuccess();
    }
  }


  /**
   * _didResultInNoChanges
   * Called when there were no changes to upload
   */
  private _didResultInNoChanges(): void {
    this.emit('resultNoChanges');
    this._endSave();
  }


  /**
   * _didResultInErrors
   * Called when the upload failed due to errors
   */
  private _didResultInErrors(): void {
    // this.context.systems.editor.pop();
    const editor = this.context.systems.editor!;
    editor.revert();
    this.emit('resultErrors', this._errors);
    this._endSave();
  }


  /**
   * _didResultInConflicts
   * Called when the upload failed due to data conflicts
   */
  private _didResultInConflicts(): void {
    this._conflicts.sort((a, b) => b.id.localeCompare(a.id));
    this.emit('resultConflicts', this.changeset, this._conflicts, this._origChanges);
    this._endSave();
  }


  /**
   * _didResultInSuccess
   * Called when the upload completed successfully
   */
  private _didResultInSuccess(): void {
    this.emit('resultSuccess', this.changeset);
    this._endSave();
  }


  /**
   * _endSave
   * Called to clean up after a save attempt
   */
  private _endSave(): void {
    this._isSaving = false;
    this.emit('saveEnded');
  }


  /**
   * cancelConflictResolution
   * Cancel the conflict resolution process and revert changes
   */
  cancelConflictResolution(): void {
    // this.context.systems.editor.pop();
    const editor = this.context.systems.editor!;
    editor.revert();
  }


  /**
   * processResolvedConflicts
   * Process conflicts that have been resolved by the user and retry the upload
   */
  processResolvedConflicts(): void {
    const editor = this.context.systems.editor!;

    for (const conflict of this._conflicts) {
      if (conflict.chosen === 1) {   // user chose "use theirs"
        const graph = editor.staging.graph!;
        const entity = graph.hasEntity(conflict.id) as any;
        if (entity?.type === 'way') {
          for (const child of utilArrayUniq(entity.nodes) as EntityID[]) {
            editor.perform(actionRevert(child));
          }
        }
        editor.perform(actionRevert(conflict.id));
      }
    }

    this.save(true, false);  // tryAgain = true, checkConflicts = false
  }
}
