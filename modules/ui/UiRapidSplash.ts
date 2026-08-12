import { icon } from './intro/helper.ts';
import { UiIntro } from './intro/UiIntro.ts';
import { UiModal } from './UiModal.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * This is the screen we show to the users if they have never used Rapid before.
 */
export class UiRapidSplash {
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
    const settings = context.systems.settings;

    if (settings?.has('ui.sawRapidSplash')) return;
    settings?.set('ui.sawRapidSplash', 'true');

    const Modal = new UiModal(context);
    Modal.show();
    const rtl = l10n.isRTL ? '-rtl' : '';

    Modal.$modal!
      .attr('class', 'modal rapid-modal modal-splash');   // Rapid styling

    const $introModal: D3Selection = Modal.$content!;

    $introModal
      .append('div')
      .attr('class','modal-section')
      .append('h3')
      .text(l10n.t('rapid_splash.welcome'));

    $introModal
      .append('div')
      .attr('class','modal-section')
      .append('p')
      .html(l10n.t('rapid_splash.text', {
        rapidicon: icon(`#rapid-logo-rapid-wordmark${rtl}`, 'logo-rapid'),
        walkthrough: icon('#rapid-logo-walkthrough', 'logo-walkthrough'),
        edit: icon('#rapid-logo-features', 'logo-features')
      }));

    const $buttonWrap = $introModal
      .append('div')
      .attr('class', 'modal-actions');

    const $walkthrough = $buttonWrap
      .append('button')
      .attr('class', 'walkthrough')
      .on('click', () => {
        new UiIntro(context).start(false);
        Modal.close();
      });

    $walkthrough
      .append('svg')
      .attr('class', 'logo logo-features')
      .append('use')
      .attr('xlink:href', '#rapid-logo-walkthrough');

    $walkthrough
      .append('div')
      .text(l10n.t('rapid_splash.walkthrough'));

    const $rapidWalkthrough = $buttonWrap
      .append('button')
      .attr('class', 'rapid-walkthrough')
      .on('click', () => {
        new UiIntro(context).start(true);
        Modal.close();
      });

    $rapidWalkthrough
      .append('svg')
      .attr('class', 'logo logo-rapid')
      .append('use')
      .attr('xlink:href', `#rapid-logo-rapid-wordmark${rtl}`);

    $rapidWalkthrough
      .append('div')
      .text(l10n.t('rapid_splash.skip_to_rapid'));

    const $startEditing = $buttonWrap
      .append('button')
      .attr('class', 'start-editing')
      .on('click', () => {
        Modal.close();
      });

    $startEditing
      .append('svg')
      .attr('class', 'logo logo-features')
      .append('use')
      .attr('xlink:href', '#rapid-logo-features');

    $startEditing
      .append('div')
      .text(l10n.t('rapid_splash.start'));

    Modal.$modal!.select('button.close')
      .attr('class', 'hide');
  }
}
