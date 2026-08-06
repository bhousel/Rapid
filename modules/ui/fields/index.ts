export * from './UiFieldCheck.ts';
export * from './UiFieldCombo.ts';
export * from './UiFieldText.ts';
export * from './UiFieldAccess.ts';
export * from './UiFieldAddress.ts';
export * from './UiFieldCycleway.ts';
export * from './UiFieldLanes.ts';
export * from './UiFieldLocalized.ts';
export * from './UiFieldRoadspeed.ts';
export * from './UiFieldRadio.ts';
export * from './UiFieldRestrictions.ts';
export * from './UiFieldTextarea.ts';
export * from './UiFieldWikidata.ts';
export * from './UiFieldWikipedia.ts';

import {
  UiFieldCheck,
  UiFieldDefaultCheck,
  UiFieldOnewayCheck
} from './UiFieldCheck.ts';

import {
  UiFieldCombo,
  UiFieldManyCombo,
  UiFieldMultiCombo,
  UiFieldNetworkCombo,
  UiFieldSemiCombo,
  UiFieldTypeCombo
} from './UiFieldCombo.ts';

import {
  UiFieldEmail,
  UiFieldIdentifier,
  UiFieldNumber,
  UiFieldTel,
  UiFieldText,
  UiFieldUrl
} from './UiFieldText.ts';

import {
  UiFieldRadio,
  UiFieldStructureRadio
} from './UiFieldRadio.ts';

import { UiFieldAccess } from './UiFieldAccess.ts';
import { UiFieldAddress } from './UiFieldAddress.ts';
import { UiFieldCycleway } from './UiFieldCycleway.ts';
import { UiFieldLanes } from './UiFieldLanes.ts';
import { UiFieldLocalized } from './UiFieldLocalized.ts';
import { UiFieldRoadspeed } from './UiFieldRoadspeed.ts';
import { UiFieldRestrictions } from './UiFieldRestrictions.ts';
import { UiFieldTextarea } from './UiFieldTextarea.ts';
import { UiFieldWikidata } from './UiFieldWikidata.ts';
import { UiFieldWikipedia } from './UiFieldWikipedia.ts';

import type { Context } from '../../Context.ts';
import type { UiField } from '../UiField.ts';


/** A field constructor: creates a `UiField` subclass for a given field type. */
export type UiFieldConstructor = (new (
  context: Context,
  presetField: any,
  entityIDs?: EntityID[],
  options?: any
) => UiField) & {
  supportsMultiselection?: boolean;
};


export const uiFields: Record<string, UiFieldConstructor> = {
  access: UiFieldAccess,
  address: UiFieldAddress,
  check: UiFieldCheck,
  combo: UiFieldCombo,
  cycleway: UiFieldCycleway,
  defaultCheck: UiFieldDefaultCheck,
  email: UiFieldEmail,
  identifier: UiFieldIdentifier,
  lanes: UiFieldLanes,
  localized: UiFieldLocalized,
  roadspeed: UiFieldRoadspeed,
  roadheight: UiFieldText,
  manyCombo: UiFieldManyCombo,
  multiCombo: UiFieldMultiCombo,
  networkCombo: UiFieldNetworkCombo,
  number: UiFieldNumber,
  onewayCheck: UiFieldOnewayCheck,
  radio: UiFieldRadio,
  restrictions: UiFieldRestrictions,
  semiCombo: UiFieldSemiCombo,
  structureRadio: UiFieldStructureRadio,
  tel: UiFieldTel,
  text: UiFieldText,
  textarea: UiFieldTextarea,
  typeCombo: UiFieldTypeCombo,
  url: UiFieldUrl,
  wikidata: UiFieldWikidata,
  wikipedia: UiFieldWikipedia
};


/**
 * Creates the `UiField` for a preset field, choosing the subclass by `presetField.type`.
 * @param context - Global shared application context
 * @param presetField - the Field definition tracked by the SchemaSystem
 * @param entityIDs - the entities this field applies to
 * @param options - field display options
 * @return the constructed `UiField` subclass instance
 * @throws Error if there is no field type registered for `presetField.type`
 */
export function createUiField(
  context: Context,
  presetField: any,
  entityIDs: EntityID[] = [],
  options: any = {}
): UiField {
  const ctor = uiFields[presetField.type];
  if (!ctor) {
    throw new Error(`No field type registered for "${presetField.type}"`);
  }
  return new ctor(context, presetField, entityIDs, options);
}
