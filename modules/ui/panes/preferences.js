import { uiPane } from '../pane.js';
import { UiSectionPrivacy } from '../sections/UiSectionPrivacy.js';
//import { UiSectionColorSelection } from '../sections/UiSectionColorSelection.js';
//import { UiSectionColorblindModeOptions } from '../sections/UiSectionColorblindModeOptions.js';
import { UiSectionMapInteractionOptions } from '../sections/UiSectionMapInteractionOptions.js';


export function uiPanePreferences(context) {
  const l10n = context.systems.l10n;

  return uiPane(context, 'preferences')
    .key(l10n.t('shortcuts.command.toggle_preferences.key'))
    .label(l10n.t('preferences.title'))
    .description(l10n.t('preferences.description'))
    .iconName('fas-user-cog')
    .sections([
      new UiSectionPrivacy(context),
      new UiSectionMapInteractionOptions(context),
//      uiSectionColorSelection(context),
//      uiSectionColorblindModeOptions(context)
    ]);
}
