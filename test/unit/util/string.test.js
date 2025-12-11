import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('utilNormalizeString', () => {
  it('lowercases', () => {
    assert.equal(Rapid.utilNormalizeString('Aldo'), 'aldo');
  });

  it('replaces combined diacritics', () => {
    assert.equal(Rapid.utilNormalizeString('André'), 'andre');
  });

  it('normalizes combining diacritics', () => {
    assert.equal(Rapid.utilNormalizeString('Andre\u0301'), 'andre');
  });

  it('removes spaces', () => {
    assert.equal(Rapid.utilNormalizeString('Jimmy Choo'), 'jimmychoo');
  });

  it('removes various dashes', () => {
    assert.equal(Rapid.utilNormalizeString('PTV - Metropolitan'), 'ptvmetropolitan');  // hypen
    assert.equal(Rapid.utilNormalizeString('PTV \u2013 Metropolitan'), 'ptvmetropolitan');  // en dash (U+2013)
    assert.equal(Rapid.utilNormalizeString('PTV \u2014 Metropolitan'), 'ptvmetropolitan');  // em dash (U+2014)
    assert.equal(Rapid.utilNormalizeString('PTV \u2015 Metropolitan'), 'ptvmetropolitan');  // horizontal bar (U+2015)
  });

  it('removes unprintable unicode (like RTL/LTR marks, zero width space, zero width nonjoiner)', () => {
    assert.equal(Rapid.utilNormalizeString('\u200FJim\u200Bmy\u200CChoo\u200E'), 'jimmychoo');
  });

  it('removes punctuation', () => {
    assert.equal(Rapid.utilNormalizeString('K+K Schuh-Center'), 'kkschuhcenter');
  });

  it('replaces & with and', () => {
    assert.equal(Rapid.utilNormalizeString('Johnston & Murphy'), 'johnstonandmurphy');
  });

  it('replaces ß (eszett) with ss', () => {
    assert.equal(Rapid.utilNormalizeString('Beßon'), 'besson');
  });

  it('replaces İ (0130) or i̇ (0069 0307) with i', () => {   // NSI#5017, NSI#8261 for examples
    assert.equal(Rapid.utilNormalizeString('İnşaat'), 'insaat');
    assert.equal(Rapid.utilNormalizeString('i̇nşaat'), 'insaat');
  });

  it('returns empty string if no input', () => {
    assert.equal(Rapid.utilNormalizeString(), '');
    assert.equal(Rapid.utilNormalizeString(null), '');
    assert.equal(Rapid.utilNormalizeString({}), '');
  });

});
