import { select, selection } from 'd3-selection';
import { UiCombobox } from '../UiCombobox.ts';
import { UiField } from '../UiField.ts';
import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { TagChange, Tags } from './types.ts';
import type { UiFieldOptions } from '../UiField.ts';


const placeholdersByHighway: Record<string, Record<string, string>> = {
  footway: {
    foot: 'designated',
    motor_vehicle: 'no'
  },
  steps: {
    foot: 'yes',
    motor_vehicle: 'no',
    bicycle: 'no',
    horse: 'no'
  },
  pedestrian: {
    foot: 'yes',
    motor_vehicle: 'no'
  },
  cycleway: {
    motor_vehicle: 'no',
    bicycle: 'designated'
  },
  bridleway: {
    motor_vehicle: 'no',
    horse: 'designated'
  },
  path: {
    foot: 'yes',
    motor_vehicle: 'no',
    bicycle: 'yes',
    horse: 'yes'
  },
  motorway: {
    foot: 'no',
    motor_vehicle: 'yes',
    bicycle: 'no',
    horse: 'no'
  },
  trunk: {
    motor_vehicle: 'yes'
  },
  primary: {
    foot: 'yes',
    motor_vehicle: 'yes',
    bicycle: 'yes',
    horse: 'yes'
  },
  secondary: {
    foot: 'yes',
    motor_vehicle: 'yes',
    bicycle: 'yes',
    horse: 'yes'
  },
  tertiary: {
    foot: 'yes',
    motor_vehicle: 'yes',
    bicycle: 'yes',
    horse: 'yes'
  },
  residential: {
    foot: 'yes',
    motor_vehicle: 'yes',
    bicycle: 'yes',
    horse: 'yes'
  },
  unclassified: {
    foot: 'yes',
    motor_vehicle: 'yes',
    bicycle: 'yes',
    horse: 'yes'
  },
  service: {
    foot: 'yes',
    motor_vehicle: 'yes',
    bicycle: 'yes',
    horse: 'yes'
  },
  motorway_link: {
    foot: 'no',
    motor_vehicle: 'yes',
    bicycle: 'no',
    horse: 'no'
  },
  trunk_link: {
    motor_vehicle: 'yes'
  },
  primary_link: {
    foot: 'yes',
    motor_vehicle: 'yes',
    bicycle: 'yes',
    horse: 'yes'
  },
  secondary_link: {
    foot: 'yes',
    motor_vehicle: 'yes',
    bicycle: 'yes',
    horse: 'yes'
  },
  tertiary_link: {
    foot: 'yes',
    motor_vehicle: 'yes',
    bicycle: 'yes',
    horse: 'yes'
  },
  busway: {
    access: 'no',
    bus: 'designated',
    emergency: 'yes'
  }
};


/**
 * This UI component displays an access field.
 * It includes subfields for different modes of transport:
 *  "all", "foot", "motor vehicle", "bicycle", "horse"
 */
export class UiFieldAccess extends UiField {
  // D3 selections
  public $parent: D3Selection | null;
  public $items: D3Selection | null;

  protected _tags: Tags;


  /**
   * @constructor
   * @param context - Global shared application context
   * @param presetField - The preset field definition this field renders
   * @param entityIDs - The entities this field applies to
   * @param options - Field display options
   */
  public constructor(context: Context, presetField: Field, entityIDs: EntityID[] = [], options: Partial<UiFieldOptions> = {}) {
    super(context, presetField, entityIDs, options);

    // D3 selections
    this.$parent = null;
    this.$items = null;

    this._tags = {};

    this.renderContent = this.renderContent.bind(this);
    this._change = this._change.bind(this);
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
    const l10n = context.systems.l10n!;

    let $wrap: D3Selection = $parent.selectAll('.form-field-input-wrap')
      .data([0]);

    $wrap = $wrap.enter()
      .append('div')
      .attr('class', `form-field-input-wrap form-field-input-${this.type}`)
      .merge($wrap);

    let $list: D3Selection = $wrap.selectAll('ul')
      .data([0]);

    $list = $list.enter()
      .append('ul')
      .attr('class', 'rows')
      .merge($list);


    this.$items = $list.selectAll('li')
      .data(this.keys);

    // Enter
    const $$items = this.$items.enter()
      .append('li')
      .attr('class', d => `labeled-input preset-access-${d}`);

    const stringBase = `_tagging.presets.fields.${this.id}.types`;
    $$items
      .append('div')
      .attr('class', 'label preset-label-access')
      .attr('for', d => `preset-input-access-${d}`);

    $$items
      .append('div')
      .attr('class', 'preset-input-access-wrap')
      .append('input')
      .attr('type', 'text')
      .attr('class', d => `preset-input-access preset-input-access-${d}`)
      .call(utilNoAuto)
      .each((d, i, nodes) => {
        select(nodes[i])
          .call(new UiCombobox(context, `access-${d}`)
            .data(this._fieldOptions(d))
            .attach
          );
      });


    // Update
    this.$items = this.$items.merge($$items);

    // Set localized text on the update selection so it re-localizes on language change.
    this.$items.selectAll('.preset-label-access')
      .html(d => l10n.tHtml(`${stringBase}.${d}`));

    $wrap.selectAll('.preset-input-access')
      .on('change', this._change)
      .on('blur', this._change);
  }


  /**
   * Handles a change to one of the access inputs and dispatches the tag change.
   * @param d3_event - The triggering DOM event
   * @param d - The access type key (e.g. 'foot', 'bicycle')
   */
  protected _change(d3_event: Event, d: string): void {
    const context = this.context;

    const tagChange: TagChange = {};
    const value = context.cleanTagValue(utilGetSetValue(select(d3_event.currentTarget as any)) as string);

    // don't override multiple values with blank string
    if (!value && typeof this._tags[d] !== 'string') return;

    tagChange[d] = value || undefined;
    this.emit('change', tagChange);
  }


  /**
   * Returns the selectable options for this field.
   * @param type - The access type key to build options for
   * @return An array of `{ title, value }` option objects
   */
  public _fieldOptions(type: string): any[] {
    const l10n = this.context.systems.l10n!;

    const options = ['no', 'permissive', 'private', 'permit', 'destination'];

    if (type !== 'access') {
      options.unshift('yes');
      options.push('designated');

      if (type === 'bicycle') {
        options.push('dismount');
      }
    }

    const stringBase = `_tagging.presets.fields.${this.id}.options`;
    return options.map(val => {
      return {
        title: l10n.t(`${stringBase}.${val}.description`),
        value: val
      };
    });
  }


  /**
   * Updates the field UI to reflect the given entity tags.
   * @param tags - The entity tags to display
   */
  public syncTags(tags: Tags): void {
    if (!this.$items) return;   // called too early?

    const l10n = this.context.systems.l10n!;

    this._tags = tags;
    const t: any = tags;

    (utilGetSetValue(this.$items.selectAll('.preset-input-access'), (d: any) => {
      return typeof t[d] === 'string' ? t[d] : '';
    }) as D3Selection)
      .classed('mixed', (d: any) => {
        return t[d] && Array.isArray(t[d]);
      })
      .attr('title', (d: any) => {
        return t[d] && Array.isArray(t[d]) && t[d].filter(Boolean).join('\n');
      })
      .attr('placeholder', (d: any) => {
        if (t[d] && Array.isArray(t[d])) {
          return l10n.t('inspector.multiple_values');
        }
        if (d === 'access') {
          return 'yes';
        }
        if (t.access && typeof t.access === 'string') {
          return t.access;
        }
        if (t.highway) {
          if (typeof t.highway === 'string') {
            if (placeholdersByHighway[t.highway] && placeholdersByHighway[t.highway][d]) {
              return placeholdersByHighway[t.highway][d];
            }
          } else {
            const impliedAccesses = t.highway.filter(Boolean).map((highwayVal: string) => {
              return placeholdersByHighway[highwayVal] && placeholdersByHighway[highwayVal][d];
            }).filter(Boolean);

            if (impliedAccesses.length === t.highway.length && new Set(impliedAccesses).size === 1) {
              // if all the highway values have the same implied access for this type then use that
              return impliedAccesses[0];
            }
          }
        }
        return this.placeholder;
      });
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    if (!this.$items) return;   // called too early?

    (this.$items.selectAll('.preset-input-access').node() as HTMLElement).focus();
  }
}
