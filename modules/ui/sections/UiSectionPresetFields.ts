import { dispatch as d3_dispatch } from 'd3-dispatch';
import { utilArrayIdentical, utilArrayUnion } from '@rapid-sdk/util';

import { AbstractUiSection } from '../AbstractUiSection.js';
import { UiField } from '../UiField.js';
import { uiFormFields } from '../form_fields.js';
import { utilRebind } from '../../util/rebind.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


export class UiSectionPresetFields extends AbstractUiSection {
  public dispatch: any;
  /** Added at runtime by `utilRebind` */
  public on!: (...args: any[]) => any;

  protected _formFields: any;
  protected _state: string | undefined;    // can be 'hide', 'hover', or 'select'
  protected _uifields: any[] | null;
  protected _presets: any[];
  protected _tags: any;
  protected _entityIDs: EntityID[];

  public constructor(context: Context) {
    super(context, 'preset-fields');
    this._formFields = uiFormFields(context);
    this._state = undefined;
    this._uifields = null;
    this._presets = [];
    this._tags = undefined;
    this._entityIDs = [];

    this.dispatch = d3_dispatch('change', 'revert');
    utilRebind(this as any, this.dispatch, 'on');
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

      let allFields: any[] = [];
      let allMoreFields: any[] = [];
      let sharedTotalFields: any[] | undefined;

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
        this._uifields.push(new UiField(context, field, this._entityIDs));
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
        this._uifields.push(new UiField(context, field, this._entityIDs, { show: false }) );
      }

      const ids = this._entityIDs.slice();  // make copy (eslint warning)
      for (const uifield of this._uifields) {
        uifield.on('change', (t: any, onInput: boolean) => {
          this.dispatch.call('change', uifield, ids, t, onInput);
        });
        uifield.on('revert', (keys: string[]) => {
          this.dispatch.call('revert', uifield, keys);
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
  public presets(val?: any[]): any {
    if (!arguments.length) return this._presets;
    if (!this._presets || !val || !utilArrayIdentical(this._presets, val)) {
      this._presets = val as any[];
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
  public tags(val?: any): any {
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
