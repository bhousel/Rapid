import { selection } from 'd3-selection';

import { AbstractUiCard } from './AbstractUiCard.ts';
import { uiIcon } from '../icon.ts';
import { utilCmd } from '../../util/cmd.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { RenderFrame } from '../../pixi/RenderFrame.ts';


const CHART_HEIGHT = 48;     // CSS pixels
const SAMPLE_MS = 1000;      // the numbers are averages over the frames drawn this recently
const UPDATE_MS = 250;       // the card redraws at most this often while the map is drawing

/** One line of the card: a time with a bar, or a label with text */
interface Row {
  id: string;
  label: string;
  value: string;
  /** For a time: its share of the chart's scale (0..1). Text rows have none. */
  fraction?: number;
  /** For a time: whether it is over the frame budget */
  over?: boolean;
}


/**
 * `UiRenderingCard` shows what recent frames of the map cost: the time of the APP and DRAW passes
 * against the frame budget, a chart of the last frames, and what Pixi drew.
 * The numbers are `GraphicsSystem`'s frame stats, see `design/graphics-system.md`.
 */
export class UiRenderingCard extends AbstractUiCard {
  public id: string;
  public rerender: () => void;

  protected _deferredRender: () => void;
  protected _keys: string[] | null;
  protected _turnedDetailsOn: boolean;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'rendering';

    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;
    const scheduler = context.systems.scheduler;  // optional

    this._keys = null;
    this._turnedDetailsOn = false;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.rerender = () => this.render();
    this._deferredRender = () => {
      if (!this.visible) return;
      // scheduler limits how often the card redraws; without it, just redraw with every frame
      if (scheduler) {
        scheduler.throttle('UiRenderingCard-render', this.rerender, { ms: UPDATE_MS });
      } else {
        this.render();
      }
    };
    this._setupKeybinding = this._setupKeybinding.bind(this);
    this._toggleDetails = this._toggleDetails.bind(this);

    // Event listeners
    gfx.on('draw', this._deferredRender);
    l10n.on('localechange', this._setupKeybinding);

    this._setupKeybinding();
  }


  /**
   * Hides the component, and turns detailed stats off again if this card turned them on.
   * @param [e] - the triggering event, if any
   */
  public override hide(e?: Event): void {
    const gfx = this.context.systems.gfx!;

    if (this._turnedDetailsOn) {
      gfx.enableDetailedStats(false);
      this._turnedDetailsOn = false;
    }
    super.hide(e);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public override render($parent: D3Selection | null = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    if (!this.visible) return;

    const context = this.context;
    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;
    const scheduler = context.systems.scheduler;  // optional

    // .card-container
    let $wrap: D3Selection = $parent.selectAll('.card-container')
      .data([this.id], d => d);

    // enter
    const $$wrap = $wrap.enter()
      .append('div')
      .attr('class', d => `fillD2 card-container card-container-${d}`);

    const $$title = $$wrap
      .append('div')
      .attr('class', 'fillD2 card-title');

    $$title
      .append('h3');

    $$title
      .append('button')
      .attr('class', 'close')
      .on('click', this.toggle)
      .call(uiIcon('#rapid-icon-close'));

    const $$content = $$wrap
      .append('div')
      .attr('class', d => `card-content card-content-${d}`);

    $$content
      .append('canvas')
      .attr('class', 'rendering-chart');

    $$content
      .append('div')
      .attr('class', 'rendering-rows');

    $$content
      .append('a')
      .attr('href', '#')
      .attr('class', 'button button-toggle-details')
      .on('click', this._toggleDetails);


    // update
    this.$wrap = $wrap = $wrap.merge($$wrap);

    $wrap.selectAll('h3')
      .text(l10n.t('info_panels.rendering.title'));

    $wrap.selectAll('.button-toggle-details')
      .text(l10n.t(`info_panels.rendering.${gfx.detailedStats ? 'hide_details' : 'show_details'}`));

    // If the user is trying to select text, don't redraw - Rapid#1659
    const $content = $wrap.selectAll('.card-content');
    const textSelection = document.getSelection();
    if (textSelection?.containsNode($content.node() as Node, true)) return;

    const frames = gfx.renderFrames;
    const budget = scheduler?.targetFrameTime ?? (1000 / 60);

    this._drawChart($content.selectAll('.rendering-chart').node() as HTMLCanvasElement, frames, budget);


    // .rendering-row
    let $rows: D3Selection = $content.selectAll('.rendering-rows').selectAll('.rendering-row')
      .data(this._rows(frames, budget), d => d.id);

    $rows.exit()
      .remove();

    // enter
    const $$rows = $rows.enter()
      .append('div')
      .attr('class', d => `rendering-row rendering-row-${d.id}`)
      .classed('rendering-row-time', d => d.fraction !== undefined);

    $$rows
      .append('span')
      .attr('class', 'rendering-label');

    $$rows.filter(d => d.fraction !== undefined)
      .append('span')
      .attr('class', 'rendering-bar')
      .append('span')
      .attr('class', 'rendering-bar-fill');

    $$rows
      .append('span')
      .attr('class', 'rendering-value');

    // update
    // (`select`, not `selectAll`, so each row's new data reaches its children)
    $rows = $rows.merge($$rows).order();

    $rows.select('.rendering-label')
      .text(d => d.label);

    $rows.select('.rendering-value')
      .text(d => d.value);

    $rows.select('.rendering-bar-fill')
      .classed('over', d => !!d.over)
      .style('width', d => `${(Math.min(d.fraction ?? 0, 1) * 100).toFixed(1)}%`);
  }


  /**
   * Returns the lines to show: the average times of the frames drawn in the last second
   * (or of the last frame, if nothing was drawn that recently), and what the last frame drew.
   * @param frames - Recent frames, oldest first
   * @param budget - Milliseconds a frame has
   * @return The rows, in the order to show them
   */
  protected _rows(frames: RenderFrame[], budget: number): Row[] {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const scheduler = context.systems.scheduler;  // optional
    const localeCode = l10n.localeCode;

    const last = frames.at(-1);
    if (!last?.draw) return [];

    const since = performance.now() - SAMPLE_MS;
    const recent = frames.filter(frame => frame.time > since);
    const sample = recent.length ? recent : [last];

    const average = (vals: (number | undefined)[]): number | undefined => {
      const nums = vals.filter(val => val !== undefined);
      return nums.length ? nums.reduce((sum, val) => sum + val, 0) / nums.length : undefined;
    };
    const count = (num: number): string => num.toLocaleString(localeCode);
    // Lists of names with numbers: a line breaks between the pairs, not inside one
    const pairs = (list: [string, string][]): string => list.map(([name, val]) => `${name} ${val}`).join(' · ');

    const rows: Row[] = [];

    // How many frames were drawn in the last second, and in how many of them a pass was held back
    const held = recent.filter(frame => frame.held).length;
    rows.push({
      id: 'frames',
      label: l10n.t('info_panels.rendering.frames'),
      value: l10n.t(`info_panels.rendering.${held ? 'frames_held' : 'frames_drawn'}`, { frames: count(recent.length), held: count(held) })
    });

    // Times. The bars use the chart's scale: two frame budgets wide.
    const times: [string, number | undefined][] = [
      ['app', average(sample.map(frame => frame.appMs))],
      ['draw', average(sample.map(frame => frame.draw?.ms))],
      ['gpu', average(sample.map(frame => frame.draw?.gpuMs))]   // only with detailed stats on
    ];
    for (const [id, ms] of times) {
      if (ms === undefined) continue;
      rows.push({
        id: id,
        label: l10n.t(`info_panels.rendering.${id}`),
        value: l10n.t('info_panels.rendering.milliseconds', { ms: ms.toFixed(1) }),
        fraction: ms / (budget * 2),
        over: ms > budget
      });
    }

    // Features shown, of the features the layers have
    let visible = 0;
    let total = 0;
    for (const layer of last.layers.values()) {
      visible += layer.visible;
      total += layer.features;
    }
    rows.push({
      id: 'features',
      label: l10n.t('info_panels.rendering.features'),
      value: l10n.t('info_panels.rendering.features_shown', { visible: count(visible), total: count(total) })
    });

    // The layers that took the most time (the names and numbers below are for developers, not translated)
    const layerTimes: [LayerID, number][] = [];
    for (const layerID of last.layers.keys()) {
      const ms = average(sample.map(frame => {
        const layer = frame.layers.get(layerID);
        return layer && (layer.renderMs + layer.cullMs);
      })) ?? 0;
      if (ms >= 0.05) layerTimes.push([layerID, ms]);
    }
    layerTimes.sort((a, b) => b[1] - a[1]);
    if (layerTimes.length) {
      rows.push({
        id: 'layers',
        label: l10n.t('info_panels.rendering.layers'),
        value: pairs(layerTimes.slice(0, 3).map(([layerID, ms]) => [layerID, ms.toFixed(1)]))
      });
    }

    // The layers that kept their features as they were (only the view had moved), in how many of the frames
    const keptLayers: [string, string][] = [];
    for (const layerID of last.layers.keys()) {
      const kept = sample.filter(frame => frame.layers.get(layerID)?.kept).length;
      if (kept) keptLayers.push([layerID, `${kept}/${sample.length}`]);
    }
    if (keptLayers.length) {
      rows.push({
        id: 'kept',
        label: l10n.t('info_panels.rendering.kept'),
        value: pairs(keptLayers)
      });
    }

    // The work that the last frame put off to the frames after it (features to draw again, labels to place)
    const waitingLayers: [string, string][] = [];
    for (const [layerID, layer] of last.layers) {
      if (layer.waiting) waitingLayers.push([layerID, count(layer.waiting)]);
    }
    if (waitingLayers.length) {
      rows.push({
        id: 'waiting',
        label: l10n.t('info_panels.rendering.waiting'),
        value: pairs(waitingLayers)
      });
    }

    // What Pixi drew: its instructions by pipe, and with detailed stats on, the WebGL calls
    const instructions = Object.entries(last.draw.instructions).sort((a, b) => b[1] - a[1]);
    rows.push({
      id: 'instructions',
      label: l10n.t('info_panels.rendering.instructions'),
      value: pairs(instructions.map(([pipe, num]) => [pipe, count(num)]))
    });

    // How many of Pixi's instruction lists (one per render group) it had to rebuild, per frame
    const rebuilt = average(sample.map(frame => frame.draw?.rebuiltGroups)) ?? 0;
    rows.push({
      id: 'groups',
      label: l10n.t('info_panels.rendering.groups'),
      value: l10n.t('info_panels.rendering.groups_rebuilt', { rebuilt: rebuilt.toFixed(1), total: count(last.draw.renderGroups) })
    });

    const gl = last.draw.gl;
    if (gl) {
      rows.push({
        id: 'webgl',
        label: l10n.t('info_panels.rendering.webgl'),
        value: pairs(Object.entries(gl).map(([call, num]) => [call, count(num)]))
      });
    }

    if (scheduler) {
      const metrics = scheduler.metrics;
      rows.push({
        id: 'scheduler',
        label: l10n.t('info_panels.rendering.scheduler'),
        value: pairs([
          ['pending', count(scheduler.numPending)],
          ['pressure', metrics.pressure],
          ['dropped', count(metrics.droppedFrames)]
        ])
      });
    }

    return rows;
  }


  /**
   * Draws the chart: one bar per frame, oldest on the left, with the DRAW pass stacked on the APP
   * pass and a line at the frame budget. The chart is two budgets tall; a taller bar is cut off.
   * A pass that went over the budget is drawn in red.
   * @param canvas - The canvas to draw on
   * @param frames - Recent frames, oldest first
   * @param budget - Milliseconds a frame has
   */
  protected _drawChart(canvas: HTMLCanvasElement | null, frames: RenderFrame[], budget: number): void {
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;   // no canvas support, e.g. in tests

    // Match the canvas to its size on screen
    const ratio = globalThis.devicePixelRatio || 1;
    const width = canvas.clientWidth || 218;
    const height = CHART_HEIGHT;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const SLOTS = 120;   // as many frames as `GraphicsSystem` keeps
    const slot = width / SLOTS;
    const scale = height / (budget * 2);
    const offset = SLOTS - frames.length;   // the newest frame is always at the right edge

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const x = (offset + i) * slot;
      const appMs = frame.appMs;
      const drawMs = frame.draw?.ms ?? 0;
      const appHeight = Math.min(appMs * scale, height);
      const drawHeight = Math.min(drawMs * scale, height - appHeight);

      ctx.fillStyle = (appMs > budget) ? '#ff5555' : '#7092ff';
      ctx.fillRect(x, height - appHeight, slot, appHeight);
      ctx.fillStyle = (drawMs > budget) ? '#ff5555' : '#ffff88';
      ctx.fillRect(x, height - appHeight - drawHeight, slot, drawHeight);
    }

    // The frame budget
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, height - (budget * scale) + 0.5);
    ctx.lineTo(width, height - (budget * scale) + 0.5);
    ctx.stroke();
  }


  /**
   * Turns `GraphicsSystem`'s detailed stats (WebGL calls and GPU time) on or off.
   * @param e - the click event
   */
  protected _toggleDetails(e: Event): void {
    e.preventDefault();

    const gfx = this.context.systems.gfx!;

    const enable = !gfx.detailedStats;
    gfx.enableDetailedStats(enable);
    this._turnedDetailsOn = enable && gfx.detailedStats;   // it stays off with a renderer that isn't WebGL
    gfx.immediateRedraw();   // draw a frame that has them (or doesn't)
    this.render();
  }


  /**
   * This sets up the keybinding, replacing existing if needed
   */
  protected _setupKeybinding(): void {
    const context = this.context;
    const keyboard = context.systems.keyboard!;
    const l10n = context.systems.l10n!;

    if (Array.isArray(this._keys)) {
      keyboard.global.off(this._keys);
    }

    this._keys = [utilCmd('⌘⇧' + l10n.t('shortcuts.command.toggle_rendering_card.key'))];
    keyboard.global.on(this._keys, this.toggle);
  }

}
