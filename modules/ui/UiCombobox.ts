import { select } from 'd3-selection';
import { EventEmitter } from 'tseep/lib/ee-safe';
import { utilGetSetValue, utilSanitizeHTML } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * A combobox data item.
 * This code assumes that the combobox values will not have duplicate entries.
 * It is keyed on the `value` of the entry.
 */
export interface UiComboboxDatum {
  value: string;
  display?: string | (($selection: D3Selection) => void);
  title?: string;
  terms?: string[];
  klass?: string;
}

/** Fetches combobox suggestions for the current input value. */
export type UiComboboxFetcher = (this: any, val: string, cb: (results: UiComboboxDatum[]) => void) => void;


/**
 * The `UiCombobox` component attaches autocomplete/suggestion behavior to an
 * `<input>` or `<textarea>`. A parent owns the instance, configures it with the
 * fluent setters (`.data()`, `.fetcher()`, `.minItems()`, …), then attaches it via
 * `input.call(combobox.attach)`. Emits `accept` and `cancel` events.
 */
export class UiCombobox extends EventEmitter {
  public context: Context;

  // D3 selections
  public $container: D3Selection;
  public $input: D3Selection | null;
  public $attachTo: D3Selection | null;

  protected _klass: string | undefined;
  protected _suggestions: UiComboboxDatum[];
  protected _data: UiComboboxDatum[];
  protected _fetched: Record<string, UiComboboxDatum>;
  protected _selected: string | null;
  protected _canAutocomplete: boolean;
  protected _caseSensitive: boolean;
  protected _cancelFetch: boolean;
  protected _minItems: number;
  protected _tDown: number;
  protected _mouseEnterHandler: any;
  protected _mouseLeaveHandler: any;
  protected _fetcher: UiComboboxFetcher;


  /**
   * @param context - Global shared application context
   * @param klass   - optional extra class name added to the combobox element
   */
  public constructor(context: Context, klass?: string) {
    super();
    this.context = context;
    this.$container = context.container();
    this._klass = klass;

    // D3 selections
    this.$input = null;
    this.$attachTo = null;

    this._suggestions = [];
    this._data = [];
    this._fetched = {};
    this._selected = null;
    this._canAutocomplete = true;
    this._caseSensitive = false;
    this._cancelFetch = false;
    this._minItems = 2;
    this._tDown = 0;
    this._mouseEnterHandler = undefined;
    this._mouseLeaveHandler = undefined;

    // Default fetcher filters the static `_data` by value/terms.
    this._fetcher = (val, cb) => {
      cb(this._data.filter(d => {
        const terms = d.terms || [];
        terms.push(d.value);
        return terms.some(term => {
          return term
            .toString()
            .toLowerCase()
            .indexOf(val.toLowerCase()) !== -1;
        });
      }));
    };

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.attach = this.attach.bind(this);
    this._focus = this._focus.bind(this);
    this._blur = this._blur.bind(this);
    this._keydown = this._keydown.bind(this);
    this._keyup = this._keyup.bind(this);
    this._change = this._change.bind(this);
    this._mousedown = this._mousedown.bind(this);
    this._mouseup = this._mouseup.bind(this);
    this._hide = this._hide.bind(this);
    this._render = this._render.bind(this);
    this._accept = this._accept.bind(this);

    // `accept` and `cancel` are single-listener events: each attach site re-registers
    // a new handler on every render, expecting the old one to be replaced. This matches
    // the d3-dispatch semantics the combobox was originally written against. We wrap `on`
    // here so that registering a new listener automatically removes any previous one for
    // the same event. (tseep types `on` as a class field, so method override is not
    // possible — the wrapper is assigned in the constructor instead.)
    const _on = this.on;
    this.on = ((event: any, listener: any) => {
      this.removeAllListeners(event);
      return _on.call(this, event, listener);
    }) as typeof this.on;
  }


  /**
   * Detaches the combobox behavior from an input, and removes any open dropdown.
   * @param $input  - the input selection to detach the combobox from
   * @param context - Global shared application context
   */
  public static off($input: D3Selection, context: Context): void {
    $input
      .on('focus.combo-input', null)
      .on('blur.combo-input', null)
      .on('keydown.combo-input', null)
      .on('keyup.combo-input', null)
      .on('input.combo-input', null)
      .on('mousedown.combo-input', null)
      .on('mouseup.combo-input', null);

    context.container()
      .on('scroll.combo-scroll', null);
  }


  /**
   * Gets or sets whether the combobox autocompletes the input as the user types.
   * @param val - the new value, or omit to get the current value
   * @return the current value (getter) or `this` (setter)
   */
  public canAutocomplete(): boolean;
  public canAutocomplete(val: boolean): this;
  public canAutocomplete(val?: boolean): boolean | this {
    if (val === undefined) return this._canAutocomplete;
    this._canAutocomplete = val;
    return this;
  }


  /**
   * Gets or sets whether matching is case-sensitive.
   * @param val - the new value, or omit to get the current value
   * @return the current value (getter) or `this` (setter)
   */
  public caseSensitive(): boolean;
  public caseSensitive(val: boolean): this;
  public caseSensitive(val?: boolean): boolean | this {
    if (val === undefined) return this._caseSensitive;
    this._caseSensitive = val;
    return this;
  }


  /**
   * Gets or sets the static suggestion data used by the default fetcher.
   * @param val - the new data, or omit to get the current data
   * @return the current data (getter) or `this` (setter)
   */
  public data(): UiComboboxDatum[];
  public data(val: UiComboboxDatum[]): this;
  public data(val?: UiComboboxDatum[]): UiComboboxDatum[] | this {
    if (val === undefined) return this._data;
    this._data = val;
    return this;
  }


  /**
   * Gets or sets the function that fetches suggestions for the current input value.
   * @param val - the new fetcher, or omit to get the current fetcher
   * @return the current fetcher (getter) or `this` (setter)
   */
  public fetcher(): UiComboboxFetcher;
  public fetcher(val: UiComboboxFetcher): this;
  public fetcher(val?: UiComboboxFetcher): UiComboboxFetcher | this {
    if (val === undefined) return this._fetcher;
    this._fetcher = val;
    return this;
  }


  /**
   * Gets or sets the minimum number of suggestions required before the dropdown shows.
   * @param val - the new value, or omit to get the current value
   * @return the current value (getter) or `this` (setter)
   */
  public minItems(): number;
  public minItems(val: number): this;
  public minItems(val?: number): number | this {
    if (val === undefined) return this._minItems;
    this._minItems = val;
    return this;
  }


  /**
   * Gets or sets a handler called when the pointer enters a suggestion row.
   * @param val - the new handler, or omit to get the current handler
   * @return the current handler (getter) or `this` (setter)
   */
  public itemsMouseEnter(): any;
  public itemsMouseEnter(val: any): this;
  public itemsMouseEnter(val?: any): any {
    if (val === undefined) return this._mouseEnterHandler;
    this._mouseEnterHandler = val;
    return this;
  }


  /**
   * Gets or sets a handler called when the pointer leaves a suggestion row.
   * @param val - the new handler, or omit to get the current handler
   * @return the current handler (getter) or `this` (setter)
   */
  public itemsMouseLeave(): any;
  public itemsMouseLeave(val: any): this;
  public itemsMouseLeave(val?: any): any {
    if (val === undefined) return this._mouseLeaveHandler;
    this._mouseLeaveHandler = val;
    return this;
  }


  /**
   * Attaches the combobox behavior to an `<input>` or `<textarea>`.
   * @param $input    - the input selection to attach the combobox to
   * @param $attachTo - optional selection the dropdown should be positioned against
   */
  public attach($input: D3Selection, $attachTo?: D3Selection): void {
    if (!$input || $input.empty()) return;

    this.$input = $input;
    this.$attachTo = $attachTo ?? null;

    $input
      .classed('combobox-input', true)
      .on('focus.combo-input', this._focus)
      .on('blur.combo-input', this._blur)
      .on('keydown.combo-input', this._keydown)
      .on('keyup.combo-input', this._keyup)
      .on('input.combo-input', this._change)
      .on('mousedown.combo-input', this._mousedown)
      .each((d, i, nodes) => {
        const el = nodes[i] as any;
        const parent = el.parentNode;
        const sibling = el.nextSibling;

        select(parent).selectAll('.combobox-caret')
          .filter(d2 => d2 === $input.node())
          .data([$input.node()])
          .enter()
          .insert('div', () => sibling)
          .attr('class', 'combobox-caret')
          .on('mousedown.combo-caret', (d3_event: MouseEvent) => {
            d3_event.preventDefault();  // don't steal focus from input
            $input.node().focus();      // focus the input as if it was clicked
            this._mousedown(d3_event);
          })
          .on('mouseup.combo-caret', (d3_event: MouseEvent) => {
            d3_event.preventDefault();  // don't steal focus from input
            this._mouseup(d3_event);
          });
      });
  }


  /**
   * On mouse-button down: records the timestamp (for double-click detection) and
   * clears any text selection that would interfere with the caret toggle.
   * @param d3_event - the triggering mouse event
   */
  protected _mousedown(d3_event: MouseEvent): void {
    const $input = this.$input;
    if (!$input) return;
    if (d3_event.button !== 0) return;    // left click only
    this._tDown = +new Date();

    // clear selection
    const start = $input.property('selectionStart');
    const end = $input.property('selectionEnd');
    if (start !== end) {
      const val = utilGetSetValue($input) as string;
      $input.node().setSelectionRange(val.length, val.length);
      return;
    }

    $input.on('mouseup.combo-input', this._mouseup);
  }


  /**
   * On mouse-button up: shows or hides the dropdown, debounced to ignore double-clicks.
   * @param d3_event - the triggering mouse event
   */
  protected _mouseup(d3_event: MouseEvent): void {
    const scheduler = this.context.systems.scheduler;   // optional
    const $container = this.$container;
    const $input = this.$input;
    if (!$input) return;

    $input.on('mouseup.combo-input', null);
    if (d3_event.button !== 0) return;    // left click only
    if ($input.node() !== document.activeElement) return;   // exit if this input is not focused

    const start = $input.property('selectionStart');
    const end = $input.property('selectionEnd');
    if (start !== end) return;  // exit if user is selecting

    // not showing or showing for a different field - try to show it.
    const $combo = $container.selectAll('.combobox');
    if ($combo.empty() || $combo.datum() !== $input.node()) {
      const tOrig = this._tDown;
      const showCombo = () => {
        if (tOrig !== this._tDown) return;   // exit if user double clicked
        this._fetchComboData('', () => {
          this._show();
          this._render();
        });
      };
      if (scheduler) {
        scheduler.setTimeout('ui-combobox-show', showCombo, { ms: 250 });
      } else {
        showCombo();
      }

    } else {
      this._hide();
    }
  }


  /**
   * On focus: prefetches suggestions so the dropdown is ready when the user starts typing.
   * Also warms external caches (e.g. taginfo).
   */
  protected _focus(): void {
    this._fetchComboData('');   // prefetch values (may warm taginfo cache)
  }


  /**
   * On blur: hides the dropdown after a short delay (allows a click on an option to register first).
   */
  protected _blur(): void {
    const scheduler = this.context.systems.scheduler;   // optional
    if (scheduler) {
      scheduler.setTimeout('ui-combobox-hide', this._hide, { ms: 75 });
    } else {
      this._hide();
    }
  }


  /**
   * Inserts the dropdown element into the container and wires scroll tracking.
   */
  protected _show(): void {
    const $container = this.$container;
    const $input = this.$input;
    if (!$input) return;

    this._hide();   // remove any existing

    $container
      .insert('div', ':first-child')
      .datum($input.node())
      .attr('class', 'combobox' + (this._klass ? ' combobox-' + this._klass : ''))
      .style('position', 'absolute')
      .style('display', 'block')
      .style('left', '0px')
      .on('mousedown.combo-container', (d3_event: MouseEvent) => {
        // prevent moving focus out of the input field
        d3_event.preventDefault();
      });

    $container
      .on('scroll.combo-scroll', this._render, true);
  }


  /**
   * Removes the dropdown element and cancels any pending hide timer.
   */
  protected _hide(): void {
    const scheduler = this.context.systems.scheduler;   // optional
    const $container = this.$container;

    scheduler?.cancel('ui-combobox-hide');

    $container.selectAll('.combobox')
      .remove();

    $container
      .on('scroll.combo-scroll', null);
  }


  /**
   * Handles keyboard navigation (arrows, Tab, Return, Backspace/Delete) while the input is focused.
   * @param d3_event - the triggering keyboard event
   */
  protected _keydown(d3_event: KeyboardEvent): void {
    const $container = this.$container;
    const $input = this.$input;
    if (!$input) return;

    const shown = !$container.selectAll('.combobox').empty();
    const tagName = $input.node() ? $input.node().tagName.toLowerCase() : '';

    switch (d3_event.keyCode) {
      case 8:   // ⌫ Backspace
      case 46:  // ⌦ Delete
        d3_event.stopPropagation();
        this._selected = null;
        this._render();
        $input.on('input.combo-input', () => {
          const start = $input.property('selectionStart');
          $input.node().setSelectionRange(start, start);
          $input.on('input.combo-input', this._change);
        });
        break;

      case 9:   // ⇥ Tab
        this._accept(d3_event);
        break;

      case 13:  // ↩ Return
        d3_event.preventDefault();
        d3_event.stopPropagation();
        break;

      case 38:  // ↑ Up arrow
        if (tagName === 'textarea' && !shown) return;
        d3_event.preventDefault();
        if (tagName === 'input' && !shown) {
          this._show();
        }
        this._nav(-1);
        break;

      case 40:  // ↓ Down arrow
        if (tagName === 'textarea' && !shown) return;
        d3_event.preventDefault();
        if (tagName === 'input' && !shown) {
          this._show();
        }
        this._nav(+1);
        break;
    }
  }


  /**
   * Handles Escape (cancel) and Return (accept) on key-up.
   * @param d3_event - the triggering keyboard event
   */
  protected _keyup(d3_event: KeyboardEvent): void {
    switch (d3_event.keyCode) {
      case 27:  // ⎋ Escape
        this._cancel();
        break;

      case 13:  // ↩ Return
        this._accept(d3_event);
        break;
    }
  }


  /**
   * Reacts to input value changes: fetches new suggestions, runs autocomplete, and updates the dropdown.
   */
  protected _change(): void {
    const $container = this.$container;
    const $input = this.$input;
    if (!$input) return;

    this._fetchComboData(this._value(), () => {
      this._selected = null;
      const val = $input.property('value');

      if (this._suggestions.length) {
        if ($input.property('selectionEnd') === val.length) {
          this._selected = this._tryAutocomplete() ?? null;
        }

        if (!this._selected) {
          this._selected = val;
        }
      }

      if (val.length) {
        const $combo = $container.selectAll('.combobox');
        if ($combo.empty()) {
          this._show();
        }
      } else {
        this._hide();
      }

      this._render();
    });
  }


  /**
   * Moves the highlighted selection up or down in the suggestion list.
   * @param dir - `+1` to move down, `-1` to move up
   */
  protected _nav(dir: number): void {
    const $input = this.$input;
    if (!$input) return;

    if (this._suggestions.length) {
      // try to determine previously selected index..
      let index = -1;
      for (let i = 0; i < this._suggestions.length; i++) {
        if (this._selected && this._suggestions[i].value === this._selected) {
          index = i;
          break;
        }
      }

      // pick new _selected
      index = Math.max(Math.min(index + dir, this._suggestions.length - 1), 0);
      this._selected = this._suggestions[index].value;
      $input.property('value', this._selected);
    }

    this._render();
    this._ensureVisible();
  }


  /**
   * Scrolls the container or the highlighted option into view if the dropdown overflows.
   */
  protected _ensureVisible(): void {
    const $container = this.$container;
    const $input = this.$input;
    if (!$input) return;

    const $combo = $container.selectAll('.combobox');
    if ($combo.empty()) return;

    const containerRect = ($container.node() as HTMLElement).getBoundingClientRect();
    const comboRect = ($combo.node() as HTMLElement).getBoundingClientRect();

    if (comboRect.bottom > containerRect.bottom) {
      const node = (this.$attachTo ? this.$attachTo.node() : $input.node()) as HTMLElement;
      node.scrollIntoView({ behavior: 'instant', block: 'center' });
      this._render();
    }

    // https://stackoverflow.com/questions/11039885/scrollintoview-causing-the-whole-page-to-move
    const selected = $combo.selectAll('.combobox-option.selected').node() as HTMLElement | null;
    if (selected) {
      selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }


  /**
   * Returns the portion of the input's current text value up to the selection start,
   * so autocomplete only considers what the user has actually typed.
   * @return the effective input string
   */
  protected _value(): string {
    const $input = this.$input!;
    let value = $input.property('value');
    const start = $input.property('selectionStart');
    const end = $input.property('selectionEnd');

    if (start && end) {
      value = value.substring(0, start);
    }

    return value;
  }


  /**
   * Invokes the configured fetcher and updates `_suggestions`/`_fetched`, then calls `cb`.
   * A stale fetch (superseded by a newer one) is silently discarded via `_cancelFetch`.
   * @param v  - the current input value to fetch suggestions for
   * @param cb - optional callback invoked after suggestions are loaded
   */
  protected _fetchComboData(v: string, cb?: () => void): void {
    this._cancelFetch = false;

    this._fetcher.call(this.$input, v, (results: UiComboboxDatum[]) => {
      // already chose a value, don't overwrite or autocomplete it
      if (this._cancelFetch) return;

      this._suggestions = results;
      results.forEach(d => { this._fetched[d.value] = d; });

      cb?.();
    });
  }


  /**
   * Attempts to complete the input value to the best matching suggestion and selects the
   * completed suffix so the user can keep typing to override it.
   * @return the completed value, or `undefined` if no completion was applied
   */
  protected _tryAutocomplete(): string | undefined {
    if (!this._canAutocomplete) return;

    const $input = this.$input!;
    const val = this._caseSensitive ? this._value() : this._value().toLowerCase();
    if (!val) return;

    // Don't autocomplete if user is typing a number - iD#4935
    if (!isNaN(parseFloat(val)) && isFinite(val as any)) return;

    let bestIndex = -1;
    for (let i = 0; i < this._suggestions.length; i++) {
      const suggestion = this._suggestions[i].value;
      const compare = this._caseSensitive ? suggestion : suggestion.toLowerCase();

      // if search string matches suggestion exactly, pick it..
      if (compare === val) {
        bestIndex = i;
        break;

      // otherwise lock in the first result that starts with the search string..
      } else if (bestIndex === -1 && compare.indexOf(val) === 0) {
        bestIndex = i;
      }
    }

    if (bestIndex !== -1) {
      const bestVal = this._suggestions[bestIndex].value;
      $input.property('value', bestVal);
      $input.node().setSelectionRange(val.length, bestVal.length);
      return bestVal;
    }
  }


  /**
   * Syncs the visible dropdown options with `_suggestions` and positions the dropdown
   * relative to the input (or the `$attachTo` element). Hides if there are too few suggestions.
   */
  protected _render(): void {
    const $container = this.$container;
    const $input = this.$input;
    if (!$input) return;

    if (this._suggestions.length < this._minItems || document.activeElement !== $input.node()) {
      this._hide();
      return;
    }

    const shown = !$container.selectAll('.combobox').empty();
    if (!shown) return;

    const $combo = $container.selectAll('.combobox');
    const $options: D3Selection = $combo.selectAll('.combobox-option')
      .data(this._suggestions, (d: any) => d.value);

    $options.exit()
      .remove();

    // enter/update
    $options.enter()
      .append('a')
      .attr('class', d => 'combobox-option ' + (d.klass || ''))
      .attr('title', d => d.title)
      .each((d, i, nodes) => {
        const $selection = select(nodes[i]);
        if (typeof d.display === 'function') {  // display function
          $selection.call(d.display);
        } else if (d.display) {                 // display html value
          $selection.html(utilSanitizeHTML(d.display));
        } else {                                // text value
          $selection.text(d.value);
        }
      })
      .on('mouseenter', this._mouseEnterHandler)
      .on('mouseleave', this._mouseLeaveHandler)
      .merge($options)
      .classed('selected', d => d.value === this._selected)
      .on('click.combo-option', this._accept)
      .order();

    const node = this.$attachTo ? this.$attachTo.node() : $input.node();
    const containerRect = ($container.node() as HTMLElement).getBoundingClientRect();
    const rect = (node as HTMLElement).getBoundingClientRect();

    $combo
      .style('left', (rect.left + 5 - containerRect.left) + 'px')
      .style('width', (rect.width - 10) + 'px')
      .style('top', (rect.height + rect.top - containerRect.top) + 'px');
  }


  /**
   * Commits the current value: writes it back to the input, emits `accept` with the
   * matching datum, and hides the dropdown.
   * @param d3_event - the triggering event (Tab, Return, or option click)
   * @param d        - the suggestion datum if the user clicked an option directly
   */
  protected _accept(d3_event: Event, d?: UiComboboxDatum): void {
    const $input = this.$input!;

    this._cancelFetch = true;
    const el = $input.node();

    if (d) {   // user clicked on a suggestion
      utilGetSetValue($input, d.value);    // replace field contents
      $input.node()?.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    }

    // clear (and keep) selection
    const val = utilGetSetValue($input) as string;
    el.setSelectionRange(val.length, val.length);

    d = this._fetched[val];
    this.emit('accept', d, val);
    this._hide();
  }


  /**
   * Discards any autocompleted suffix, restores the typed portion, emits `cancel`, and hides the dropdown.
   */
  protected _cancel(): void {
    const $input = this.$input!;

    this._cancelFetch = true;
    const el = $input.node();

    // clear (and remove) selection, and replace field contents
    let val = utilGetSetValue($input) as string;
    const start = $input.property('selectionStart');
    const end = $input.property('selectionEnd');
    val = val.slice(0, start) + val.slice(end);
    utilGetSetValue($input, val);
    el.setSelectionRange(val.length, val.length);

    this.emit('cancel');
    this._hide();
  }
}
