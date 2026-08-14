import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * "Cards" are user interface elements that can float on top of the map
 * and provide extra information about the map or the selection.
 *
 * `AbstractUiCard` is the base class from which all UI Cards inherit.
 *
 * Properties available:
 *   `enabled`  `true` if the card is enabled, `false` if not.
 */
export abstract class AbstractUiCard {
  public context: Context;

  protected _isVisible: boolean;

  // D3 selections
  public $parent: D3Selection | null;
  public $wrap: D3Selection | null;


  /**
   * @constructor
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    this._isVisible = false;

    // D3 selections
    this.$parent = null;
    this.$wrap = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.show = this.show.bind(this);
    this.hide = this.hide.bind(this);
    this.toggle = this.toggle.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * Subclasses must implement this.
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public abstract render($parent?: D3Selection | null): void;


  /**
   * @readonly
   */
  public get visible(): boolean {
    return this._isVisible;
  }


  /**
   * Shows the component.
   * @param [e] - the triggering event, if any
   */
  public show(e?: Event): void {
    e?.preventDefault();

    if (this._isVisible) {  // already visible
      this.render();        // just rerender
      return;
    }

    this._isVisible = true;
    this.render();
    if (!this.$wrap) return;   // shouldn't happen?

    this.$wrap
      .interrupt()
      .style('display', null)
      .style('opacity', '0')
      .transition()
      .duration(200)
      .style('opacity', '1');
  }


  /**
   * Hides the component.
   * @param [e] - the triggering event, if any
   */
  public hide(e?: Event): void {
    e?.preventDefault();

    if (!this.$wrap) return;        // called too early?
    if (!this._isVisible) return;   // already invisible

    this._isVisible = false;

    this.$wrap
      .interrupt()
      .transition()
      .duration(200)
      .style('opacity', '0')
      .on('end', () => this.$wrap?.style('display', 'none'));
  }


  /**
   * Toggles the component between shown/hidden.
   * @param [e] - the triggering event, if any
   */
  public toggle(e?: Event): void {
    if (this._isVisible) {
      this.hide(e);
    } else {
      this.show(e);
    }
  }

}
