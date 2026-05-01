import type { ValidationIssue } from './ValidationIssue.ts';



/**
 * Properties that define a ValidationFix.
 */
export interface ValidationFixProps {
  /** Display title for this fix */
  title: string;
  /** The function to run to apply the fix */
  onClick: (() => void) | undefined;
  /** A string explaining why the fix is unavailable, if any */
  disabledReason: string | undefined;
  /** Icon name for the fix (defaults to 'rapid-icon-wrench') */
  icon: string | undefined;
  /** Entity IDs used for hover-highlighting */
  entityIds: EntityID[];
}


/**
 * Represents a possible fix for a validation issue.
 * Each ValidationIssue can have multiple possible fixes that the user can choose from.
 */
export class ValidationFix {
  /** Unique identifier for this fix (set by ValidationIssue.fixes()) */
  id: string;
  /** Display title for this fix */
  title: string;
  /** The function to run to apply the fix */
  onClick: (() => void) | undefined;
  /** A string explaining why the fix is unavailable, if any */
  disabledReason: string | undefined;
  /** Icon name for the fix (defaults to 'rapid-icon-wrench') */
  icon: string | undefined;
  /** Entity IDs used for hover-highlighting */
  entityIds: EntityID[];
  /** Reference back to the parent ValidationIssue (set by ValidationIssue.fixes()) */
  issue: ValidationIssue | null;

  /**
   * @constructor
   * @param props - Properties for this ValidationFix
   */
  constructor(props: Partial<ValidationFixProps>) {
    this.id = '';
    this.title = props.title ?? '';
    this.onClick = props.onClick;
    this.disabledReason = props.disabledReason;
    this.icon = props.icon;
    this.entityIds = props.entityIds ?? [];

    this.issue = null;    // Generated link - added by ValidationIssue
  }
}
