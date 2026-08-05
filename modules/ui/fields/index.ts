export * from './UiFieldCheck.js';
export * from './UiFieldCombo.js';
export * from './UiFieldText.js';
export * from './UiFieldAccess.js';
export * from './UiFieldAddress.js';
export * from './UiFieldCycleway.js';
export * from './UiFieldLanes.js';
export * from './UiFieldLocalized.js';
export * from './UiFieldRoadspeed.js';
export * from './UiFieldRadio.js';
export * from './UiFieldRestrictions.js';
export * from './UiFieldTextarea.js';
export * from './UiFieldWikidata.js';
export * from './UiFieldWikipedia.js';

import {
  UiFieldCheck,
  UiFieldDefaultCheck,
  UiFieldOnewayCheck
} from './UiFieldCheck.js';

import {
  UiFieldCombo,
  UiFieldManyCombo,
  UiFieldMultiCombo,
  UiFieldNetworkCombo,
  UiFieldSemiCombo,
  UiFieldTypeCombo
} from './UiFieldCombo.js';

import {
  UiFieldEmail,
  UiFieldIdentifier,
  UiFieldNumber,
  UiFieldTel,
  UiFieldText,
  UiFieldUrl
} from './UiFieldText.js';

import {
  UiFieldRadio,
  UiFieldStructureRadio
} from './UiFieldRadio.js';

import { UiFieldAccess } from './UiFieldAccess.js';
import { UiFieldAddress } from './UiFieldAddress.js';
import { UiFieldCycleway } from './UiFieldCycleway.js';
import { UiFieldLanes } from './UiFieldLanes.js';
import { UiFieldLocalized } from './UiFieldLocalized.js';
import { UiFieldRoadspeed } from './UiFieldRoadspeed.js';
import { UiFieldRestrictions } from './UiFieldRestrictions.js';
import { UiFieldTextarea } from './UiFieldTextarea.js';
import { UiFieldWikidata } from './UiFieldWikidata.js';
import { UiFieldWikipedia } from './UiFieldWikipedia.js';

import type { Context } from '../../Context.ts';
import type { UiField } from '../UiField.js';


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
