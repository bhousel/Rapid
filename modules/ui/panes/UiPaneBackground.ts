import { UiPane } from '../UiPane.js';
import { UiSectionBackgroundDisplayOptions } from '../sections/UiSectionBackgroundDisplayOptions.js';
import { UiSectionBackgroundList } from '../sections/UiSectionBackgroundList.js';
import { UiSectionBackgroundOffset } from '../sections/UiSectionBackgroundOffset.js';
import { UiSectionGridDisplayOptions } from '../sections/UiSectionGridDisplayOptions.js';
import { UiSectionOverlayList } from '../sections/UiSectionOverlayList.js';
// import { UiSectionReactContainer } from '../sections/react_container.jsx';

import type { Context } from '../../Context.ts';


export class UiPaneBackground extends UiPane {
  public constructor(context: Context) {
    super(context, 'background');

    const l10n = context.systems.l10n!;

    this.key = l10n.t('shortcuts.command.toggle_background.key');
    this.label = l10n.t('background.title');
    this.description = l10n.t('background.description');
    this.iconName = 'rapid-icon-layers';
    this.sections = [
      new UiSectionBackgroundList(context),
      // new UiSectionReactContainer(context),
      new UiSectionOverlayList(context),
      new UiSectionGridDisplayOptions(context),
      new UiSectionBackgroundDisplayOptions(context),
      new UiSectionBackgroundOffset(context)
    ];
  }
}
