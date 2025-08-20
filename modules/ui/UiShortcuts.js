import { select } from 'd3-selection';
import { utilArrayUniq } from '@rapid-sdk/util';

import { uiIcon } from './icon.js';
import { uiModal } from './modal.js';
import { utilCmd, utilDetect } from '../util/index.js';


/**
 * UiShortcuts
 * This is a UI component for displaying the keyboard shortcuts (when the user presses '?')
 * It is a modified `uiModal` component.
 * We load the data from 'shortcuts.json' to populate this screen.
 *
 * +------------------------------+
 * | Keyboard Shortcuts         X |   `.shortcuts-heading`
 * +------------------------------+
 * |    Browsing Editing Tools    |   `.nav-bar` containing `.nav-items`
 * |                              |
 * |  +--column--+  +--column--+  |  \
 * |  | row      |  | row      |  |  |-- `.shortcuts-section`
 * |  | row      |  | row      |  |  |    contains multiple `.shortcut-tab` (one visible at a time)
 * |  | row      |  | row      |  |  |     each of those contains multiple `.shortcut-column`
 * |  +----------+  +----------+  |  |      each of those contains multiple `.shortcut-row`
 * +------------------------------+  /
 */
export class UiShortcuts {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    this.context = context;

    this._detectedOS = utilDetect().os;
    this._activeTab = 0;
    this._keys = null;

    // Modal and data will be created when calling `show()`
    this._dataShortcuts = null;

    // D3 selections
    this.$modal = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.show = this.show.bind(this);
    this.hide = this.hide.bind(this);
    this.toggle = this.toggle.bind(this);
    this.render = this.render.bind(this);
    this._setupKeybinding = this._setupKeybinding.bind(this);

    // Setup event handlers..
    const l10n = context.systems.l10n;
    l10n.on('localechange', () => {
      this._setupKeybinding();
      this.render();
    });

    this._setupKeybinding();
  }


  /**
   * render
   * Renders the content inside the modal.
   * Note that most `render` functions accept a parent selection,
   *  this one doesn't need it - `$modal` is always the parent.
   */
  render() {
    // Modals are created at the time when `show()` is first called
    if (!this.$modal || !this._dataShortcuts) return;

    const context = this.context;
    const l10n = context.systems.l10n;
    const $content = this.$modal.select('.content');

    // enter
    $content
      .selectAll('.shortcuts-heading')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'shortcuts-heading modal-section')
      .append('h3')
      .text(l10n.t('shortcuts.title'));

    const $$wrapper = $content
      .selectAll('.shortcuts-wrapper')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'shortcuts-wrapper modal-section');

    const $$navbar = $$wrapper
      .append('div')
      .attr('class', 'nav-bar');

    $$navbar
      .selectAll('.nav-item')
      .data(this._dataShortcuts)
      .enter()
      .append('a')
      .attr('class', 'nav-item')
      .attr('href', '#')
      .on('click', (e, d) => {
        e.preventDefault();
        this._activeTab = this._dataShortcuts.indexOf(d);
        this.render();
      })
      .append('span')
      .text(d => l10n.t(d.text));


    const $$content = $$wrapper
      .append('div')
      .attr('class', 'shortcuts-content');

    const $$tabs = $$content
      .selectAll('.shortcut-tab')
      .data(this._dataShortcuts)
      .enter()
      .append('div')
      .attr('class', d => `shortcut-tab shortcut-tab-${d.tab}`);

    const $$columns = $$tabs
      .selectAll('.shortcut-column')
      .data(d => d.columns)
      .enter()
      .append('table')
      .attr('class', 'shortcut-column');

    const $$rows = $$columns
      .selectAll('.shortcut-row')
      .data(d => d.rows)
      .enter()
      .append('tr')
      .attr('class', 'shortcut-row');


    // Rows without a "shortcuts" property are the subsection headings
    const $$sectionRow = $$rows
      .filter(d => !d.shortcuts);

    // Each "section" row contains:
    // +---`td.shortcut-keys`--+--`td.shortcut-desc`---+
    // +      (empty)          |  h3 section heading   |
    // +-----------------------+-----------------------+

    $$sectionRow
      .append('td')  // empty
      .attr('class', 'shortcut-keys');

    $$sectionRow
      .append('td')
      .attr('class', 'shortcut-section')
      .append('h3')
      .text(d => l10n.t(d.text));


    // Rows with a "shortcuts" property are the actual shortcuts
    const $$shortcutRow = $$rows
      .filter(d => d.shortcuts);

    // Each "shortcut" row contains:
    // +---`td.shortcut-keys`--+--`td.shortcut-desc`---+
    // +      modifiers, keys  |  description          |
    // +-----------------------+-----------------------+

    $$shortcutRow
      .append('td')
      .attr('class', 'shortcut-keys')
      .each((d, i, nodes) => {
        const $$selection = select(nodes[i]);

        // Add modifiers, if any..
        let modifiers = d.modifiers || [];
        if (this._detectedOS === 'win' && d.text === 'shortcuts.editing.commands.redo') {
          modifiers = ['⌃'];
        } else if (this._detectedOS !== 'mac' && d.text === 'shortcuts.browsing.display_options.fullscreen') {
          modifiers = [];
        }

        for (const val of modifiers) {
          $$selection
            .append('kbd')
            .attr('class', 'modifier')
            .text(d => utilCmd.display(context, val));

          $$selection
            .append('span')
            .attr('class', 'shortcut-separator')
            .text('+');
        }


        // Add shortcuts, if any..
        let shortcuts = d.shortcuts || [];
        if (this._detectedOS === 'win' && d.text === 'shortcuts.editing.commands.redo') {
          shortcuts = ['Y'];
        } else if (this._detectedOS !== 'mac' && d.text === 'shortcuts.browsing.display_options.fullscreen') {
          shortcuts = ['F11'];
        }

        // 'shortcuts' should be an Array containing strings and Array groups
        // For example,  `['A', ['B', 'C'], 'D']`
        //  will display a shortcut like "A -or- B,C -or- D"
        // Preprocess this data to convert all the strings to display values and remove duplicates.
        const s = new Set();
        for (const item of shortcuts) {
          let group = Array.isArray(item) ? item : [item];  // treat all items as arrays
          group = group.map(s => {
            if (s.includes('{')) return s;
            else return utilCmd.display(context, s.includes('.') ? l10n.t(s) : s);
          });
          group = utilArrayUniq(group);

          if (group.length === 0) {
            continue;
          } else if (group.length === 1) {
            s.add(group[0]);
          } else {
            s.add(group);
          }
        }

        const arr = [...s];
        for (let i = 0; i < arr.length; i++) {
          const item = arr[i];
          const group = Array.isArray(item) ? item : [item];  // treat all items as arrays

          for (let j = 0; j < group.length; j++) {
            const s = group[j];
            if (typeof s !== 'string') continue;

            const icon = s.toLowerCase().match(/^\{(.*)\}$/);
            if (icon) {
              const altText = icon[1].replace('interaction-', '').replace(/\-/g, ' ');
              $$selection
               .call(uiIcon(`#rapid-${icon[1]}`, 'operation', altText));

            } else {
              $$selection
                .append('kbd')
                .attr('class', 'shortcut')
                .text(s);
            }

            if (j < group.length - 1) {
              $$selection
                .append('span')
                .text('/');
            }
          }

          if (i < arr.length - 1) {
            $$selection
              .append('span')
              .attr('class', 'shortcut-separator')
              .text(l10n.t('shortcuts.or'));
          }
        }

        // Add gesture word, if any..
        if (d.gesture) {
          $$selection
            .append('span')
            .attr('class', 'shortcut-separator')
            .text('+');

          $$selection
            .append('span')
            .attr('class', 'gesture')
            .text(d => l10n.t(d.gesture));
        }
      });


    $$shortcutRow
      .append('td')
      .attr('class', 'shortcut-desc')
      .text(d => d.text ? l10n.t(d.text) : '\u00a0');   // \u00a0 = &nbsp;


    // Update
    const $wrapper = $content.selectAll('.shortcuts-wrapper');

    $wrapper.selectAll('.nav-item')
      .classed('active', (d, i) => i === this._activeTab);

    $wrapper.selectAll('.shortcut-tab')
      .style('display', (d, i) => i === this._activeTab ? 'flex' : 'none');
  }


  /**
   * show
   * Shows the shortcuts modal.
   * This will create the modal, then load the shortcuts data, then render()
   * For this kind of popup component, must first `show()` to create the modal.
   */
  show() {
    const context = this.context;
    const assets = context.systems.assets;
    const $container = context.container();   // $container is always the parent for a modal

    assets.loadAssetAsync('shortcuts')
      .then(data => {
        this._dataShortcuts = data.shortcuts;

        const isShowing = $container.selectAll('.shaded').size();
        if (isShowing) return;  // a modal is already showing

        this.$modal = uiModal($container);

        this.$modal.select('.modal')
          .classed('modal-shortcuts', true);

        this.render();
      })
      .catch(e => {
        console.error(e);  // eslint-disable-line
      });
  }


  /**
   * hide
   * Hides the shortcuts modal.
   */
  hide() {
    if (!this.$modal) return;
    this.$modal.close();
    this.$modal = null;
  }


  /**
   * toggle
   * Toggle the shortcuts modal
   */
  toggle() {
    const $container = this.context.container();

    const otherShowing = $container.selectAll('.shaded > div:not(.modal-shortcuts)').size();
    if (otherShowing) return;  // some other modal is already showing

    const isShowing = $container.selectAll('.shaded > div.modal-shortcuts').size();
    if (isShowing) {
      this.hide();
    } else {
      this.show();
    }
  }


  /**
   * _setupKeybinding
   * This sets up the keybinding, replacing existing if needed
   */
  _setupKeybinding() {
    const context = this.context;
    const keybinding = context.keybinding();
    const l10n = context.systems.l10n;

    if (Array.isArray(this._keys)) {
      keybinding.off(this._keys);
    }

    this._keys = [l10n.t('shortcuts.command.keyboard_shortcuts.key'), '?'];
    context.keybinding().on(this._keys, this.toggle);
  }

}
