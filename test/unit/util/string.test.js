import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('utilNormalizeString', () => {
  it('returns empty string if no input', () => {
    assert.strictEqual(Rapid.utilNormalizeString(), '');
    assert.strictEqual(Rapid.utilNormalizeString(null), '');
    assert.strictEqual(Rapid.utilNormalizeString({}), '');
  });

  it('lowercases', () => {
    assert.strictEqual(Rapid.utilNormalizeString('Aldo'), 'aldo');
  });

  it('replaces combined diacritics', () => {
    assert.strictEqual(Rapid.utilNormalizeString('André'), 'andre');
  });

  it('normalizes combining diacritics', () => {
    assert.strictEqual(Rapid.utilNormalizeString('Andre\u0301'), 'andre');
  });

  it('removes spaces', () => {
    assert.strictEqual(Rapid.utilNormalizeString('Jimmy Choo'), 'jimmychoo');
  });

  it('removes various dashes', () => {
    assert.strictEqual(Rapid.utilNormalizeString('PTV - Metropolitan'), 'ptvmetropolitan');  // hypen
    assert.strictEqual(Rapid.utilNormalizeString('PTV \u2013 Metropolitan'), 'ptvmetropolitan');  // en dash (U+2013)
    assert.strictEqual(Rapid.utilNormalizeString('PTV \u2014 Metropolitan'), 'ptvmetropolitan');  // em dash (U+2014)
    assert.strictEqual(Rapid.utilNormalizeString('PTV \u2015 Metropolitan'), 'ptvmetropolitan');  // horizontal bar (U+2015)
  });

  it('removes unprintable unicode (like RTL/LTR marks, zero width space, zero width nonjoiner)', () => {
    assert.strictEqual(Rapid.utilNormalizeString('\u200FJim\u200Bmy\u200CChoo\u200E'), 'jimmychoo');
  });

  it('removes punctuation', () => {
    assert.strictEqual(Rapid.utilNormalizeString('K+K Schuh-Center'), 'kkschuhcenter');
  });

  it('replaces & with and', () => {
    assert.strictEqual(Rapid.utilNormalizeString('Johnston & Murphy'), 'johnstonandmurphy');
  });

  it('replaces ß (eszett) with ss', () => {
    assert.strictEqual(Rapid.utilNormalizeString('Beßon'), 'besson');
  });

  it('replaces İ (0130) or i̇ (0069 0307) with i', () => {   // NSI#5017, NSI#8261 for examples
    assert.strictEqual(Rapid.utilNormalizeString('İnşaat'), 'insaat');
    assert.strictEqual(Rapid.utilNormalizeString('i̇nşaat'), 'insaat');
  });
});


describe('utilWildcard', () => {
  it('returns null if no input', () => {
    assert.isNull(Rapid.utilWildcard(),);
    assert.isNull(Rapid.utilWildcard(null));
    assert.isNull(Rapid.utilWildcard({}));
  });

  it('returns null if no wildcard chars', () => {
    assert.isNull(Rapid.utilWildcard('hello world'));
  });

  it(`replaces '*'`, () => {
    const result = Rapid.utilWildcard('he*o wo*');
    assert.instanceOf(result, RegExp);
    assert.strictEqual(result.toString(), '/^he.*o wo.*$/');
  });

  it(`replaces '?'`, () => {
    const result = Rapid.utilWildcard('he??o wor?d');
    assert.instanceOf(result, RegExp);
    assert.strictEqual(result.toString(), '/^he..o wor.d$/');
  });

  it('escapes special regex characters', () => {
    const result = Rapid.utilWildcard('hello .+^${}()|[]\\ *');
    assert.instanceOf(result, RegExp);
    assert.strictEqual(result.toString(), '/^hello \\.\\+\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\ .*$/');
  });

});
