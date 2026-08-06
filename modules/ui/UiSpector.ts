import * as PIXI from 'pixi.js';
import { selection } from 'd3-selection';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * Spector.js is a WebGL debugging tool
 * This is just a wrapper for the Spector.js debugger
 * Is is only available on the development build of Rapid.
 */
export class UiSpector {
  public context: Context;

  protected _isHidden: boolean;
  protected _spyCanvas: any;

  // Child components, we will defer creating these until `_initSpectorUI()`
  public Spector: any;
  public CaptureMenu: any;
  public ResultView: any;

  // D3 selections
  public $parent: D3Selection | null;
  public $wrap: D3Selection | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    this._isHidden = true;   // start out hidden
    this._spyCanvas = null;

    // Child components, we will defer creating these until `_initSpectorUI()`
    this.Spector = null;
    this.CaptureMenu = null;
    this.ResultView = null;

    // D3 selections
    this.$parent = null;
    this.$wrap = null;

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
  public render($parent: D3Selection | null = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    // add .spector wrapper
    const $wrap: D3Selection = $parent.selectAll('.spector')
      .data([0]);

    const $$wrap = $wrap.enter()
      .append('div')
      .attr('class', 'spector');

    this.$wrap = $wrap.merge($$wrap)
      .style('display', this._isHidden ? 'none' : 'block');
  }


  /**
   * Toggles the Spector UI on/off
   * @param  e? - triggering event (if any)
   */
  public toggle(e?: Event): void {
    if (e) e.preventDefault();
    this._initSpectorUI();

    const $wrap = this.$wrap;
    const CaptureMenu = this.CaptureMenu;
    if (!$wrap || !CaptureMenu) return;   // called too early / couldn't init spector?

    if (this._isHidden) {
      this._isHidden = false;
      CaptureMenu.display();

      // Hide fps meter (it is inaccurate?)
      $wrap.selectAll('.fpsCounterComponent')
        .style('display', 'none');

      $wrap
        .style('display', 'block')
        .style('opacity', '0')
        .transition()
        .duration(200)
        .style('opacity', '1');

    } else {
      this._isHidden = true;
      $wrap
        .transition()
        .duration(200)
        .style('opacity', '0')
        .on('end', () => {
          $wrap.style('display', 'none');
          CaptureMenu.hide();
        });
    }
  }


  /**
   * This creates the Spector components and starts spying on the rendering canvas.
   * (We avoid doing this until something calls `toggle()` to try to show the UI)
   */
  protected _initSpectorUI(): void {
    if (!this.$wrap) return;      // called too early?

    const SPECTOR = (window as any).SPECTOR;
    if (!SPECTOR) return;  // no spector - production build?

    const context = this.context;
    const gfx = context.systems.gfx!;
    const renderer = gfx.pixi?.renderer as any;

    if (!renderer) {   // This could happen if the WebGL context is lost and `pixi` is gone temporarily.
      this._reset();   // Throw everything away, but the user can try toggling it on again later.
      return;
    }

    // Spector will only work with the WebGL renderer
    if (renderer.type !== PIXI.RendererType.WEBGL) return;  // webgpu?

    // The default behavior of the CaptureMenu is to search the document for canvases to spy.
    // This doesn't work in our situation because Pixi is setup with `multiView: true`
    // and will render to an offscreen canvas - instead we will tell it what canvas to spy on.

    // If canvas has changed because we replaced Pixi after a context loss, reset but continue on..
    const canvas = renderer.context.canvas;
    if (canvas !== this._spyCanvas) {
      this._reset();
    }

    if (this.Spector) return;   // init steps below were already done

    const spector = new SPECTOR.Spector();
    this.Spector = spector;
    this._spyCanvas = canvas;
    spector.spyCanvas(canvas);

    // override of spector.getCaptureUI()
    const options = {
      rootPlaceHolder: this.$wrap.node(),
      canvas: canvas,
      hideLog: true
    };

    const cm = new SPECTOR.EmbeddedFrontend.CaptureMenu(options);
    cm.trackPageCanvases = () => {};    // replace with no-op to avoid doing this
    cm.updateCanvasesList([canvas]);    // only the one we are spying

    cm.onPauseRequested.add(spector.pause, spector);
    cm.onPlayRequested.add(spector.play, spector);
    cm.onPlayNextFrameRequested.add(spector.playNextFrame, spector);
    cm.onCaptureRequested.add((info: any) => {
      if (info) {
        spector.captureCanvas(info.ref);
      }
    }, spector);

// hide fps meter (it is inaccurate?)
//      window.setInterval(() => {
//        if (this._isHidden) return;
//        cm.setFPS(spector.getFps());
//      }, 1000);

    this.CaptureMenu = spector.captureMenu = cm;

    // override of spector.getResultUI()
    const rv = new SPECTOR.EmbeddedFrontend.ResultView();

    spector.onCapture.add((capture: any) => {
      rv.display();
      rv.addCapture(capture);
    });

    this.ResultView = spector.resultView = rv;
  }


  /**
   * Throws away the Spector components (e.g. after a WebGL context loss).
   */
  protected _reset(): void {
    this._spyCanvas = null;
    this.Spector = null;
    this.CaptureMenu = null;
    this.ResultView = null;
  }
}
