import { AbstractSystem } from './AbstractSystem.ts';
import { actionDiscardTags } from '../actions/discard_tags.ts';
import { actionMergeRemoteChanges } from '../actions/merge_remote_changes.ts';
import { actionRevert } from '../actions/revert.ts';
import { createOsmEntity } from '../data/index.ts';
import { Graph } from '../lib/Graph.ts';
import { utilArrayUnion, utilArrayUniq } from '@rapid-sdk/util';

import type { Context } from '../Context.ts';
import type { OsmChangeset } from '../data/OsmChangeset.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { OsmEntityProps, OsmWay } from '../data/types.ts';


/**
 * How many times one save may check for conflicts on its own, after the API answers 409 Conflict.
 * (The user resolving conflicts starts the count again.)
 */
const MAX_CONFLICT_CHECKS = 3;


/** Represents an error that occurred during the upload process */
export interface UploadError {
  /** Error message */
  msg: string;
  /** Additional details about the error */
  details?: string[];
}

/** Which version of a conflicting entity to keep: the user's (`local`) or the other mapper's (`remote`) */
export type ConflictChoiceType = 'local' | 'remote';

/** Represents a choice option for resolving a conflict */
export interface ConflictChoice {
  /** Entity ID this choice applies to */
  id: EntityID;
  /** Which version this choice keeps */
  type: ConflictChoiceType;
  /** Display text for this choice */
  text: string;
  /** Action to perform when this choice is selected */
  action: () => void;
}

/** Represents a conflict that occurred during the upload process */
export interface UploadConflict {
  /** Entity ID of the conflicting entity */
  id: EntityID;
  /** Display name of the entity */
  name: string;
  /** Details about the conflict */
  details: string[];
  /** Which choice is currently chosen */
  chosen: ConflictChoiceType;
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
 * // Start and end events are dispatched exactly once each per legitimate outside call to `save`
 * - 'saveStarted'        - dispatched as soon as a call to `save` has been deemed legitimate
 * - 'saveEnded'          - dispatched after the result event has been dispatched
 * - 'willAttemptUpload'  - dispatched before the actual upload call occurs, if it will
 * - 'progressChanged'
 *
 * // Each save results in one of these outcomes:
 * - 'resultNoChanges'   - upload wasn't attempted since there were no edits
 * - 'resultErrors'      - upload failed due to errors
 * - 'resultConflicts'   - upload failed due to data conflicts
 * - 'resultSuccess'     - upload completed without errors
 *
 * See `design/uploader-system.md` for how conflicts are checked and resolved, and where this is heading.
 */
export class UploaderSystem extends AbstractSystem {

  /** The current changeset being uploaded (created by uiCommit) */
  public changeset: OsmChangeset | null;

  /**
   * Draft changeset comment. Session state seeded from the urlhash at init time;
   * intentionally NOT persisted (a changeset comment is ephemeral, not a durable preference).
   */
  public comment: string;
  /** Draft changeset source (session state, seeded from the urlhash) */
  public source: string;
  /** Draft changeset hashtags (session state, seeded from the urlhash) */
  public hashtags: string;

  /** The original set of changes captured when an upload was initiated */
  protected _origChanges: UploadChanges | null;
  /** Tag keys that should be stripped from entities before uploading */
  protected _discardTags: Record<string, boolean>;
  /** Whether an upload is currently in progress */
  protected _isSaving: boolean;
  /** Counts calls to `save`, so results of an earlier attempt that arrive late are ignored */
  protected _attempt: number;

  // Variables for conflict checking
  /** Local graph snapshot taken at the start of the upload, used for conflict resolution */
  protected _localGraph: Graph | null;
  /** Graph built from data fetched from the OSM API during conflict checking */
  protected _remoteGraph: Graph | null;
  /** Entity IDs that need to be checked for server-side conflicts */
  protected _toCheckIDs: Set<EntityID>;
  /** Entity IDs that have been successfully fetched from the OSM API */
  protected _loadedIDs: Set<EntityID>;
  /** How many times this save has checked for conflicts on its own (see `MAX_CONFLICT_CHECKS`) */
  protected _conflictChecks: number;
  /** Entity IDs the API reported a version mismatch for, during this save */
  protected _mismatchIDs: Set<EntityID>;
  /** Conflicts discovered during the upload, each with choices for resolution */
  protected _conflicts: UploadConflict[];
  /** Errors that occurred during the upload */
  protected _errors: UploadError[];


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'uploader';
    this.requiredDependencies = new Set<SystemID>(['editor', 'l10n']);
    this.optionalDependencies = new Set<SystemID>(['schema', 'urlhash']);

    this.changeset = null;    // uiCommit will create it

    this.comment = '';
    this.source = '';
    this.hashtags = '';

    this._origChanges = null;
    this._discardTags = {};
    this._isSaving = false;
    this._attempt = 0;

    // variables for conflict checking
    this._localGraph = null;
    this._remoteGraph = null;
    this._toCheckIDs = new Set<EntityID>();
    this._loadedIDs = new Set<EntityID>();
    this._conflictChecks = 0;
    this._mismatchIDs = new Set<EntityID>();
    this._conflicts = [];
    this._errors = [];

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._uploadCallback = this._uploadCallback.bind(this);
  }


  /**
   * Called after all core objects have been constructed.
   * @return  Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const editor = context.systems.editor;
    const l10n = context.systems.l10n;
    const schema = context.systems.schema;
    const urlhash = context.systems.urlhash;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          editor?.initAsync(),
          l10n?.initAsync(),
          schema?.initAsync(),
          urlhash?.initAsync()
        ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        if (schema) {
          const osmScope = schema.getScope('osm');
          this._discardTags = osmScope.discarded as Record<string, boolean>;
        }

        // Seed the draft changeset metadata from the urlhash (one-time init params).
        // These are session-scoped and not persisted.
        this.comment = urlhash?.initialHashParams.get('comment') ?? '';
        this.source = urlhash?.initialHashParams.get('source') ?? '';
        this.hashtags = urlhash?.initialHashParams.get('hashtags') ?? '';
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
    this.changeset = null;
    return Promise.resolve();
  }


  /**
   * Clears the draft changeset metadata (comment / source / hashtags).
   * Called when the user discards their edits or switches API endpoints, so the
   * next changeset starts fresh. (This is session state, not a persisted preference.)
   */
  public clearDraft(): void {
    this.comment = '';
    this.source = '';
    this.hashtags = '';
  }


  /**
   * Reports whether a save (upload) operation is currently in progress.
   * @return `true` if a save operation is in progress, `false` otherwise
   */
  public isSaving(): boolean {
    return this._isSaving;
  }


  /**
   * Begin the save process to upload changes to OSM
   * @param tryAgain - Whether this is a retry attempt after a conflict
   * @param checkConflicts - Whether to check for conflicts before uploading
   */
  public save(tryAgain?: boolean, checkConflicts?: boolean): void {
    // Guard against accidentally entering save code twice - iD#4641
    if (this._isSaving && !tryAgain) return;

    const context = this.context;
    const editor = context.systems.editor!;
    const osm = context.services.osm;
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
      this._conflictChecks = 0;
      this._mismatchIDs = new Set<EntityID>();
      this.emit('saveStarted');
    }

    // reset variables
    this._attempt++;
    this._localGraph = null;
    this._remoteGraph = null;
    this._toCheckIDs = new Set<EntityID>();
    this._loadedIDs = new Set<EntityID>();
    this._conflicts = [];
    this._errors = [];

    // Store original changes, in case user wants to download them as an .osc file
    this._origChanges = editor.changes(actionDiscardTags(editor.difference(), this._discardTags));

    // Attempt a fast upload first.. If there are conflicts, re-enter with `checkConflicts = true`
    if (!checkConflicts) {
      this._tryUpload();
    } else {
      this._checkConflictsAsync();
    }
  }


  /**
   * Check for conflicts before uploading.
   * Fetches the current version of everything we'd upload as modified or deleted, compares it to
   * what we have, and merges in other mappers' changes where it can. Merges are made in `staging`,
   * so cancelling the conflict screen throws them away. Then either uploads, or shows the conflicts.
   * @return Promise resolved when the check is done (the upload or the result happens after)
   */
  protected async _checkConflictsAsync(): Promise<void> {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const attempt = this._attempt;
    const baseGraph = editor.base.graph!;
    const localGraph = editor.stable.graph!;

    this._conflictChecks++;
    this._localGraph = localGraph;
    this._remoteGraph = new Graph(baseGraph);

    // Gather entityIDs to check: everything we'd upload as modified or deleted (each carries a version
    // that the API checks), and anything the API told us has a version mismatch.
    // We will load these from the OSM API into the `remoteGraph`
    const difference = editor.difference();
    const toCheckIDs = new Set<EntityID>();
    for (const entity of [...difference.modified(), ...difference.deleted()]) {
      if (entity.version) {
        toCheckIDs.add(entity.id);
      }
    }
    for (const entityID of this._mismatchIDs) {
      if (localGraph.hasEntity(entityID) ?? baseGraph.hasEntity(entityID)) {
        toCheckIDs.add(entityID);
      }
    }

    // Also load the child nodes of those ways, to compare their versions too
    const toLoadIDs = new Set<EntityID>(toCheckIDs);
    for (const entityID of toCheckIDs) {
      const entity = localGraph.hasEntity(entityID);
      for (const childID of (entity as OsmWay | undefined)?.nodes ?? []) {
        if (localGraph.hasEntity(childID)?.version) {
          toLoadIDs.add(childID);
        }
      }
    }

    this._toCheckIDs = toCheckIDs;
    this._loadedIDs = new Set<EntityID>();
    let total = toLoadIDs.size;
    this.emit('progressChanged', 0, total);

    try {
      const remoteWays = (await this._loadRemoteAsync(toLoadIDs))
        .filter(entity => entity.type === 'way' && entity.visible) as OsmWay[];
      if (attempt !== this._attempt) return;   // a newer attempt started meanwhile

      // `loadEntityVersionsAsync` doesn't load child nodes like `/full` does, and merging a way needs
      // the remote way's child nodes, so load any we don't have yet.
      const moreIDs = new Set<EntityID>();
      for (const way of remoteWays) {
        for (const childID of way.nodes) {
          if (!this._loadedIDs.has(childID)) {
            moreIDs.add(childID);
          }
        }
      }

      if (moreIDs.size) {
        total += moreIDs.size;
        this.emit('progressChanged', this._loadedIDs.size, total);
        await this._loadRemoteAsync(moreIDs);
        if (attempt !== this._attempt) return;
      }

    } catch (err: any) {
      if (attempt !== this._attempt) return;
      this._errors.push({
        msg: err?.message || err?.responseText,
        details: [ l10n.t('save.status_code', { code: err?.status }) ]
      });
      this._didResultInErrors();
      return;
    }

    this.emit('progressChanged', total, total);
    this._detectConflicts();

    // Merged without conflicts? Commit the merges, so that they are what we upload.
    if (!this._conflicts.length && editor.hasWorkInProgress) {
      editor.commit({ stringID: 'save.conflict.annotation' });
    }
    this._tryUpload();
  }


  /**
   * Load the current versions of the given entities from the OSM API into `remoteGraph`.
   * @param entityIDs - The entities to load
   * @return Promise resolved with the entities that were loaded (deleted ones included, with `visible: false`)
   * @throws Rejects if the OSM API can't be reached
   */
  protected async _loadRemoteAsync(entityIDs: Set<EntityID>): Promise<OsmEntity[]> {
    const context = this.context;
    const osm = context.services.osm!;

    const versions = new Map<EntityID, undefined>();
    for (const entityID of entityIDs) {
      versions.set(entityID, undefined);   // the current version
    }

    const results = await osm.loadEntityVersionsAsync(versions);

    const entities: OsmEntity[] = [];
    for (const props of results) {
      const entity = createOsmEntity(context, props as OsmEntityProps);
      entities.push(entity);
      this._loadedIDs.add(entity.id);
    }
    this._remoteGraph!.replace(entities);

    return entities;
  }


  /**
   * Test everything in `_toCheckIDs` for conflicts
   */
  protected _detectConflicts(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const osm = context.services.osm;
    if (!osm) return;

    const baseGraph = editor.base.graph!;
    const localGraph = this._localGraph!;
    const remoteGraph = this._remoteGraph!;

    for (const entityID of this._toCheckIDs) {
      if (!this._loadedIDs.has(entityID)) continue;   // the API doesn't have it, there's nothing to compare

      const local = localGraph.hasEntity(entityID);   // `undefined` if the user deleted it
      const original = local ?? baseGraph.entity(entityID);
      const remote = remoteGraph.entity(entityID);

      if (sameVersions(original, remote)) continue;

      // Deleted locally but changed remotely.  To keep the deletion, it has to be uploaded against
      // the remote version, so that version (with child nodes the user didn't change) replaces the base copy.
      // (If a child node of the remote way couldn't be loaded, leave the base alone: a way can't be
      // drawn without its nodes. Keeping the deletion then fails on upload, and the user sees why.)
      if (!local && remote.visible) {
        const children: OsmEntity[] = [];
        let complete = true;
        for (const childID of (remote as OsmWay).nodes ?? []) {
          const child = this._loadedIDs.has(childID) ? remoteGraph.entity(childID) : undefined;
          if (child?.visible && !this._toCheckIDs.has(childID)) {
            children.push(child);
          } else if (!baseGraph.hasEntity(childID)) {
            complete = false;
          }
        }
        if (complete) {
          editor.updateBase([remote, ...children]);
        }
      }

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

      let keepMine, keepTheirs;
      if (!local) {             // deleted by us, changed by them
        keepMine = l10n.t('save.conflict.delete');
        keepTheirs = l10n.t('save.conflict.restore');
      } else if (!remote.visible) {   // changed by us, deleted by them
        keepMine = l10n.t('save.conflict.restore');
        keepTheirs = l10n.t('save.conflict.delete');
      } else {
        keepMine = l10n.t('save.conflict.keep_local');
        keepTheirs = l10n.t('save.conflict.keep_remote');
      }

      this._conflicts.push({
        id: entityID,
        name: entityName(original),
        details: mergeConflicts,
        chosen: 'remote',
        choices: [
          { id: entityID, type: 'local', text: keepMine, action: () => editor.perform(actionForceLocal) },
          { id: entityID, type: 'remote', text: keepTheirs, action: () => editor.perform(actionForceRemote) }
        ]
      });
    }


    /**
     * Formats a username as a link to their OSM profile.
     * @param d - The username
     * @return HTML for the link
     */
    function formatUser(d: string): string {
      return '<a href="' + osm!.userURL(d) + '" target="_blank">' + d + '</a>';
    }

    /**
     * Returns a name for the entity to show in the conflict list.
     * @param entity - The entity to name
     * @return Its display name, or its type and ID
     */
    function entityName(entity: OsmEntity): string {
      return l10n.displayName(entity.tags) || (l10n.displayType(entity.id) + ' ' + entity.id);
    }

    /**
     * Whether the local and remote copies are the same version (for ways, their child nodes too).
     * @param local - The local copy (the base copy, if the user deleted it)
     * @param remote - The remote copy
     * @return `true` if nothing changed remotely
     */
    function sameVersions(local: OsmEntity, remote: OsmEntity): boolean {
      if (local.version !== remote.version) return false;
      if (local.type === 'way' && localGraph.hasEntity(local.id)) {
        for (const childID of utilArrayUnion((local as OsmWay).nodes, (remote as OsmWay).nodes ?? []) as EntityID[]) {
          const a = localGraph.hasEntity(childID);
          const b = remoteGraph.hasEntity(childID);
          if (a && b && a.version !== b.version) return false;
        }
      }
      return true;
    }
  }


  /**
   * This is called when we are ready to attempt a changeset upload.
   * If conflicts or errors exist, present them to the user instead.
   */
  protected _tryUpload(): void {
    const context = this.context;
    const osm = context.services.osm;
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
        // Keep the backup, marked as uploading, so a closed tab doesn't lose the edits or upload them twice (iD#5200)
        const beforeUpload = (changeset: OsmChangeset) => editor.markUploadAsync(changeset.id, osm!.apiroot);
        osm!.sendChangeset(this.changeset!, changes, this._uploadCallback, beforeUpload);
      } else {
        // changes were insignificant or reverted by user
        this._didResultInNoChanges();
      }
    }
  }


  /**
   * Callback for the changeset upload attempt
   * @param err - The error, if the upload failed
   * @param updatedChangeset - The changeset, which may have an id now
   */
  protected _uploadCallback(err: any, updatedChangeset?: any): void {
    const editor = this.context.systems.editor!;

    if (updatedChangeset) {
      this.changeset = updatedChangeset;  // it may have a changeset id now
    }

    if (err) {
      // Unless we can't tell (status -6), nothing was applied, so the backup is an ordinary one again
      if (err.status !== -6) {
        editor.clearUploadMarkAsync();
      }

      if (err.status === 409) {  // 409 Conflict
        if (this._shouldCheckAgain(err)) {
          this.save(true, true);   // tryAgain = true, checkConflicts = true
        } else {
          this._didResultInErrors();
        }
      } else {
        this._errors.push(this._describeUploadError(err));
        this._didResultInErrors();
      }

    } else {
      editor.clearBackup();   // the edits are on OSM now, so restoring them would upload them twice
      this._didResultInSuccess();
    }
  }


  /**
   * Describe a failed upload for the error screen.
   * `OsmService.sendChangeset` uses status `-5` when the upload got no answer and wasn't applied,
   * and `-6` when we can't tell whether it was.
   * @param err - The error from the upload
   * @return The error message, with details
   */
  protected _describeUploadError(err: any): { msg: string, details: string[] } {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const osm = context.services.osm;

    if (err.status === -5) {
      return { msg: l10n.t('save.upload_failed'), details: [ err.message ].filter(Boolean) };
    }
    if (err.status === -6) {
      const changesetID = this.changeset?.id;
      return {
        msg: l10n.t('save.upload_unknown'),
        details: [ changesetID && osm ? osm.changesetURL(changesetID) : '', err.message ].filter(Boolean)
      };
    }
    if (typeof err.status !== 'number') {   // never got an answer, e.g. offline
      return { msg: l10n.t('save.unknown_error_details'), details: [ err.message ].filter(Boolean) };
    }
    return {
      msg: err.message || err.responseText,
      details: [ l10n.t('save.status_code', { code: err.status }) ]
    };
  }


  /**
   * After the API answers 409 Conflict, decide whether checking for conflicts again could help.
   * The API's message names the entity whose version didn't match, e.g.
   *  "Version mismatch: Provided 8, server had: 10 of Relation 123".
   * Checking again can't help if the changeset was closed, if the same entity is reported again
   * (the check didn't fix it), or after `MAX_CONFLICT_CHECKS`.  Then this records an error instead.
   * @param err - The error from the upload
   * @return `true` to check for conflicts again
   */
  protected _shouldCheckAgain(err: any): boolean {
    const l10n = this.context.systems.l10n!;
    const message = String(err.body || err.message || '');

    // A closed changeset is a 409 too, and no conflict check will reopen it
    if (/changeset \d+ was closed/i.test(message)) {
      this._errors.push({ msg: message, details: [ l10n.t('save.status_code', { code: err.status }) ] });
      return false;
    }

    let entityID: EntityID | undefined;
    const match = message.match(/of (node|way|relation) (\d+)/i);
    if (match) {
      entityID = match[1].charAt(0).toLowerCase() + match[2];
    }

    if (this._conflictChecks >= MAX_CONFLICT_CHECKS || (entityID && this._mismatchIDs.has(entityID))) {
      this._errors.push({
        msg: l10n.t('save.conflict.unresolved'),
        details: [ message, l10n.t('save.status_code', { code: err.status }) ].filter(Boolean)
      });
      return false;
    }

    if (entityID) {
      this._mismatchIDs.add(entityID);
    }
    return true;
  }


  /**
   * Called when there were no changes to upload
   */
  protected _didResultInNoChanges(): void {
    this.emit('resultNoChanges');
    this._endSave();
  }


  /**
   * Called when the upload failed due to errors
   */
  protected _didResultInErrors(): void {
    // this.context.systems.editor.pop();
    const editor = this.context.systems.editor!;
    editor.revert();
    this.emit('resultErrors', this._errors);
    this._endSave();
  }


  /**
   * Called when the upload failed due to data conflicts
   */
  protected _didResultInConflicts(): void {
    this._conflicts.sort((a, b) => b.id.localeCompare(a.id));
    this.emit('resultConflicts', this.changeset, this._conflicts, this._origChanges);
    this._endSave();
  }


  /**
   * Called when the upload completed successfully
   */
  protected _didResultInSuccess(): void {
    this.emit('resultSuccess', this.changeset);
    this._endSave();
  }


  /**
   * Called to clean up after a save attempt
   */
  protected _endSave(): void {
    this._isSaving = false;
    this.emit('saveEnded');
  }


  /**
   * Cancel the conflict resolution process and revert changes
   * (The merges and choices are all in `staging`, so this throws them away.)
   */
  public cancelConflictResolution(): void {
    // this.context.systems.editor.pop();
    const editor = this.context.systems.editor!;
    editor.revert();
  }


  /**
   * Process conflicts that have been resolved by the user and retry the upload
   */
  public processResolvedConflicts(): void {
    const editor = this.context.systems.editor!;

    for (const conflict of this._conflicts) {
      if (conflict.chosen === 'remote') {   // user chose "use theirs"
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

    // Commit the merges and the user's choices, so that they are what we upload.
    if (editor.hasWorkInProgress) {
      editor.commit({ stringID: 'save.conflict.annotation' });
    }

    this.save(true, false);  // tryAgain = true, checkConflicts = false
  }
}
