import { UiModal } from './UiModal.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiRestore` component is a modal component that offers the user
 * choices to restore or clear their saved edits from a previous session.
 */
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
   * Renders the content inside the Modal component.
   */
  public render(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    if (!editor.canRestoreBackup) return;

    const Modal = new UiModal(context, true).show();

    Modal.$modal!
      .attr('class', 'modal fillL');

    const $introModal: D3Selection = Modal.$content!;

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
        Modal.close();
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
        Modal.close();
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
