import { select } from 'd3-selection';
import { utilCmd, utilFunctor, utilSanitizeHTML } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/** A functor: either a value, or a function that optionally accepts the bound datum. */
type Functor<T> = (datum?: any) => T;

/** A tooltip content builder: given the current datum/args, returns a render function. */
export type UiTooltipContent = (this: any, ...args: any[]) => ($selection: D3Selection) => void;


/**
 * A tooltip control (callable + fluent), attached to anchor element(s).
 * Tooltips position themselves relative to their anchor and show on hover or focus.
 * Configure with `.title()`, `.heading()`, and `.shortcut()`, then attach via
 * `selection.call(tooltip)`.
 */
export interface UiTooltip {
  /** Attaches the tooltip to the given anchor selection */
  ($selection: D3Selection): void;

  displayType(): Functor<string>;
  displayType(val: string | Functor<string>): UiTooltip;
  hasArrow(): Functor<boolean>;
  hasArrow(val: boolean | Functor<boolean>): UiTooltip;
  placement(): Functor<string>;
  placement(val: string | Functor<string>): UiTooltip;
  alignment(): Functor<string>;
  alignment(val: string | Functor<string>): UiTooltip;
  scrollContainer(): Functor<D3Selection>;
  scrollContainer(val: D3Selection | Functor<D3Selection>): UiTooltip;
  content(): UiTooltipContent | undefined;
  content(val: UiTooltipContent): UiTooltip;

  title(): Functor<string | null>;
  title(val: string | null | Functor<string | null>): UiTooltip;
  heading(): Functor<string | null>;
  heading(val: string | null | Functor<string | null>): UiTooltip;
  shortcut(): Functor<string | null>;
  shortcut(val: string | null | Functor<string | null>): UiTooltip;

  isShown(): boolean;
  show(): void;
  updateContent(): void;
  hide(): void;
  toggle(): void;
  destroy($selection: D3Selection, selector?: string): void;
  destroyAny($selection: D3Selection): void;
}


let _tooltipID = 0;


/**
 * Creates a hover tooltip control that can be attached to one or more anchor elements.
 * Tooltips position themselves relative to their anchor and show on hover or focus
 * (see `displayType`). Configure with `.title()`, `.heading()`, and `.shortcut()`,
 * then attach via `selection.call(tooltip)`.
 *
 * @param context - Global shared application context
 * @return the tooltip control
 */
export function uiTooltip(context: Context): UiTooltip {
  const l10n = context.systems.l10n!;

  const _id = _tooltipID++;
  let $anchorSelection: D3Selection = select(null);
  const tooltip = function($selection: D3Selection): void {
    $anchorSelection = $selection;
    $selection.each(setup);
  } as UiTooltip;

  let _placement: Functor<string> = utilFunctor('top'); // top, bottom, left, right
  let _alignment: Functor<string> = utilFunctor('center');  // leading, center, trailing
  let _scrollContainer: Functor<D3Selection> = utilFunctor(select(null));
  let _content: UiTooltipContent | undefined;
  let _displayType: Functor<string> = utilFunctor('hover');
  let _hasArrow: Functor<boolean> = utilFunctor(true);

  let _title: Functor<string | null> = utilFunctor(null);
  let _heading: Functor<string | null> = utilFunctor(null);
  let _shortcut: Functor<string | null> = utilFunctor(null);


  tooltip.displayType = function(val?: string | Functor<string>): any {
    if (arguments.length) {
      _displayType = utilFunctor(val as string | Functor<string>);
      return tooltip;
    } else {
      return _displayType;
    }
  };

  tooltip.hasArrow = function(val?: boolean | Functor<boolean>): any {
    if (arguments.length) {
      _hasArrow = utilFunctor(val as boolean | Functor<boolean>);
      return tooltip;
    } else {
      return _hasArrow;
    }
  };

  tooltip.placement = function(val?: string | Functor<string>): any {
    if (arguments.length) {
      _placement = utilFunctor(val as string | Functor<string>);
      return tooltip;
    } else {
      return _placement;
    }
  };

  tooltip.alignment = function(val?: string | Functor<string>): any {
    if (arguments.length) {
      _alignment = utilFunctor(val as string | Functor<string>);
      return tooltip;
    } else {
      return _alignment;
    }
  };

  tooltip.scrollContainer = function(val?: D3Selection | Functor<D3Selection>): any {
    if (arguments.length) {
      _scrollContainer = utilFunctor(val as D3Selection | Functor<D3Selection>);
      return tooltip;
    } else {
      return _scrollContainer;
    }
  };

  tooltip.content = function(val?: UiTooltipContent): any {
    if (arguments.length) {
      _content = val;
      return tooltip;
    } else {
      return _content;
    }
  };

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

  tooltip.isShown = function(): boolean {
    const $tooltip = $anchorSelection.select('.popover-' + _id);
    return !$tooltip.empty() && $tooltip.classed('in');
  };

  tooltip.show = function(): void {
    $anchorSelection.each(show);
  };

  tooltip.updateContent = function(): void {
    $anchorSelection.each(updateContent);
  };

  tooltip.hide = function(): void {
    $anchorSelection.each(hide);
  };

  tooltip.toggle = function(): void {
    $anchorSelection.each(toggle);
  };

  tooltip.destroy = function($selection: D3Selection, selector?: string): void {
    // by default, just destroy the current tooltip
    selector = selector || '.popover-' + _id;

    $selection
      .on('pointerenter.popover', null)
      .on('pointerleave.popover', null)
      .on('pointerup.popover', null)
      .on('pointerdown.popover', null)
      .on('click.popover', null)
      .selectAll(selector)
      .remove();
  };


  tooltip.destroyAny = function($selection: D3Selection): void {
    $selection.call(tooltip.destroy, '.popover');
  };

  function setup(this: any): void {
    const $anchor = select(this);
    let $tooltip: D3Selection = $anchor.selectAll('.popover-' + _id)
      .data([0]);


    const $$tooltip: D3Selection = $tooltip.enter()
      .append('div')
      .attr('class', 'popover popover-' + _id + ' tooltip')
      .classed('arrowed', _hasArrow());

    $$tooltip
      .append('div')
      .attr('class', 'popover-arrow');

    $$tooltip
      .append('div')
      .attr('class', 'popover-inner');

    $tooltip = $$tooltip
      .merge($tooltip);

    const display = _displayType();

    if (display === 'hover') {
      let _lastNonMouseEnterTime: number | undefined;
      $anchor.on('pointerenter.popover', function(this: any, d3_event: PointerEvent) {

        if (d3_event.pointerType) {
          if (d3_event.pointerType !== 'mouse') {
            _lastNonMouseEnterTime = d3_event.timeStamp;
            // only allow hover behavior for mouse input
            return;
          } else if (_lastNonMouseEnterTime &&
            d3_event.timeStamp - _lastNonMouseEnterTime < 1500) {
            // HACK: iOS 13.4 sends an erroneous `mouse` type pointerenter
            // event for non-mouse interactions right after sending
            // the correct type pointerenter event. Workaround by discarding
            // any mouse event that occurs immediately after a non-mouse event.
            return;
          }
        }

        // don't show if buttons are pressed, e.g. during click and drag of map
        if (d3_event.buttons !== 0) return;

        show.call(this);
      })
      .on('pointerleave.popover', function(this: any) {
        hide.call(this);
      })
      // show on focus too for better keyboard navigation support
      .on('focus.popover', function(this: any) {
        show.call(this);
      })
      .on('blur.popover', function(this: any) {
        hide.call(this);
      });

    } else if (display === 'clickFocus') {
      $anchor
        .on('pointerdown.popover', function(d3_event: PointerEvent) {
          d3_event.preventDefault();
          d3_event.stopPropagation();
        })
        .on('pointerup.popover', function(d3_event: PointerEvent) {
          d3_event.preventDefault();
          d3_event.stopPropagation();
        })
        .on('click.popover', toggle);

      $tooltip
        // This attribute lets the tooltip take focus
        .attr('tabindex', 0)
        .on('blur.popover', function(this: any) {
          $anchor.each(function(this: any) {
            hide.call(this);
          });
        });
    }
  }


  function show(this: any): void {
    const $anchor = select(this);
    let $tooltip = $anchor.selectAll('.popover-' + _id);

    if ($tooltip.empty()) {
      // tooltip was removed somehow, put it back
      $anchor.call(tooltip.destroy);
      $anchor.each(setup);
      $tooltip = $anchor.selectAll('.popover-' + _id);
    }

    $tooltip.classed('in', true);

    const displayType = _displayType();
    if (displayType === 'clickFocus') {
      $anchor.classed('active', true);
      ($tooltip.node() as HTMLElement).focus();
    }

    $anchor.each(updateContent);
  }

  function updateContent(this: any): void {
    const $anchor = select(this);

    if (_content) {
      $anchor.selectAll('.popover-' + _id + ' > .popover-inner')
        .call(_content.call(this));
    }

    updatePosition.call(this);
    // hack: update multiple times to fix instances where the absolute offset is
    // set before the dynamic tooltip size is calculated by the browser
    updatePosition.call(this);
    updatePosition.call(this);
  }


  function updatePosition(this: any): void {
    const $anchor = select(this);
    const $tooltip = $anchor.selectAll('.popover-' + _id);

    const $scrollContainer = _scrollContainer && _scrollContainer();
    const scrollNode = $scrollContainer && !$scrollContainer.empty() && $scrollContainer.node();
    const scrollLeft = scrollNode ? scrollNode.scrollLeft : 0;
    const scrollTop = scrollNode ? scrollNode.scrollTop : 0;

    const placement = _placement();
    $tooltip
      .classed('left', false)
      .classed('right', false)
      .classed('top', false)
      .classed('bottom', false)
      .classed(placement, true);

    const alignment = _alignment();
    let alignFactor = 0.5;
    if (alignment === 'leading') {
      alignFactor = 0;
    } else if (alignment === 'trailing') {
      alignFactor = 1;
    }
    const anchorFrame = getFrame($anchor.node());
    const tooltipFrame = getFrame($tooltip.node());
    let position: { x: number; y: number } | undefined;

    switch (placement) {
      case 'top':
      position = {
        x: anchorFrame.x + (anchorFrame.w - tooltipFrame.w) * alignFactor,
        y: anchorFrame.y - tooltipFrame.h
      };
      break;
      case 'bottom':
      position = {
        x: anchorFrame.x + (anchorFrame.w - tooltipFrame.w) * alignFactor,
        y: anchorFrame.y + anchorFrame.h
      };
      break;
      case 'left':
      position = {
        x: anchorFrame.x - tooltipFrame.w,
        y: anchorFrame.y + (anchorFrame.h - tooltipFrame.h) * alignFactor
      };
      break;
      case 'right':
      position = {
        x: anchorFrame.x + anchorFrame.w,
        y: anchorFrame.y + (anchorFrame.h - tooltipFrame.h) * alignFactor
      };
      break;
    }

    if (position) {

      if (scrollNode && (placement === 'top' || placement === 'bottom')) {

        const initialPosX = position.x;

        if (position.x + tooltipFrame.w > scrollNode.offsetWidth - 10) {
          position.x = scrollNode.offsetWidth - 10 - tooltipFrame.w;
        } else if (position.x < 10) {
          position.x = 10;
        }

        const $arrow = $anchor.selectAll('.popover-' + _id + ' > .popover-arrow');
        // keep the arrow centered on the button, or as close as possible
        const arrowPosX = Math.min(Math.max(tooltipFrame.w / 2 - (position.x - initialPosX), 10), tooltipFrame.w - 10);
        $arrow.style('left', ~~arrowPosX + 'px');
      }

      $tooltip.style('left', ~~position.x + 'px').style('top', ~~position.y + 'px');
    } else {
      $tooltip.style('left', null).style('top', null);
    }

    function getFrame(node: any): { x: number; y: number; w: number; h: number } {
      const positionStyle = select(node).style('position');
      if (positionStyle === 'absolute' || positionStyle === 'static') {
        return {
          x: node.offsetLeft - scrollLeft,
          y: node.offsetTop - scrollTop,
          w: node.offsetWidth,
          h: node.offsetHeight
        };
      } else {
        return {
          x: 0,
          y: 0,
          w: node.offsetWidth,
          h: node.offsetHeight
        };
      }
    }
  }


  function hide(this: any): void {
    const $anchor = select(this);
    if (_displayType() === 'clickFocus') {
      $anchor.classed('active', false);
    }
    $anchor.selectAll('.popover-' + _id).classed('in', false);
  }


  function toggle(this: any): void {
    if (select(this).select('.popover-' + _id).classed('in')) {
      hide.call(this);
    } else {
      show.call(this);
    }
  }


  tooltip.content(function(this: any) {
    const datum = select(this).datum();
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
          const $selection = select(nodes[i]);

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
