import { selection, select } from 'd3-selection';
import { uiIcon } from '../icon.ts';
import { uiTooltip } from '../tooltip.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';

interface DrawCommand {
  id: string;
  icon: string;
  preset?: unknown;
  getTitle(): string;
  getDescription(): string;
  getKey(): string;
}


/**
 * A toolbar section for the mode buttons
 */
export class UiDrawModesTool {
  public context: Context;
  public id: string;
  public stringID: string;
  public Tooltip: any;
  public commands: DrawCommand[];

  // D3 selections
  public $parent: D3Selection | null;

  public debouncedRender: () => void;

  protected _keys: string | string[] | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.id = 'draw_modes';
    this.stringID = 'toolbar.add_feature';

    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;
    const scheduler = context.systems.scheduler;  // optional
    const ui = context.systems.ui;

    this._keys = null;

    this.commands = [{
      id: 'add-point',
      icon: 'point',
      preset: schema.getFallback('point'),
      getTitle: () => l10n.t('modes.add_point.title'),
      getDescription: () => l10n.t('modes.add_point.description'),
      getKey: () => l10n.t('shortcuts.command.add_point.key')
    }, {
      id: 'draw-line',
      icon: 'line',
      preset: schema.getFallback('line'),
      getTitle: () => l10n.t('modes.add_line.title'),
      getDescription: () => l10n.t('modes.add_line.description'),
      getKey: () => l10n.t('shortcuts.command.add_line.key')
    }, {
      id: 'draw-area',
      icon: 'area',
      preset: schema.getFallback('area'),
      getTitle: () => l10n.t('modes.add_area.title'),
      getDescription: () => l10n.t('modes.add_area.description'),
      getKey: () => l10n.t('shortcuts.command.add_area.key')
    }, {
      id: 'add-note',
      icon: 'note',
      getTitle: () => l10n.t('modes.add_note.title'),
      getDescription: () => l10n.t('modes.add_note.description'),
      getKey: () => l10n.t('shortcuts.command.add_note.key')
    }];


    // Create child components
    this.Tooltip = (uiTooltip(context) as any)
      .placement('bottom')
      .title((d: DrawCommand) => d.getDescription())
      .shortcut((d: DrawCommand) => d.getKey());

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.choose = this.choose.bind(this);
    this.render = this.render.bind(this);
    this.debouncedRender = () => {
      // scheduler throttles the redraw; without it, just redraw immediately
      if (scheduler) {
        scheduler.throttle('UiDrawModesTool-render', () => this.render(), { ms: 500 });
      } else {
        this.render();
      }
    };
    this._setupKeybinding = this._setupKeybinding.bind(this);

    // Event listeners
    gfx.on('draw', this.debouncedRender);
    gfx.scene!.on('layerchange', this.render);
    context.on('modechange', this.render);
    ui?.on('uichange', this.render);
    l10n.on('localechange', this._setupKeybinding);

    this._setupKeybinding();
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
    const ui = context.systems.ui;

    this.Tooltip
      .scrollContainer(context.container().select('.map-toolbar'));

    // Button group
    let $joined: D3Selection = $parent.selectAll('.joined')
      .data([0]);

    const $$joined = $joined.enter()
      .append('div')
      .attr('class', 'joined')
      .style('display', 'flex');

    $joined = $joined.merge($$joined);


    // Buttons
    const showButtons = this.commands.filter(d => {
      return (d.id === 'add-note') ? this.notesEnabled() : true;
    });

    let $buttons: D3Selection = $joined.selectAll('button.add-button')
      .data(showButtons, d => d.id);

    // exit
    $buttons.exit()
      .remove();

    // enter
    const $$buttons = $buttons.enter()
      .append('button')
      .attr('class', d => `${d.id} add-button bar-button`)
      .on('click', this.choose);

    $$buttons
      .each((d, i, nodes) => {
        select(nodes[i])
          .call(uiIcon(`#rapid-icon-${d.icon}`))
          .call(this.Tooltip);
      });

    $$buttons
      .append('span')
      .attr('class', 'label');

    // If we are adding/removing any buttons, check if toolbar has overflowed..
    if ($buttons.enter().size() || $buttons.exit().size()) {
      ui?.checkOverflow('.map-toolbar', true);
    }

    // update
    $buttons = $buttons.merge($$buttons);

    $buttons
      .classed('disabled', d => !this.buttonEnabled(d))
      .classed('active', d => context.mode?.id === d.id);

    $buttons.selectAll('.label')
      .text(d => d.getTitle());
  }


  /**
   * @return  `true` if the OSM layer is enabled, `false` if not
   */
  public osmEnabled() {
    const layers = this.context.systems.gfx!.scene!.layers;
    return layers.get('osm')?.enabled;
  }

  /**
   * @return  `true` if OSM data is currently editable, `false` if not
   */
  public osmEditable(): boolean {
    return this.context.mode?.id !== 'save';
  }

  /**
   * @return  `true` if the Notes layer is enabled, `false` if not
   */
  public notesEnabled() {
    const layers = this.context.systems.gfx!.scene!.layers;
    return layers.get('notes')?.enabled;
  }

  /**
   * @return  `true` if Notes are currently editable, `false` if not
   */
  public notesEditable(): boolean {
    return this.context.mode?.id !== 'save';
  }

  /**
   * @param   d - the command bound to the button
   * @return  `true` if the button should be enabled, `false` if not
   */
  public buttonEnabled(d: DrawCommand) {
    if (d.id === 'add-note') return this.notesEnabled() && this.notesEditable();
    if (d.id !== 'add-note') return this.osmEnabled() && this.osmEditable();
  }


  /**
   * @param  e? - triggering event (if any)
   * @param  d? - object bound to the selection (i.e. the command)
   */
  public choose(e?: Event, d?: DrawCommand): void {
    e?.preventDefault();
    if (!d || !this.buttonEnabled(d)) return;

    const context = this.context;
    const currMode = context.mode?.id;

    // When drawing, ignore accidental clicks on mode buttons - iD#4042
    if (e && /^draw/.test(currMode as string)) return;   // d3_event will be defined if user clicked

    if (d.id === currMode) {
      context.enter('browse');
    } else {
      context.enter(d.id);
    }
  }


  /**
   * This sets up the keybinding, replacing existing if needed
   */
  protected _setupKeybinding(): void {
    const context = this.context;
    const keybinding = context.keybinding();

    if (Array.isArray(this._keys)) {
      keybinding.off(this._keys);
    }

    this._keys = [];
    for (const d of this.commands) {
      const key = d.getKey();
      this._keys.push(key);
      keybinding.on(key, e => this.choose(e, d));
    }
  }
}
