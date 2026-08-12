import { icon } from './intro/helper.ts';
import { UiModal } from './UiModal.ts';
import { UiRapidSplash } from './UiRapidSplash.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


export class UiRapidFirstEditDialog {
  public context: Context;

  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
  }


  /**
   * Renders the content inside the Modal component.
   */
  public render(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    const Modal = new UiModal(context).show();
    const rtl = l10n.isRTL ? '-rtl' : '';

    Modal.$modal!
      .attr('class', 'modal rapid-modal');

    const $content: D3Selection = Modal.$content!;

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
      .on('click', Modal.close);

    $exploring
      .append('div')
      .text(l10n.t('rapid_first_edit.exploring'));

    const $loginToOsm = $buttonWrap
      .append('button')
      .attr('class', 'rapid-login-to-osm')
      .on('click', () => {
        Modal.close();
        const osm = context.services.osm;
        if (!osm) return;
        osm.authenticate(() => new UiRapidSplash(context).render() );
      });

    $loginToOsm
      .append('div')
      .text(l10n.t('rapid_first_edit.login_with_osm'));
  }
}
