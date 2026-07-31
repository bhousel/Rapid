import { UiPane } from '../UiPane.js';

import { UiSectionDataLayers } from '../sections/UiSectionDataLayers.js';
import { UiSectionMapFeatures } from '../sections/UiSectionMapFeatures.js';
import { UiSectionMapStyleOptions } from '../sections/UiSectionMapStyleOptions.js';
import { UiSectionPhotoOverlays } from '../sections/UiSectionPhotoOverlays.js';

import type { Context } from '../../Context.ts';


export class UiPaneMapData extends UiPane {
  public constructor(context: Context) {
    super(context, 'map-data');

    const l10n = context.systems.l10n!;

    this.key = l10n.t('shortcuts.command.toggle_map_data.key');
    this.label = l10n.t('map_data.title');
    this.description = l10n.t('map_data.description');
    this.iconName = 'rapid-icon-data';
    this.sections = [
      new UiSectionDataLayers(context),
      new UiSectionPhotoOverlays(context),
      new UiSectionMapStyleOptions(context),
      new UiSectionMapFeatures(context)
    ];
  }
}
