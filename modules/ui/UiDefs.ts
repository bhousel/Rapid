import { selection, select } from 'd3-selection';

import { utilFetchResponse } from '../util/fetch_response.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * A standalone `svg` and `defs` to contain the icon spritesheets for the user interface.
 * It is attached to the main rapid container so the icons can be used anywhere.
 *
 * @example
 *  <svg id='#rapid-defs'>
 *    <defs>
 *      <g class='spritesheet spritesheet-rapid'>…</g>
 *      <g class='spritesheet spritesheet-maki'>…</g>
 *      <g class='spritesheet spritesheet-temaki'>…</g>
 *      …
 *    </defs>
 *  </svg>
 */
export class UiDefs {
  public context: Context;

  public spritesheetIDs: string[];

  // D3 selections
  public $parent: D3Selection | null;

  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    this.spritesheetIDs = [
      'rapid', 'maki', 'temaki', 'fa', 'roentgen', 'community', /*'mapillary-object',*/ 'mapillary'
    ];

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this._spritesheetLoaded = this._spritesheetLoaded.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public render($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const assets = context.systems.assets!;
    const network = context.systems.network!;

    // create svg and defs if necessary
    $parent.selectAll('#rapid-defs')
      .data([0])
      .enter()
      .append('svg')
      .attr('id', 'rapid-defs')
      .append('defs');

    // update
    const $defs = $parent.selectAll('#rapid-defs > defs');

    $defs.selectAll('.spritesheet')
      .data(this.spritesheetIDs, d => d)
      .enter()
      .append('g')
      .attr('class', d => `spritesheet spritesheet-${d}`)
      .each((d, i, nodes) => {
        const $group = select(nodes[i]);
        const url = assets.getFileURL(`svg/${d}-sprite.svg`);
        // We need the browser's DOMParser here, so we can insert this spritesheet into the document.
        network.fetchRaw(url, { requestID: `spritesheet-${d}` })
          .then(response => utilFetchResponse(response, new window.DOMParser() as any))
          .then(svg => $group.call(this._spritesheetLoaded, d, svg))
          .catch(e => console.error(e));  // eslint-disable-line
      });
  }


  /**
   * @param  $selection      - A d3-selection to a `g` element that the icons should render themselves into
   * @param  spritesheetID   - the spritesheet id to use
   * @param  spritesheetSvg  - Document containing the fetched spritesheet
   */
  protected _spritesheetLoaded($selection: D3Selection, spritesheetID: string, spritesheetSvg: XMLDocument): void {
    const group = $selection.node() as SVGGElement;
    const element = spritesheetSvg.documentElement;

    element.setAttribute('id', spritesheetID);
    group.appendChild(element);

    // For some spritesheets, allow icon fill colors to be overridden..
    if (['maki', 'temaki', 'fa', 'roentgen', 'community'].includes(spritesheetID)) {
      $selection.selectAll('path')
        .attr('fill', 'currentColor');
    }

    // Notify Pixi about the icons so they can be used by WebGL/webGPU - see Rapid#925
    // Pixi's textureManager should be set up, throw if we're wrong about this.
    const textureManager = this.context.systems.gfx!.textureManager;
    if (!textureManager) {
      throw new Error(`TextureManager not ready to pack icons for ${spritesheetID}`);
    }

    $selection.selectAll('symbol')
      .each((d, i, nodes) => {
        const symbol = nodes[i] as SVGSymbolElement;
        const iconID = symbol.getAttribute('id') as string;
        textureManager.registerSvgIcon(iconID, symbol);
     });
  }

}
