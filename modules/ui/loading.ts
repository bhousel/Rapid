import { select } from 'd3-selection';
import { uiModal } from './modal.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/** A configurable, reusable loading modal control (callable + fluent). */
export interface UiLoadingControl {
  /** Shows the loading modal by appending it to the given selection */
  ($selection: D3Selection): UiLoadingControl;
  /** Gets the message shown in the loading modal */
  message(): string;
  /** Sets the message shown in the loading modal */
  message(val: string): UiLoadingControl;
  /** Gets whether the modal blocks interaction */
  blocking(): boolean;
  /** Sets whether the modal blocks interaction */
  blocking(val: boolean): UiLoadingControl;
  /** Removes the loading modal */
  close(): void;
  /** Returns `true` if the loading modal is currently shown */
  isShown(): boolean;
}


/**
 * Creates a reusable loading-modal control. Configure it with `.message()` / `.blocking()`,
 * show it by calling it with a parent selection (e.g. `selection.call(loading)`), and hide it
 * again with `.close()`.
 *
 * @param context - Global shared application context
 * @return the loading control
 */
export function uiLoading(context: Context): UiLoadingControl {
  const assets = context.systems.assets!;

  let $modalSelection: D3Selection = select(null);
  let _message = '';
  let _blocking = false;


  const loading = (($selection: D3Selection): UiLoadingControl => {
    $modalSelection = uiModal($selection, _blocking);

    const $loadertext = $modalSelection.select('.content')
      .classed('loading-modal', true)
      .append('div')
      .attr('class', 'modal-section fillL');

    $loadertext
      .append('img')
      .attr('class', 'loader')
      .attr('src', assets.getFileURL('img/loader-white.gif'));

    $loadertext
      .append('h3')
      .text(_message);

    $modalSelection.select('button.close')
      .attr('class', 'hide');

    return loading;
  }) as UiLoadingControl;


  loading.message = function(val?: string): string | UiLoadingControl {
    if (!arguments.length) return _message;
    _message = val as string;
    return loading;
  } as UiLoadingControl['message'];


  loading.blocking = function(val?: boolean): boolean | UiLoadingControl {
    if (!arguments.length) return _blocking;
    _blocking = val as boolean;
    return loading;
  } as UiLoadingControl['blocking'];


  loading.close = () => {
    $modalSelection.remove();
  };


  loading.isShown = () => {
    return !!$modalSelection && !$modalSelection.empty() && !!$modalSelection.node()?.parentNode;
  };


  return loading;
}
