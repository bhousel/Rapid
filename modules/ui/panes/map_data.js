import { uiPane } from '../pane.js';

import { UiSectionDataLayers } from '../sections/UiSectionDataLayers.js';
import { UiSectionMapFeatures } from '../sections/UiSectionMapFeatures.js';
import { UiSectionMapStyleOptions } from '../sections/UiSectionMapStyleOptions.js';
import { UiSectionPhotoOverlays } from '../sections/UiSectionPhotoOverlays.js';


export function uiPaneMapData(context) {
  const l10n = context.systems.l10n;

  return uiPane(context, 'map-data')
    .key(l10n.t('shortcuts.command.toggle_map_data.key'))
    .label(l10n.t('map_data.title'))
    .description(l10n.t('map_data.description'))
    .iconName('rapid-icon-data')
    .sections([
      new UiSectionDataLayers(context),
      new UiSectionPhotoOverlays(context),
      new UiSectionMapStyleOptions(context),
      new UiSectionMapFeatures(context)
    ]);
}
