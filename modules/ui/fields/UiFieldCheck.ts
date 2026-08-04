import { EventEmitter } from 'tseep/lib/ee-safe';
import { select as d3_select } from 'd3-selection';

import { actionReverse } from '../../actions/reverse.js';
import { uiIcon } from '../icon.js';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { TagChange, Tags } from './types.ts';

export { UiFieldCheck as UiFieldDefaultCheck };
export { UiFieldCheck as UiFieldOnewayCheck };


export class UiFieldCheck extends EventEmitter {
  public context: Context;

  protected _uifield: any;
  protected _values: (string | undefined)[];
  protected _texts: string[];
  public $input: D3Selection;
  public $text: D3Selection;
  public $label: D3Selection;
  public $reverser: D3Selection;
  protected _tags: Tags;
  protected _impliedYes: boolean;
  protected _entityIDs: EntityID[];
  protected _value: any;

  /**
   * @param context - Global shared application context
   * @param uifield - The `UiField` wrapper that owns this field internal
   */
  public constructor(context: Context, uifield: any) {
    super();
    const l10n = context.systems.l10n!;

    this.context = context;
    this._uifield = uifield;

    this._values = [];
    this._texts = [];
    this.$input = d3_select(null);
    this.$text = d3_select(null);
    this.$label = d3_select(null);
    this.$reverser = d3_select(null);
    this._tags = {};
    this._impliedYes = false;
    this._entityIDs = [];
    this._value = undefined;

    this.render = this.render.bind(this);
    this._reverserSetText = this._reverserSetText.bind(this);

    // Prepare the values and texts that this checkbox works with
    const options = uifield.presetField.props.options;
    if (Array.isArray(options)) {
      const stringBase = `_tagging.presets.fields.${uifield.id}.options`;
      for (const v of options) {
        this._values.push(v === 'undefined' ? undefined : v);
        this._texts.push(l10n.t(`${stringBase}.${v}`, { 'default': v }));
      }
    } else {
      this._values = [undefined, 'yes'];
      this._texts = [l10n.t('inspector.unknown'), l10n.t('inspector.check.yes')];
      if (uifield.type !== 'defaultCheck') {
        this._values.push('no');
        this._texts.push(l10n.t('inspector.check.no'));
      }
    }
  }


  // Checks tags to see whether an undefined value is "Assumed to be Yes"
  /** Checks tags to see whether an undefined value is "assumed to be yes". */
  protected _checkImpliedYes(): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const uifield = this._uifield;

    this._impliedYes = (uifield.id === 'oneway_yes');

    // hack: pretend `oneway` field is a `oneway_yes` field
    // where implied oneway tag exists (e.g. `junction=roundabout`) iD#2220, iD#1841
    if (uifield.id === 'oneway' && this._entityIDs.length) {
      const schema = context.systems.schema;
      const rulesets = schema?.getScope('osm')?.rulesets;
      const graph = editor.staging.graph;
      const entity = graph.entity(this._entityIDs[0]);

      const isImpliedOneway = rulesets?.get('oneway_forward')?.match(entity.tags)
        || rulesets?.get('oneway_backward')?.match(entity.tags)
        || rulesets?.get('oneway_bidirectional')?.match(entity.tags);

      if (isImpliedOneway) {
        this._impliedYes = true;
        this._texts[0] = context.systems.l10n!.t('_tagging.presets.fields.oneway_yes.options.undefined');
      }
    }
  }


  /**
   * Returns whether the reverser control should be hidden for the current value.
   * @return `true` if the reverser should be hidden
   */
  protected _reverserHidden(): boolean {
    const context = this.context;
    if (!context.container().select('div.inspector-hover').empty()) return true;
    return !(this._value === 'yes' || (this._impliedYes && !this._value));
  }


  /**
   * Sets the reverser control's label and direction icon.
   * @param $selection - A d3-selection to the reverser element
   * @return The same selection, for chaining
   */
  protected _reverserSetText($selection: D3Selection): D3Selection {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    const graph = editor.staging.graph;
    const entity = (this._entityIDs.length && graph.hasEntity(this._entityIDs[0])) as any;
    if (this._reverserHidden() || !entity) return $selection;

    const first = entity.first();
    const last = entity.isClosed() ? entity.nodes[entity.nodes.length - 2] : entity.last();
    const pseudoDirection = first < last;
    const icon = pseudoDirection ? '#rapid-icon-forward' : '#rapid-icon-backward';

    $selection.selectAll('.reverser-span')
      .text(l10n.t('inspector.check.reverser'))
      .call(uiIcon(icon, 'inline'));

    return $selection;
  }


  /**
   * Renders the content into the given selection.
   * This component is handed its target selection by its parent on each render, so it
   *  renders into `$selection` directly rather than capturing `$parent` for re-render.
   * @param $selection - A d3-selection to the HTMLElement this component renders into
   */
  public render($selection: D3Selection): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const uifield = this._uifield;

    this._checkImpliedYes();

    this.$label = $selection.selectAll('.form-field-input-wrap')
      .data([0]);

    const $$enter = this.$label.enter()
      .append('label')
      .attr('class', 'form-field-input-wrap form-field-input-check');

    $$enter
      .append('input')
      .property('indeterminate', uifield.type !== 'defaultCheck')
      .attr('type', 'checkbox')
      .attr('id', uifield.uid);

    $$enter
      .append('span')
      .attr('class', 'value');

    if (uifield.type === 'onewayCheck') {
      $$enter
        .append('button')
        .attr('class', 'reverser' + (this._reverserHidden() ? ' hide' : ''))
        .append('span')
        .attr('class', 'reverser-span');
    }

    this.$label = this.$label.merge($$enter);
    this.$input = this.$label.selectAll('input');
    this.$text = this.$label.selectAll('span.value');

    // Set localized text on the update selection so it re-localizes on language change.
    this.$text.text(this._texts[0]);

    this.$input
      .on('click', (d3_event: MouseEvent) => {
        d3_event.stopPropagation();
        const key = uifield.key;
        const tagChange: TagChange = {};

        if (Array.isArray(this._tags[key])) {
          if (this._values.indexOf('yes') !== -1) {
            tagChange[key] = 'yes';
          } else {
            tagChange[key] = this._values[0];
          }
        } else {
          tagChange[key] = this._values[(this._values.indexOf(this._value) + 1) % this._values.length];
        }

        // Don't cycle through `alternating` or `reversible` states - iD#4970
        // (They are supported as translated strings, but should not toggle with clicks)
        if (tagChange[key] === 'reversible' || tagChange[key] === 'alternating') {
          tagChange[key] = this._values[0];
        }

        this.emit('change', tagChange);
      });


    if (uifield.type === 'onewayCheck') {
      this.$reverser = this.$label.selectAll('.reverser');

      this.$reverser
        .call(this._reverserSetText)
        .on('click', (d3_event: MouseEvent) => {
          d3_event.preventDefault();
          d3_event.stopPropagation();
          if (!this._entityIDs.length) return;

          const combinedAction = (graph: any) => {
            for (const entityID of this._entityIDs) {
              graph = actionReverse(entityID)(graph);
            }
            return graph;
          };

          editor.perform(combinedAction);
          editor.commit({
            annotation: l10n.t('operations.reverse.annotation.line', { n: 1 }),
            selectedIDs: this._entityIDs
          });

          d3_select(d3_event.currentTarget as any)
            .call(this._reverserSetText);
        });
    }
  }


  /**
   * Gets or sets the entity IDs this field applies to.
   * @param val - The new entity IDs, or omit to get the current IDs
   * @return The current entity IDs (getter) or `this` (setter)
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._entityIDs;
    this._entityIDs = val as EntityID[];
    return this;
  }


  /**
   * Updates the field UI to reflect the given entity tags.
   * @param tags - The entity tags to display
   */
  public tags(tags: Tags): void {
    const l10n = this.context.systems.l10n!;
    const uifield = this._uifield;

    this._tags = tags;
    const key = uifield.key;

    const isChecked = (val: any): boolean => {
      return val !== 'no' && val !== '' && val !== undefined && val !== null;
    };

    const textFor = (val: any): string => {
      if (val === '') val = undefined;
      const index = this._values.indexOf(val);
      return index === -1 ? `"${val}"` : this._texts[index];
    };

    this._checkImpliedYes();
    const isMixed = Array.isArray(tags[key]);
    this._value = !isMixed && tags[key] && (tags[key] as string).toLowerCase();

    if (uifield.type === 'onewayCheck' && (this._value === '1' || this._value === '-1')) {
      this._value = 'yes';
    }

    this.$input
      .property('indeterminate', isMixed || (uifield.type !== 'defaultCheck' && !this._value))
      .property('checked', isChecked(this._value));

    this.$text
      .text(isMixed ? l10n.t('inspector.multiple_values') : textFor(this._value))
      .classed('mixed', isMixed);

    this.$label
      .classed('set', !!this._value);

    if (uifield.type === 'onewayCheck') {
      this.$reverser
        .classed('hide', this._reverserHidden())
        .call(this._reverserSetText);
    }
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    this.$input.node().focus();
  }
}
