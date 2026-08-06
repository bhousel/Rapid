import { utilArrayIdentical, utilArrayUnion } from '@rapid-sdk/util';
import { AbstractUiSection } from './AbstractUiSection.ts';
import { createUiField } from '../fields/index.ts';
import { uiFormFields } from '../form_fields.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { Preset } from '../../lib/Preset.ts';
import type { Tags } from '../fields/types.ts';
import type { UiField } from '../UiField.ts';


export class UiSectionPresetFields extends AbstractUiSection {
  protected _formFields: any;
  protected _state: string | undefined;    // can be 'hide', 'hover', or 'select'
  protected _uifields: UiField[] | null;
  protected _presets: Preset[];
  protected _tags: Tags | undefined;
  protected _entityIDs: EntityID[];


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'preset-fields');

    this._formFields = uiFormFields(context);
    this._state = undefined;
    this._uifields = null;
    this._presets = [];
    this._tags = undefined;
    this._entityIDs = [];
  }


  /**
   * The disclosure heading label — "Fields".
   * @return Localized heading text
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('inspector.fields');
  }


  /**
   * Builds (once) and renders the preset fields form into the selection.
   * @param $selection - A d3-selection to the HTMLElement this content renders into
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;
    const scope = schema.getScope('osm');

    if (!this._uifields) {
      const graph = editor.staging.graph;
      const localeCode = l10n.localeCode;

      const allGeometries = new Set<string>();
      for (const entityID of this._entityIDs) {
        const entity = graph.entity(entityID);
        const geometry = entity.geometry(graph);
        allGeometries.add(geometry);
      }

      let allFields: Field[] = [];
      let allMoreFields: Field[] = [];
      let sharedTotalFields: Field[] | undefined;

      for (const preset of this._presets) {
        const fields = preset.fields();
        const moreFields = preset.moreFields();

        allFields = utilArrayUnion(allFields, fields);
        allMoreFields = utilArrayUnion(allMoreFields, moreFields);

        if (!sharedTotalFields) {
          sharedTotalFields = utilArrayUnion(fields, moreFields);
        } else {
          sharedTotalFields = sharedTotalFields.filter(field => {
            return fields.includes(field) || moreFields.includes(field);
          });
        }
      }

      const sharedFields = allFields.filter(field => sharedTotalFields!.includes(field));
      const sharedMoreFields = allMoreFields.filter(field => sharedTotalFields!.includes(field));

      this._uifields = [];
      for (const field of sharedFields) {
        if (!(allGeometries as any).isSubsetOf(field.geometries)) continue;  // skip fields that don't support all geometries needed
        this._uifields.push(createUiField(context, field, this._entityIDs));
      }

//    let singularEntity = _entityIDs.length === 1 && graph.hasEntity(_entityIDs[0]);
//    const restrictions = scope?.fields.get('restrictions');
//    if (restrictions && singularEntity?.isHighwayIntersection(graph)) {
//      this._uifields.push(new UiField(context, restrictions, this._entityIDs));
//    }

      const additionalFields = utilArrayUnion(sharedMoreFields, [...(scope?.universal?.values() ?? [])]);
      additionalFields.sort((field1, field2) => {
        return field1.label.localeCompare(field2.label, localeCode);
      });

      for (const field of additionalFields) {
        if (sharedFields.includes(field)) continue;                 // skip fields that were already included above
        if (!(allGeometries as any).isSubsetOf(field.geometries)) continue;  // skip fields that don't support all geometries needed
        this._uifields.push(createUiField(context, field, this._entityIDs, { show: false }) );
      }

      const ids = this._entityIDs.slice();  // make copy (eslint warning)
      for (const uifield of this._uifields) {
        uifield.on('change', (t: Tags, onInput: boolean) => {
          this.emit('change', ids, t, onInput);
        });
        uifield.on('revert', (keys: string[]) => {
          this.emit('revert', keys);
        });
      }
    }

    for (const uifield of this._uifields) {
      uifield.state(this._state).tags(this._tags);
    }


    $selection
      .call(this._formFields
        .fieldsArr(this._uifields)
        .state(this._state as string)
        .klass('grouped-items-area')
      );


    $selection.selectAll('.wrap-form-field input')
      .on('keydown', function(d3_event: KeyboardEvent) {
        // if user presses enter, and combobox is not active, accept edits..
        if (d3_event.keyCode === 13 && context.container().select('.combobox').empty()) {   // ↩ Return
          context.enter('browse');
        }
      });
  }


  /**
   * Gets or sets the presets, invalidating the cached fields when changed.
   * @param val - the new presets, or omit to get the current value
   * @return the current presets (getter) or `this` (setter)
   */
  public presets(val?: Preset[]): any {
    if (!arguments.length) return this._presets;
    if (!this._presets || !val || !utilArrayIdentical(this._presets, val)) {
      this._presets = val ?? [];
      this._uifields = null;
    }
    return this;
  }


  /**
   * Gets or sets the editor state ('hide', 'hover', or 'select').
   * @param val - the new state, or omit to get the current value
   * @return the current state (getter) or `this` (setter)
   */
  public state(val?: string): any {
    if (!arguments.length) return this._state;
    this._state = val;
    return this;
  }


  /**
   * Gets or sets the tags being edited (does not invalidate the fields).
   * @param val - the new tags, or omit to get the current value
   * @return the current tags (getter) or `this` (setter)
   */
  public tags(val?: Tags): any {
    if (!arguments.length) return this._tags;
    this._tags = val;
    // Don't reset _uifields here.
    return this;
  }


  /**
   * Gets or sets the entity IDs being edited, invalidating the cached fields when changed.
   * @param val - the new entity IDs, or omit to get the current value
   * @return the current entity IDs (getter) or `this` (setter)
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._entityIDs;
    if (!val || !this._entityIDs || !utilArrayIdentical(this._entityIDs, val)) {
      this._entityIDs = val as EntityID[];
      this._uifields = null;
    }
    return this;
  }
}
