import { uiModal } from './modal.js';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { UiModalSelection } from './modal.js';


/** A confirm dialog's selection, augmented with an `okButton()` method. */
export type UiConfirmSelection = UiModalSelection & { okButton(): UiConfirmSelection };


/**
 * Builds a simple alert-style modal (header, message, buttons) on top of `uiModal`.
 * The returned selection is augmented with an `okButton()` method that appends a
 * focused "Okay" button which dismisses the dialog.
 *
 * @param context   - Global shared application context
 * @param $selection - the parent selection to append the dialog into
 * @return the modal selection with an added `okButton()` method
 */
export function uiConfirm(context: Context, $selection: D3Selection): UiConfirmSelection {
  const l10n = context.systems.l10n;
  const modalSelection = uiModal($selection) as UiConfirmSelection;

  modalSelection.select('.modal')
    .classed('modal-alert', true);

  const $section = modalSelection.select('.content');

  $section.append('div')
    .attr('class', 'modal-section header');

  $section.append('div')
    .attr('class', 'modal-section message-text');

  const $buttons = $section.append('div')
    .attr('class', 'modal-section buttons');


  modalSelection.okButton = function() {
    $buttons
      .append('button')
      .attr('class', 'button ok-button action')
      .on('click.confirm', () => modalSelection.remove())
      .text(l10n?.t('confirm.okay') ?? 'Okay')
      .node()
      ?.focus();

    return modalSelection;
  };


  return modalSelection;
}
