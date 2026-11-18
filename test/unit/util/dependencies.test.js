import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';
import { dependencies } from '../../../package.json' with { type: 'json' };


describe('utilDependencyVersion', () => {
  it('returns the version from package.json, without the range prefix', () => {
    const expected = dependencies['maplibre-gl'].replace(/^[\^~]/, '');
    assert.strictEqual(Rapid.utilDependencyVersion('maplibre-gl'), expected);
    assert.match(expected, /^\d+\.\d+\.\d+/);
  });

  it('handles scoped package names', () => {
    const expected = dependencies['@openstreetmap/id-tagging-schema'].replace(/^[\^~]/, '');
    assert.strictEqual(Rapid.utilDependencyVersion('@openstreetmap/id-tagging-schema'), expected);
  });

  it('keeps a prerelease suffix', () => {
    const expected = dependencies['@rapid-sdk/math'].replace(/^[\^~]/, '');
    assert.strictEqual(Rapid.utilDependencyVersion('@rapid-sdk/math'), expected);
  });

  it('returns undefined for a specifier that is not a plain version', () => {
    assert.match(dependencies['editor-layer-index'], /^github:/);
    assert.isUndefined(Rapid.utilDependencyVersion('editor-layer-index'));
  });

  it('returns undefined for a package that is not a dependency', () => {
    assert.isUndefined(Rapid.utilDependencyVersion('not-a-real-package'));
    assert.isUndefined(Rapid.utilDependencyVersion('typescript'));   // a devDependency
  });
});


describe('utilCDNPath', () => {
  const version = Rapid.utilDependencyVersion('maplibre-gl');

  it('returns the package root without an asset', () => {
    assert.strictEqual(Rapid.utilCDNPath('maplibre-gl'), `https://cdn.jsdelivr.net/npm/maplibre-gl@${version}`);
  });

  it('appends the asset path', () => {
    assert.strictEqual(Rapid.utilCDNPath('maplibre-gl', 'dist'), `https://cdn.jsdelivr.net/npm/maplibre-gl@${version}/dist`);
    assert.strictEqual(Rapid.utilCDNPath('maplibre-gl', '/dist/maplibre-gl.min.css'), `https://cdn.jsdelivr.net/npm/maplibre-gl@${version}/dist/maplibre-gl.min.css`);
  });

  it('handles scoped package names', () => {
    const v = Rapid.utilDependencyVersion('@openstreetmap/id-tagging-schema');
    assert.strictEqual(Rapid.utilCDNPath('@openstreetmap/id-tagging-schema', 'dist'), `https://cdn.jsdelivr.net/npm/@openstreetmap/id-tagging-schema@${v}/dist`);
  });

  it('throws for a package without an exact version', () => {
    assert.throws(() => Rapid.utilCDNPath('editor-layer-index'), /no exact version/);
    assert.throws(() => Rapid.utilCDNPath('not-a-real-package'), /no exact version/);
  });
});
