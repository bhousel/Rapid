import { select as d3_select } from 'd3-selection';

import { uiPopover } from './popover.js';
import { utilCmd, utilFunctor, utilSanitizeHTML } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { UiPopover } from './popover.js';


/** A functor: either a value, or a function that optionally accepts the bound datum. */
type Functor<T> = (datum?: any) => T;


/** A tooltip control: a popover with title, heading, and shortcut text. */
export interface UiTooltip extends UiPopover {
  title(): Functor<string | null>;
  title(val: string | null | Functor<string | null>): UiTooltip;
  heading(): Functor<string | null>;
  heading(val: string | null | Functor<string | null>): UiTooltip;
  shortcut(): Functor<string | null>;
  shortcut(val: string | null | Functor<string | null>): UiTooltip;
}


/**
 * Creates a hover tooltip control that can be attached to element(s).
 * Configure with `.title()`, `.heading()`, and `.shortcut()`, then attach via
 * `selection.call(tooltip)`.
 *
 * @param context - Global shared application context
 * @return the tooltip control
 */
export function uiTooltip(context: Context): UiTooltip {
  const l10n = context.systems.l10n!;
  const tooltip = uiPopover(context, 'tooltip').displayType('hover') as UiTooltip;

  let _title: Functor<string | null> = utilFunctor(null);
  let _heading: Functor<string | null> = utilFunctor(null);
  let _shortcut: Functor<string | null> = utilFunctor(null);


  tooltip.title = function(val?: string | null | Functor<string | null>): any {
    if (!arguments.length) return _title;
    _title = utilFunctor(val as string | null | Functor<string | null>);
    return tooltip;
  };

  tooltip.heading = function(val?: string | null | Functor<string | null>): any {
    if (!arguments.length) return _heading;
    _heading = utilFunctor(val as string | null | Functor<string | null>);
    return tooltip;
  };

  tooltip.shortcut = function(val?: string | null | Functor<string | null>): any {
    if (!arguments.length) return _shortcut;
    _shortcut = utilFunctor(val as string | null | Functor<string | null>);
    return tooltip;
  };


  tooltip.content(function(this: any) {
    const datum = d3_select(this).datum();
    const heading = _heading(datum);
    const text = _title(datum);
    const shortcut = _shortcut(datum);

    return function($selection: D3Selection): void {
      const $headingWrap: D3Selection = $selection
        .selectAll('.tooltip-heading')
        .data(heading ? [heading] : []);

      $headingWrap.exit()
        .remove();

      $headingWrap.enter()
        .append('div')
        .attr('class', 'tooltip-heading')
        .merge($headingWrap)
        .text(d => d);

      const $textWrap: D3Selection = $selection
        .selectAll('.tooltip-text')
        .data(text ? [text] : []);

      $textWrap.exit()
        .remove();

      $textWrap.enter()
        .append('div')
        .attr('class', 'tooltip-text')
        .merge($textWrap)
        .html(d => utilSanitizeHTML(d));    // watch out: a few tooltips still send html through here

      const $shortcutWrap: D3Selection = $selection
        .selectAll('.tooltip-keyhint')
        .data(shortcut ? [shortcut] : []);

      $shortcutWrap.exit()
        .remove();

      const $$shortcutWrap = $shortcutWrap.enter()
        .append('div')
        .attr('class', 'tooltip-keyhint')
        .text(d => d.length === 1 ? l10n.t('tooltip_keyhint') : null);  // "Key:"

      const $$shortcutKeys = $$shortcutWrap
        .append('span')
        .attr('class', 'tooltip-keys');

      // Split the shortcut string into an array and display a `kbd` for each one
      // Warning: this will fail if the key is multiple character like 'F11'
      // (we aren't displaying this in a tooltip currently)
      $$shortcutKeys.selectAll('kbd.shortcut')
        .data(d => (typeof d === 'string') ? d.split('') : [])
        .enter()
        .each((d, i, nodes) => {
          const $selection = d3_select(nodes[i]);

          $selection
            .append('kbd')
            .attr('class', 'shortcut')
            .text(d => utilCmd.display(context, d));

          if (i < shortcut!.length - 1) {
            $selection
              .append('span')
              .text('+');
          }
        });
    };
  });

  return tooltip;
}
