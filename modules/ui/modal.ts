import { select } from 'd3-selection';
import { uiIcon } from './icon.ts';
import { utilKeybinding } from '../util/keybinding.ts';

import type { D3Selection } from 'd3-selection';


/** A modal's shaded-backdrop selection, augmented with a `close()` method. */
export type UiModalSelection = D3Selection & { close(): void };


/**
 * Builds a modal dialog (a shaded backdrop containing a `.modal` box) and appends
 * it to the given selection. Returns the shaded-backdrop selection, augmented with
 * a `close()` method that animates the modal away and unbinds its keybindings.
 *
 * @param $selection - the parent selection to append the modal into
 * @param blocking  - if `true`, the modal cannot be dismissed by clicking away or pressing Esc
 * @return the shaded-backdrop selection with an added `close()` method
 */
export function uiModal(this: unknown, $selection: D3Selection, blocking?: boolean): UiModalSelection {
  const keybinding = utilKeybinding('modal');
  const $previous = $selection.select('div.modal');
  const animate = $previous.empty();

  $previous.transition()
    .duration(200)
    .style('opacity', 0)
    .remove();

  const $shaded = $selection
    .append('div')
    .attr('class', 'shaded')
    .style('opacity', 0) as UiModalSelection;

  $shaded.close = () => {
    $shaded
      .transition()
      .duration(200)
      .style('opacity', 0)
      .remove();

    $modal
      .transition()
      .duration(200)
      .style('top', '0px');

    select(document)
      .call(keybinding.unbind);
  };


  const $modal = $shaded
    .append('div')
    .attr('class', 'modal fillL');

  $modal
    .append('input')
    .attr('class', 'keytrap keytrap-first')
    .on('focus.keytrap', moveFocusToLast);

  if (!blocking) {
    $shaded.on('click.remove-modal', (d3_event: MouseEvent) => {
      if (d3_event.target === this) {
        $shaded.close();
      }
    });

    $modal
      .append('button')
      .attr('class', 'close')
      .on('click', $shaded.close)
      .call(uiIcon('#rapid-icon-close'));

    keybinding
      .on('⌫', $shaded.close)
      .on('⎋', $shaded.close);

    select(document)
      .call(keybinding);
  }

  $modal
    .append('div')
    .attr('class', 'content');

  $modal
    .append('input')
    .attr('class', 'keytrap keytrap-last')
    .on('focus.keytrap', moveFocusToFirst);

  if (animate) {
    $shaded.transition().style('opacity', 1);
  } else {
    $shaded.style('opacity', 1);
  }

  return $shaded;


  function moveFocusToFirst(this: Element): void {
    const node = $modal
      // there are additional rules about what's focusable, but this suits our purposes
      .select('a, button, input:not(.keytrap), select, textarea')
      .node() as HTMLElement | null;

    if (node) {
      node.focus();
    } else {
      (select(this).node() as HTMLElement).blur();
    }
  }

  function moveFocusToLast(this: Element): void {
    const nodes = $modal
      .selectAll('a, button, input:not(.keytrap), select, textarea')
      .nodes() as HTMLElement[];

    if (nodes.length) {
      nodes[nodes.length - 1].focus();
    } else {
      (select(this).node() as HTMLElement).blur();
    }
  }
}
