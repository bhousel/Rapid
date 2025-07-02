import { selection, select } from 'd3-selection';
import debounce from 'lodash-es/debounce.js';

import { uiIcon } from '../icon.js';
import { uiTooltip } from '../tooltip.js';


/**
 * UiDrawModesTool
 * A toolbar section for the mode buttons
 */
export class UiDrawModesTool {

  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    this.context = context;
    this.id = 'draw_modes';
    this.stringID = 'toolbar.add_feature';

    const l10n = context.systems.l10n;
    const gfx = context.systems.gfx;
    const presets = context.systems.presets;
    const ui = context.systems.ui;

    this._keys = null;

    this.commands = [{
      id: 'add-point',
      icon: 'point',
      preset: presets.item('point'),
      getTitle: () => l10n.t('modes.add_point.title'),
      getDescription: () => l10n.t('modes.add_point.description'),
      getKey: () => l10n.t('shortcuts.command.add_point.key')
    }, {
      id: 'draw-line',
      icon: 'line',
      preset: presets.item('line'),
      getTitle: () => l10n.t('modes.add_line.title'),
      getDescription: () => l10n.t('modes.add_line.description'),
      getKey: () => l10n.t('shortcuts.command.add_line.key')
    }, {
      id: 'draw-area',
      icon: 'area',
      preset: presets.item('area'),
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
    this.Tooltip = uiTooltip(context)
      .placement('bottom')
      .title(d => d.getDescription())
      .shortcut(d => d.getKey());

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.choose = this.choose.bind(this);
    this.render = this.render.bind(this);
    this.rerender = (() => this.render());  // call render without argument
    this.debouncedRender = debounce(this.rerender, 500, { leading: true, trailing: true });
    this._setupKeybinding = this._setupKeybinding.bind(this);

    // Event listeners
    gfx.on('draw', this.debouncedRender);
    gfx.scene.on('layerchange', this.rerender);
    context.on('modechange', this.rerender);
    ui.on('uichange', this.rerender);
    l10n.on('localechange', this._setupKeybinding);

    this._setupKeybinding();
  }


  /**
   * render
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param {d3-selection} $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  render($parent = this.$parent) {
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
    let $joined = $parent.selectAll('.joined')
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

    let $buttons = $joined.selectAll('button.add-button')
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
      ui.checkOverflow('.map-toolbar', true);
    }

    // update
    $buttons = $buttons.merge($$buttons);

    $buttons
      .classed('disabled', d => !this.buttonEnabled(d))
      .classed('active', d => context.mode?.id === d.id);

    $buttons.selectAll('.label')
      .text(d => d.getTitle());
  }


  osmEnabled() {
    const layers = this.context.systems.gfx.scene.layers;
    return layers.get('osm')?.enabled;
  }

  osmEditable() {
    return this.context.mode?.id !== 'save';
  }

  notesEnabled() {
    const layers = this.context.systems.gfx.scene.layers;
    return layers.get('notes')?.enabled;
  }

  notesEditable() {
    return this.context.mode?.id !== 'save';
  }

  buttonEnabled(d) {
    if (d.id === 'add-note') return this.notesEnabled() && this.notesEditable();
    if (d.id !== 'add-note') return this.osmEnabled() && this.osmEditable();
  }


  /**
   * choose
   * @param  {Event}  e? - triggering event (if any)
   * @param  {Object} d? - object bound to the selection (i.e. the command)
   */
  choose(e, d) {
    if (e)  e.preventDefault();
    if (!d || !this.buttonEnabled(d)) return;

    const context = this.context;
    const currMode = context.mode?.id;

    // When drawing, ignore accidental clicks on mode buttons - iD#4042
    if (e && /^draw/.test(currMode)) return;   // d3_event will be defined if user clicked

    if (d.id === currMode) {
      context.enter('browse');
    } else {
      context.enter(d.id);
    }
  }


  /**
   * _setupKeybinding
   * This sets up the keybinding, replacing existing if needed
   */
  _setupKeybinding() {
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
