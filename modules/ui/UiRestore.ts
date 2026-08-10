import { UiModal } from './UiModal.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


export class UiRestore {
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
   * Builds the modal and renders its content.
   * The given selection is the container the modal attaches to. This is a one-shot
   *  modal (not re-rendered in place), so it does not capture `$parent`.
   * @param $selection - A d3-selection to the container this modal attaches to
   */
  public render($selection: D3Selection): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    if (!editor.canRestoreBackup) return;

    const modal = new UiModal(context, true).show($selection);

    modal.$modal!
      .attr('class', 'modal fillL');

    const $introModal = modal.$content!;

    $introModal
      .append('div')
      .attr('class', 'modal-section')
      .append('h3')
      .text(l10n.t('restore.heading'));

    $introModal
      .append('div')
      .attr('class','modal-section')
      .append('p')
      .text(l10n.t('restore.description'));

    const $buttonWrap = $introModal
      .append('div')
      .attr('class', 'modal-actions');

    const $restore = $buttonWrap
      .append('button')
      .attr('class', 'restore')
      .on('click', () => {
        editor.restoreBackup();
        modal.close();
      });

    $restore
      .append('svg')
      .attr('class', 'logo logo-restore')
      .append('use')
      .attr('xlink:href', '#rapid-logo-restore');

    $restore
      .append('div')
      .text(l10n.t('restore.restore'));

    const $reset = $buttonWrap
      .append('button')
      .attr('class', 'reset')
      .on('click', () => {
        editor.clearBackup();
        modal.close();
      });

    $reset
      .append('svg')
      .attr('class', 'logo logo-reset')
      .append('use')
      .attr('xlink:href', '#rapid-logo-reset');

    $reset
      .append('div')
      .text(l10n.t('restore.reset'));

    ($restore.node() as HTMLElement | null)?.focus();
  }
}
