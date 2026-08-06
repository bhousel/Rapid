import { select, selection } from 'd3-selection';
import { actionReverse } from '../../actions/reverse.ts';
import { uiIcon } from '../icon.ts';
import { UiField } from '../UiField.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { TagChange, Tags } from './types.ts';
import type { UiFieldOptions } from '../UiField.ts';

export { UiFieldCheck as UiFieldDefaultCheck };
export { UiFieldCheck as UiFieldOnewayCheck };


/**
 * This UI component displays a checkbox field.
 * There are several variants:
 * - 'check':
 * - 'defaultcheck':
 * - 'onewaycheck':
 */
export class UiFieldCheck extends UiField {
  // D3 selections
  public $parent: D3Selection | null;
  public $input: D3Selection | null;
  public $text: D3Selection | null;
  public $label: D3Selection | null;
  public $reverser: D3Selection | null;

  protected _values: (string | undefined)[];
  protected _texts: string[];
  protected _tags: Tags;
  protected _impliedYes: boolean;
  protected _value: any;


  /**
   * @constructor
   * @param context - Global shared application context
   * @param presetField - The preset field definition this field renders
   * @param entityIDs - The entities this field applies to
   * @param options - Field display options
   */
  public constructor(context: Context, presetField: Field, entityIDs: EntityID[] = [], options: Partial<UiFieldOptions> = {}) {
    super(context, presetField, entityIDs, options);
    const l10n = context.systems.l10n!;

    // D3 selctions
    this.$parent = null;
    this.$input = null;
    this.$text = null;
    this.$label = null;
    this.$reverser = null;

    this._values = [];
    this._texts = [];
    this._tags = {};
    this._impliedYes = false;
    this._value = undefined;

    this.renderContent = this.renderContent.bind(this);
    this._reverserSetText = this._reverserSetText.bind(this);

    // Prepare the values and texts that this checkbox works with
    const fieldOptions = presetField.props.options;
    if (Array.isArray(fieldOptions)) {
      const stringBase = `_tagging.presets.fields.${this.id}.options`;
      for (const v of fieldOptions) {
        this._values.push(v === 'undefined' ? undefined : v);
        this._texts.push(l10n.t(`${stringBase}.${v}`, { 'default': v }));
      }
    } else {
      this._values = [undefined, 'yes'];
      this._texts = [l10n.t('inspector.unknown'), l10n.t('inspector.check.yes')];
      if (this.type !== 'defaultCheck') {
        this._values.push('no');
        this._texts.push(l10n.t('inspector.check.no'));
      }
    }
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
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    this._checkImpliedYes();

    this.$label = $parent.selectAll('.form-field-input-wrap')
      .data([0]);

    const $$label = this.$label.enter()
      .append('label')
      .attr('class', 'form-field-input-wrap form-field-input-check');

    $$label
      .append('input')
      .property('indeterminate', this.type !== 'defaultCheck')
      .attr('type', 'checkbox')
      .attr('id', this.uid);

    $$label
      .append('span')
      .attr('class', 'value');

    if (this.type === 'onewayCheck') {
      $$label
        .append('button')
        .attr('class', 'reverser' + (this._reverserHidden() ? ' hide' : ''))
        .append('span')
        .attr('class', 'reverser-span');
    }

    this.$label = this.$label.merge($$label);
    this.$input = this.$label.selectAll('input');
    this.$text = this.$label.selectAll('span.value');

    // Set localized text on the update selection so it re-localizes on language change.
    this.$text.text(this._texts[0]);

    this.$input
      .on('click', (d3_event: MouseEvent) => {
        d3_event.stopPropagation();
        const key = this.key;
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


    if (this.type === 'onewayCheck') {
      this.$reverser = this.$label.selectAll('.reverser');

      this.$reverser
        .call(this._reverserSetText)
        .on('click', (d3_event: MouseEvent) => {
          d3_event.preventDefault();
          d3_event.stopPropagation();
          if (!this.entityIDs.length) return;

          const combinedAction = (graph: any) => {
            for (const entityID of this.entityIDs) {
              graph = actionReverse(entityID)(graph);
            }
            return graph;
          };

          editor.perform(combinedAction);
          editor.commit({
            annotation: l10n.t('operations.reverse.annotation.line', { n: 1 }),
            selectedIDs: this.entityIDs
          });

          select(d3_event.currentTarget as any)
            .call(this._reverserSetText);
        });
    }
  }


  /** Checks tags to see whether an undefined value is "assumed to be yes". */
  protected _checkImpliedYes(): void {
    const context = this.context;
    const editor = context.systems.editor!;

    this._impliedYes = (this.id === 'oneway_yes');

    // hack: pretend `oneway` field is a `oneway_yes` field
    // where implied oneway tag exists (e.g. `junction=roundabout`) iD#2220, iD#1841
    if (this.id === 'oneway' && this.entityIDs.length) {
      const schema = context.systems.schema;
      const rulesets = schema?.getScope('osm')?.rulesets;
      const graph = editor.staging.graph;
      const entity = graph.entity(this.entityIDs[0]);

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
    const entity = (this.entityIDs.length && graph.hasEntity(this.entityIDs[0])) as any;
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
   * Updates the field UI to reflect the given entity tags.
   * @param tags - The entity tags to display
   */
  public syncTags(tags: Tags): void {
    if (!this.$input || !this.$label || !this.$text) return;   // called too early?

    const l10n = this.context.systems.l10n!;

    this._tags = tags;
    const key = this.key;

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

    if (this.type === 'onewayCheck' && (this._value === '1' || this._value === '-1')) {
      this._value = 'yes';
    }

    this.$input
      .property('indeterminate', isMixed || (this.type !== 'defaultCheck' && !this._value))
      .property('checked', isChecked(this._value));

    this.$text
      .text(isMixed ? l10n.t('inspector.multiple_values') : textFor(this._value))
      .classed('mixed', isMixed);

    this.$label
      .classed('set', !!this._value);

    if (this.type === 'onewayCheck' && this.$reverser) {
      this.$reverser
        .classed('hide', this._reverserHidden())
        .call(this._reverserSetText);
    }
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    if (!this.$input) return;   // called too early?
    this.$input.node().focus();
  }
}
