import { describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('validationDuplicateWaySegments', () => {
  const context = new Rapid.MockContext();
  context.systems = {
    l10n:  new Rapid.LocalizationSystem(context)
  };

  const validator = Rapid.validationDuplicateWaySegments(context);

});
