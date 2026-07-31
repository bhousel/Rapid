import { UiPane } from '../UiPane.js';
import { UiSectionValidationIssues } from '../sections/UiSectionValidationIssues.js';
import { UiSectionValidationOptions } from '../sections/UiSectionValidationOptions.js';
import { UiSectionValidationRules } from '../sections/UiSectionValidationRules.js';
import { UiSectionValidationStatus } from '../sections/UiSectionValidationStatus.js';

import type { Context } from '../../Context.ts';


export class UiPaneIssues extends UiPane {
  public constructor(context: Context) {
    super(context, 'issues');

    const l10n = context.systems.l10n!;

    this.key = l10n.t('shortcuts.command.toggle_issues.key');
    this.label = l10n.t('issues.title');
    this.description = l10n.t('issues.title');
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
