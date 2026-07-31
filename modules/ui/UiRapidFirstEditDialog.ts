import { icon } from './intro/helper.js';
import { uiModal } from './modal.js';
import { UiRapidSplash } from './UiRapidSplash.js';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


export class UiRapidFirstEditDialog {
  public context: Context;

  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.render = this.render.bind(this);
  }


  /**
   * Builds the modal and renders its content.
   * The given selection is the container the modal attaches to. This is a one-shot
   *  modal (not re-rendered in place), so it does not capture `$parent`.
   * @param $selection - A d3-selection to the container this modal attaches to
   */
  public render($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const $modal = uiModal($selection);
    const rtl = l10n.isRTL ? '-rtl' : '';

    $modal.select('.modal')
      .attr('class', 'modal rapid-modal');

    const $content = $modal.select('.content');

    $content
      .append('div')
      .attr('class', 'modal-section')
      .append('h3')
      .html(l10n.t('rapid_first_edit.nice', {
        rapidicon: icon(`#rapid-logo-rapid-wordmark${rtl}`, 'logo-rapid')
      }));

    $content
      .append('div')
      .attr('class', 'modal-section')
      .append('p')
      .text(l10n.t('rapid_first_edit.text'));

    const $buttonWrap = $content
      .append('div')
      .attr('class', 'modal-actions');

    const $exploring = $buttonWrap
      .append('button')
      .attr('class', 'rapid-explore')
      .on('click', $modal.close);

    $exploring
      .append('div')
      .text(l10n.t('rapid_first_edit.exploring'));

    const $loginToOsm = $buttonWrap
      .append('button')
      .attr('class', 'rapid-login-to-osm')
      .on('click', () => {
        $modal.close();
        const osm = context.services.osm;
        if (!osm) return;
        osm.authenticate(() => new UiRapidSplash(context).render(context.container()) );
      });

    $loginToOsm
      .append('div')
      .text(l10n.t('rapid_first_edit.login_with_osm'));
  }
}
