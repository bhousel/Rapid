import { utilCmd, utilDetect } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * `UiFullscreen` just adds fullscreen key bindings.
 * There is commented out code for a fullscreen button, not currently shown.
 */
export class UiFullscreen {
  public context: Context;

  // D3 selections
  public $parent: D3Selection | null;
  // public $button: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    // D3 selections
    this.$parent = null;
    // this.$button = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.toggle = this.toggle.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent = this.$parent): void {
    if (!this.isSupported()) return;

// parent not actually used here , since we aren't rendering a button
//    if ($parent instanceof selection) {
//      this.$parent = $parent;
//    } else {
//      return;   // no parent - called too early?
//    }

    const context = this.context;

    // There was a button for this a long time ago
    // this.$button = $parent.append('button')
    //   .attr('title', t('full_screen'))
    //   .on('click', fullScreen)
    //   .call(tooltip);
    // this.$button.append('span')
    //   .attr('class', 'icon full-screen');

    const detected = utilDetect();
    const keys = (detected.os === 'mac' ? [utilCmd('⌃⌘F'), 'f11'] : ['f11']);
    context.keybinding().off(keys);
    context.keybinding().on(keys, this.toggle);
  }


  /**
   * Returns `true` if fullscreen mode is supported in this browser.
   * @return  `true` if the container can be made fullscreen, `false` if not
   */
  public isSupported(): boolean {
    const container = this.context.containerNode;
    return (typeof container?.requestFullscreen === 'function');
  }


  /**
   * Returns `true` if we are in fullscreen mode.
   * @return  `true` if the container is currently fullscreen, `false` if not
   */
  public isFullscreen(): boolean {
    const container = this.context.containerNode;
    return document.fullscreenElement === container;
  }


  /**
   * Enters fullscreen mode.
   * @return  Promise settled when the browser has entered fullscreen mode
   */
  public requestFullscreen(): Promise<void> {
    const container = this.context.containerNode!;
    return container.requestFullscreen();
    // $button.classed('active', true);
  }


  /**
   * Exits fullscreen mode.
   * @return  Promise settled when the browser has left fullscreen mode
   */
  public exitFullscreen(): Promise<void> {
    return document.exitFullscreen();
    // $button.classed('active', false);
  }


  /**
   * Toggle fullscreen mode.
   * @param   [e] - the triggering event, if any
   * @return  Promise settled when the browser is finished toggling
   */
  public toggle(e?: Event): Promise<void> {
    e?.preventDefault();
    if (!this.isSupported()) return Promise.resolve();  // do nothing

    if (!this.isFullscreen()) {
      return this.requestFullscreen();
    } else {
      return this.exitFullscreen();
    }
  }

}
