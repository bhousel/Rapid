import { EventEmitter } from 'tseep/lib/ee-safe';
import { select as d3_select } from 'd3-selection';
import { utilArrayUnion } from '@rapid-sdk/util';

import { UiField } from '../UiField.js';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Tags } from './types.ts';

export { UiFieldRadio as UiFieldStructureRadio };


export class UiFieldRadio extends EventEmitter {
  public context: Context;

  protected _uifield: any;
  protected _scope: any;
  protected _radioData: any[];
  public $placeholder: D3Selection;
  public $wrap: D3Selection;
  public $labels: D3Selection;
  public $radios: D3Selection;
  protected _typeField: any;
  protected _layerField: any;
  protected _oldType: any;
  protected _entityIDs: EntityID[];

  /**
   * @param context - Global shared application context
   * @param uifield - The `UiField` wrapper that owns this field internal
   */
  public constructor(context: Context, uifield: any) {
    super();
    const schema = context.systems.schema!;

    this.context = context;
    this._uifield = uifield;
    this._scope = schema.getScope('osm');

    this.$placeholder = d3_select(null);
    this.$wrap = d3_select(null);
    this.$labels = d3_select(null);
    this.$radios = d3_select(null);
    this._radioData = (uifield.presetField.props.options || uifield.keys).slice();  // shallow copy
    this._typeField = null;
    this._layerField = null;
    this._oldType = {};
    this._entityIDs = [];

    this.render = this.render.bind(this);
    this._structureExtras = this._structureExtras.bind(this);
    this._changeType = this._changeType.bind(this);
    this._changeLayer = this._changeLayer.bind(this);
    this._changeRadio = this._changeRadio.bind(this);
  }


  /**
   * Returns the datum of the currently active radio, or `false` if none is active.
   * @return The active radio's bound value, or `false`
   */
  protected _selectedKey(): any {
    const $node = this.$wrap.selectAll('.form-field-input-radio label.active input');
    return !$node.empty() && $node.datum();
  }


  /**
   * Renders the content into the given selection.
   * This component is handed its target selection by its parent on each render, so it
   *  renders into `$selection` directly rather than capturing `$parent` for re-render.
   * @param $selection - A d3-selection to the HTMLElement this component renders into
   */
  public render($selection: D3Selection): void {
    const l10n = this.context.systems.l10n!;
    const uifield = this._uifield;

    $selection.classed('preset-radio', true);

    this.$wrap = $selection.selectAll('.form-field-input-wrap')
      .data([0]);

    let $$enter: D3Selection = this.$wrap.enter()
      .append('div')
      .attr('class', 'form-field-input-wrap form-field-input-radio');

    $$enter
      .append('span')
      .attr('class', 'placeholder');

    this.$wrap = this.$wrap
      .merge($$enter);


    this.$placeholder = this.$wrap.selectAll('.placeholder');

    this.$labels = this.$wrap.selectAll('label')
      .data(this._radioData);

    $$enter = this.$labels.enter()
      .append('label');

    const stringBase = `_tagging.presets.fields.${uifield.id}.options`;
    $$enter
      .append('input')
      .attr('type', 'radio')
      .attr('name', uifield.id)
      .attr('checked', false);

    $$enter
      .append('span');

    this.$labels = this.$labels
      .merge($$enter);

    // Set localized value/text on the update selection so they re-localize on language change.
    this.$labels.selectAll('input')
      .attr('value', d => l10n.t(`${stringBase}.${d}`, { 'default': d }));

    this.$labels.selectAll('span')
      .text(d => l10n.t(`${stringBase}.${d}`, { 'default': d }));

    this.$radios = this.$labels.selectAll('input')
      .on('change', this._changeRadio);
  }


  /**
   * Renders the extra bridge/tunnel type and layer controls beneath the radios.
   * @param $selection - A d3-selection to render the extras into
   * @param tags - The current entity tags
   */
  protected _structureExtras($selection: D3Selection, tags: any): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const uifield = this._uifield;
    const scope = this._scope;

    const selected = this._selectedKey() || tags.layer !== undefined;
    const type = scope?.fields.get(selected);
    const layer = scope?.fields.get('layer');
    const showLayer = (selected === 'bridge' || selected === 'tunnel' || tags.layer !== undefined);

    let $extrasWrap: D3Selection = $selection.selectAll('.structure-extras-wrap')
      .data(selected ? [0] : []);

    $extrasWrap.exit()
      .remove();

    $extrasWrap = $extrasWrap.enter()
      .append('div')
      .attr('class', 'structure-extras-wrap')
      .merge($extrasWrap);

    let $list: D3Selection = $extrasWrap.selectAll('ul')
      .data([0]);

    $list = $list.enter()
      .append('ul')
      .attr('class', 'rows')
      .merge($list);


    // Type
    if (type) {
      if (!this._typeField || this._typeField.id !== selected) {
        this._typeField = (new UiField(context, type, this._entityIDs, { wrap: false }) as any)
          .on('change', this._changeType);
      }
      this._typeField.tags(tags);
    } else {
      this._typeField = null;
    }

    let $typeItem: D3Selection = $list.selectAll('.structure-type-item')
      .data(this._typeField ? [this._typeField] : [], function(d: any) { return d.id; });

    // Exit
    $typeItem.exit()
      .remove();

    // Enter
    const $$typeItem = $typeItem.enter()
      .insert('li', ':first-child')
      .attr('class', 'labeled-input structure-type-item');

    $$typeItem
      .append('div')
      .attr('class', 'label structure-label-type')
      .attr('for', 'preset-input-' + selected);

    $$typeItem
      .append('div')
      .attr('class', 'structure-input-type-wrap');

    // Update
    $typeItem = $typeItem
      .merge($$typeItem);

    // Set localized text on the update selection so it re-localizes on language change.
    $typeItem.selectAll('.structure-label-type')
      .text(l10n.t('inspector.type'));

    if (this._typeField) {
      $typeItem.selectAll('.structure-input-type-wrap')
        .call(this._typeField.render);
    }


    // Layer
    if (layer && showLayer) {
      if (!this._layerField) {
        this._layerField = (new UiField(context, layer, this._entityIDs, { wrap: false }) as any)
          .on('change', this._changeLayer);
      }
      this._layerField.tags(tags);
      uifield.keys = utilArrayUnion(uifield.keys, ['layer']);
    } else {
      this._layerField = null;
      uifield.keys = uifield.keys.filter(function(k: string) { return k !== 'layer'; });
    }

    let $layerItem: D3Selection = $list.selectAll('.structure-layer-item')
      .data(this._layerField ? [this._layerField] : []);

    // Exit
    $layerItem.exit()
      .remove();

    // Enter
    const $$layerItem = $layerItem.enter()
      .append('li')
      .attr('class', 'labeled-input structure-layer-item');

    $$layerItem
      .append('div')
      .attr('class', 'label structure-label-layer')
      .attr('for', 'preset-input-layer');

    $$layerItem
      .append('div')
      .attr('class', 'structure-input-layer-wrap');

    // Update
    $layerItem = $layerItem
      .merge($$layerItem);

    // Set localized text on the update selection so it re-localizes on language change.
    $layerItem.selectAll('.structure-label-layer')
      .html(l10n.tHtml('inspector.radio.structure.layer'));

    if (this._layerField) {
      $layerItem.selectAll('.structure-input-layer-wrap')
        .call(this._layerField.render);
    }
  }


  /**
   * Handles a change from the type sub-field, adjusting the `layer` tag as needed.
   * @param t - The proposed tag change
   * @param onInput - `true` while typing, `false`/omit on commit
   */
  protected _changeType(t: any, onInput: any): void {
    const uifield = this._uifield;
    const key = this._selectedKey();
    if (!key) return;

    const val = t[key];
    if (val !== 'no') {
      this._oldType[key] = val;
    }

    if (uifield.type === 'structureRadio') {
      // remove layer if it should not be set
      if (val === 'no' ||
        (key !== 'bridge' && key !== 'tunnel') ||
        (key === 'tunnel' && val === 'building_passage')) {
        t.layer = undefined;
      }
      // add layer if it should be set
      if (t.layer === undefined) {
        if (key === 'bridge' && val !== 'no') {
          t.layer = '1';
        }
        if (key === 'tunnel' && val !== 'no' && val !== 'building_passage') {
          t.layer = '-1';
        }
      }
    }

    this.emit('change', t, onInput);
  }


  /**
   * Handles a change from the layer sub-field.
   * @param t - The proposed tag change
   * @param onInput - `true` while typing, `false`/omit on commit
   */
  protected _changeLayer(t: any, onInput: any): void {
    if (t.layer === '0') {
      t.layer = undefined;
    }
    this.emit('change', t, onInput);
  }


  /** Handles a radio selection change and dispatches the resulting tag change. */
  protected _changeRadio(): void {
    const uifield = this._uifield;
    const oldType = this._oldType;
    const t: any = {};
    let activeKey: any;

    if (uifield.key) {
      t[uifield.key] = undefined;
    }

    this.$radios.each(function(this: any, d) {
      const active = d3_select(this).property('checked');
      if (active) activeKey = d;

      if (uifield.key) {
        if (active) t[uifield.key] = d;
      } else {
        const val = oldType[activeKey] || 'yes';
        t[d] = active ? val : undefined;
      }
    });

    if (uifield.type === 'structureRadio') {
      if (activeKey === 'bridge') {
        t.layer = '1';
      } else if (activeKey === 'tunnel' && t.tunnel !== 'building_passage') {
        t.layer = '-1';
      } else {
        t.layer = undefined;
      }
    }

    this.emit('change', t);
  }


  /**
   * Updates the field UI to reflect the given entity tags.
   * @param tags - The entity tags to display
   */
  public tags(tags: Tags): void {
    const l10n = this.context.systems.l10n!;
    const uifield = this._uifield;
    const t: any = tags;

    this.$radios.property('checked', function(d: any) {
      if (uifield.key) {
        return t[uifield.key] === d;
      }
      return !!(typeof t[d] === 'string' && t[d].toLowerCase() !== 'no');
    });

    function isMixed(d: any): boolean {
      if (uifield.key) {
        return Array.isArray(t[uifield.key]) && t[uifield.key].includes(d);
      }
      return Array.isArray(t[d]);
    }

    this.$labels
      .classed('active', function(d: any) {
        if (uifield.key) {
          return (Array.isArray(t[uifield.key]) && t[uifield.key].includes(d))
            || t[uifield.key] === d;
        }
        return Array.isArray(t[d]) || !!(t[d] && t[d].toLowerCase() !== 'no');
      })
      .classed('mixed', isMixed)
      .attr('title', function(d: any) {
        return isMixed(d) ? l10n.t('inspector.unshared_value_tooltip') : null;
      });


    const selection = this.$radios.filter(function(this: any) { return this.checked; });

    if (selection.empty()) {
      this.$placeholder.text(l10n.t('inspector.none'));
    } else {
      this.$placeholder.text(selection.attr('value'));
      this._oldType[selection.datum()] = t[selection.datum()];
    }

    if (uifield.type === 'structureRadio') {
      // For waterways without a tunnel tag, set 'culvert' as
      // the _oldType to default to if the user picks 'tunnel'
      if (!!t.waterway && !this._oldType.tunnel) {
        this._oldType.tunnel = 'culvert';
      }

      this.$wrap.call(this._structureExtras, t);
    }
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    (this.$radios.node() as HTMLElement).focus();
  }


  /**
   * Gets or sets the entity IDs this field applies to.
   * @param val - The new entity IDs, or omit to get the current IDs
   * @return The current entity IDs (getter) or `this` (setter)
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._entityIDs;
    this._entityIDs = val as EntityID[];
    this._oldType = {};
    return this;
  }


  /** Returns whether this field is allowed for the current selection. */
  public isAllowed(): boolean {
    return this._entityIDs.length === 1;
  }
}
