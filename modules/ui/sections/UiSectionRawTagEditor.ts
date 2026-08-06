import { select as d3_select } from 'd3-selection';
import { utilArrayDifference, utilArrayIdentical, utilTagDiff } from '@rapid-sdk/util';
import { uiIcon } from '../icon.ts';
import { uiCombobox } from '../combobox.ts';
import { AbstractUiSection } from './AbstractUiSection.ts';
import { UiTagReference } from '../UiTagReference.ts';
import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';

import type { TagDiff } from '@rapid-sdk/util';
import type { Category } from '../../lib/Category.ts';
import type { Context } from '../../Context.ts';
import type { OsmTags } from '../../data/types.ts';
import type { Preset } from '../../lib/Preset.ts';
import type { Tags } from '../fields/types.ts';
import type { D3Selection } from 'd3-selection';


const AVAILABLE_VIEWS = [
  { id: 'list', icon: '#fas-th-list' },
  { id: 'text', icon: '#fas-i-cursor' }
];

type ViewOption = typeof AVAILABLE_VIEWS[number];

interface TagRow {
  index: number;
  key: string;
  value: string | string[];
}


function isMultiValueTag(d: { value: unknown }): boolean {
  return Array.isArray(d.value);
}

function stringify(s: string): string {
  return JSON.stringify(s).slice(1, -1);   // without leading/trailing "
}

function unstringify(s: string): string {
  let leading = '';
  let trailing = '';
  if (s.length < 1 || s.charAt(0) !== '"') {
    leading = '"';
  }
  if (s.length < 2 || s.charAt(s.length - 1) !== '"' ||
    (s.charAt(s.length - 1) === '"' && s.charAt(s.length - 2) === '\\')
  ) {
    trailing = '"';
  }
  return JSON.parse(leading + s + trailing);
}


export class UiSectionRawTagEditor extends AbstractUiSection {
  protected _discardKeys: Set<string>;
  protected _tagView: string;    // 'list', 'text'
  protected _readOnlyTags: RegExp[];
  protected _orderedKeys: string[];   // the keys in the order we want them to display
  protected _didFocus: boolean;
  protected _showBlank: boolean;
  protected _pendingChange: Record<string, string | undefined> | null;
  protected _state: string | undefined;    // can be 'hide', 'hover', or 'select'
  protected _presets: (Preset | Category)[] | undefined;
  protected _tags: Tags;
  protected _entityIDs: EntityID[];


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context, id: string) {
    super(context, id);
    this._classes = 'raw-tag-editor';

    const schema = context.systems.schema;
    const settings = context.systems.settings;

    this._discardKeys = new Set<string>();
    if (schema) {
      const osmScope = schema.getScope('osm');
      this._discardKeys = new Set(Object.keys(osmScope.discarded));
    }

    this._tagView = settings?.get('ui.rawTagEditorView') || 'list';
    this._readOnlyTags = [];
    this._orderedKeys = [];
    this._didFocus = false;
    this._showBlank = false;
    this._pendingChange = null;
    this._state = undefined;
    this._presets = undefined;
    this._tags = {};
    this._entityIDs = [];

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._isReadOnlyTag = this._isReadOnlyTag.bind(this);
    this._setTextareaHeight = this._setTextareaHeight.bind(this);
    this._onFocus = this._onFocus.bind(this);
    this._textChanged = this._textChanged.bind(this);
    this._pushMore = this._pushMore.bind(this);
    this._keyChange = this._keyChange.bind(this);
    this._valueChange = this._valueChange.bind(this);
    this._removeTag = this._removeTag.bind(this);
    this._addTag = this._addTag.bind(this);
  }


  /**
   * The disclosure heading label — "Tags (N)".
   * @return Localized heading text
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    const count = Object.keys(this._tags ?? {}).filter(Boolean).length;
    return l10n.t('inspector.title_count', { title: l10n.t('inspector.tags'), count: count });
  }


  /**
   * Renders the tag editor content (list/text views, add row, tag rows).
   * @param $wrap - A d3-selection to the HTMLElement this content renders into
   */
  public renderDisclosureContent($wrap: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const settings = context.systems.settings;
    const taginfo = context.services.taginfo;

    // remove deleted keys
    this._orderedKeys = this._orderedKeys.filter(k => this._tags[k] !== undefined);

    // When switching to a different entity or changing the state (hover/select)
    // reorder the keys alphabetically.
    // We trigger this by emptying the `_orderedKeys` array, then it will be rebuilt here.
    // Otherwise leave their order alone - iD#5857, iD#5927
    const all = Object.keys(this._tags).sort();
    const missingKeys = utilArrayDifference(all, this._orderedKeys);
    for (const i in missingKeys) {
      this._orderedKeys.push(missingKeys[i]);
    }

    // assemble row data
    const rowData: TagRow[] = this._orderedKeys.map((key, index) => {
      return { index: index, key: key, value: (this._tags[key] ?? '') as string | string[] };
    });

    // append blank row last, if necessary
    if (!rowData.length || this._showBlank) {
      this._showBlank = false;
      rowData.push({ index: rowData.length, key: '', value: '' });
    }


    // View Options
    const $options = $wrap.selectAll('.raw-tag-options')
      .data([0]);

    const $$options = $options.enter()
      .insert('div', ':first-child')
      .attr('class', 'raw-tag-options');

    const $$option = $$options.selectAll('.raw-tag-option')
      .data(AVAILABLE_VIEWS, (d: ViewOption) => d.id)
      .enter();

    $$option
      .append('button')
      .attr('class', (d: ViewOption) => `raw-tag-option raw-tag-option-${d.id}` + (this._tagView === d.id ? ' selected' : ''))
      .on('click', (d3_event: Event, clicked: ViewOption) => {
        this._tagView = clicked.id;
        settings?.set('ui.rawTagEditorView', clicked.id);

        $wrap.selectAll('.raw-tag-option')
          .classed('selected', (d: ViewOption) => d === clicked);

        $wrap.selectAll('.tag-text')
          .classed('hide', (clicked.id !== 'text'))
          .each((d, i, nodes) => this._setTextareaHeight(nodes[i] as HTMLTextAreaElement));

        $wrap.selectAll('.tag-list, .add-row')
          .classed('hide', (clicked.id !== 'list'));
      })
      .each((d: ViewOption, i, nodes) => {
        d3_select(nodes[i])
          .call(uiIcon(d.icon));
      });

    // set localized titles on the update selection so they re-localize on language change
    $wrap.selectAll('.raw-tag-option')
      .attr('title', (d: ViewOption) => l10n.t(`icons.${d.id}`));


    // View as Text
    const textData = this._rowsToText(rowData);
    let $textarea: D3Selection = $wrap.selectAll('.tag-text')
      .data([0]);

    $textarea = $textarea.enter()
      .append('textarea')
      .attr('class', 'tag-text' + (this._tagView !== 'text' ? ' hide' : ''))
      .call(utilNoAuto)
      .attr('spellcheck', 'false')
      .merge($textarea);

    $textarea
      .attr('placeholder', l10n.t('inspector.key_value'))
      .call(utilGetSetValue, textData)
      .each((d, i, nodes) => this._setTextareaHeight(nodes[i] as HTMLTextAreaElement))
      .on('input', (d3_event: Event) => this._setTextareaHeight(d3_event.currentTarget as HTMLTextAreaElement))
      .on('focus', this._onFocus)
      .on('blur', this._textChanged)
      .on('change', this._textChanged);


    // View as List
    let $list: D3Selection = $wrap.selectAll('.tag-list')
      .data([0]);

    $list = $list.enter()
      .append('ul')
      .attr('class', 'tag-list' + (this._tagView !== 'list' ? ' hide' : ''))
      .merge($list);


    // Container for the Add button
    const $$addRow = $wrap.selectAll('.add-row')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'add-row' + (this._tagView !== 'list' ? ' hide' : ''));

    $$addRow
      .append('button')
      .attr('class', 'add-tag')
      .call(uiIcon('#rapid-icon-plus', 'light'))
      .on('click', this._addTag);

    $$addRow
      .append('div')
      .attr('class', 'space-value');   // preserve space

    $$addRow
      .append('div')
      .attr('class', 'space-buttons');  // preserve space


    // Tag list items
    let $items: D3Selection = $list.selectAll('.tag-row')
      .data(rowData, (d: TagRow) => d.key);

    $items.exit()
      .each((d: TagRow, i, nodes) => {
        const $row = d3_select(nodes[i]);
        $row.selectAll('input.key, input.value')
          .call(uiCombobox.off, context);
      })
      .remove();


    // Enter
    const $$items = $items.enter()
      .append('li')
      .attr('class', 'tag-row')
      .classed('readonly', this._isReadOnlyTag);

    const $$innerWrap = $$items.append('div')
      .attr('class', 'inner-wrap');

    $$innerWrap
      .append('div')
      .attr('class', 'key-wrap')
      .append('input')
      .property('type', 'text')
      .attr('class', 'key')
      .call(utilNoAuto)
      .on('focus', this._onFocus)
      .on('blur', this._keyChange)
      .on('change', this._keyChange);

    $$innerWrap
      .append('div')
      .attr('class', 'value-wrap')
      .append('input')
      .property('type', 'text')
      .attr('class', 'value')
      .call(utilNoAuto)
      .on('focus', this._onFocus)
      .on('blur', this._valueChange)
      .on('change', this._valueChange)
      .on('keydown.push-more', this._pushMore);

    $$innerWrap
      .append('button')
      .attr('class', 'form-field-button remove')
      .call(uiIcon('#rapid-operation-delete'));


    // Update
    $items = $items
      .merge($$items)
      .sort((a: TagRow, b: TagRow) => a.index - b.index);

    $items
      .each((d: TagRow, i, nodes) => {
        const $row = d3_select(nodes[i]);
        $row.select('input.key');      // propagate bound data
        $row.select('input.value');    // propagate bound data

        if (this._entityIDs.length && taginfo && this._state !== 'hover') {
          this._addComboboxes($row);
        }

        const referenceOptions: { key: string; value?: string } = { key: d.key };
        if (!isMultiValueTag(d)) {
          referenceOptions.value = d.value as string;
        }

        const reference = new UiTagReference(context, referenceOptions);
        if (this._state === 'hover') {
          reference.showing(false);
        }

        $row.select('.inner-wrap')      // propagate bound data
          .call(reference.button);

        $row.call(reference.body);

        $row.select('button.remove');   // propagate bound data
      });

    const $keys = $items.selectAll('input.key')
      .attr('title', (d: TagRow) => d.key)
      .attr('readonly', (d: TagRow) => this._isReadOnlyTag(d) || isMultiValueTag(d) || null);
    utilGetSetValue($keys, (d: TagRow) => d.key);

    const $values = $items.selectAll('input.value')
      .classed('mixed', isMultiValueTag)
      .attr('title', (d: TagRow) => isMultiValueTag(d) ? (d.value as string[]).filter(Boolean).join('\n') : d.value as string)
      .attr('readonly', (d: TagRow) => this._isReadOnlyTag(d) || null)
      .attr('placeholder', (d: TagRow) => isMultiValueTag(d) ? l10n.t('inspector.multiple_values') : null);
    utilGetSetValue($values, (d: TagRow) => isMultiValueTag(d) ? '' : d.value as string);

    $items.selectAll('button.remove')
      .attr('title', l10n.t('icons.remove'))
      .on(('PointerEvent' in window ? 'pointer' : 'mouse') + 'down', this._removeTag);  // 'click' fires too late - iD#5878
  }


  /**
   * Whether the given tag row is read-only (matches a `readOnlyTags` pattern).
   * @param d - the row datum ({ key, value })
   * @return `true` if the key matches a read-only pattern
   */
  protected _isReadOnlyTag(d: { key: string }): boolean {
    for (const regex of this._readOnlyTags) {
      if (regex.test(d.key)) return true;
    }
    return false;
  }


  /**
   * Resizes the text-view textarea to fit its content.
   * @param el - the textarea element to resize
   */
  protected _setTextareaHeight(el: HTMLTextAreaElement): void {
    if (this._tagView !== 'text') return;

    const $selection = d3_select(el);
    const matches = el.value.match(/\n/g);
    const lineCount = 2 + Number(matches && matches.length);
    const lineHeight = 20;

    $selection.style('height', lineCount * lineHeight + 'px');
  }


  /**
   * Serializes tag rows to the `key=value` text used by the text view.
   * @param rows - the row data to serialize
   * @return the joined `key=value` text
   */
  protected _rowsToText(rows: TagRow[]): string {
    const str = rows
      .filter(row => row.key && row.key.trim() !== '')
      .map(row => {
        let rawVal = row.value;
        if (typeof rawVal !== 'string') rawVal = '*';
        const val = rawVal ? stringify(rawVal) : '';
        return stringify(row.key) + '=' + val;
      })
      .join('\n');

    if (this._state !== 'hover' && str.length) {
      return str + '\n';
    }
    return  str;
  }


  /**
   * Handles edits in the text view, diffing the parsed tags against the current tags.
   * @param d3_event - the triggering blur/change event
   */
  protected _textChanged(d3_event: Event): void {
    const context = this.context;
    const newText = (d3_event.currentTarget as HTMLTextAreaElement).value.trim();
    const newTags: Record<string, string> = {};
    newText.split('\n').forEach((row: string) => {
      const m = row.match(/^\s*([^=]+)=(.*)$/);
      if (m !== null) {
        const k = context.cleanTagKey(unstringify(m[1].trim()));
        const v = context.cleanTagValue(unstringify(m[2].trim()));
        newTags[k] = v;
      }
    });

    const tagDiff = utilTagDiff(this._tags as OsmTags, newTags);
    if (!tagDiff.length) return;

    this._pendingChange = this._pendingChange || {};

    tagDiff.forEach((change: TagDiff) => {
      if (this._isReadOnlyTag({ key: change.key })) return;

      // skip unchanged multiselection placeholders
      if (change.newVal === '*' && typeof change.oldVal !== 'string') return;

      if (change.type === '-') {
        this._pendingChange![change.key] = undefined;
      } else if (change.type === '+') {
        this._pendingChange![change.key] = change.newVal || '';
      }
    });

    if (Object.keys(this._pendingChange).length === 0) {
      this._pendingChange = null;
      return;
    }

    this._scheduleChange();
  }


  /**
   * Adds a blank row when Tab is pressed on the last (non-empty) value field.
   * @param d3_event - the triggering keydown event
   */
  protected _pushMore(d3_event: KeyboardEvent): void {
    const el = d3_event.currentTarget as HTMLElement;
    // if pressing Tab on the last value field with content, add a blank row
    if (d3_event.keyCode === 9 && !d3_event.shiftKey &&
      this.$container.selectAll('.tag-list li:last-child input.value').node() === el &&
      utilGetSetValue(d3_select(el))) {
      this._addTag();
    }
  }


  /**
   * Attaches key/value comboboxes (taginfo autocomplete) to a tag row.
   * @param $row - a d3-selection to the tag row
   */
  protected _addComboboxes($row: D3Selection): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const taginfo = context.services.taginfo;

    const d = $row.datum();
    const $key = $row.select('input.key');      // propagate bound data
    const $value = $row.select('input.value');  // propagate bound data

    if (this._isReadOnlyTag(d)) return;
    if (!this._entityIDs.length) return;

    if (isMultiValueTag(d)) {
      $value.call(uiCombobox(context, 'tag-value')
        .minItems(1)
        .fetcher((value: string, callback: (data: any[]) => void) => {
          const keyString = utilGetSetValue($key) as string;
          if (!this._tags[keyString]) return;
          const data = (this._tags[keyString] as string[]).filter(Boolean).map((tagValue: string) => {
            return {
              value: tagValue,
              title: tagValue
            };
          });
          callback(data);
        }));
      return;
    }

    const graph = editor.staging.graph;
    const entity = graph.hasEntity(this._entityIDs[0]);
    const geometry = entity?.geometry(graph);

    $key.call(uiCombobox(context, 'tag-key')
      .fetcher((value: string, callback: (data: any[]) => void) => {
        taginfo!.keys({
          debounce: true,
          geometry: geometry,
          query: value
        }, (err: any, data: any) => {
          if (!err) {
            const filtered = data.filter((d: any) => {
              if (/_\d$/.test(d.value)) return false;          // tag like `_1`, see iD#9422
              if (this._discardKeys.has(d.value)) return false;     // discardable, see iD#9817
              if (this._tags[d.value] !== undefined) return false;  // already used as a tag
              return true;
            });
            callback(sort(value, filtered));
          }
        });
      }));

    $value.call(uiCombobox(context, 'tag-value')
      .fetcher((value: string, callback: (data: any[]) => void) => {
        taginfo!.values({
          debounce: true,
          key: utilGetSetValue($key) as string,
          geometry: geometry,
          query: value
        }, (err: any, data: any) => {
          if (!err) callback(sort(value, data));
        });
      }));


    function sort(value: string, data: any[]): any[] {
      const sameletter = [];
      const other = [];
      for (const d of data) {
        if (d.value.substring(0, value.length) === value) {
          sameletter.push(d);
        } else {
          other.push(d);
        }
      }
      return sameletter.concat(other);
    }
  }


  /**
   * Handles editing a tag key (renaming, dedupe, ordering).
   * @param d3_event - the triggering blur/change event
   * @param d - the row datum
   */
  protected _keyChange(d3_event: Event, d: TagRow): void {
    const context = this.context;
    const el = d3_event.currentTarget as HTMLInputElement;
    if (d3_select(el).attr('readonly')) return;

    const kOld = d.key;

    // exit if we are currently about to delete this row anyway - iD#6366
    if (this._pendingChange && this._pendingChange.hasOwnProperty(kOld) && this._pendingChange[kOld] === undefined) return;

    const kNew = context.cleanTagKey(el.value.trim());

    // allow no change if the key should be readonly
    if (this._isReadOnlyTag({ key: kNew })) {
      el.value = kOld;
      return;
    }

    // new key is already in use, switch focus to the existing row
    if (kNew && kNew !== kOld && this._tags[kNew] !== undefined) {
      el.value = kOld;     // reset the key
      this.$container.selectAll('.tag-list input.value')
          .each((d: TagRow, i, nodes) => {
          if (d.key === kNew) {     // send focus to that other value combo instead
            const input = nodes[i] as HTMLInputElement;
            input.focus();
            input.select();
          }
        });
      return;
    }

    const row = (el.parentNode as HTMLElement).parentNode as HTMLElement;
    const $inputVal = d3_select(row).selectAll('input.value');
    const vNew = context.cleanTagValue(utilGetSetValue($inputVal) as string);

    this._pendingChange = this._pendingChange || {};

    if (kOld) {
      this._pendingChange[kOld] = undefined;
    }

    this._pendingChange[kNew] = vNew;

    // update the ordered key index so this row doesn't change position
    const existingKeyIndex = this._orderedKeys.indexOf(kOld);
    if (existingKeyIndex !== -1) {
      this._orderedKeys[existingKeyIndex] = kNew;
    }

    d.key = kNew;    // update datum to avoid exit/enter on tag update
    d.value = vNew;

    el.value = kNew;
    utilGetSetValue($inputVal, vNew);
    this._scheduleChange();
  }


  /**
   * Handles editing a tag value.
   * @param d3_event - the triggering blur/change event
   * @param d - the row datum
   */
  protected _valueChange(d3_event: Event, d: TagRow): void {
    const context = this.context;
    const el = d3_event.currentTarget as HTMLInputElement;
    if (this._isReadOnlyTag(d)) return;

    // exit if this is a multiselection and no value was entered
    if (isMultiValueTag(d) && !el.value) return;

    // exit if we are currently about to delete this row anyway - iD#6366
    if (this._pendingChange && this._pendingChange.hasOwnProperty(d.key) && this._pendingChange[d.key] === undefined) return;

    this._pendingChange = this._pendingChange || {};
    this._pendingChange[d.key] = context.cleanTagValue(el.value);
    this._scheduleChange();
  }


  /**
   * Removes a tag row (or clears the blank row).
   * @param d3_event - the triggering pointer/mouse event
   * @param d - the row datum
   */
  protected _removeTag(d3_event: Event, d: TagRow): void {
    if (this._isReadOnlyTag(d)) return;

    if (d.key === '') {    // removing the blank row
      this._showBlank = false;
      this.reRender();

    } else {
      // remove the key from the ordered key index
      this._orderedKeys = this._orderedKeys.filter(key => key !== d.key);
      this._pendingChange = this._pendingChange || {};
      this._pendingChange[d.key] = undefined;
      this._scheduleChange();
    }
  }


  /**
   * Appends a blank tag row and focuses its key input.
   */
  protected _addTag(): void {
    const scheduler = this.context.systems.scheduler;  // optional
    // Delay render in case this click is blurring an edited combo.
    // Without the setTimeout, the `content` render would wipe out the pending tag change.
    const addTag = () => {
      this._showBlank = true;
      this.reRender();
      (this.$container.selectAll('.tag-list li:last-child input.key').node() as HTMLElement).focus();
    };
    if (scheduler) {
      scheduler.setTimeout('ui-raw-tag-editor-add-tag', addTag, { ms: 20 });
    } else {
      addTag();
    }
  }


  /**
   * Records that the user focused a field (used to auto-expand the disclosure).
   */
  protected _onFocus(): void {
    this._didFocus = true;
  }


  /**
   * Dispatches the pending tag change (deferred a tick to let combos blur).
   */
  protected _scheduleChange(): void {
    const scheduler = this.context.systems.scheduler;  // optional
    // Cache IDs in case the editor is reloaded before the change event is called. - iD#6028
    const entityIDs = this._entityIDs;

    // Delay change in case this change is blurring an edited combo. - iD#5878
    const applyChange = () => {
      if (!this._pendingChange) return;
      this.emit('change', entityIDs, this._pendingChange);
      this._pendingChange = null;
    };
    if (scheduler) {
      scheduler.setTimeout('ui-raw-tag-editor-change', applyChange, { ms: 10 });
    } else {
      applyChange();
    }
  }


  /**
   * Gets or sets the editor state ('hide', 'hover', or 'select').
   * @param val - the new state, or omit to get the current value
   * @return the current state (getter) or `this` (setter)
   */
  public state(val?: string): any {
    if (!arguments.length) return this._state;
    if (this._state !== val) {
      this._didFocus = false;
      this._orderedKeys = [];
      this._state = val;
    }
    return this;
  }


  /**
   * Gets or sets the presets, adjusting the disclosure expand override.
   * @param val - the new presets, or omit to get the current value
   * @return the current presets (getter) or `this` (setter)
   */
  public presets(val?: (Preset | Category)[]): any {
    if (!arguments.length) return this._presets;
    this._presets = val;

    // Force the raw tag editor to be expanded if ...
    if (this._presets && this._presets.length && this._presets[0].isFallback()) {  // ... it's a fallback preset
      this._disclosureExpandOverride = true;
    } else if (this._didFocus) {    // ... the user was just using it - iD#1881
      this._disclosureExpandOverride = true;
    } else {
      this._disclosureExpandOverride = undefined;
    }

    return this;
  }


  /**
   * Gets or sets the tags being edited.
   * @param val - the new tags, or omit to get the current value
   * @return the current tags (getter) or `this` (setter)
   */
  public tags(val?: Tags): any {
    if (!arguments.length) return this._tags;
    this._tags = val ?? {};
    return this;
  }


  /**
   * Gets or sets the entity IDs being edited.
   * @param val - the new entity IDs, or omit to get the current value
   * @return the current entity IDs (getter) or `this` (setter)
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._entityIDs;

    if (!this._entityIDs || !val || !utilArrayIdentical(this._entityIDs, val)) {
      this._didFocus = false;
      this._orderedKeys = [];
      this._entityIDs = val ?? [];
    }
    return this;
  }


  /**
   * Gets or sets the read-only tag patterns (regexes tested against the tag key).
   * @param val - the new patterns, or omit to get the current value
   * @return the current patterns (getter) or `this` (setter)
   */
  public readOnlyTags(val?: RegExp[]): any {
    if (!arguments.length) return this._readOnlyTags;
    this._readOnlyTags = val ?? [];
    return this;
  }
}
