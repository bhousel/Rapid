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
// import { UiFieldRestrictions } from './UiFieldRestrictions.js';
import { UiFieldTextarea } from './UiFieldTextarea.js';
import { UiFieldWikidata } from './UiFieldWikidata.js';
import { UiFieldWikipedia } from './UiFieldWikipedia.js';

import type { Context } from '../../Context.ts';
import type { UiFieldInternal } from './types.ts';


/** A field constructor: creates the internal implementation for a field type. */
export type UiFieldConstructor = (new (context: Context, uifield: any) => UiFieldInternal) & {
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
    // restrictions: UiFieldRestrictions,
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
