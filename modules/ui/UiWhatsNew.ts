import { marked } from 'marked';
import { icon } from './intro/helper.ts';
import { UiModal } from './UiModal.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * This is the "whats new" screen we show to the users if:
 * - They have used Rapid before and seen the welcome screen
 * - They do not have backup changes to restore
 */
export class UiWhatsNew {
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
    // const assets = context.systems.assets;
    const l10n = context.systems.l10n!;
    const settings = context.systems.settings;

    const modal = new UiModal(context).show();
    const rtl = l10n.isRTL ? '-rtl' : '';

    modal.$modal!
      .attr('class', 'modal rapid-modal modal-whatsnew');

    const $content: D3Selection = modal.$content!;
    $content
      .append('div')
      .attr('class', 'modal-section')
      .append('h2')
      .html(l10n.t('splash.welcome', {
        rapidicon: icon(`#rapid-logo-rapid-wordmark${rtl}`, 'pre-text rapid'),
        version: `v${context.version}`
      }));


    const markdown = `
Big changes are coming soon to Rapid. including:

* · Rewritten core data model, allows for runtime data conflation across data layers.
* · New schema system - bring your own Presets, Fields, tag matching rules.
* · New styling system - control all aspects of map styling: colors, line widths, etc.
* · Style, Schema, and Imagery can all be replaced with your own custom rules changed on the fly.
* · All customizations can be scoped - they can apply to 'osm' or to other data layers.

<br/>Happy Mapping! 👍
`;
//    const markdown = l10n.t('whats_new.text_v25') + '\n\n' + l10n.t('whats_new.project_links') + '\n\n';

    const $mainSection = $content
      .append('div')
      .attr('class', 'modal-section');

    $mainSection
      .append('div')
      .attr('class', 'whatsnew-text')
      .html(marked.parse(markdown) as string);

//     $mainSection
//       .append('div')
//       .attr('class', 'whatsnew-images')
// // if an image:
//       .append('img')
//       .attr('class', 'whatsnew-image')
//       .attr('src', assets.getFileURL('img/rapid-v25-curbs.gif'));
// // if a video:
// //      .append('video')
// //      .attr('class', 'whatsnew-image')
// //      .attr('width', '660')
// //      .attr('muted', '')
// //      .attr('controls', '')
// //      .attr('loop', '')
// //      .attr('playsinline', '')
// //      .attr('disablepictureinpicture', '')
// //      .attr('poster', assets.getFileURL('img/rapid-v23-rotation.jpg'))
// //      .attr('src', assets.getFileURL('img/rapid-v23-rotation.mp4'))
// //      .attr('autoplay', '');

    const $checkbox = $mainSection
      .append('div')
      .attr('class', 'rapid-checkbox whatsnew-dontshow')
      .append('label')
      .attr('class', 'rapid-checkbox-label');

    $checkbox
      .append('span')
      .attr('class', 'rapid-checkbox-text')
      .text(l10n.t('whats_new.dontshowagain'));

    $checkbox
      .append('input')
      .attr('type', 'checkbox')
      .attr('class', 'rapid-feature-checkbox')
      .on('click', (d3_event: Event) => {
        if ((d3_event.target as HTMLInputElement).checked) {
          settings?.set('ui.sawWhatsNewVersion', String(context.whatsNewVersion));
        } else {
          settings?.unset('ui.sawWhatsNewVersion');
        }
      });

    $checkbox
      .append('div')
      .attr('class', 'rapid-checkbox-custom');


    // outbound links should open in new tab
    $content.selectAll('a')
      .attr('target', '_blank');


    /* OK Button */
    const $buttonWrap = $content
      .append('div')
      .attr('class', 'modal-section buttons');

    const $okButton = $buttonWrap
      .append('button')
      .attr('class', 'button ok-button action')
      .text(l10n.t('confirm.okay'))
      .on('click', modal.close);

    ($okButton.node() as HTMLElement | null)?.focus();
  }
}
