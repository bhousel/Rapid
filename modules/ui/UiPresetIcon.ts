import * as PIXI from 'pixi.js';
import { uiIcon } from './icon.ts';

import type { Category } from '../lib/Category.ts';
import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { MatchedStyle } from '../core/StyleSystem.ts';
import type { OsmTags } from '../data/types.ts';
import type { Preset } from '../lib/Preset.ts';
import type { Tags } from './fields/types.ts';


/**
 * `UiPresetIcon` renders the icon (and any surrounding shape/border) for a Preset,
 * Category, or an array of features. Configure via `.preset()` and `.geometry()`,
 * then attach with `selection.call(presetIcon.render)`.
 */
export class UiPresetIcon {
  public context: Context;

  protected _preset: Preset | Category | Preset[] | null;
  protected _geometry: string | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this._preset = null;
    this._geometry = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
  }


  /**
   * Fluent getter/setter for the preset (or category, or array) to display.
   * @param  val? - the preset/category/array to set; if omitted, returns the current value
   */
  public preset(val?: Preset | Category | Preset[] | null): any {
    if (!arguments.length) return this._preset;
    this._preset = val ?? null;
    return this;
  }


  /**
   * Fluent getter/setter for the geometry to display the icon for.
   * @param  val? - the geometry to set; if omitted, returns the current value
   */
  public geometry(val?: string | null): any {
    if (!arguments.length) return this._geometry;
    this._geometry = val ?? null;
    return this;
  }


  /**
   * Returns the icon name to use for the given preset/category/array and geometry.
   * @param  p - the preset, category, or array of features
   * @param  geom - the geometry to pick an icon for
   */
  protected _getIcon(p: Preset | Category | Preset[] | null, geom: string): string {
    if (Array.isArray(p)) return 'rapid-icon-data';
    if (p?.props?.icon) return p.props.icon;
    if (geom === 'line') return 'rapid-other-line';
    if (geom === 'vertex') return p?.isFallback() ? '' : 'temaki-vertex';
    return 'maki-marker-stroked';
  }


  /**
   * Category border looks like a folder
   * @param  $container - the selection to render the border into
   * @param  style - the style (fill color/opacity) to use
   */
  protected _renderCategoryBorder($container: D3Selection, style: MatchedStyle): void {
    const px = 60;
    const color = new PIXI.Color(style.fill.color).toHex();
    const opacity = style.fill.opacity;
    const FOLDER_PATH = 'M9.5,7.5 L25.5,7.5 L28.5,12.5 L49.5,12.5 C51.709139,12.5 53.5,14.290861 53.5,16.5 L53.5,43.5 C53.5,45.709139 51.709139,47.5 49.5,47.5 L10.5,47.5 C8.290861,47.5 6.5,45.709139 6.5,43.5 L6.5,12.5 L9.5,7.5 Z';

    $container
      .append('svg')
      .attr('class', 'preset-icon-category-border')
      .attr('width', `${px}px`)
      .attr('height', `${px}px`)
      .attr('viewBox', `0 0 ${px} ${px}`)
      .append('path')
      .attr('fill', color)
      .attr('fill-opacity', opacity ?? null)
      .attr('stroke', color)
      .attr('d', FOLDER_PATH);
  }


  /**
   * Point border is a map pin
   * @param  $container - the selection to render the border into
   */
  protected _renderPointBorder($container: D3Selection): void {
    const px = 60;
    const PIN_PATH = 'M 0,0 C -2,-2 -8,-10 -8,-15 C -8,-19 -4,-23 0,-23 C 4,-23 8,-19 8,-15 C 8,-10 2,-2 0,0 Z';

    $container
      .append('svg')
      .attr('class', 'preset-icon-point-border')
      .attr('width', `${px}px`)
      .attr('height', `${px}px`)
      .attr('viewBox', '-10 -27 20 30')
      .append('path')
      .attr('d', PIN_PATH);
  }


  /**
   * Vertex border is just a circle
   * @param  $container - the selection to render the border into
   */
  protected _renderVertexBorder($container: D3Selection): void {
    const px = 60;
    const mid = px / 2;
    const d = px * 2/3;

    $container
      .append('svg')
      .attr('class', 'preset-icon-vertex-border')
      .attr('width', `${px}px`)
      .attr('height', `${px}px`)
      .attr('viewBox', `0 0 ${px} ${px}`)
      .append('circle')
      .attr('cx', mid)
      .attr('cy', mid)
      .attr('r', d / 2);
  }


  /**
   * Area border is just a square with tiny endpoints/midpoints
   * @param  $container - the selection to render the border into
   * @param  style - the style (fill color/opacity) to use
   */
  protected _renderAreaBorder($container: D3Selection, style: MatchedStyle): void {
    const px = 60;
    const mid = px / 2;
    const len = px * 2/3;
    const c1 = (px-len) / 2;
    const c2 = c1 + len;
    const color = new PIXI.Color(style.fill.color).toHex();
    const opacity = style.fill.opacity;

    const $svg = $container
      .append('svg')
      .attr('class', 'preset-icon-area-border')
      .attr('width', `${px}px`)
      .attr('height', `${px}px`)
      .attr('viewBox', `0 0 ${px} ${px}`);

    $svg
      .append('path')
      .attr('fill', color)
      .attr('fill-opacity', opacity ?? null)
      .attr('stroke', color)
      .attr('d', `M${c1} ${c1} L${c1} ${c2} L${c2} ${c2} L${c2} ${c1} Z`);

    const rVertex = 2.5;
    [[c1, c1], [c1, c2], [c2, c2], [c2, c1]].forEach(([cx, cy]) => {
      $svg
        .append('circle')
        .attr('class', 'vertex')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', rVertex);
    });

    const rMidpoint = 1.25;
    [[c1, mid], [c2, mid], [mid, c1], [mid, c2]].forEach(([cx, cy]) => {
      $svg
        .append('circle')
        .attr('class', 'midpoint')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', rMidpoint);
    });
  }


  /**
   * Line shows a line beneath the icon
   * @param  $container - the selection to render the line into
   * @param  style - the style (casing/stroke color, dash) to use
   */
  protected _renderLine($container: D3Selection, style: MatchedStyle): void {
    const px = 60;
    const y = Math.round(px * 0.72);
    const l = Math.round(px * 0.6);
    const x1 = (px - l) / 2;
    const x2 = x1 + l;
    const casingColor = new PIXI.Color(style.casing.color).toHex();
    const strokeColor = new PIXI.Color(style.stroke.color).toHex();
    const dash = style.stroke.dash;
    const hasDash = Array.isArray(dash);

    const $svg = $container
      .append('svg')
      .attr('class', 'preset-icon-line')
      .attr('width', `${px}px`)
      .attr('height', `${px}px`)
      .attr('viewBox', `0 0 ${px} ${px}`);

    $svg
      .append('path')
      .attr('class', 'casing')
      .attr('stroke', casingColor)
      .attr('stroke-opacity', (hasDash ? 1 : 0.5))  // lighten casing, unless it's used to make the dash work
      .attr('d', `M${x1} ${y} L${x2} ${y}`);

    $svg
      .append('path')
      .attr('class', 'stroke')
      .attr('stroke', strokeColor)
      .attr('stroke-dasharray', (hasDash ? dash.map((v: number) => v * 0.75).join(' ') : null))  // scale down the dashes
      .attr('d', `M${x1} ${y} L${x2} ${y}`);

    const rVertex = 3;
    [[x1-1, y], [x2+1, y]].forEach(([cx, cy]) => {
      $svg
        .append('circle')
        .attr('class', 'vertex')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', rVertex);
    });
  }


  /**
   * Route shows a zig-zag line beneath the icon
   * @param  $container - the selection to render the route into
   */
  protected _renderRoute($container: D3Selection): void {
    $container
      .append('div')
      .attr('class', 'preset-icon-route')
      .call(uiIcon('#rapid-route', 'rapid-icon lowered'));
  }


  /**
   * Renders the icon at correct size and placement
   * @param  $container - the selection to render the icon into
   * @param  iconName - the icon id to render
   * @param  klass - extra CSS classes to apply
   * @param  color - the icon color
   */
  protected _renderSvgIcon($container: D3Selection, iconName: string, klass: string[], color: string): void {
    $container
      .append('div')
      .attr('class', 'preset-icon')
      .call(uiIcon(`#${iconName}`, klass.join(' ')));

    $container.selectAll('.preset-icon svg.icon')
      .attr('color', color);
  }


  /**
   * Renders an image icon
   * @param  $container - the selection to render the image into
   * @param  imageURL - the image URL to display
   */
  protected _renderImageIcon($container: D3Selection, imageURL: string): void {
    $container.selectAll('img.image-icon')
      .data([imageURL])
      .enter()
      .append('img')
      .attr('class', 'image-icon')
      .attr('src', imageURL)
      .on('load', () => $container.classed('showing-img', true) )
      .on('error', () => $container.classed('showing-img', false) );
  }


  /**
   * Renders into the given selection.
   * A fresh instance is created and rendered per row/use, so it renders into
   *  `$selection` rather than capturing `$parent`.
   * @param $selection - A d3-selection to the HTMLElement this renders into
   */
  public render($selection: D3Selection): void {
    const context = this.context;
    let $container: D3Selection = $selection.selectAll('.preset-icon-container')
      .data([0]);

    $container = $container.enter()
      .append('div')
      .attr('class', 'preset-icon-container')
      .merge($container)
      .html('');   // Empty out any existing content and rebuild from scratch..

    const p = this._preset;
    let geom = this._geometry;
    if (!p || !geom) return;  // nothing to display

    // 'p' is either an array, a preset or a category
    const isMulti = Array.isArray(p);
    const isPreset = !isMulti && (typeof (p as Preset).setTags === 'function');
    const isCategory = !isMulti && !isPreset;

    const tags: Tags = isPreset ? (p as Preset).setTags({}, geom as any) : {};
    for (const k in tags) {
      if (tags[k] === '*') {
        tags[k] = 'yes';
      }
    }

    if (geom === 'relation' && (tags.type === 'route' || tags.type === 'waterway')) {
      geom = 'route';
    }

    const settings = context.systems.settings;
    const styles = context.systems.styles!;

    const showThirdPartyIcons = (settings?.get('ui.privacy.thirdPartyIcons') ?? 'true') === 'true';
    const imageURL = showThirdPartyIcons && (p as any)?.props?.imageURL;
    const picon = this._getIcon(p, geom);
    // const showPoint = isPreset && (geom === 'point');     // not actually used
    const showVertex = isPreset && (geom === 'vertex');
    const showLine = isPreset && (geom === 'line');
    const showArea = isPreset && (geom === 'area');
    const showRoute = isPreset && (geom === 'route') && (p.id !== 'type/route');
    const style = styles.styleMatch(tags as OsmTags, this._geometry as any, 'osm');

    $container
      .classed('showing-img', !!imageURL);

    // Render outline shape, if any
    if (isCategory)   this._renderCategoryBorder($container, style);
    // if (showPoint)    this._renderPointBorder($container);        // not actually used
    if (showVertex)   this._renderVertexBorder($container);
    if (showArea)     this._renderAreaBorder($container, style);
    if (showLine)     this._renderLine($container, style);
    if (showRoute)    this._renderRoute($container);

    // Render Icon
    if (picon)  {
      const isRaised = showLine || showRoute;                  // move the icon up a little
      const isShrunk = isMulti || isCategory || showLine || showRoute;    // make it smaller
      const isRapidIcon = /^rapid-/.test(picon);

      const klass: string[] = [];
      if (isRapidIcon) klass.push('rapid-icon');
      if (isShrunk) klass.push('shrunk');
      if (isRaised) klass.push('raised');

      let color = '#333';
      if (showLine || showRoute) {
        if (isRapidIcon) {
          color = new PIXI.Color(style.stroke.color).toHex();
        }
      }

      this._renderSvgIcon($container, picon, klass, color);
    }

    // If we have an image/logo url, it may display over the other content
    if (imageURL) {
      this._renderImageIcon($container, imageURL);
    }
  }
}
