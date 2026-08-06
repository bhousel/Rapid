import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';
import { utilGetSetValue, utilRebind, utilSanitizeHTML } from '../util/index.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


// This code assumes that the combobox values will not have duplicate entries.
// It is keyed on the `value` of the entry. Data should be an array of objects like:
//   [{
//       value:   'string value',  // required
//       display: 'label html'     // optional html value or function
//       title:   'hover text'     // optional
//       terms:   ['search terms'] // optional
//   }, ...]


/** A single combobox suggestion. */
export interface UiComboboxDatum {
  value: string;
  display?: string | (($selection: D3Selection) => void);
  title?: string;
  terms?: string[];
  klass?: string;
}

/** Fetches combobox suggestions for the current input value. */
export type UiComboboxFetcher = (this: any, val: string, cb: (results: UiComboboxDatum[]) => void) => void;


/** A combobox control (callable + fluent), attached to an `<input>` or `<textarea>`. */
export interface UiCombobox {
  ($input: D3Selection, $attachTo?: D3Selection): void;
  canAutocomplete(): boolean;
  canAutocomplete(val: boolean): UiCombobox;
  caseSensitive(): boolean;
  caseSensitive(val: boolean): UiCombobox;
  data(): UiComboboxDatum[];
  data(val: UiComboboxDatum[]): UiCombobox;
  fetcher(): UiComboboxFetcher;
  fetcher(val: UiComboboxFetcher): UiCombobox;
  minItems(): number;
  minItems(val: number): UiCombobox;
  itemsMouseEnter(): any;
  itemsMouseEnter(val: any): UiCombobox;
  itemsMouseLeave(): any;
  itemsMouseLeave(val: any): UiCombobox;
  on(...args: any[]): UiCombobox;
}


/**
 * Creates a combobox control that attaches autocomplete/suggestion behavior to an
 * `<input>` or `<textarea>`. Configure with the fluent methods, then attach via
 * `input.call(combobox)`. Dispatches `accept` and `cancel` events.
 *
 * @param context - Global shared application context
 * @param klass   - optional extra class name added to the combobox element
 * @return the combobox control
 */
export function uiCombobox(context: Context, klass?: string): UiCombobox {
  const scheduler = context.systems.scheduler;  // optional

  const dispatch = d3_dispatch('accept', 'cancel');
  const $container = context.container();

  let _suggestions: UiComboboxDatum[] = [];
  let _data: UiComboboxDatum[] = [];
  const _fetched: Record<string, UiComboboxDatum> = {};
  let _selected: string | null = null;
  let _canAutocomplete = true;
  let _caseSensitive = false;
  let _cancelFetch = false;
  let _minItems = 2;
  let _tDown = 0;
  let _mouseEnterHandler: any, _mouseLeaveHandler: any;

  let _fetcher: UiComboboxFetcher = function(val, cb) {
    cb(_data.filter(function(d) {
      const terms = d.terms || [];
      terms.push(d.value);
      return terms.some(function(term) {
        return term
          .toString()
          .toLowerCase()
          .indexOf(val.toLowerCase()) !== -1;
      });
    }));
  };

  const combobox = function($input: D3Selection, $attachTo?: D3Selection): void {
    if (!$input || $input.empty()) return;

    $input
      .classed('combobox-input', true)
      .on('focus.combo-input', focus)
      .on('blur.combo-input', blur)
      .on('keydown.combo-input', keydown)
      .on('keyup.combo-input', keyup)
      .on('input.combo-input', change)
      .on('mousedown.combo-input', mousedown)
      .each(function(this: any) {
        const parent = this.parentNode;
        const sibling = this.nextSibling;

        d3_select(parent).selectAll('.combobox-caret')
          .filter(function(d) { return d === $input.node(); })
          .data([$input.node()])
          .enter()
          .insert('div', function() { return sibling; })
          .attr('class', 'combobox-caret')
          .on('mousedown.combo-caret', function(d3_event: MouseEvent) {
            d3_event.preventDefault(); // don't steal focus from input
            $input.node().focus(); // focus the input as if it was clicked
            mousedown(d3_event);
          })
          .on('mouseup.combo-caret', function(d3_event: MouseEvent) {
            d3_event.preventDefault(); // don't steal focus from input
            mouseup(d3_event);
          });
      });


    function mousedown(d3_event: MouseEvent): void {
      if (d3_event.button !== 0) return;    // left click only
      _tDown = +new Date();

      // clear selection
      const start = $input.property('selectionStart');
      const end = $input.property('selectionEnd');
      if (start !== end) {
        const val = utilGetSetValue($input) as string;
        $input.node().setSelectionRange(val.length, val.length);
        return;
      }

      $input.on('mouseup.combo-input', mouseup);
    }


    function mouseup(d3_event: MouseEvent): void {
      $input.on('mouseup.combo-input', null);
      if (d3_event.button !== 0) return;    // left click only
      if ($input.node() !== document.activeElement) return;   // exit if this input is not focused

      const start = $input.property('selectionStart');
      const end = $input.property('selectionEnd');
      if (start !== end) return;  // exit if user is selecting

      // not showing or showing for a different field - try to show it.
      const $combo = $container.selectAll('.combobox');
      if ($combo.empty() || $combo.datum() !== $input.node()) {
        const tOrig = _tDown;
        const showCombo = () => {
          if (tOrig !== _tDown) return;   // exit if user double clicked
          fetchComboData('', function() {
            show();
            render();
          });
        };
        if (scheduler) {
          scheduler.setTimeout('ui-combobox-show', showCombo, { ms: 250 });
        } else {
          showCombo();
        }

      } else {
        hide();
      }
    }


    function focus(): void {
      fetchComboData('');   // prefetch values (may warm taginfo cache)
    }


    function blur(): void {
      if (scheduler) {
        scheduler.setTimeout('ui-combobox-hide', hide, { ms: 75 });
      } else {
        hide();
      }
    }


    function show(): void {
      hide();   // remove any existing

      $container
        .insert('div', ':first-child')
        .datum($input.node())
        .attr('class', 'combobox' + (klass ? ' combobox-' + klass : ''))
        .style('position', 'absolute')
        .style('display', 'block')
        .style('left', '0px')
        .on('mousedown.combo-container', function (d3_event: MouseEvent) {
          // prevent moving focus out of the input field
          d3_event.preventDefault();
        });

      $container
        .on('scroll.combo-scroll', render, true);
    }


    function hide(): void {
      scheduler?.cancel('ui-combobox-hide');

      $container.selectAll('.combobox')
        .remove();

      $container
        .on('scroll.combo-scroll', null);
    }


    function keydown(d3_event: KeyboardEvent): void {
      const shown = !$container.selectAll('.combobox').empty();
      const tagName = $input.node() ? $input.node().tagName.toLowerCase() : '';

      switch (d3_event.keyCode) {
        case 8:   // ⌫ Backspace
        case 46:  // ⌦ Delete
          d3_event.stopPropagation();
          _selected = null;
          render();
          $input.on('input.combo-input', function() {
            const start = $input.property('selectionStart');
            $input.node().setSelectionRange(start, start);
            $input.on('input.combo-input', change);
          });
          break;

        case 9:   // ⇥ Tab
          accept(d3_event);
          break;

        case 13:  // ↩ Return
          d3_event.preventDefault();
          d3_event.stopPropagation();
          break;

        case 38:  // ↑ Up arrow
          if (tagName === 'textarea' && !shown) return;
          d3_event.preventDefault();
          if (tagName === 'input' && !shown) {
            show();
          }
          nav(-1);
          break;

        case 40:  // ↓ Down arrow
          if (tagName === 'textarea' && !shown) return;
          d3_event.preventDefault();
          if (tagName === 'input' && !shown) {
            show();
          }
          nav(+1);
          break;
      }
    }


    function keyup(d3_event: KeyboardEvent): void {
      switch (d3_event.keyCode) {
        case 27:  // ⎋ Escape
          cancel();
          break;

        case 13:  // ↩ Return
          accept(d3_event);
          break;
      }
    }


    // Called whenever the input value is changed (e.g. on typing)
    function change(): void {
      fetchComboData(value(), function() {
        _selected = null;
        const val = $input.property('value');

        if (_suggestions.length) {
          if ($input.property('selectionEnd') === val.length) {
            _selected = tryAutocomplete() ?? null;
          }

          if (!_selected) {
            _selected = val;
          }
        }

        if (val.length) {
          const $combo = $container.selectAll('.combobox');
          if ($combo.empty()) {
            show();
          }
        } else {
          hide();
        }

        render();
      });
    }


    // Called when the user presses up/down arrows to navigate the list
    function nav(dir: number): void {
      if (_suggestions.length) {
        // try to determine previously selected index..
        let index = -1;
        for (let i = 0; i < _suggestions.length; i++) {
          if (_selected && _suggestions[i].value === _selected) {
            index = i;
            break;
          }
        }

        // pick new _selected
        index = Math.max(Math.min(index + dir, _suggestions.length - 1), 0);
        _selected = _suggestions[index].value;
        $input.property('value', _selected);
      }

      render();
      ensureVisible();
    }


    function ensureVisible(): void {
      const $combo = $container.selectAll('.combobox');
      if ($combo.empty()) return;

      const containerRect = ($container.node() as HTMLElement).getBoundingClientRect();
      const comboRect = ($combo.node() as HTMLElement).getBoundingClientRect();

      if (comboRect.bottom > containerRect.bottom) {
        const node = ($attachTo ? $attachTo.node() : $input.node()) as HTMLElement;
        node.scrollIntoView({ behavior: 'instant', block: 'center' });
        render();
      }

      // https://stackoverflow.com/questions/11039885/scrollintoview-causing-the-whole-page-to-move
      const selected = $combo.selectAll('.combobox-option.selected').node() as HTMLElement | null;
      if (selected) {
        selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }


    function value(): string {
      let value = $input.property('value');
      const start = $input.property('selectionStart');
      const end = $input.property('selectionEnd');

      if (start && end) {
        value = value.substring(0, start);
      }

      return value;
    }


    function fetchComboData(v: string, cb?: () => void): void {
      _cancelFetch = false;

      _fetcher.call($input, v, function(results: UiComboboxDatum[]) {
        // already chose a value, don't overwrite or autocomplete it
        if (_cancelFetch) return;

        _suggestions = results;
        results.forEach(function(d) { _fetched[d.value] = d; });

        cb?.();
      });
    }


    function tryAutocomplete(): string | undefined {
      if (!_canAutocomplete) return;

      const val = _caseSensitive ? value() : value().toLowerCase();
      if (!val) return;

      // Don't autocomplete if user is typing a number - iD#4935
      if (!isNaN(parseFloat(val)) && isFinite(val as any)) return;

      let bestIndex = -1;
      for (let i = 0; i < _suggestions.length; i++) {
        const suggestion = _suggestions[i].value;
        const compare = _caseSensitive ? suggestion : suggestion.toLowerCase();

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
        const bestVal = _suggestions[bestIndex].value;
        $input.property('value', bestVal);
        $input.node().setSelectionRange(val.length, bestVal.length);
        return bestVal;
      }
    }


    function render(): void {
      if (_suggestions.length < _minItems || document.activeElement !== $input.node()) {
        hide();
        return;
      }

      const shown = !$container.selectAll('.combobox').empty();
      if (!shown) return;

      const $combo = $container.selectAll('.combobox');
      const $options: D3Selection = $combo.selectAll('.combobox-option')
        .data(_suggestions, function(d: any) { return d.value; });

      $options.exit()
        .remove();

      // enter/update
      $options.enter()
        .append('a')
        .attr('class', function(d) {
          return 'combobox-option ' + (d.klass || '');
        })
        .attr('title', function(d) { return d.title; })
        .each(function(d, i, nodes) {
          const $selection = d3_select(nodes[i]);
          if (typeof d.display === 'function') {  // display function
            $selection.call(d.display);
          } else if (d.display) {                 // display html value
            $selection.html(utilSanitizeHTML(d.display));
          } else {                                // text value
            $selection.text(d.value);
          }
        })
        .on('mouseenter', _mouseEnterHandler)
        .on('mouseleave', _mouseLeaveHandler)
        .merge($options)
        .classed('selected', function(d) { return d.value === _selected; })
        .on('click.combo-option', accept)
        .order();

      const node = $attachTo ? $attachTo.node() : $input.node();
      const containerRect = ($container.node() as HTMLElement).getBoundingClientRect();
      const rect = (node as HTMLElement).getBoundingClientRect();

      $combo
        .style('left', (rect.left + 5 - containerRect.left) + 'px')
        .style('width', (rect.width - 10) + 'px')
        .style('top', (rect.height + rect.top - containerRect.top) + 'px');
    }


    // Dispatches an 'accept' event
    // Then hides the combobox.
    function accept(d3_event: Event, d?: UiComboboxDatum): void {
      _cancelFetch = true;
      const el = $input.node();

      if (d) {   // user clicked on a suggestion
        utilGetSetValue($input, d.value);    // replace field contents
        $input.node()?.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      }

      // clear (and keep) selection
      const val = utilGetSetValue($input) as string;
      el.setSelectionRange(val.length, val.length);

      d = _fetched[val];
      dispatch.call('accept', el, d, val);
      hide();
    }


    // Dispatches an 'cancel' event
    // Then hides the combobox.
    function cancel(): void {
      _cancelFetch = true;
      const el = $input.node();

      // clear (and remove) selection, and replace field contents
      let val = utilGetSetValue($input) as string;
      const start = $input.property('selectionStart');
      const end = $input.property('selectionEnd');
      val = val.slice(0, start) + val.slice(end);
      utilGetSetValue($input, val);
      el.setSelectionRange(val.length, val.length);

      dispatch.call('cancel', el);
      hide();
    }

  } as UiCombobox;


  combobox.canAutocomplete = function(val?: boolean): any {
    if (!arguments.length) return _canAutocomplete;
    _canAutocomplete = val as boolean;
    return combobox;
  };

  combobox.caseSensitive = function(val?: boolean): any {
    if (!arguments.length) return _caseSensitive;
    _caseSensitive = val as boolean;
    return combobox;
  };

  combobox.data = function(val?: UiComboboxDatum[]): any {
    if (!arguments.length) return _data;
    _data = val as UiComboboxDatum[];
    return combobox;
  };

  combobox.fetcher = function(val?: UiComboboxFetcher): any {
    if (!arguments.length) return _fetcher;
    _fetcher = val as UiComboboxFetcher;
    return combobox;
  };

  combobox.minItems = function(val?: number): any {
    if (!arguments.length) return _minItems;
    _minItems = val as number;
    return combobox;
  };

  combobox.itemsMouseEnter = function(val?: any): any {
    if (!arguments.length) return _mouseEnterHandler;
    _mouseEnterHandler = val;
    return combobox;
  };

  combobox.itemsMouseLeave = function(val?: any): any {
    if (!arguments.length) return _mouseLeaveHandler;
    _mouseLeaveHandler = val;
    return combobox;
  };

  return utilRebind(combobox as any, dispatch as any, 'on') as unknown as UiCombobox;
}


uiCombobox.off = function($input: D3Selection, context: Context): void {
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
};
