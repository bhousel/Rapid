import { UiPane } from '../UiPane.js';
import { UiSectionPrivacy } from '../sections/UiSectionPrivacy.js';
//import { UiSectionColorSelection } from '../sections/UiSectionColorSelection.js';
//import { UiSectionColorblindModeOptions } from '../sections/UiSectionColorblindModeOptions.js';
import { UiSectionMapInteractionOptions } from '../sections/UiSectionMapInteractionOptions.js';

import type { Context } from '../../Context.ts';


export class UiPanePreferences extends UiPane {
  public constructor(context: Context) {
    super(context, 'preferences');

    const l10n = context.systems.l10n!;

    this.key = l10n.t('shortcuts.command.toggle_preferences.key');
    this.label = l10n.t('preferences.title');
    this.description = l10n.t('preferences.description');
    this.iconName = 'fas-user-cog';
    this.sections = [
      new UiSectionPrivacy(context),
      new UiSectionMapInteractionOptions(context),
//      new UiSectionColorSelection(context),
//      new UiSectionColorblindModeOptions(context)
    ];
  }
}
