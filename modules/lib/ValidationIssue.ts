import { Extent } from '@rapid-sdk/math';

import type { Context } from '../core/types.ts';
import type { EntityID, Vec2 } from '../data/types.ts';
import type { Graph } from './Graph.js';
import { ValidationFix } from './ValidationFix.ts';
import { utilTotalExtent } from '../util/util.ts';


/** Severity level for validation issues */
export type ValidationSeverity = 'warning' | 'error' | 'suggestion';


/**
 * Properties that define a ValidationIssue.
 */
export interface ValidationIssueProps {
  /** Name of rule that created the issue (e.g. 'missing_tag') */
  type: string;
  /** Category of the issue within the type (e.g. 'relation_type' under 'missing_tag') */
  subtype: string;
  /** Severity level: 'warning', 'error', or 'suggestion' */
  severity: ValidationSeverity;
  /** Array of IDs of entities involved in the issue */
  entityIds: EntityID[];
  /** [lon, lat] to zoom in on to see the issue */
  loc: Vec2;
  /** Extra data for the fixes */
  data: Record<string, unknown>;
  /** String to further differentiate the issue */
  hash: string;
  /** If this issue can be autofixed, supply the autofix args at issue creation */
  autoArgs: unknown[];
  /** Function returning localized string for the issue message */
  message: () => string;
  /** Function to render reference information */
  reference: (selection: unknown) => void;
  /** Function returning fixes for this issue */
  dynamicFixes: () => ValidationFix[];
}


/**
 * ValidationIssue
 * Represents a validation problem detected in the map data.
 * Each issue has a type, severity, affected entities, and possible fixes.
 */
export class ValidationIssue {
  context: Context;
  /** Unique identifier for this issue */
  id: string;
  /** Key suitable for use with d3.selection#data() */
  key: string;
  /** Name of rule that created the issue */
  type: string;
  /** Category of the issue within the type */
  subtype: string | undefined;
  /** Severity level */
  severity: ValidationSeverity;
  /** Array of IDs of entities involved in the issue */
  entityIds: EntityID[];
  /** [lon, lat] to zoom in on to see the issue */
  loc: Vec2 | undefined;
  /** Extra data for the fixes */
  data: Record<string, unknown> | undefined;
  /** String to further differentiate the issue */
  hash: string | undefined;
  /** If this issue can be autofixed, supply the autofix args at issue creation */
  autoArgs: unknown[] | undefined;
  /** Function returning localized string for the issue message */
  message: () => string;
  /** Function to render reference information */
  reference: (selection: unknown) => void;
  /** Function returning fixes for this issue */
  dynamicFixes: (() => ValidationFix[]) | undefined;

  /**
   * @constructor
   * @param context - Global shared application context
   * @param props - Properties for this ValidationIssue
   */
  constructor(context: Context, props: Partial<ValidationIssueProps>) {
    this.context = context;

    this.type = props.type ?? '';
    this.subtype = props.subtype;
    this.severity = props.severity ?? 'warning';
    this.entityIds = props.entityIds ?? [];
    this.loc = props.loc;
    this.data = props.data;
    this.hash = props.hash;
    this.autoArgs = props.autoArgs;

    // Make sure callbacks have `this` bound correctly
    this.message = props.message?.bind(this) ?? (() => '');
    this.reference = props.reference?.bind(this) ?? (() => {});
    if (props.dynamicFixes) this.dynamicFixes = props.dynamicFixes.bind(this);

    this.id = this._generateID();            // generated - see below
    this.key = this._generateKey();          // generated - see below (call after generating this.id)
  }


  /**
   * extent
   * Returns the geographic extent of the issue.
   * @param graph - The graph to look up entities in
   * @return The extent of the issue, or null if not determinable
   */
  extent(graph: Graph): Extent | null {
    if (this.loc) {
      return new Extent(this.loc);
    }
    if (this.entityIds && this.entityIds.length) {
      return utilTotalExtent(this.entityIds, graph);
    }
    return null;
  }


  /**
   * fixes
   * Returns the available fixes for this issue.
   * @return Array of ValidationFix objects
   */
  fixes(): ValidationFix[] {
    // sometimes the fixes are generated dynamically
    // (bhousel - why is this?  so they can use the latest graph?)
    const fixes: ValidationFix[] = (typeof this.dynamicFixes === 'function') ? this.dynamicFixes() : [];

    // For minor issues, create an "ignore" option
    if (this.severity !== 'error') {
      const l10n = this.context.systems.l10n;
      const validator = (this.context.systems.validator as any);

      fixes.push(new ValidationFix({
        title: l10n?.t('issues.fix.ignore_issue.title') ?? 'Ignore this issue',
        icon: 'rapid-icon-close',
        onClick: () => {
          validator.ignoreIssue(this.id);
        }
      }));
    }

    for (const fix of fixes) {
      fix.id = fix.title;   // the id doesn't matter as long as it's unique to this issue/fix
      fix.issue = this;     // add a reference back to this issue for use in actions
    }
    return fixes;
  }


  /**
   * _generateID
   * A unique, deterministic string hash.
   * Issues with identical id values are considered identical.
   */
  private _generateID(): string {
    const parts: string[] = [this.type];

    if (this.hash) {   // subclasses can pass in their own differentiator
      parts.push(this.hash);
    }

    if (this.subtype) {
      parts.push(this.subtype);
    }

    // include the entities this issue is for
    // (sort them so the id is deterministic)
    if (this.entityIds) {
      const entityKeys = this.entityIds.slice().sort();
      parts.push(...entityKeys);
    }

    return parts.join(':');
  }


  /**
   * _generateKey
   * An identifier suitable for use as the second argument to d3.selection#data().
   * (i.e. this should change whenever the data needs to be refreshed)
   */
  private _generateKey(): string {
    return this.id + ':' + Date.now().toString();  // include time of creation
  }
}
