import { select } from 'd3-selection';
import { EventEmitter } from 'tseep/lib/ee-safe';
import { utilCmd, utilFunctor, utilSanitizeHTML } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/** A functor: either a value, or a function that optionally accepts the bound datum. */
type Functor<T> = (datum?: any) => T;

/** A tooltip content builder: given the current datum/args, returns a render function. */
export type UiTooltipContent = (this: any, ...args: any[]) => ($selection: D3Selection) => void;


let _tooltipID = 0;


/**
 * `UiTooltip` attaches a hover/focus tooltip to one or more anchor elements.
 * Tooltips position themselves relative to their anchor and show on hover or focus
 * (see `displayType`). A parent owns the instance, configures it with the fluent setters
 * (`.title()`, `.heading()`, `.shortcut()`, `.placement()`, …), then attaches it via
 * `selection.call(tooltip.attach)`. The owner can reconfigure and re-render it over time
 * (e.g. to relocalize) by calling `.updateContent()`.
 */
export class UiTooltip extends EventEmitter {
  public context: Context;

  // D3 selections
  public $anchorSelection: D3Selection;

  protected _id: number;
  protected _placement: Functor<string>;
  protected _alignment: Functor<string>;
  protected _scrollContainer: Functor<D3Selection>;
  protected _content: UiTooltipContent | undefined;
  protected _displayType: Functor<string>;
  protected _hasArrow: Functor<boolean>;
  protected _title: Functor<string | null>;
  protected _heading: Functor<string | null>;
  protected _shortcut: Functor<string | null>;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    this._id = _tooltipID++;

    // D3 selections
    this.$anchorSelection = select(null);

    this._placement = utilFunctor('top');       // top, bottom, left, right
    this._alignment = utilFunctor('center');     // leading, center, trailing
    this._scrollContainer = utilFunctor(select(null));
    this._content = undefined;
    this._displayType = utilFunctor('hover');
    this._hasArrow = utilFunctor(true);
    this._title = utilFunctor(null);
    this._heading = utilFunctor(null);
    this._shortcut = utilFunctor(null);

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.attach = this.attach.bind(this);
    this.show = this.show.bind(this);
    this.hide = this.hide.bind(this);
    this.toggle = this.toggle.bind(this);
    this.updateContent = this.updateContent.bind(this);
    this.destroy = this.destroy.bind(this);
    this.destroyAny = this.destroyAny.bind(this);
  }


  /**
   * Builds the default tooltip content (heading / text / keyhint) from the configured functors.
   * @param datum - the anchor element's bound datum, passed to the title/heading/shortcut functors
   * @return a render function that draws the content into the popover inner selection
   */
  protected _defaultContent(datum: any): ($selection: D3Selection) => void {
    const l10n = this.context.systems.l10n!;
    const heading = this._heading(datum);
    const text = this._title(datum);
    const shortcut = this._shortcut(datum);

    return ($selection: D3Selection): void => {
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
          const $key = select(nodes[i]);

          $key
            .append('kbd')
            .attr('class', 'shortcut')
            .text(d => utilCmd.display(this.context, d));

          if (i < shortcut!.length - 1) {
            $key
              .append('span')
              .text('+');
          }
        });
    };
  }


  /**
   * Gets or sets how the tooltip is triggered (`hover` or `clickFocus`).
   * @param val - the new value, or omit to get the current value
   * @return the current functor (getter) or `this` (setter)
   */
  public displayType(): Functor<string>;
  public displayType(val: string | Functor<string>): this;
  public displayType(val?: string | Functor<string>): Functor<string> | this {
    if (val === undefined) return this._displayType;
    this._displayType = utilFunctor(val);
    return this;
  }


  /**
   * Gets or sets whether the tooltip has an arrow pointing at its anchor.
   * @param val - the new value, or omit to get the current value
   * @return the current functor (getter) or `this` (setter)
   */
  public hasArrow(): Functor<boolean>;
  public hasArrow(val: boolean | Functor<boolean>): this;
  public hasArrow(val?: boolean | Functor<boolean>): Functor<boolean> | this {
    if (val === undefined) return this._hasArrow;
    this._hasArrow = utilFunctor(val);
    return this;
  }


  /**
   * Gets or sets the tooltip placement (`top`, `bottom`, `left`, `right`).
   * @param val - the new value, or omit to get the current value
   * @return the current functor (getter) or `this` (setter)
   */
  public placement(): Functor<string>;
  public placement(val: string | Functor<string>): this;
  public placement(val?: string | Functor<string>): Functor<string> | this {
    if (val === undefined) return this._placement;
    this._placement = utilFunctor(val);
    return this;
  }


  /**
   * Gets or sets the tooltip alignment along the anchor (`leading`, `center`, `trailing`).
   * @param val - the new value, or omit to get the current value
   * @return the current functor (getter) or `this` (setter)
   */
  public alignment(): Functor<string>;
  public alignment(val: string | Functor<string>): this;
  public alignment(val?: string | Functor<string>): Functor<string> | this {
    if (val === undefined) return this._alignment;
    this._alignment = utilFunctor(val);
    return this;
  }


  /**
   * Gets or sets the scroll container used to keep the tooltip within view.
   * @param val - the new value, or omit to get the current value
   * @return the current functor (getter) or `this` (setter)
   */
  public scrollContainer(): Functor<D3Selection>;
  public scrollContainer(val: D3Selection | Functor<D3Selection>): this;
  public scrollContainer(val?: D3Selection | Functor<D3Selection>): Functor<D3Selection> | this {
    if (val === undefined) return this._scrollContainer;
    this._scrollContainer = utilFunctor(val);
    return this;
  }


  /**
   * Gets or sets the content builder that renders the tooltip's inner content.
   * @param val - the new content builder, or omit to get the current one
   * @return the current content builder (getter) or `this` (setter)
   */
  public content(): UiTooltipContent | undefined;
  public content(val: UiTooltipContent): this;
  public content(val?: UiTooltipContent): UiTooltipContent | undefined | this {
    if (val === undefined) return this._content;
    this._content = val;
    return this;
  }


  /**
   * Gets or sets the tooltip's title text.
   * @param val - the new title, or omit to get the current functor
   * @return the current functor (getter) or `this` (setter)
   */
  public title(): Functor<string | null>;
  public title(val: string | null | Functor<string | null>): this;
  public title(val?: string | null | Functor<string | null>): Functor<string | null> | this {
    if (val === undefined) return this._title;
    this._title = utilFunctor(val);
    return this;
  }


  /**
   * Gets or sets the tooltip's heading text (shown above the title).
   * @param val - the new heading, or omit to get the current functor
   * @return the current functor (getter) or `this` (setter)
   */
  public heading(): Functor<string | null>;
  public heading(val: string | null | Functor<string | null>): this;
  public heading(val?: string | null | Functor<string | null>): Functor<string | null> | this {
    if (val === undefined) return this._heading;
    this._heading = utilFunctor(val);
    return this;
  }


  /**
   * Gets or sets the tooltip's keyboard-shortcut hint.
   * @param val - the new shortcut, or omit to get the current functor
   * @return the current functor (getter) or `this` (setter)
   */
  public shortcut(): Functor<string | null>;
  public shortcut(val: string | null | Functor<string | null>): this;
  public shortcut(val?: string | null | Functor<string | null>): Functor<string | null> | this {
    if (val === undefined) return this._shortcut;
    this._shortcut = utilFunctor(val);
    return this;
  }


  /**
   * Attaches the tooltip behavior to the given anchor selection (one or more elements).
   * @param $selection - the anchor selection to attach the tooltip to
   */
  public attach($selection: D3Selection): void {
    this.$anchorSelection = $selection;
    $selection.each((d, i, nodes) => this._setup(nodes[i]));
  }


  /**
   * @return `true` if the tooltip is currently shown
   */
  public isShown(): boolean {
    const $tooltip = this.$anchorSelection.select(`.popover-${this._id}`);
    return !$tooltip.empty() && $tooltip.classed('in');
  }


  /**
   * Shows the tooltip on all its anchors.
   */
  public show(): void {
    this.$anchorSelection.each((d, i, nodes) => this._show(nodes[i]));
  }


  /**
   * Re-renders the tooltip content and position on all its anchors (e.g. after relocalization).
   */
  public updateContent(): void {
    this.$anchorSelection.each((d, i, nodes) => this._updateContent(nodes[i]));
  }


  /**
   * Hides the tooltip on all its anchors.
   */
  public hide(): void {
    this.$anchorSelection.each((d, i, nodes) => this._hide(nodes[i]));
  }


  /**
   * Toggles the tooltip's shown state on all its anchors.
   */
  public toggle(): void {
    this.$anchorSelection.each((d, i, nodes) => this._toggle(nodes[i]));
  }


  /**
   * Removes the tooltip element(s) from a selection and unbinds its event handlers.
   * @param $selection - the anchor selection to clean up
   * @param selector   - the tooltip selector to remove (defaults to this tooltip's popover)
   */
  public destroy($selection: D3Selection, selector?: string): void {
    // by default, just destroy the current tooltip
    selector = selector || `.popover-${this._id}`;

    $selection
      .on('pointerenter.popover', null)
      .on('pointerleave.popover', null)
      .on('pointerup.popover', null)
      .on('pointerdown.popover', null)
      .on('click.popover', null)
      .selectAll(selector)
      .remove();
  }


  /**
   * Removes any popover element from a selection (not just this tooltip's).
   * @param $selection - the anchor selection to clean up
   */
  public destroyAny($selection: D3Selection): void {
    $selection.call(this.destroy, '.popover');
  }


  /**
   * Builds the tooltip DOM for a single anchor element and wires its trigger handlers.
   * @param node - the anchor element
   */
  protected _setup(node: any): void {
    const $anchor = select(node);
    let $tooltip: D3Selection = $anchor.selectAll(`.popover-${this._id}`)
      .data([0]);

    const $$tooltip: D3Selection = $tooltip.enter()
      .append('div')
      .attr('class', `popover popover-${this._id} tooltip`)
      .classed('arrowed', this._hasArrow());

    $$tooltip
      .append('div')
      .attr('class', 'popover-arrow');

    $$tooltip
      .append('div')
      .attr('class', 'popover-inner');

    $tooltip = $$tooltip
      .merge($tooltip);

    const display = this._displayType();

    if (display === 'hover') {
      let _lastNonMouseEnterTime: number | undefined;
      $anchor.on('pointerenter.popover', (d3_event: PointerEvent) => {

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

        this._show(d3_event.currentTarget as Element);
      })
      .on('pointerleave.popover', (d3_event: PointerEvent) => {
        this._hide(d3_event.currentTarget as Element);
      })
      // show on focus too for better keyboard navigation support
      .on('focus.popover', (d3_event: FocusEvent) => {
        this._show(d3_event.currentTarget as Element);
      })
      .on('blur.popover', (d3_event: FocusEvent) => {
        this._hide(d3_event.currentTarget as Element);
      });

    } else if (display === 'clickFocus') {
      $anchor
        .on('pointerdown.popover', (d3_event: PointerEvent) => {
          d3_event.preventDefault();
          d3_event.stopPropagation();
        })
        .on('pointerup.popover', (d3_event: PointerEvent) => {
          d3_event.preventDefault();
          d3_event.stopPropagation();
        })
        .on('click.popover', (d3_event: MouseEvent) => {
          this._toggle(d3_event.currentTarget as Element);
        });

      $tooltip
        // This attribute lets the tooltip take focus
        .attr('tabindex', 0)
        .on('blur.popover', () => {
          this._hide(node);
        });
    }
  }


  /**
   * Shows the tooltip for a single anchor element.
   * @param node - the anchor element
   */
  protected _show(node: any): void {
    const $anchor = select(node);
    let $tooltip = $anchor.selectAll(`.popover-${this._id}`);

    if ($tooltip.empty()) {
      // tooltip was removed somehow, put it back
      $anchor.call(this.destroy);
      this._setup(node);
      $tooltip = $anchor.selectAll(`.popover-${this._id}`);
    }

    $tooltip.classed('in', true);

    const displayType = this._displayType();
    if (displayType === 'clickFocus') {
      $anchor.classed('active', true);
      const tipNode = $tooltip.node() as HTMLElement | null;
      tipNode?.focus();
    }

    this._updateContent(node);
  }


  /**
   * Re-renders the tooltip content and repositions it for a single anchor element.
   * @param node - the anchor element
   */
  protected _updateContent(node: any): void {
    const $anchor = select(node);

    const $inner = $anchor.selectAll(`.popover-${this._id} > .popover-inner`);
    if (this._content) {
      $inner.call(this._content.call(node));   // custom content uses the element-`this` contract
    } else {
      $inner.call(this._defaultContent($anchor.datum()));
    }

    this._updatePosition(node);
    // hack: update multiple times to fix instances where the absolute offset is
    // set before the dynamic tooltip size is calculated by the browser
    this._updatePosition(node);
    this._updatePosition(node);
  }


  /**
   * Positions the tooltip relative to its anchor, honoring placement, alignment, and scroll.
   * @param node - the anchor element
   */
  protected _updatePosition(node: any): void {
    const $anchor = select(node);
    const $tooltip = $anchor.selectAll(`.popover-${this._id}`);

    const $scrollContainer = this._scrollContainer && this._scrollContainer();
    const scrollNode = $scrollContainer && !$scrollContainer.empty() && $scrollContainer.node();
    const scrollLeft = scrollNode ? scrollNode.scrollLeft : 0;
    const scrollTop = scrollNode ? scrollNode.scrollTop : 0;

    const placement = this._placement();
    $tooltip
      .classed('left', false)
      .classed('right', false)
      .classed('top', false)
      .classed('bottom', false)
      .classed(placement, true);

    const alignment = this._alignment();
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

        const $arrow = $anchor.selectAll(`.popover-${this._id} > .popover-arrow`);
        // keep the arrow centered on the button, or as close as possible
        const arrowPosX = Math.min(Math.max(tooltipFrame.w / 2 - (position.x - initialPosX), 10), tooltipFrame.w - 10);
        $arrow.style('left', ~~arrowPosX + 'px');
      }

      $tooltip.style('left', ~~position.x + 'px').style('top', ~~position.y + 'px');
    } else {
      $tooltip.style('left', null).style('top', null);
    }

    function getFrame(n: any): { x: number; y: number; w: number; h: number } {
      const positionStyle = select(n).style('position');
      if (positionStyle === 'absolute' || positionStyle === 'static') {
        return {
          x: n.offsetLeft - scrollLeft,
          y: n.offsetTop - scrollTop,
          w: n.offsetWidth,
          h: n.offsetHeight
        };
      } else {
        return {
          x: 0,
          y: 0,
          w: n.offsetWidth,
          h: n.offsetHeight
        };
      }
    }
  }


  /**
   * Hides the tooltip for a single anchor element.
   * @param node - the anchor element
   */
  protected _hide(node: any): void {
    const $anchor = select(node);
    if (this._displayType() === 'clickFocus') {
      $anchor.classed('active', false);
    }
    $anchor.selectAll(`.popover-${this._id}`).classed('in', false);
  }


  /**
   * Toggles the tooltip's shown state for a single anchor element.
   * @param node - the anchor element
   */
  protected _toggle(node: any): void {
    if (select(node).select(`.popover-${this._id}`).classed('in')) {
      this._hide(node);
    } else {
      this._show(node);
    }
  }
}
