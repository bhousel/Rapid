import { marked } from 'marked';
import { icon } from './intro/helper.ts';
import { UiIntro } from './intro/UiIntro.ts';
import { UiModal } from './UiModal.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';


/**
 * This is the screen we show to the users if:
 * - They have never used Rapid before, or
 * - We have an updated privacy policy to tell them about
 */
export class UiSplash {
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
    const assets = context.systems.assets!;
    const l10n = context.systems.l10n!;
    const settings = context.systems.settings;

    const sawPrivacyVersion = parseInt(settings?.get('ui.sawPrivacyVersion') ?? '', 10) || 0;

    const rtl = l10n.isRTL ? '-rtl' : '';
    settings?.set('ui.sawPrivacyVersion', String(context.privacyVersion));

    // prefetch intro graph data now, while user is looking at the splash screen
    assets.loadAssetAsync('intro_graph');

    const Modal = new UiModal(context).show();
    Modal.$modal!
      .attr('class', 'modal rapid-modal modal-splash');

    const $content: D3Selection = Modal.$content!;

    /* Heading section */
    let $heading: D3Selection = $content.selectAll('.modal-heading')
      .data([0]);

    // enter
    const $$heading: D3EnterSelection = $heading
      .enter()
      .append('div')
      .attr('class', 'modal-section modal-heading');

    $$heading
      .append('h1')
      .attr('class', 'modal-heading-text');

    // update
    $heading = $heading.merge($$heading);

    $heading.selectAll('.modal-heading-text')
      .html(l10n.t('splash.welcome', {
        rapidicon: icon(`#rapid-logo-rapid-wordmark${rtl}`, 'pre-text rapid'),
        version: `v${context.version}`
      }));


    /* Main section */
    let markdown = l10n.t('splash.text') + '\n\n';

    // If they have seen some privacy version, but not the current one,
    // prepend with "Our privacy policy has recently been updated."
    if (sawPrivacyVersion > 0) {
      markdown += l10n.t('splash.privacy_update') + ' ';
    }
    markdown += l10n.t('splash.privacy');


    $content
      .append('div')
      .attr('class', 'modal-section')
      .html(marked.parse(markdown) as string);

    // outbound links should open in new tab
    $content.selectAll('a')
      .attr('target', '_blank');


    /* Button section */
    const $buttonWrap = $content
      .append('div')
      .attr('class', 'modal-actions');

    const $walkthrough = $buttonWrap
      .append('button')
      .attr('class', 'walkthrough')
      .on('click', () => {
        new UiIntro(context).start();
        Modal.close();
      });

    $walkthrough
      .append('svg')
      .attr('class', 'logo logo-walkthrough')
      .append('use')
      .attr('xlink:href', '#rapid-logo-walkthrough');

    $walkthrough
      .append('div')
      .text(l10n.t('splash.walkthrough'));

    const $startEditing = $buttonWrap
      .append('button')
      .attr('class', 'start-editing')
      .on('click', Modal.close);

    $startEditing
      .append('svg')
      .attr('class', 'logo logo-features')
      .append('use')
      .attr('xlink:href', '#rapid-logo-features');

    $startEditing
      .append('div')
      .text(l10n.t('splash.start'));
  }
}
