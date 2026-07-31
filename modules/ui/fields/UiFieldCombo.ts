import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';
import { drag as d3_drag } from 'd3-drag';
import { utilArrayUniq, utilUnicodeCharsCount } from '@rapid-sdk/util';
import { iso1A2Code } from '@rapideditor/country-coder';

import { uiCombobox } from '../combobox.js';
import { utilKeybinding } from '../../util/keybinding.ts';
import { utilGetSetValue, utilNoAuto, utilRebind } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Tags } from './types.ts';

export {
  UiFieldCombo as UiFieldManyCombo,
  UiFieldCombo as UiFieldMultiCombo,
  UiFieldCombo as UiFieldNetworkCombo,
  UiFieldCombo as UiFieldSemiCombo,
  UiFieldCombo as UiFieldTypeCombo
};


export class UiFieldCombo {
  public context: Context;
  public dispatch: any;
  /** Added at runtime by `utilRebind` */
  public on!: (...args: any[]) => any;

  protected _uifield: any;
  protected _isMulti: boolean;
  protected _isNetwork: boolean;
  protected _isSemi: boolean;
  protected _optarray: any;
  protected _showTagInfoSuggestions: boolean;
  protected _allowCustomValues: boolean;
  protected _snake_case: boolean;
  protected _combobox: any;
  public $container: D3Selection;
  protected _inputWrap: D3Selection;
  public $input: D3Selection;
  protected _comboData: any[];
  protected _multiData: any[];
  protected _entityIDs: EntityID[];
  protected _tags: Tags;
  protected _countryCode: string | undefined;
  protected _staticPlaceholder: string;

  public constructor(context: Context, uifield: any) {
    const presetField = uifield.presetField;

    this.context = context;
    this._uifield = uifield;

    this._isMulti = (uifield.type === 'multiCombo' || uifield.type === 'manyCombo');
    this._isNetwork = (uifield.type === 'networkCombo');
    this._isSemi = (uifield.type === 'semiCombo');
    this._optarray = presetField.props.options;
    this._showTagInfoSuggestions = uifield.type !== 'manyCombo' && presetField.props.autoSuggestions !== false;
    this._allowCustomValues = uifield.type !== 'manyCombo' && presetField.props.customValues !== false;
    this._snake_case = (presetField.props.snake_case || (presetField.props.snake_case === undefined));
    this._combobox = uiCombobox(context, 'combo-' + uifield.safeid)
      .caseSensitive(presetField.props.caseSensitive)
      .minItems(this._isMulti || this._isSemi ? 1 : 2);
    this.$container = d3_select(null);
    this._inputWrap = d3_select(null);
    this.$input = d3_select(null);
    this._comboData = [];
    this._multiData = [];
    this._entityIDs = [];
    this._tags = {};
    this._countryCode = undefined;
    this._staticPlaceholder = '';

    // ensure multiCombo field.key ends with a ':'
    if (this._isMulti && uifield.key && /[^:]$/.test(uifield.key)) {
      uifield.key += ':';
    }

    this.render = this.render.bind(this);
    this._initCombo = this._initCombo.bind(this);
    this._setTaginfoValues = this._setTaginfoValues.bind(this);
    this._setPlaceholder = this._setPlaceholder.bind(this);
    this._change = this._change.bind(this);
    this._removeMultikey = this._removeMultikey.bind(this);

    this.dispatch = d3_dispatch('change');
    utilRebind(this as any, this.dispatch, 'on');
  }


  /** @param s - The string to convert to snake_case */
  protected _snake(s: string): string {
    return s.replace(/\s+/g, '_').toLowerCase();
  }

  /** @param s - The string to normalize (trims each `;`-separated part) */
  protected _clean(s: string): string {
    return s.split(';').map(s => s.trim()).join(';');
  }


  // returns the tag value for a display value
  // (for multiCombo, dval should be the key suffix, not the entire key)
  /** @param dval - The display value (for multiCombo, the key suffix) */
  protected _tagValue(dval: string): string | undefined {
    const uifield = this._uifield;

    dval = this._clean(dval || '');

    const found = this._comboData.find(o => {
      return o.key && this._clean(o.value) === dval;
    });
    if (found) return found.key;

    if (uifield.type === 'typeCombo' && !dval) {
      return 'yes';
    }

    return (this._snake_case ? this._snake(dval) : dval) || undefined;
  }


  // returns the display value for a tag value
  // (for multiCombo, tval should be the key suffix, not the entire key)
  /** @param tval - The tag value (for multiCombo, the key suffix) */
  protected _displayValue(tval: string): string {
    const l10n = this.context.systems.l10n!;
    const uifield = this._uifield;

    tval = tval || '';

    const stringID = `_tagging.presets.fields.${uifield.id}.options.${tval}`;
    if (l10n.hasTextForStringID(stringID)) {
      return l10n.t(stringID, { default: tval });
    }

    if (uifield.type === 'typeCombo' && tval.toLowerCase() === 'yes') {
      return '';
    }

    return tval;
  }


  // Compute the difference between arrays of objects by `value` property
  //
  // objectDifference([{value:1}, {value:2}, {value:3}], [{value:2}])
  // > [{value:1}, {value:3}]
  //
  /**
   * @param a - The array to subtract from
   * @param b - The array of objects to exclude (matched by `value`)
   */
  protected _objectDifference(a: any[], b: any[]): any[] {
    return a.filter(d1 => {
      return !b.some(d2 => {
        return !d2.isMixed && d1.value === d2.value;
      });
    });
  }


  /**
   * Wires up the combobox behavior (and taginfo suggestions) on the input.
   * @param $selection - The input selection to attach the combobox to
   * @param $attachTo  - Optional selection the dropdown should be positioned against
   */
  protected _initCombo($selection: D3Selection, $attachTo?: D3Selection): void {
    const context = this.context;

    if (!this._allowCustomValues) {
      $selection.attr('readonly', 'readonly');
    }

    const taginfo = context.services.taginfo as any;
    if (taginfo && this._showTagInfoSuggestions) {
      $selection.call(this._combobox.fetcher(this._setTaginfoValues), $attachTo);
      this._setTaginfoValues('', this._setPlaceholder);
    } else {
      $selection.call(this._combobox, $attachTo);
      this._setStaticValues(this._setPlaceholder);
    }
  }


  /**
   * Populates the combobox from the field's static option list.
   * @param callback - Optional callback receiving the computed combo data
   */
  protected _setStaticValues(callback?: (data: any[]) => void): void {
    const l10n = this.context.systems.l10n!;
    const uifield = this._uifield;

    if (!this._optarray) return;

    this._comboData = this._optarray.map((v: string) => {
      const stringID = `_tagging.presets.fields.${uifield.id}.options.${v}`;
      return {
        key: v,
        value: l10n.t(stringID, { default: v }),
        title: v,
        display: l10n.tHtml(stringID, { default: v }),
        klass: l10n.hasTextForStringID(stringID) ? '' : 'raw-option'
      };
    });

    this._combobox.data(this._objectDifference(this._comboData, this._multiData));
    callback?.(this._comboData);
  }


  /**
   * Populates the combobox from taginfo suggestions for the given query.
   * @param q        - The query text to look up
   * @param callback - Optional callback receiving the computed combo data
   */
  protected _setTaginfoValues(q: string, callback?: (data: any[]) => void): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;
    const uifield = this._uifield;

    const taginfo = context.services.taginfo as any;
    const graph = editor.staging.graph;

    if (!taginfo) {
      this._comboData = [];
      callback?.(this._comboData);
      return;
    }

    const fn = this._isMulti ? taginfo.multikeys : taginfo.values;
    let query = (this._isMulti ? uifield.key : '') + q;
    const hasCountryPrefix = this._isNetwork && this._countryCode && this._countryCode.indexOf(q.toLowerCase()) === 0;
    if (hasCountryPrefix) {
      query = this._countryCode + ':';
    }

    const params: any = {
      debounce: (q !== ''),
      key: uifield.key,
      query: query
    };

    if (this._entityIDs.length) {
      const entity = graph.entity(this._entityIDs[0]);
      params.geometry = entity.geometry(graph);
    }

    fn(params, (err: any, data: any) => {
      if (err) return;

      data = data.filter((d: any) => {
        if (uifield.type === 'typeCombo' && d.value === 'yes') {
          // don't show the fallback value
          return false;
        }

        // don't show values with very low usage
        return !d.count || d.count > 10;
      });

      // don't suggest deprecated tag values
      const deprecatedValues = schema.getScope('osm').deprecatedValues[uifield.key];
      if (deprecatedValues) {
        data = data.filter((d: any) => {
          return deprecatedValues.indexOf(d.value) === -1;
        });
      }

      if (hasCountryPrefix) {
        data = data.filter((d: any) => {
          return d.value.toLowerCase().indexOf(this._countryCode + ':') === 0;
        });
      }

      // hide the caret if there are no suggestions
      this.$container.classed('empty-combobox', data.length === 0);

      this._comboData = data.map((d: any) => {
        let k = d.value;
        if (this._isMulti) k = k.replace(uifield.key, '');
        const stringID = `_tagging.presets.fields.${uifield.id}.options.${k}`;
        const label = l10n.t(stringID, { default: k });
        return {
          key: k,
          value: label,
          display: l10n.tHtml(stringID, { default: k }),
          title: d.title || label,
          klass: l10n.hasTextForStringID(stringID) ? '' : 'raw-option'
        };
      });

      this._comboData = this._objectDifference(this._comboData, this._multiData);
      callback?.(this._comboData);
    });
  }


  /**
   * Updates the input placeholder based on the available values.
   * @param values - The combo data values used to build the placeholder
   */
  protected _setPlaceholder(values: any[]): void {
    const l10n = this.context.systems.l10n!;
    const uifield = this._uifield;

    if (this._isMulti || this._isSemi) {
      this._staticPlaceholder = uifield.placeholder || l10n.t('inspector.add');
    } else {
      const vals = values
        .map(d => d.value)
        .filter(s => s.length < 20);

      const placeholders = vals.length > 1 ? vals : values.map(d => d.key);
      this._staticPlaceholder = uifield.placeholder || placeholders.slice(0, 3).join(', ');
    }

    if (!/(…|\.\.\.)$/.test(this._staticPlaceholder)) {
      this._staticPlaceholder += '…';
    }

    let ph;
    if (!this._isMulti && !this._isSemi && this._tags && Array.isArray(this._tags[uifield.key])) {
      ph = l10n.t('inspector.multiple_values');
    } else {
      ph =  this._staticPlaceholder;
    }

    this.$container.selectAll('input')
      .attr('placeholder', ph);
  }


  /** Reads the current input value(s) and dispatches the resulting tag change. */
  protected _change(): void {
    const context = this.context;
    const scheduler = context.systems.scheduler;  // optional
    const uifield = this._uifield;

    const t: Tags = {};
    let val;

    if (this._isMulti || this._isSemi) {
      val = this._tagValue(utilGetSetValue(this.$input) as string) || '';
      this.$container.classed('active', false);
      utilGetSetValue(this.$input, '');

      const vals = val.split(';').filter(Boolean);
      if (!vals.length) return;

      if (this._isMulti) {
        utilArrayUniq(vals).forEach(v => {
          let key = (uifield.key || '') + v;
          if (this._tags) {
            // don't set a multicombo value to 'yes' if it already has a non-'no' value
            // e.g. `language:de=main`
            const old = this._tags[key];
            if (typeof old === 'string' && old.toLowerCase() !== 'no') return;
          }
          key = context.cleanTagKey(key);
          uifield.keys.push(key);
          t[key] = 'yes';
        });

      } else if (this._isSemi) {
        let arr = this._multiData.map(d => d.key);
        arr = arr.concat(vals);
        t[uifield.key] = context.cleanTagValue(utilArrayUniq(arr).filter(Boolean).join(';'));
      }

      if (scheduler) {
        scheduler.setTimeout('ui-combo-focus', () => { this.$input.node().focus(); }, { ms: 10 });
      } else {
        this.$input.node().focus();
      }

    } else {
      const rawValue = utilGetSetValue(this.$input) as string;

      // don't override multiple values with blank string
      if (!rawValue && Array.isArray(this._tags[uifield.key])) return;

      val = context.cleanTagValue(this._tagValue(rawValue) ?? '');
      t[uifield.key] = val || undefined;
    }

    this.dispatch.call('change', this, t);
  }


  /** Returns true if the current entity is a Rapid (AI-suggested) feature. */
  protected _isRapidFeature(): boolean {
    const rapid = this.context.systems.rapid!;
    const entityID = this._entityIDs?.length && this._entityIDs[0];
    return !!entityID && rapid.acceptIDs.has(entityID);
  }


  /**
   * Removes a multi/semi combo value and dispatches the tag change.
   * @param d3_event - The triggering DOM event
   * @param d        - The chip datum to remove
   */
  protected _removeMultikey(d3_event: Event, d: any): void {
    const uifield = this._uifield;
    const key = uifield.key;

    d3_event.preventDefault();
    d3_event.stopPropagation();

    // Don't allow user to remove source of a rapid feature
    if (key === 'source' && this._isRapidFeature()) return;

    const t: Tags = {};
    if (this._isMulti) {
      t[d.key] = undefined;
    } else if (this._isSemi) {
      let arr = this._multiData.map(md => {
        return md.key === d.key ? null : md.key;
      }).filter(Boolean);

      arr = utilArrayUniq(arr);
      t[key] = arr.length ? arr.join(';') : undefined;
    }
    this.dispatch.call('change', this, t);
  }


  /**
   * Renders the content into the given selection.
   * This component is handed its target selection by its parent on each render, so it
   *  renders into `$selection` directly rather than capturing `$parent` for re-render.
   * @param $selection - A d3-selection to the HTMLElement this component renders into
   */
  public render($selection: D3Selection): void {
    const context = this.context;
    const scheduler = context.systems.scheduler;  // optional
    const uifield = this._uifield;

    this.$container = $selection.selectAll('.form-field-input-wrap')
      .data([0]);

    const type = (this._isMulti || this._isSemi) ? 'multicombo' : 'combo';
    this.$container = this.$container.enter()
      .append('div')
      .attr('class', 'form-field-input-wrap form-field-input-' + type)
      .merge(this.$container);

    if (this._isMulti || this._isSemi) {
      this.$container = this.$container.selectAll('.chiplist')
        .data([0]);

      let listClass = 'chiplist';

      // Use a separate line for each value in the Destinations and Via fields
      // to mimic highway exit signs
      if (uifield.key === 'destination' || uifield.key === 'via') {
        listClass += ' full-line-chips';
      }

      this.$container = this.$container.enter()
        .append('ul')
        .attr('class', listClass)
        .on('click', () => {
          if (scheduler) {
            scheduler.setTimeout('ui-combo-focus', () => { this.$input.node().focus(); }, { ms: 10 });
          } else {
            this.$input.node().focus();
          }
        })
        .merge(this.$container);


      this._inputWrap = this.$container.selectAll('.input-wrap')
        .data([0]);

      this._inputWrap = this._inputWrap.enter()
        .append('li')
        .attr('class', 'input-wrap')
        .merge(this._inputWrap);

      this.$input = this._inputWrap.selectAll('input')
        .data([0]);
    } else {
      this.$input = this.$container.selectAll('input')
        .data([0]);
    }

    this.$input = this.$input.enter()
      .append('input')
      .attr('type', 'text')
      .attr('id', uifield.uid)
      .call(utilNoAuto)
      .call(this._initCombo, $selection)
      .merge(this.$input);

    if (this._isNetwork) {
      const extent = uifield.entityExtent;
      const countryCode = extent && iso1A2Code(extent.center());
      this._countryCode = countryCode && countryCode.toLowerCase();
    }

    this.$input
      .on('change', this._change)
      .on('blur', this._change);

    this.$input
      .on('keydown.field', (d3_event: KeyboardEvent) => {
        switch (d3_event.keyCode) {
          case 13: // ↩ Return
            this.$input.node().blur(); // blurring also enters the value
            d3_event.stopPropagation();
            break;
        }
      });

    if (this._isMulti || this._isSemi) {
      this._combobox
        .on('accept', () => {
          this.$input.node().blur();
          this.$input.node().focus();
        });

      this.$input
        .on('focus', () => { this.$container.classed('active', true); });
    }
  }


  /**
   * Updates the field UI to reflect the given entity tags.
   * @param tags - The entity tags to display
   */
  public tags(tags: Tags): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const uifield = this._uifield;

    this._tags = tags;
    const key = uifield.key;
    let keys = uifield.keys;

    if (this._isMulti || this._isSemi) {
      this._multiData = [];

      let maxLength = 0;

      if (this._isMulti) {
        // Build _multiData array containing keys already set..
        for (const k in tags) {
          if (key && k.indexOf(key) !== 0) continue;
          if (!key && keys.indexOf(k) === -1) continue;

          const v = tags[k];
          if (!v || (typeof v === 'string' && v.toLowerCase() === 'no')) continue;

          const suffix = key ? k.slice(key.length) : k;
          this._multiData.push({
            key: k,
            value: this._displayValue(suffix),
            isMixed: Array.isArray(v)
          });
        }

        if (key) {
          // Set keys for form-field modified (needed for undo and reset buttons)..
          keys = this._multiData.map(function (d) { return d.key; });

          // limit the input length so it fits after prepending the key prefix
          maxLength = context.maxCharsForTagKey - utilUnicodeCharsCount(key);
        } else {
          maxLength = context.maxCharsForTagKey;
        }

      } else if (this._isSemi) {

        let allValues: string[] = [];
        let commonValues: string[] | undefined;
        if (Array.isArray(tags[key])) {

          (tags[key] as string[]).forEach(function(tagVal) {
            const thisVals = utilArrayUniq((tagVal || '').split(';')).filter(Boolean);
            allValues = allValues.concat(thisVals);
            if (!commonValues) {
              commonValues = thisVals;
            } else {
              commonValues = commonValues.filter(value => thisVals.includes(value));
            }
          });
          allValues = utilArrayUniq(allValues).filter(Boolean);

        } else {
          allValues =  utilArrayUniq(((tags[key] as string) || '').split(';')).filter(Boolean);
          commonValues = allValues;
        }

        this._multiData = allValues.map((v) => {
          return {
            key: v,
            value: this._displayValue(v),
            isMixed: !commonValues!.includes(v)
          };
        });

        const currLength = utilUnicodeCharsCount(commonValues!.join(';'));

        // limit the input length to the remaining available characters
        maxLength = context.maxCharsForTagValue - currLength;

        if (currLength > 0) {
          // account for the separator if a new value will be appended to existing
          maxLength -= 1;
        }
      }
      // a negative maxlength doesn't make sense
      maxLength = Math.max(0, maxLength);

      const allowDragAndDrop = this._isSemi // only semiCombo values are ordered
        && !Array.isArray(tags[key]);

      // Exclude existing multikeys from combo options..
      const available = this._objectDifference(this._comboData, this._multiData);
      this._combobox.data(available);

      // Hide 'Add' button if this field uses fixed set of
      // options and they're all currently used,
      // or if the field is already at its character limit
      const hideAdd = (!this._allowCustomValues && !available.length) || maxLength <= 0;
      this.$container.selectAll('.chiplist .input-wrap')
        .style('display', hideAdd ? 'none' : null as any);


      // Render chips
      let $chips: D3Selection = this.$container.selectAll('.chip')
        .data(this._multiData);

      $chips.exit()
        .remove();

      const $$enter = $chips.enter()
        .insert('li', '.input-wrap')
        .attr('class', 'chip');

      $$enter.append('span');
      $$enter.append('a');

      $chips = $chips.merge($$enter)
        .order()
        .classed('raw-value', (d) => {
          let k = d.key;
          if (this._isMulti) k = k.replace(key, '');
          const stringID = `_tagging.presets.fields.${uifield.id}.placeholders.options.${k}`;
          return !l10n.hasTextForStringID(stringID);
        })
        .classed('draggable', allowDragAndDrop)
        .classed('mixed', function(d) {
          return d.isMixed;
        })
        .attr('title', function(d) {
          return d.isMixed ? l10n.t('inspector.unshared_value_tooltip') : null;
        });

      if (allowDragAndDrop) {
        this._registerDragAndDrop($chips);
      }

      $chips.select('span')
        .text((d: any) => d.value);

      // Don't show delete '×' on the source chip for rapid features
      if (!(uifield.key === 'source' && this._isRapidFeature())) {
        $chips.select('a')
          .attr('href', '#')
          .on('click', this._removeMultikey)
          .attr('class', 'remove')
          .text('×');
      }

    } else {
      const v = tags[key];
      const isMixed = Array.isArray(v);
      const mixedValues = isMixed && (v as string[]).map(val => this._displayValue(val)).filter(Boolean);

      const showsValue = !isMixed && v && !(uifield.type === 'typeCombo' && v === 'yes');
      const stringID = `_tagging.presets.fields.${uifield.id}.placeholders.options.${v}`;
      const isRawValue = showsValue && !l10n.hasTextForStringID(stringID);
      const isKnownValue = showsValue && !isRawValue;
      const isReadOnly = !this._allowCustomValues || isKnownValue;

      (utilGetSetValue(this.$input, !isMixed ? this._displayValue(v as string) : '') as D3Selection)
        .classed('raw-value', !!isRawValue)
        .classed('known-value', !!isKnownValue)
        .attr('readonly', isReadOnly ? 'readonly' : null)
        .attr('title', isMixed ? (mixedValues as string[]).join('\n') : null)
        .attr('placeholder', isMixed ? l10n.t('inspector.multiple_values') : this._staticPlaceholder || '')
        .classed('mixed', isMixed)
        .on('keydown.deleteCapture', (d3_event: KeyboardEvent) => {
          if (isReadOnly &&
            isKnownValue &&
            (d3_event.keyCode === utilKeybinding.keyCodes['⌫'] ||
            d3_event.keyCode === utilKeybinding.keyCodes['⌦'])) {

            d3_event.preventDefault();
            d3_event.stopPropagation();

            const t: Tags = {};
            t[key] = undefined;
            this.dispatch.call('change', this, t);
          }
        });
    }
  }


  /**
   * Enables drag-and-drop reordering of the chips in the given selection.
   * @param $selection - The chip selection to make draggable
   */
  protected _registerDragAndDrop($selection: D3Selection): void {
    const uifield = this._uifield;
    const key = uifield.key;
    const $container = this.$container;
    const multiData = this._multiData;
    const dispatch = this.dispatch;

    // allow drag and drop re-ordering of chips
    let dragOrigin: any, targetIndex: any;
    $selection.call(d3_drag<any, any>()
      .on('start', function(d3_event: any) {
        dragOrigin = {
          x: d3_event.x,
          y: d3_event.y
        };
        targetIndex = null;
      })
      .on('drag', function(this: any, d3_event: any) {
        const x = d3_event.x - dragOrigin.x,
          y = d3_event.y - dragOrigin.y;

        if (!d3_select(this).classed('dragging') &&
          // don't display drag until dragging beyond a distance threshold
          Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)) <= 5) return;

        const index = $selection.nodes().indexOf(this);

        d3_select(this)
          .classed('dragging', true);

        targetIndex = null;
        let targetIndexOffsetTop: number | null = null;
        const draggedTagWidth = d3_select(this).node().offsetWidth;

        if (key === 'destination' || key === 'via') { // meaning tags are full width
          $container.selectAll('.chip')
            .style('transform', function(this: any, d2, index2) {
              const node = d3_select(this).node();

              if (index === index2) {
                return 'translate(' + x + 'px, ' + y + 'px)';
              // move the dragged tag up the order
              } else if (index2 > index && d3_event.y > node.offsetTop) {
                if (targetIndex === null || index2 > targetIndex) {
                  targetIndex = index2;
                }
                return 'translateY(-100%)';
              // move the dragged tag down the order
              } else if (index2 < index && d3_event.y < node.offsetTop + node.offsetHeight) {
                if (targetIndex === null || index2 < targetIndex) {
                  targetIndex = index2;
                }
                return 'translateY(100%)';
              }
              return null;
            });
        } else {
          $container.selectAll('.chip')
            .each(function(this: any, d2, index2) {
              const node = d3_select(this).node();

              // check the cursor is in the bounding box
              if (
                index !== index2 &&
                d3_event.x < node.offsetLeft + node.offsetWidth + 5 &&
                d3_event.x > node.offsetLeft &&
                d3_event.y < node.offsetTop + node.offsetHeight &&
                d3_event.y > node.offsetTop
              ) {
                targetIndex = index2;
                targetIndexOffsetTop = node.offsetTop;
              }
            })
            .style('transform', function(this: any, d2, index2) {
              const node = d3_select(this).node();

              if (index === index2) {
                return 'translate(' + x + 'px, ' + y + 'px)';
              }

              // only translate tags in the same row
              if (node.offsetTop === targetIndexOffsetTop) {
                if (index2 < index && index2 >= targetIndex) {
                  return 'translateX(' + draggedTagWidth + 'px)';
                } else if (index2 > index && index2 <= targetIndex) {
                  return 'translateX(-' + draggedTagWidth + 'px)';
                }
              }
              return null;
            });
          }
      })
      .on('end', function(this: any) {
        if (!d3_select(this).classed('dragging')) {
          return;
        }
        const index = $selection.nodes().indexOf(this);

        d3_select(this)
          .classed('dragging', false);

        $container.selectAll('.chip')
          .style('transform', null);

        if (typeof targetIndex === 'number') {
          const element = multiData[index];
          multiData.splice(index, 1);
          multiData.splice(targetIndex, 0, element);

          const t: Tags = {};

          if (multiData.length) {
            t[key] = multiData.map(function(element) {
              return element.key;
            }).join(';');
          } else {
            t[key] = undefined;
          }

          dispatch.call('change', this, t);
        }
        dragOrigin = undefined;
        targetIndex = undefined;
      })
    );
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    this.$input.node().focus();
  }


  /**
   * Gets or sets the entity IDs this field is editing.
   * @param val - The entity IDs to set; if omitted, acts as a getter
   * @returns The current entity IDs (getter) or `this` (setter)
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._entityIDs;
    this._entityIDs = val || [];
    return this;
  }
}
