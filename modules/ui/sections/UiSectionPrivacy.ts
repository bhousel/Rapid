import { AbstractUiSection } from './AbstractUiSection.ts';
import { uiTooltip } from '../tooltip.ts';
import { uiIcon } from '../icon.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


export class UiSectionPrivacy extends AbstractUiSection {
  protected _showThirdPartyIcons: string;

  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'preferences-third-party');

    const settings = context.systems.settings;
    this._showThirdPartyIcons = settings?.get('ui.privacy.thirdPartyIcons') || 'true';
  }


  /**
   * The section's heading label.
   * @return Localized section title
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('preferences.privacy.title');
  }


  /**
   * Renders the privacy options into the disclosure body.
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const settings = context.systems.settings;

    const update = (): void => {
      $selection.selectAll('.privacy-third-party-icons-item')
        .classed('active', (this._showThirdPartyIcons === 'true'))
        .select('input')
        .property('checked', (this._showThirdPartyIcons === 'true'));
    };

    // enter
    const $$privacyOptionsList = $selection.selectAll('.privacy-options-list')
      .data([0])
      .enter()
      .append('ul')
      .attr('class', 'layer-list privacy-options-list');

    const $$thirdPartyIcons = $$privacyOptionsList
      .append('li')
      .attr('class', 'privacy-third-party-icons-item')
      .append('label')
      .call(uiTooltip(context)
        .title(l10n.t('preferences.privacy.third_party_icons.tooltip'))
        .placement('bottom')
      );

    $$thirdPartyIcons
      .append('input')
      .attr('type', 'checkbox')
      .on('change', (d3_event: Event) => {
        d3_event.preventDefault();
        this._showThirdPartyIcons = (this._showThirdPartyIcons === 'true') ? 'false' : 'true';
        settings?.set('ui.privacy.thirdPartyIcons', this._showThirdPartyIcons);
        update();
      });

    $$thirdPartyIcons
      .append('span');


    // Privacy Policy link
    $selection.selectAll('.privacy-link')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'privacy-link')
      .append('a')
      .attr('target', '_blank')
      .call(uiIcon('#rapid-icon-out-link', 'inline'))
      .attr('href', 'https://rapideditor.org/doc/license/MapWithAIPrivacyPolicy.pdf')
      .append('span');

    // Set localized text on the update selection so it re-localizes on language change.
    $selection.selectAll('.privacy-third-party-icons-item span')
      .text(l10n.t('preferences.privacy.third_party_icons.description'));
    $selection.select('.privacy-link span')
      .text(l10n.t('preferences.privacy.privacy_link'));

    update();
  }
}
