import * as Validators from '../validators/index.ts';
import { AbstractSystem } from './AbstractSystem.ts';
import { Difference } from '../lib/Difference.ts';
import { Extent } from '@rapid-sdk/math';
import { utilArrayChunk, utilArrayGroupBy } from '@rapid-sdk/util';
import { utilExtractValues } from '../util/string.ts';
import { ValidationCache } from '../lib/ValidationCache.ts';

import type { Context } from '../Context.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { Graph } from '../lib/Graph.ts';
import type { ValidationIssue, ValidationSeverity } from '../lib/ValidationIssue.ts';
import type { ValidatorFactory, ValidatorFunction, ValidatorResult } from '../validators/types.ts';

/** Wait 5 sec before revalidating provisional entities */
const RETRY = 5000;

/** Override for adjusting issue severity */
interface SeverityOverride {
  type: RegExp;
  subtype: RegExp;
}

/** Options for getIssues and related methods */
export interface GetIssuesOptions {
  /** 'all' to include all issues, 'edited' for only user-edited features */
  what?: 'all' | 'edited';
  /** 'all' for all issues, 'visible' for only issues in the visible extent */
  where?: 'all' | 'visible';
  /** true to include ignored issues, 'only' for only ignored issues */
  includeIgnored?: boolean | 'only';
  /** true to include disabled rule issues, 'only' for only disabled rule issues */
  includeDisabledRules?: boolean | 'only';
}

/** Result from getIssuesBySeverity */
export interface IssuesBySeverity {
  error: ValidationIssue[];
  warning: ValidationIssue[];
  suggestion: ValidationIssue[];
}


/**
 * `ValidationSystem` manages all the validator functions and maintains two caches
 * containing the validation results:
 * - `base` is the results of validating the base graph (before user edits)
 * - `head` is the results of validating the head graph (with user edits applied)
 *
 * We do both because that's the only way to know whether to credit a user with
 * fixing something (or breaking it).  This means that every feature downloaded
 * from OSM gets validated.  This system maintains a work queue so that validation
 * is performed in the background during browser idle times.
 *
 * It would be even better to do this in a worker process, but workers don't
 * have easy access to things like the Graph or Edits/History.
 *
 * Events available:
 * - `validated`       Fires after some validation has occurred
 * - `focusedIssue`    Fires after an issue has received focus, receives the issue
 */
export class ValidationSystem extends AbstractSystem {

  /** Map of ValidatorID to validator function */
  protected _validators: Map<ValidatorID, ValidatorFunction>;
  /** Validation cache for base graph (before user edits) */
  protected _base: ValidationCache;
  /** Validation cache for head graph (with user edits) */
  protected _head: ValidationCache;
  /** Disabled validator IDs */
  protected _disabledValidatorIDs: Set<ValidatorID>;
  /** Ignored issue IDs */
  protected _ignoredIssueIDs: Set<IssueID>;
  /** Resolved issue IDs */
  protected _resolvedIssueIDs: Set<IssueID>;
  /** Complete diff base -> head of what the user changed */
  protected _completeDiff: Map<EntityID, OsmEntity | undefined>;
  /** Deferred `setTimeout` - Set<handles> */
  protected _deferredST: Set<ReturnType<typeof setTimeout>>;
  /** Override rules that force issues to be errors */
  protected _errorOverrides: SeverityOverride[];
  /** Override rules that force issues to be warnings */
  protected _warningOverrides: SeverityOverride[];
  /** Override rules that disable issues */
  protected _disableOverrides: SeverityOverride[];
  /** Promise fulfilled when validation caught up to `stable` snapshot */
  protected _validationPromise: Promise<void> | null;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'validator';
    this.requiredDependencies = new Set<SystemID>(['editor', 'l10n', 'scheduler', 'schema', 'spatial']);
    this.optionalDependencies = new Set<SystemID>(['map', 'storage', 'ui', 'urlhash']);

    this._validators = new Map<ValidatorID, ValidatorFunction>();
    this._base = new ValidationCache('base');
    this._head = new ValidationCache('head');

    this._disabledValidatorIDs = new Set<ValidatorID>();
    this._ignoredIssueIDs = new Set<IssueID>();
    this._resolvedIssueIDs = new Set<IssueID>();
    this._completeDiff = new Map<EntityID, OsmEntity | undefined>();
    this._deferredST = new Set();
    this._errorOverrides = [];
    this._warningOverrides = [];
    this._disableOverrides = [];

    this._validationPromise = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.validateAsync = this.validateAsync.bind(this);
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    // Create the validator functions
    // TODO: Validator functions are instantiated once here at init time.  Any schema-derived
    // data they capture at construction (e.g. hoisted `pathVals`, `variables`, etc.) will be
    // stale if the schema is loaded or updated after this point.  The fix is to convert each
    // validator into a proper class (like the systems and behaviors) so it can subscribe to
    // 'schemachange' events and refresh its cached prerequisites.  Until then, validators
    // that depend on schema data must fetch it lazily (inside the validation function), or
    // use the `if (!pathVals) return []` guard pattern to fail gracefully when schema is not
    // yet loaded.
    const context = this.context;
    for (const factory of Object.values(Validators) as ValidatorFactory[]) {
      if (typeof factory !== 'function') continue;
      const validator = factory(context);
      this._validators.set(validator.type, validator);
    };

    const editor = context.systems.editor;
    const schema = context.systems.schema;
    const storage = context.systems.storage;
    const urlhash = context.systems.urlhash;

    return this._initPromise = super.initAsync()
      .then(() => {
        const prerequisites = [
          editor?.initAsync(),
          schema?.initAsync(),
          storage?.initAsync(),
          urlhash?.initAsync()
        ];
        return Promise.all(prerequisites.filter(Boolean));
      })
      .then(() => {
        // Allow validation severity to be overridden by url queryparams...
        // See: https://github.com/openstreetmap/iD/pull/8243
        //
        // Each param should contain a urlencoded comma separated list of
        //  `type/subtype` rules.  `*` may be used as a wildcard..
        // Examples:
        //  `validationError=disconnected_way/*`
        //  `validationError=disconnected_way/highway`
        //  `validationError=crossing_ways/bridge*`
        //  `validationError=crossing_ways/bridge*,crossing_ways/tunnel*`
        const hash = urlhash?.initialHashParams ?? new Map<string, string>();
        this._errorOverrides = this._parseHashParam(hash.get('validationError'));
        this._warningOverrides = this._parseHashParam(hash.get('validationWarning'));
        this._disableOverrides = this._parseHashParam(hash.get('validationDisable'));

        const disabledRules = storage?.getItem('validate-disabledRules') ?? '';
        const validatorIDs = utilExtractValues(disabledRules).filter(Boolean);
        this._disabledValidatorIDs = new Set<ValidatorID>(validatorIDs);

        // Setup event handlers..
        // When to run validation:
        editor!
          .on('stablechange', () => this.validateAsync())
          .on('merge', (entityIDs: EntityID[]) => this._validateBaseEntitiesAsync(entityIDs));
      });
  }


  /**
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    return super.startAsync();
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    // empty queues
    this._base.queue = [];
    this._head.queue = [];

    // cancel deferred work
    const scheduler = this.context.systems.scheduler!;
    scheduler.cancelAllIdleTasks();

    for (const handle of this._deferredST) {
      globalThis.clearTimeout(handle);
    }
    this._deferredST.clear();

    // clear caches
    this._ignoredIssueIDs.clear();
    this._resolvedIssueIDs.clear();
    this._base = new ValidationCache('base');
    this._head = new ValidationCache('head');
    this._completeDiff.clear();

    return Promise.resolve();
  }


  /**
   * Converts hash parameters for severity overrides to regex matchers
   * @param val - The value retrieved, e.g. `crossing_ways/bridge*,crossing_ways/tunnel*`
   * @return Array of Objects like { type: RegExp, subtype: RegExp }
   */
  protected _parseHashParam(val: string = ''): SeverityOverride[] {
    const result: SeverityOverride[] = [];

    const vals = utilExtractValues(val, /[,;|]/).filter(Boolean);  // keep slashes
    for (const val of vals) {
      const parts = val.split('/', 2);  // "type/subtype"
      const type = parts[0];
      const subtype = parts[1] ?? '*';
      if (!type || !subtype) continue;
      result.push({ type: makeRegExp(type), subtype: makeRegExp(subtype) });
    }
    return result;

    /**
     *
     * @param str
     */
    function makeRegExp(str: string): RegExp {
      const escaped = str
        .replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&')   // escape all reserved chars except for the '*'
        .replace(/\*/g, '.*');                      // treat a '*' like '.*'
      return new RegExp(`^${escaped}$`);
    }
  }


  /**
   * Clears out the `_ignoredIssueIDs` Set
   */
  public resetIgnoredIssues(): void {
    this._ignoredIssueIDs.clear();
    this.emit('validated');   // redraw UI
  }


  /**
   * Called whenever the user changes the unsquare threshold
   * It reruns just the "unsquare_way" validation on all buildings.
   */
  public revalidateUnsquare(): void {
    const checkUnsquareWay = this._validators.get('unsquare_way');
    if (typeof checkUnsquareWay !== 'function') return;

    const revalidate = (cache: ValidationCache): void => {
      if (!cache.graph) return;

      cache.uncacheIssuesOfType('unsquare_way');   // uncache existing

      // rerun for all buildings
      const tree = this.context.systems.editor!.tree;
      const buildings = tree.intersects(new Extent([-180,-90],[180, 90]), cache.graph)  // everywhere
        .filter((entity: OsmEntity) => (entity.type === 'way' && entity.tags.building && entity.tags.building !== 'no'));

      for (const entity of buildings) {
        const detected = checkUnsquareWay(entity, cache.graph);
        if (!detected.issues.length) continue;
        cache.cacheIssues(detected.issues);
      }
    };

    revalidate(this._head);
    revalidate(this._base);
    this.emit('validated');
  }


  /**
   * Gets all issues that match the given options
   * This is called by many other places
   *
   * @param options - Object containing:
   * ```ts
   *   {
   *     what: 'all',                  // 'all' or 'edited'
   *     where: 'all',                 // 'all' or 'visible'
   *     includeIgnored: false,        // true, false, or 'only'
   *     includeDisabledRules: false   // true, false, or 'only'
   *   }
   * ```
   * @return An Array containing the issues
   */
  public getIssues(options?: GetIssuesOptions): ValidationIssue[] {
    // Note that we use `staging.graph` here, not `cache.graph` or `stable.graph`,
    // because that is the Graph that the calling code will be using.
    const opts: GetIssuesOptions = Object.assign({ what: 'all', where: 'all', includeIgnored: false, includeDisabledRules: false }, options);
    const context = this.context;
    const visibleExtent = context.viewport.visibleExtent();
    const graph: Graph = context.systems.editor!.staging.graph!;
    const seen = new Set<string>();
    const results: ValidationIssue[] = [];

    // Filter the issue set to include only what the calling code wants to see.
    const filter = (issue: ValidationIssue | undefined): boolean => {
      if (!issue) return false;
      if (seen.has(issue.id)) return false;
      if (this._resolvedIssueIDs.has(issue.id)) return false;
      if (opts.includeDisabledRules === 'only' && !this._disabledValidatorIDs.has(issue.type)) return false;
      if (!opts.includeDisabledRules && this._disabledValidatorIDs.has(issue.type)) return false;

      if (opts.includeIgnored === 'only' && !this._ignoredIssueIDs.has(issue.id)) return false;
      if (!opts.includeIgnored && this._ignoredIssueIDs.has(issue.id)) return false;

      // This issue may involve an entity that doesn't exist in `staging.graph`.
      // This can happen because validation is async and rendering the issue lists is async.
      if ((issue.entityIds || []).some(id => !graph.hasEntity(id))) return false;

      if (opts.where === 'visible') {
        const extent = issue.extent(graph);
        if (!extent || !visibleExtent.intersects(extent)) return false;
      }

      return true;
    };


    // Collect head issues - present in the user edits
    if (this._head.issues.size) {
      for (const issue of this._head.issues.values()) {
        // In the head cache, only count features that the user is responsible for - iD#8632
        // For example, a user can undo some work and an issue will still present in the
        // head graph, but we don't want to credit the user for causing that issue.
        const userModified = (issue.entityIds || []).some(entityID => this._completeDiff.has(entityID));
        if (opts.what === 'edited' && !userModified) continue;   // present in head but user didn't touch it

        if (!filter(issue)) continue;
        seen.add(issue.id);
        results.push(issue);
      }
    }

    // Collect base issues - present before user edits
    if (this._base.issues.size && opts.what === 'all') {
      for (const issue of this._base.issues.values()) {
        if (!filter(issue)) continue;
        seen.add(issue.id);
        results.push(issue);
      }
    }

    return results;
  }


  /**
   * Gets the issues that have been fixed by the user.
   * Resolved issues are tracked in the `_resolvedIssueIDs` Set,
   *  and they should all be issues that exist in the base cache.
   * @return An Array containing the issues
   */
  public getResolvedIssues(): ValidationIssue[] {
    return Array.from(this._resolvedIssueIDs)
      .map(issueID => this._base.issues.get(issueID))
      .filter((issue): issue is ValidationIssue => issue !== undefined);
  }


  /**
   * Adjusts the map to focus on the given issue.
   * (requires the issue to have a reasonable extent defined)
   * @param issue - The Issue to focus on
   */
  public focusIssue(issue: ValidationIssue): void {
    const context = this.context;
    const map = context.systems.map;

    const entityIDs = issue.entityIds ?? [];
    const selectID = entityIDs[0];
    if (!selectID) return;  // no entities?  shouldn't happen.

    // Try to adjust the map view
    if (issue.loc) {
      map?.centerZoomEase(issue.loc, 19);
    } else if (entityIDs.length) {
      map?.fitEntitiesEase(entityIDs);
    }

    // Select the first entity in the issue.
    globalThis.setTimeout(() => {
      context.enter('select-osm', { selection: { osm: [selectID] }} );
      this.emit('focusedIssue', issue);
    }, 250);  // after ease
  }


  /**
   * Gets the issues then groups them by error/warning
   * (This just calls `getIssues`, then puts issues in groups)
   *
   * @param options - see `getIssues`
   * @return result like:
   * ```ts
   *   {
   *     error:       Array<ValidationIssue>,
   *     warning:     Array<ValidationIssue>,
   *     suggestion:  Array<ValidationIssue>
   *   }
   * ```
   */
  public getIssuesBySeverity(options?: GetIssuesOptions): IssuesBySeverity {
    const groups = utilArrayGroupBy(this.getIssues(options), 'severity') as Record<ValidationSeverity, ValidationIssue[] | undefined>;
    return {       // note, we want them in this order
      error:       groups.error ?? [],
      warning:     groups.warning ?? [],
      suggestion:  groups.suggestion ?? []
    };
  }


  /**
   * Returns the icon name to display for a given issue severity.
   * @param severity - one of 'error', 'warning', 'suggestion', or 'resolved'
   * @return The name of the icon to use
   */
  public getSeverityIcon(severity: ValidationSeverity | 'resolved'): string {
    const icons: Record<string, string> = {
      error: '#rapid-icon-error',
      warning: '#fas-triangle-exclamation',
      suggestion: '#fas-circle-arrow-up',
      resolved: '#rapid-icon-apply'
    };
    return icons[severity] || '#fas-triangle-exclamation';
  }


  /**
   * Gets the issues that the given entityIDs have in common, matching the given options
   * (This just calls `getIssues`, then filters for the given entity IDs)
   * The issues are sorted for relevance
   *
   * @param entityIDs - Array or Set of entityIDs to get issues for
   * @param options   - See `getIssues`
   * @return An Array containing the issues
   */
  public getSharedEntityIssues(entityIDs: Iterable<EntityID>, options?: GetIssuesOptions): ValidationIssue[] {
    const orderedIssueTypes = [                 // Show some issue types in a particular order:
      'missing_tag', 'missing_role',            // - missing data first
      'outdated_tags', 'mismatched_geometry',   // - identity issues
      'crossing_ways', 'almost_junction',       // - geometry issues where fixing them might solve connectivity issues
      'disconnected_way', 'impossible_oneway'   // - finally connectivity issues
    ];

    const allIssues = this.getIssues(options);
    const forEntityIDs = new Set<EntityID>(entityIDs);

    return allIssues
      .filter(issue => (issue.entityIds ?? []).some(entityID => forEntityIDs.has(entityID)))
      .sort((issue1, issue2) => {
        if (issue1.type === issue2.type) {             // issues of the same type, sort deterministically
          return issue1.id < issue2.id ? -1 : 1;
        }
        const index1 = orderedIssueTypes.indexOf(issue1.type);
        const index2 = orderedIssueTypes.indexOf(issue2.type);
        if (index1 !== -1 && index2 !== -1) {          // both issue types have explicit sort orders
          return index1 - index2;
        } else if (index1 === -1 && index2 === -1) {   // neither issue type has an explicit sort order, sort by type
          return issue1.type < issue2.type ? -1 : 1;
        } else {                                       // order explicit types before everything else
          return index1 !== -1 ? -1 : 1;
        }
      });
  }


  /**
   * This just calls `getSharedEntityIssues` for the given entityID
   *
   * @param entityID - The entityID to get issues for
   * @param options  - See `getIssues`
   * @return An Array containing the issues
   */
  public getEntityIssues(entityID: EntityID, options?: GetIssuesOptions): ValidationIssue[] {
    return this.getSharedEntityIssues([entityID], options);
  }


  /**
   * Returns the IDs of all registered validators.
   * @return An Array containing all available validator IDs
   */
  public getValidatorIDs(): ValidatorID[] {
    return [...this._validators.keys()];
  }


  /**
   * Reports whether the given validator is currently enabled.
   * @param validatorID - The validatorID (e.g. 'crossing_ways')
   * @return true/false
   */
  public isValidatorEnabled(validatorID: ValidatorID): boolean {
    return !this._disabledValidatorIDs.has(validatorID);
  }


  /**
   * Toggles a single validatorID, then reruns the validation
   * so that the user sees something happen in the UI.
   * @param validatorID - The validator ID to toggle (e.g. 'crossing_ways')
   */
  public toggleValidator(validatorID: ValidatorID): void {
    if (this._disabledValidatorIDs.has(validatorID)) {
      this._disabledValidatorIDs.delete(validatorID);
    } else {
      this._disabledValidatorIDs.add(validatorID);
    }

    const storage = this.context.systems.storage;
    storage?.setItem('validate-disabledRules', [...this._disabledValidatorIDs].join(','));
    this.validateAsync();
  }


  /**
   * Disables given validatorIDs, then reruns validation
   * so that the user sees something happen in the UI.
   * @param validatorID - Complete set of validatorIDs that should be disabled
   */
  public disableValidators(validatorID: ValidatorID[] = []): void {
    this._disabledValidatorIDs = new Set<ValidatorID>(validatorID);

    const storage = this.context.systems.storage;
    storage?.setItem('validate-disabledRules', [...this._disabledValidatorIDs].join(','));
    this.validateAsync();
  }


  /**
   * Don't show the given issue in lists
   * @param issueID - The issueID to ignore
   */
  public ignoreIssue(issueID: IssueID): void {
    this._ignoredIssueIDs.add(issueID);
    this.emit('validated');   // emit an event to redraw various UI things
  }


  /**
   * Validates anything that has changed in the head graph since the last time it was run.
   * (head graph contains user's edits)
   * Returns a Promise fulfilled when the validation has completed and then emits a `validated` event.
   * This may take time but happen in the background during browser idle time.
   * @return Promise fulfilled when validation is completed.
   */
  public validateAsync(): Promise<void> {
    const context = this.context;
    const editor = context.systems.editor!;
    this._completeDiff = editor.difference().complete();

    if (editor.canRestoreBackup) return Promise.resolve();   // Wait to see if the user wants to restore their backup
    if (this._validationPromise) return this._validationPromise;   // Validation already in progress

    const baseGraph = editor.base.graph!;
    const stableGraph = editor.stable.graph!;
    const previousGraph = this._head.graph ?? baseGraph;   // the previously validated graph

    // User has not edited, or undone back to the base state, reset head cache
    if (stableGraph === baseGraph) {
      this._head = new ValidationCache('head');
      this._head.graph = stableGraph;
      this._resolvedIssueIDs.clear();
      this.emit('validated');
      return Promise.resolve();
    }

    // We are caught up to the stable graph
    if (stableGraph === previousGraph) {
      this.emit('validated');
      return Promise.resolve();
    }

    // If we get here, stable !== previous, so it's time to validate the stable graph..
    this._head.graph = stableGraph;   // take snapshot
    const incrementalDiff = new Difference(previousGraph, stableGraph!);
    const diffKeys = [ ...incrementalDiff.complete().keys() ];
    const entityIDs = this._head.withAllRelatedEntities(diffKeys);  // expand set

    if (!entityIDs.size) {    // nothing to do - committed a no-op edit?
      this.emit('validated');
      return Promise.resolve();
    }

    this._validationPromise = this._validateEntitiesAsync(this._head, entityIDs)
      .then(() => this._updateResolvedIssues(entityIDs))
      .then(() => this.emit('validated'))
      .catch(e => console.error(e))  // eslint-disable-line
      .then(() => {
        this._validationPromise = null;

        // Check if `stable` has changed while we were validating, and run it again to catch up if needed...
        const stableGraph = editor.stable.graph;
        const previousGraph = this._head.graph;
        if (stableGraph !== previousGraph) {
          this.validateAsync();  // recurse
        }
      });

    return this._validationPromise;
  }


  /**
   * Validates new entities being merged into the base graph.
   * (base graph contains original map state, before user's edits)
   * This may take time but happen in the background during browser idle time.
   * @param entityIDs - The entityIDs to validate
   * @return Promise fulfilled when validation is completed.
   */
  protected _validateBaseEntitiesAsync(entityIDs: Iterable<EntityID>): Promise<void> {
    const context = this.context;
    const editor = context.systems.editor!;
    if (!entityIDs) return Promise.resolve();

    // Make sure base cache has a graph assigned to it.
    // (We don't do this in `reset` because EditSystem is still resetting things and `base`/`stable` may be wrong)
    if (!this._base.graph) {
      this._base.graph = editor.base.graph!;
    }

    const expandedEntityIDs = this._base.withAllRelatedEntities(entityIDs);  // expand set

    return this._validateEntitiesAsync(this._base, expandedEntityIDs)
      .then(() => this._updateResolvedIssues(expandedEntityIDs))
      .then(() => { this.emit('validated'); })
      .catch((e: Error) => console.error(e));  // eslint-disable-line
  }


  /**
   * Runs all active validators against a single entity.
   * Some things to note:
   *  - Graph is passed in from whenever the validation was started.  Validators shouldn't use
   *    the staging/stable graphs because this all happens async, and the graph might have changed
   *   (for example, nodes getting deleted before the validation can run)
   *  - Validator functions may still be waiting on something and return a "provisional" result.
   *    In this situation, we will schedule to revalidate the entity sometime later.
   *
   * @param entity - The entity to validate
   * @param graph  - The Graph containing the Entity
   * @return Result like:
   *   {
   *     issues:       Array of detected issues
   *     provisional:  `true` if provisional result, `false` if final result
   *   }
   */
  protected _validateEntity(entity: OsmEntity, graph: Graph): ValidatorResult {

    // If there are any override rules that match the issue type/subtype,
    // adjust severity (or disable it) and keep/discard as quickly as possible.
    const applySeverityOverrides = (issue: ValidationIssue): boolean => {
      const type = issue.type;
      const subtype = issue.subtype ?? '';

      for (const error of this._errorOverrides) {
        if (error.type.test(type) && error.subtype.test(subtype)) {
          issue.severity = 'error';
          return true;
        }
      }
      for (const warning of this._warningOverrides) {
        if (warning.type.test(type) && warning.subtype.test(subtype)) {
          issue.severity = 'warning';
          return true;
        }
      }
      for (const disable of this._disableOverrides) {
        if (disable.type.test(type) && disable.subtype.test(subtype)) {
          return false;
        }
      }
      return true;
    };


    const result: ValidatorResult = { issues: [], provisional: false };
    for (const [validatorID, validator] of this._validators) {   // run all validators
      if (typeof validator !== 'function') {
        console.error(`ValidationSystem: no such validatorID = ${validatorID}`);  // eslint-disable-line no-console
        continue;
      }
      const detected = validator(entity, graph);
      if (detected.provisional) {   // this validation should be run again later
        result.provisional = true;
      }

      const filtered = detected.issues.filter(applySeverityOverrides);
      result.issues = result.issues.concat(filtered);
    }

    return result;
  }


  /**
   * Determine if any issues were resolved for the given entities.
   * This is called by `validateAsync()` after validation of the head graph
   *
   * Give the user credit for fixing an issue if:
   * - the issue is in the base cache
   * - the issue is not in the head cache
   * - the user did something to one of the entities involved in the issue
   *
   * @param entityIDs - Array or Set containing entity IDs.
   */
  protected _updateResolvedIssues(entityIDs: Iterable<EntityID> = []): void {
    for (const entityID of entityIDs) {
      const issues = this._base.entityIssueIDs.get(entityID) ?? [];
      for (const issueID of issues) {
        // Check if the user did something to one of the entities involved in this issue.
        // (This issue could involve multiple entities, e.g. disconnected routable features)
        const issue = this._base.issues.get(issueID);
        const userModified = (issue?.entityIds || []).some(id => this._completeDiff.has(id));

        if (userModified && !this._head.issues.has(issueID)) {  // issue seems fixed
          this._resolvedIssueIDs.add(issueID);
        } else {                                   // issue still not resolved
          this._resolvedIssueIDs.delete(issueID);  // (did undo, or possibly fixed and then re-caused the issue)
        }
      }
    }
  }


  /**
   * Schedule validation for many entities.
   * This may take time but happen in the background during browser idle time.
   * @param cache     - The cache to store results in (`_head` or `_base`)
   * @param entityIDs - The entityIDs to validate
   * @return Promise fulfilled when the validation has completed.
   */
  protected _validateEntitiesAsync(cache: ValidationCache, entityIDs: Iterable<EntityID>): Promise<void> {
    // Enqueue the work
    const jobs = Array.from(entityIDs).map(entityID => {
      if (cache.queuedEntityIDs.has(entityID)) return null;  // queued already
      cache.queuedEntityIDs.add(entityID);

      // Clear caches for existing issues related to this entity
      cache.uncacheEntityID(entityID);

      return () => {
        cache.queuedEntityIDs.delete(entityID);

        const graph = cache.graph;
        if (!graph) return;  // was reset?

        const entity = graph.hasEntity(entityID);   // Sanity check: don't validate deleted entities
        if (!entity) return;

        // detect new issues and update caches
        const result = this._validateEntity(entity, graph);
        if (result.provisional) {                       // provisional result
          cache.provisionalEntityIDs.add(entityID);     // we'll need to revalidate this entity again later
        }

        cache.cacheIssues(result.issues);   // update cache
      };

    }).filter(Boolean) as (() => void)[];

    // Perform the work in chunks.
    // Because this will happen during idle callbacks, we want to choose a chunk size
    // that won't make the browser stutter too badly.
    cache.queue = cache.queue.concat(utilArrayChunk(jobs, 50));

    // Enqueue the work
    if (!cache.queuePromise) {
      cache.queuePromise = this._processQueue(cache)
        .then(() => this._revalidateProvisionalEntities(cache))
        .catch((e: Error) => console.error(e))  // eslint-disable-line
        .finally(() => cache.queuePromise = null);
    }

    return cache.queuePromise;
  }


  /**
   * Sometimes a validator will return a "provisional" result.
   * In this situation, we'll need to revalidate the entity later.
   * This function waits a delay, then places them back into the validation queue.
   * @param cache - The cache to revalidate (`_head` or `_base`)
   */
  protected _revalidateProvisionalEntities(cache: ValidationCache): void {
    if (!cache.provisionalEntityIDs.size) return;  // nothing to do

    const handle = globalThis.setTimeout(() => {
      this._deferredST.delete(handle);
      if (!cache.provisionalEntityIDs.size) return;  // nothing to do
      this._validateEntitiesAsync(cache, cache.provisionalEntityIDs);
    }, RETRY);

    this._deferredST.add(handle);
  }


  /**
   * Process the next chunk of deferred validation work
   * This may take time but happen in the background during browser idle time.
   * @param cache - The cache to process (`_head` or `_base`)
   * @return Promise fulfilled when the validation has completed.
   */
  protected _processQueue(cache: ValidationCache): Promise<void> {
    // console.log(`${cache.which} queue length ${cache.queue.length}`);

    if (!cache.queue.length) return Promise.resolve();  // we're done
    const chunk = cache.queue.pop()!;
    const scheduler = this.context.systems.scheduler!;

    return scheduler.scheduleIdleTask(() => {
        // const t0 = performance.now();
        chunk.forEach(job => job());
        // const t1 = performance.now();
        // console.log('chunk processed in ' + (t1 - t0) + ' ms');
      })
      .then(() => { // dispatch an event sometimes to redraw various UI things
        if (cache.queue.length % 100 === 0) {
          this.emit('validated');
        }
      })
      .then(() => this._processQueue(cache));
  }
}

