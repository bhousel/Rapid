import { select, selection } from 'd3-selection';
import { utilArrayUnion } from '@rapid-sdk/util';
import { UiField } from '../UiField.ts';
import { createUiField } from './index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { SchemaScope } from '../../core/SchemaSystem.ts';
import type { Tags } from './types.ts';
import type { UiFieldOptions } from '../UiField.ts';

export { UiFieldRadio as UiFieldStructureRadio };


/**
 * This UI component displays a radio button field.
 * There are several variants:
 * - 'radio':
 * - 'structureRadio':
 */
export class UiFieldRadio extends UiField {
  // D3 selections
  public $parent: D3Selection | null;
  public $placeholder: D3Selection | null;
  public $wrap: D3Selection | null;
  public $labels: D3Selection | null;
  public $radios: D3Selection | null;

  protected _scope: SchemaScope;
  protected _radioData: string[];
  protected _typeField: UiField | null;
  protected _layerField: UiField | null;
  protected _oldType: Record<string, string | string[] | undefined>;


  /**
   * @constructor
   * @param context - Global shared application context
   * @param presetField - the original Field tracked by the SchemaSystem
   * @param entityIDs - the entities this field applies to
   * @param options - field display options
   */
  public constructor(context: Context, presetField: Field, entityIDs: EntityID[] = [], options: Partial<UiFieldOptions> = {}) {
    super(context, presetField, entityIDs, options);
    const schema = context.systems.schema!;

    this._scope = schema.getScope('osm');

    // D3 selections
    this.$parent = null;
    this.$placeholder = null;
    this.$wrap = null;
    this.$labels = null;
    this.$radios = null;

    this._radioData = (presetField.props.options || this.keys).slice();  // shallow copy
    this._typeField = null;
    this._layerField = null;
    this._oldType = {};

    this.renderContent = this.renderContent.bind(this);
    this._structureExtras = this._structureExtras.bind(this);
    this._changeType = this._changeType.bind(this);
    this._changeLayer = this._changeLayer.bind(this);
    this._changeRadio = this._changeRadio.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public renderContent($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const l10n = this.context.systems.l10n!;

    $parent.classed('preset-radio', true);

    this.$wrap = $parent.selectAll('.form-field-input-wrap')
      .data([0]);

    let $$wrap: D3Selection = this.$wrap.enter()
      .append('div')
      .attr('class', 'form-field-input-wrap form-field-input-radio');

    $$wrap
      .append('span')
      .attr('class', 'placeholder');

    this.$wrap = this.$wrap
      .merge($$wrap);


    this.$placeholder = this.$wrap.selectAll('.placeholder');

    this.$labels = this.$wrap.selectAll('label')
      .data(this._radioData);

    $$wrap = this.$labels.enter()
      .append('label');

    const stringBase = `_tagging.presets.fields.${this.id}.options`;
    $$wrap
      .append('input')
      .attr('type', 'radio')
      .attr('name', this.id)
      .attr('checked', false);

    $$wrap
      .append('span');

    this.$labels = this.$labels
      .merge($$wrap);

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
  protected _structureExtras($selection: D3Selection, tags: Tags): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const scope = this._scope;

    const selected: string | boolean = this._selectedKey() || tags.layer !== undefined;
    const type = typeof selected === 'string' ? scope?.fields.get(selected) : null;
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
        this._typeField = createUiField(context, type, this.entityIDs, { wrap: false })
          .on('change', this._changeType);
      }
      this._typeField!.tags(tags);
    } else {
      this._typeField = null;
    }

    let $typeItem: D3Selection = $list.selectAll('.structure-type-item')
      .data(this._typeField ? [this._typeField] : [], d => d.id);

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
        this._layerField = createUiField(context, layer, this.entityIDs, { wrap: false })
          .on('change', this._changeLayer);
      }
      this._layerField!.tags(tags);
      this.keys = utilArrayUnion(this.keys, ['layer']);
    } else {
      this._layerField = null;
      this.keys = this.keys.filter(function(k: string) { return k !== 'layer'; });
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
  protected _changeType(t: Tags, onInput: boolean | undefined): void {
    const key = this._selectedKey();
    if (!key) return;

    const val = t[key];
    if (val !== 'no') {
      this._oldType[key] = val;
    }

    if (this.type === 'structureRadio') {
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
  protected _changeLayer(t: Tags, onInput: boolean | undefined): void {
    if (t.layer === '0') {
      t.layer = undefined;
    }
    this.emit('change', t, onInput);
  }


  /** Handles a radio selection change and dispatches the resulting tag change. */
  protected _changeRadio(): void {
    if (!this.$radios) return;   // called too early?

    const key = this.key;
    const type = this.type;
    const oldType = this._oldType;
    const t: Tags = {};
    let activeKey: string | undefined;

    if (key) {
      t[key] = undefined;
    }

    this.$radios.each(function(this: HTMLInputElement, d: string) {
      const isActive = select(this).property('checked') as boolean;
      if (isActive) activeKey = d;

      if (key) {
        if (isActive) t[key] = d;
      } else {
        const val = oldType[(activeKey || '')] || 'yes';
        t[d] = isActive ? val : undefined;
      }
    });

    if (type === 'structureRadio') {
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
   * Returns the datum of the currently active radio, or `false` if none is active.
   * @return The active radio's bound value, or `false`
   */
  protected _selectedKey(): string | false {
    if (!this.$wrap) return false;   // called too early?

    const $node = this.$wrap.selectAll('.form-field-input-radio label.active input');
    if ($node.empty()) return false;
    return $node.datum() as string;
  }


  /**
   * Updates the field UI to reflect the given entity tags.
   * @param tags - The entity tags to display
   */
  public syncTags(tags: Tags): void {
    if (!this.$radios || !this.$labels || !this.$wrap || !this.$placeholder) return;   // called too early?

    const l10n = this.context.systems.l10n!;
    const key = this.key;
    const type = this.type;
    const t: any = tags;

    this.$radios.property('checked', function(d: string) {
      if (key) {
        return t[key] === d;
      }
      return !!(typeof t[d] === 'string' && (t[d] as string).toLowerCase() !== 'no');
    });

    function isMixed(d: string): boolean {
      if (key) {
        return Array.isArray(t[key]) && (t[key] as string[]).includes(d);
      }
      return Array.isArray(t[d]);
    }

    this.$labels
      .classed('active', function(d: string) {
        if (key) {
          return (Array.isArray(t[key]) && (t[key] as string[]).includes(d))
            || t[key] === d;
        }
        return Array.isArray(t[d]) || !!(t[d] && (t[d] as string).toLowerCase() !== 'no');
      })
      .classed('mixed', isMixed)
      .attr('title', function(d: string) {
        return isMixed(d) ? l10n.t('inspector.unshared_value_tooltip') : null;
      });


    const selection = this.$radios.filter(function(this: HTMLInputElement) { return this.checked; });

    if (selection.empty()) {
      this.$placeholder.text(l10n.t('inspector.none'));
    } else {
      this.$placeholder.text(selection.attr('value'));
      this._oldType[selection.datum()] = t[selection.datum()];
    }

    if (type === 'structureRadio') {
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
    if (!this.$radios) return;   // called too early?
    (this.$radios.node() as HTMLElement).focus();
  }


  /** Returns whether this field is allowed for the current selection. */
  public isAllowed(): boolean {
    return this.entityIDs.length === 1;
  }
}
