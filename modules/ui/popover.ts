import { select as d3_select } from 'd3-selection';

import { utilFunctor } from '../util/util.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/** A functor: either a value, or a function returning that value. */
type Functor<T> = () => T;

/** A popover content builder: given the current datum/args, returns a render function. */
export type UiPopoverContent = (this: any, ...args: any[]) => ($selection: D3Selection) => void;


/** A popover control (callable + fluent), attached to anchor element(s). */
export interface UiPopover {
  /** Attaches the popover to the given anchor selection */
  ($selection: D3Selection): void;

  displayType(): Functor<string>;
  displayType(val: string | Functor<string>): UiPopover;
  hasArrow(): Functor<boolean>;
  hasArrow(val: boolean | Functor<boolean>): UiPopover;
  placement(): Functor<string>;
  placement(val: string | Functor<string>): UiPopover;
  alignment(): Functor<string>;
  alignment(val: string | Functor<string>): UiPopover;
  scrollContainer(): Functor<D3Selection>;
  scrollContainer(val: D3Selection | Functor<D3Selection>): UiPopover;
  content(): UiPopoverContent | undefined;
  content(val: UiPopoverContent): UiPopover;

  isShown(): boolean;
  show(): void;
  updateContent(): void;
  hide(): void;
  toggle(): void;
  destroy($selection: D3Selection, selector?: string): void;
  destroyAny($selection: D3Selection): void;
}


let _popoverID = 0;


/**
 * Creates a popover control that can be attached to one or more anchor elements.
 * Popovers position themselves relative to their anchor and can be shown on hover
 * or click/focus (see `displayType`). This is the base used by tooltips and comboboxes.
 *
 * @param context - Global shared application context
 * @param klass   - optional extra class name added to the popover element
 * @return the popover control
 */
export function uiPopover(context: Context, klass?: string): UiPopover {
  const _id = _popoverID++;
  let $anchorSelection: D3Selection = d3_select(null);
  const popover = function($selection: D3Selection): void {
    $anchorSelection = $selection;
    $selection.each(setup);
  } as UiPopover;
  const _animation: Functor<boolean> = utilFunctor(false);
  let _placement: Functor<string> = utilFunctor('top'); // top, bottom, left, right
  let _alignment: Functor<string> = utilFunctor('center');  // leading, center, trailing
  let _scrollContainer: Functor<D3Selection> = utilFunctor(d3_select(null));
  let _content: UiPopoverContent | undefined;
  let _displayType: Functor<string> = utilFunctor('');
  let _hasArrow: Functor<boolean> = utilFunctor(true);


  popover.displayType = function(val?: string | Functor<string>): any {
    if (arguments.length) {
      _displayType = utilFunctor(val as string | Functor<string>);
      return popover;
    } else {
      return _displayType;
    }
  };

  popover.hasArrow = function(val?: boolean | Functor<boolean>): any {
    if (arguments.length) {
      _hasArrow = utilFunctor(val as boolean | Functor<boolean>);
      return popover;
    } else {
      return _hasArrow;
    }
  };

  popover.placement = function(val?: string | Functor<string>): any {
    if (arguments.length) {
      _placement = utilFunctor(val as string | Functor<string>);
      return popover;
    } else {
      return _placement;
    }
  };

  popover.alignment = function(val?: string | Functor<string>): any {
    if (arguments.length) {
      _alignment = utilFunctor(val as string | Functor<string>);
      return popover;
    } else {
      return _alignment;
    }
  };

  popover.scrollContainer = function(val?: D3Selection | Functor<D3Selection>): any {
    if (arguments.length) {
      _scrollContainer = utilFunctor(val as D3Selection | Functor<D3Selection>);
      return popover;
    } else {
      return _scrollContainer;
    }
  };

  popover.content = function(val?: UiPopoverContent): any {
    if (arguments.length) {
      _content = val;
      return popover;
    } else {
      return _content;
    }
  };

  popover.isShown = function(): boolean {
    const popoverSelection = $anchorSelection.select('.popover-' + _id);
    return !popoverSelection.empty() && popoverSelection.classed('in');
  };

  popover.show = function(): void {
    $anchorSelection.each(show);
  };

  popover.updateContent = function(): void {
    $anchorSelection.each(updateContent);
  };

  popover.hide = function(): void {
    $anchorSelection.each(hide);
  };

  popover.toggle = function(): void {
    $anchorSelection.each(toggle);
  };

  popover.destroy = function($selection: D3Selection, selector?: string): void {
    // by default, just destroy the current popover
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


  popover.destroyAny = function($selection: D3Selection): void {
    $selection.call(popover.destroy, '.popover');
  };

  function setup(this: any): void {
    const $anchor = d3_select(this);
    const animate = _animation();
    let $popoverSelection: D3Selection = $anchor.selectAll('.popover-' + _id)
      .data([0]);


    const $$enter: D3Selection = $popoverSelection.enter()
      .append('div')
      .attr('class', 'popover popover-' + _id + ' ' + (klass ? klass : ''))
      .classed('arrowed', _hasArrow());

    $$enter
      .append('div')
      .attr('class', 'popover-arrow');

    $$enter
      .append('div')
      .attr('class', 'popover-inner');

    $popoverSelection = $$enter
      .merge($popoverSelection);

    if (animate) {
      $popoverSelection.classed('fade', true);
    }

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

      $popoverSelection
        // This attribute lets the popover take focus
        .attr('tabindex', 0)
        .on('blur.popover', function(this: any) {
          $anchor.each(function(this: any) {
            hide.call(this);
          });
        });
    }
  }


  function show(this: any): void {
    const $anchor = d3_select(this);
    let $popoverSelection = $anchor.selectAll('.popover-' + _id);

    if ($popoverSelection.empty()) {
      // popover was removed somehow, put it back
      $anchor.call(popover.destroy);
      $anchor.each(setup);
      $popoverSelection = $anchor.selectAll('.popover-' + _id);
    }

    $popoverSelection.classed('in', true);

    const displayType = _displayType();
    if (displayType === 'clickFocus') {
      $anchor.classed('active', true);
      ($popoverSelection.node() as HTMLElement).focus();
    }

    $anchor.each(updateContent);
  }

  function updateContent(this: any): void {
    const $anchor = d3_select(this);

    if (_content) {
      $anchor.selectAll('.popover-' + _id + ' > .popover-inner')
        .call(_content.call(this));
    }

    updatePosition.call(this);
    // hack: update multiple times to fix instances where the absolute offset is
    // set before the dynamic popover size is calculated by the browser
    updatePosition.call(this);
    updatePosition.call(this);
  }


  function updatePosition(this: any): void {
    const $anchor = d3_select(this);
    const $popoverSelection = $anchor.selectAll('.popover-' + _id);

    const $scrollContainer = _scrollContainer && _scrollContainer();
    const scrollNode = $scrollContainer && !$scrollContainer.empty() && $scrollContainer.node();
    const scrollLeft = scrollNode ? scrollNode.scrollLeft : 0;
    const scrollTop = scrollNode ? scrollNode.scrollTop : 0;

    const placement = _placement();
    $popoverSelection
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
    const popoverFrame = getFrame($popoverSelection.node());
    let position: { x: number; y: number } | undefined;

    switch (placement) {
      case 'top':
      position = {
        x: anchorFrame.x + (anchorFrame.w - popoverFrame.w) * alignFactor,
        y: anchorFrame.y - popoverFrame.h
      };
      break;
      case 'bottom':
      position = {
        x: anchorFrame.x + (anchorFrame.w - popoverFrame.w) * alignFactor,
        y: anchorFrame.y + anchorFrame.h
      };
      break;
      case 'left':
      position = {
        x: anchorFrame.x - popoverFrame.w,
        y: anchorFrame.y + (anchorFrame.h - popoverFrame.h) * alignFactor
      };
      break;
      case 'right':
      position = {
        x: anchorFrame.x + anchorFrame.w,
        y: anchorFrame.y + (anchorFrame.h - popoverFrame.h) * alignFactor
      };
      break;
    }

    if (position) {

      if (scrollNode && (placement === 'top' || placement === 'bottom')) {

        const initialPosX = position.x;

        if (position.x + popoverFrame.w > scrollNode.offsetWidth - 10) {
          position.x = scrollNode.offsetWidth - 10 - popoverFrame.w;
        } else if (position.x < 10) {
          position.x = 10;
        }

        const $arrow = $anchor.selectAll('.popover-' + _id + ' > .popover-arrow');
        // keep the arrow centered on the button, or as close as possible
        const arrowPosX = Math.min(Math.max(popoverFrame.w / 2 - (position.x - initialPosX), 10), popoverFrame.w - 10);
        $arrow.style('left', ~~arrowPosX + 'px');
      }

      $popoverSelection.style('left', ~~position.x + 'px').style('top', ~~position.y + 'px');
    } else {
      $popoverSelection.style('left', null).style('top', null);
    }

    function getFrame(node: any): { x: number; y: number; w: number; h: number } {
      const positionStyle = d3_select(node).style('position');
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
    const $anchor = d3_select(this);
    if (_displayType() === 'clickFocus') {
      $anchor.classed('active', false);
    }
    $anchor.selectAll('.popover-' + _id).classed('in', false);
  }


  function toggle(this: any): void {
    if (d3_select(this).select('.popover-' + _id).classed('in')) {
      hide.call(this);
    } else {
      show.call(this);
    }
  }


  return popover;
}
