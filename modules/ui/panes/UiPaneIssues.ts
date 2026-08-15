import { UiPane } from '../UiPane.ts';
import { UiSectionValidationIssues } from '../sections/UiSectionValidationIssues.ts';
import { UiSectionValidationOptions } from '../sections/UiSectionValidationOptions.ts';
import { UiSectionValidationRules } from '../sections/UiSectionValidationRules.ts';
import { UiSectionValidationStatus } from '../sections/UiSectionValidationStatus.ts';

import type { Context } from '../../Context.ts';


export class UiPaneIssues extends UiPane {
  public constructor(context: Context) {
    super(context, 'issues');

    const l10n = context.systems.l10n!;
    const issues = l10n.t('text.issue', { n: 100 });  // force plural, i.e. "issues"

    this.key = l10n.t('shortcuts.command.toggle_issues.key');
    this.label = issues;
    this.description = issues;
    this.iconName = 'rapid-icon-alert';
    this.sections = [
      new UiSectionValidationOptions(context),
      new UiSectionValidationStatus(context),
      new UiSectionValidationIssues(context, 'error'),
      new UiSectionValidationIssues(context, 'warning'),
      new UiSectionValidationIssues(context, 'suggestion'),
      new UiSectionValidationRules(context)
    ];
  }
}
