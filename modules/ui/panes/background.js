import { uiPane } from '../pane.js';
import { UiSectionBackgroundDisplayOptions } from '../sections/UiSectionBackgroundDisplayOptions.js';
import { UiSectionBackgroundList } from '../sections/UiSectionBackgroundList.js';
import { UiSectionBackgroundOffset } from '../sections/UiSectionBackgroundOffset.js';
import { UiSectionGridDisplayOptions } from '../sections/UiSectionGridDisplayOptions.js';
import { UiSectionOverlayList } from '../sections/UiSectionOverlayList.js';
// import { uiSectionReactContainer } from '../sections/react_container.jsx';


export function uiPaneBackground(context) {
  const l10n = context.systems.l10n;

  return uiPane(context, 'background')
    .key(l10n.t('shortcuts.command.toggle_background.key'))
    .label(l10n.t('background.title'))
    .description(l10n.t('background.description'))
    .iconName('rapid-icon-layers')
    .sections([
      new UiSectionBackgroundList(context),
      // uiSectionReactContainer(context),
      new UiSectionOverlayList(context),
      new UiSectionGridDisplayOptions(context),
      new UiSectionBackgroundDisplayOptions(context),
      new UiSectionBackgroundOffset(context)
    ]);
}
