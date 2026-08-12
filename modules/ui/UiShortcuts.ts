import { select } from 'd3-selection';
import { utilArrayUniq } from '@rapid-sdk/util';

import { uiIcon } from './icon.ts';
import { UiModal } from './UiModal.ts';
import { utilCmd, utilDetect } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';


/**
 * This is a UI component for displaying the keyboard shortcuts (when the user presses '?')
 * It is a modal component built on `UiModal`.
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
  public context: Context;

  protected _detectedOS: string;
  protected _activeTab: number;
  protected _keys: any;
  protected _dataShortcuts: any;

  // Child components
  public Modal: UiModal | null;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;

    this._detectedOS = utilDetect().os;
    this._activeTab = 0;
    this._keys = null;

    // Modal and data will be created when calling `show()`
    this._dataShortcuts = null;

    // Child components
    this.Modal = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.show = this.show.bind(this);
    this.hide = this.hide.bind(this);
    this.toggle = this.toggle.bind(this);
    this.render = this.render.bind(this);
    this._setupKeybinding = this._setupKeybinding.bind(this);

    // Setup event handlers..
    const l10n = context.systems.l10n!;
    l10n.on('localechange', () => {
      this._setupKeybinding();
      this.render();
    });

    this._setupKeybinding();
  }


  /**
   * Renders the content inside the modal.
   * Note that most `render` functions accept a parent selection,
   *  this one doesn't need it - `$modal` is always the parent.
   */
  public render(): void {
    // Modals are created at the time when `show()` is first called
    if (!this.Modal || !this._dataShortcuts) return;

    const context = this.context;
    const l10n = context.systems.l10n!;
    const $content: D3Selection = this.Modal.$content!;

    // replace all content on render
    $content.html('');

    // enter
    $content
      .selectAll('.shortcuts-heading')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'shortcuts-heading modal-section')
      .append('h3')
      .text(l10n.t('shortcuts.title'));

    const $$wrapper: D3EnterSelection = $content
      .selectAll('.shortcuts-wrapper')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'shortcuts-wrapper modal-section');

    const $$navbar: D3EnterSelection = $$wrapper
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


    const $$content: D3EnterSelection = $$wrapper
      .append('div')
      .attr('class', 'shortcuts-content');

    const $$tabs: D3EnterSelection = $$content
      .selectAll('.shortcut-tab')
      .data(this._dataShortcuts)
      .enter()
      .append('div')
      .attr('class', d => `shortcut-tab shortcut-tab-${d.tab}`);

    const $$columns: D3EnterSelection = $$tabs
      .selectAll('.shortcut-column')
      .data((d: any) => d.columns)
      .enter()
      .append('table')
      .attr('class', 'shortcut-column');

    const $$rows: D3EnterSelection = $$columns
      .selectAll('.shortcut-row')
      .data((d: any) => d.rows)
      .enter()
      .append('tr')
      .attr('class', 'shortcut-row');


    // Rows without a "shortcuts" property are the subsection headings
    const $$sectionRow: D3EnterSelection = $$rows
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
    const $$shortcutRow: D3EnterSelection = $$rows
      .filter(d => d.shortcuts);

    // Each "shortcut" row contains:
    // +---`td.shortcut-keys`--+--`td.shortcut-desc`---+
    // +      modifiers, keys  |  description          |
    // +-----------------------+-----------------------+

    $$shortcutRow
      .append('td')
      .attr('class', 'shortcut-keys')
      .each((d, i, nodes) => {
        const $$selection: D3EnterSelection = select(nodes[i]);

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
        const s = new Set<any>();
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
    const $wrapper: D3Selection = $content.selectAll('.shortcuts-wrapper');

    $wrapper.selectAll('.nav-item')
      .classed('active', (d, i) => i === this._activeTab);

    $wrapper.selectAll('.shortcut-tab')
      .style('display', (d, i) => i === this._activeTab ? 'flex' : 'none');
  }


  /**
   * Shows the shortcuts modal.
   * This will create the modal, then load the shortcuts data, then render()
   * For this kind of popup component, must first `show()` to create the modal.
   */
  public show(): void {
    const context = this.context;
    const assets = context.systems.assets!;

    assets.loadAssetAsync('shortcuts')
      .then((data: any) => {
        this._dataShortcuts = data.shortcuts;

        if (this.Modal?.isShown) return;  // already showing

        this.Modal = new UiModal(context);
        this.Modal.show();

        this.Modal.$modal!
          .classed('modal-shortcuts', true);

        this.render();
      })
      .catch(e => {
        console.error(e);  // eslint-disable-line
      });
  }


  /**
   * Hides the shortcuts modal.
   */
  public hide(): void {
    if (!this.Modal) return;
    this.Modal.close();
    this.Modal = null;
  }


  /**
   * Toggle the shortcuts modal
   */
  public toggle(): void {
    const $container = this.context.$container;

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
   * This sets up the keybinding, replacing existing if needed
   */
  protected _setupKeybinding(): void {
    const context = this.context;
    const keybinding = context.keybinding();
    const l10n = context.systems.l10n!;

    if (Array.isArray(this._keys)) {
      keybinding.off(this._keys);
    }

    this._keys = [l10n.t('shortcuts.command.keyboard_shortcuts.key'), '?'];
    context.keybinding().on(this._keys, this.toggle);
  }

}
