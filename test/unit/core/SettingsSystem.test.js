import { afterAll, afterEach, beforeAll, beforeEach, describe, it, mock } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


// Legacy localStorage keys touched by the v0->v1 migration.
const LEGACY_KEYS = [
  'background-custom-template', 'background-favorites', 'background-last-used',
  'background-last-used-toggle', 'background-opacity', 'preset_recents',
  'preferences.privacy.thirdpartyicons', 'prefs.mouse_wheel.interaction',
  'rapid-internal-feature.allowLargeEdits', 'rapid-internal-feature.previewDatasets',
  'rapid-internal-feature.showAutoFix', 'rapid-internal-feature.tagnosticRoadCombine',
  'sawRapidSplash', 'sawPrivacyVersion', 'sawVersion', 'sawWhatsNewVersion',
  'settings-custom-data-url', 'validate-square-degrees', 'validate-what', 'validate-where',
  'validate-disabledRules', 'turn-restriction-distance', 'turn-restriction-via-way0',
  'walkthrough_completed', 'walkthrough_started', 'walkthrough_progress',
  'inspector.collapsed', 'inspector.width', 'entity-issues.reference.expanded',
  'raw-tag-editor-view', 'disabled-features', 'area-fill', 'area-fill-toggle'
];


describe('SettingsSystem', () => {
  let context;
  let storage;

  // Remove any settings + legacy keys so tests don't leak into one another.
  function cleanStorage() {
    for (const key of storage.keys()) {
      if (key.startsWith('rapid.settings.')) {
        storage.removeItem(key);
      }
    }
    for (const key of LEGACY_KEYS) {
      storage.removeItem(key);
    }
  }

  beforeEach(() => {
    context = new Rapid.MockContext();
    context.version = '3.0.0-test';
    storage = new Rapid.StorageSystem(context);
    context.systems.storage = storage;
    cleanStorage();
  });

  afterEach(() => {
    cleanStorage();
  });


  describe('lifecycle', () => {
    it('constructs a SettingsSystem from a context', () => {
      const settings = new Rapid.SettingsSystem(context);
      assert.instanceOf(settings, Rapid.SettingsSystem);
      assert.strictEqual(settings.id, 'settings');
      assert.strictEqual(settings.context, context);
      assert.isTrue(settings.requiredDependencies.has('storage'));
    });

    it('inits and starts', () => {
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => settings.startAsync())
        .then(() => assert.isTrue(settings.started));
    });

    it('rejects init if the storage dependency is missing', () => {
      context.systems.storage = undefined;
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => assert.fail('Promise was fulfilled but should have been rejected'))
        .catch(err => assert.match(String(err), /requires storage/i));
    });

    it('reports the current settings version', () => {
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => assert.strictEqual(settings.settingsVersion, 1));
    });
  });


  describe('get / set / has / unset', () => {
    let settings;

    beforeEach(() => {
      settings = new Rapid.SettingsSystem(context);
      return settings.initAsync();
    });

    it('sets and gets a nested value', () => {
      settings.set('imagery.custom[0].template', 'https://example.com/{z}/{x}/{y}.png');
      assert.strictEqual(settings.get('imagery.custom[0].template'), 'https://example.com/{z}/{x}/{y}.png');
    });

    it('returns undefined for a missing path', () => {
      assert.isUndefined(settings.get('imagery.nope'));
    });

    it('returns the fallback for a missing path', () => {
      assert.strictEqual(settings.get('imagery.nope', 'default'), 'default');
    });

    it('reports presence with has()', () => {
      assert.isFalse(settings.has('ui.sawRapidSplash'));
      settings.set('ui.sawRapidSplash', true);
      assert.isTrue(settings.has('ui.sawRapidSplash'));
    });

    it('stores whole objects and arrays', () => {
      settings.set('schema.presetRecents', ['highway/residential', 'building']);
      assert.deepEqual(settings.get('schema.presetRecents'), ['highway/residential', 'building']);
    });

    it('unsets a value', () => {
      settings.set('ui.width', '240');
      settings.unset('ui.width');
      assert.isUndefined(settings.get('ui.width'));
    });

    it('compacts arrays when unsetting an indexed element', () => {
      settings.set('imagery.custom[0].name', 'A');
      settings.set('imagery.custom[1].name', 'B');
      settings.set('imagery.custom[2].name', 'C');
      settings.unset('imagery.custom[1]');

      assert.strictEqual(settings.get('imagery.custom[0].name'), 'A');
      assert.strictEqual(settings.get('imagery.custom[1].name'), 'C');
      assert.isUndefined(settings.get('imagery.custom[2].name'));
    });

    it('returns copies from get() so callers cannot mutate internal state', () => {
      settings.set('imagery.favorites', ['a', 'b']);
      const favorites = settings.get('imagery.favorites');
      favorites.push('c');
      assert.deepEqual(settings.get('imagery.favorites'), ['a', 'b']);
    });

    it('returns a copy from getAll()', () => {
      settings.set('ui.width', '240');
      const all = settings.getAll();
      all.ui.width = '999';
      assert.strictEqual(settings.get('ui.width'), '240');
    });

    it('throws on an empty path', () => {
      assert.throws(() => settings.set('', 1), /empty/i);
    });

    it('throws when writing to the reserved meta namespace', () => {
      assert.throws(() => settings.set('meta.settingsVersion', 5), /reserved/i);
      assert.throws(() => settings.unset('meta.updatedAt'), /reserved/i);
    });

    it('emits a settingschange event on set', () => {
      let fired = 0;
      settings.on('settingschange', () => fired++);
      settings.set('ui.width', '240');
      assert.strictEqual(fired, 1);
    });
  });


  describe('value type fidelity', () => {
    it('round-trips string values losslessly through storage', () => {
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => {
          settings.set('a.str', '123');       // numeric-looking string stays a string
          settings.set('a.strBool', 'true');  // boolean-looking string stays a string
          settings.set('a.url', 'https://example.com/{z}/{x}/{y}.png');

          // Reload from the same storage to force a full encode/decode cycle.
          const reloaded = new Rapid.SettingsSystem(context);
          return reloaded.initAsync().then(() => {
            assert.strictEqual(reloaded.get('a.str'), '123');
            assert.strictEqual(reloaded.get('a.strBool'), 'true');
            assert.strictEqual(reloaded.get('a.url'), 'https://example.com/{z}/{x}/{y}.png');
          });
        });
    });
  });


  describe('persistence', () => {
    it('persists across instances sharing the same storage', () => {
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => {
          settings.set('imagery.custom[0].name', 'Sample');
          settings.set('imagery.custom[0].template', 'https://example.com/a');

          const reloaded = new Rapid.SettingsSystem(context);
          return reloaded.initAsync().then(() => {
            assert.strictEqual(reloaded.get('imagery.custom[0].name'), 'Sample');
            assert.strictEqual(reloaded.get('imagery.custom[0].template'), 'https://example.com/a');
          });
        });
    });

    it('removes stale keys when a value is unset', () => {
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => {
          settings.set('imagery.custom[0].name', 'Sample');
          assert.isTrue(storage.keys().some(k => k === 'rapid.settings.imagery.custom[0].name'));
          settings.unset('imagery.custom[0]');
          assert.isFalse(storage.keys().some(k => k === 'rapid.settings.imagery.custom[0].name'));
        });
    });

    it('does not wipe settings on resetAsync (durable preferences)', () => {
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => {
          settings.set('ui.sawRapidSplash', 'true');
          return settings.resetAsync();
        })
        .then(() => assert.strictEqual(settings.get('ui.sawRapidSplash'), 'true'));
    });
  });


  describe('legacy migration', () => {
    it('imports legacy keys on first init when the new keyspace is empty', () => {
      storage.setItem('background-custom-template', 'https://legacy.example/{z}/{x}/{y}.png');
      storage.setItem('background-favorites', JSON.stringify(['EsriWorldImagery']));
      storage.setItem('background-opacity', '0.5');
      storage.setItem('preset_recents', JSON.stringify(['building', { id: 'highway/residential' }]));
      storage.setItem('preferences.privacy.thirdpartyicons', 'false');
      storage.setItem('sawWhatsNewVersion', '20241222');
      storage.setItem('rapid-internal-feature.allowLargeEdits', 'true');
      storage.setItem('walkthrough_progress', 'welcome;point');

      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => {
          assert.strictEqual(settings.get('imagery.custom[0].template'), 'https://legacy.example/{z}/{x}/{y}.png');
          assert.strictEqual(settings.get('imagery.custom[0].name'), 'Custom');
          assert.deepEqual(settings.get('imagery.favorites'), ['EsriWorldImagery']);
          assert.strictEqual(settings.get('imagery.opacity'), '0.5');
          assert.deepEqual(settings.get('schema.presetRecents'), ['building', 'highway/residential']);
          assert.strictEqual(settings.get('ui.privacy.thirdPartyIcons'), 'false');
          assert.strictEqual(settings.get('ui.sawWhatsNewVersion'), '20241222');
          assert.strictEqual(settings.get('poweruser.allowLargeEdits'), 'true');
          assert.strictEqual(settings.get('ui.walkthrough.progress'), 'welcome;point');
        });
    });

    it('preserves numeric-looking strings during migration', () => {
      storage.setItem('walkthrough_progress', '123');

      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => assert.strictEqual(settings.get('ui.walkthrough.progress'), '123'));
    });

    it('does not re-run migration when the new keyspace already exists', () => {
      const first = new Rapid.SettingsSystem(context);
      return first.initAsync()
        .then(() => {
          first.set('imagery.custom[0].template', 'https://kept.example/a');

          // A legacy key appears after the initial migration; it must NOT clobber saved settings.
          storage.setItem('background-custom-template', 'https://legacy.example/should-not-win');

          const second = new Rapid.SettingsSystem(context);
          return second.initAsync().then(() => {
            assert.strictEqual(second.get('imagery.custom[0].template'), 'https://kept.example/a');
          });
        });
    });
  });


  describe('toJSON / fromJSON', () => {
    it('round-trips settings through an envelope', () => {
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => {
          settings.set('ui.sawWhatsNewVersion', '42');
          settings.set('imagery.custom[0].name', 'Sample');

          const envelope = settings.toJSON();
          assert.strictEqual(envelope.rapid.settingsVersion, 1);
          assert.strictEqual(envelope.rapid.settings.ui.sawWhatsNewVersion, '42');

          const fresh = new Rapid.SettingsSystem(context);
          return fresh.initAsync().then(() => {
            fresh.fromJSON(envelope);
            assert.strictEqual(fresh.get('ui.sawWhatsNewVersion'), '42');
            assert.strictEqual(fresh.get('imagery.custom[0].name'), 'Sample');
          });
        });
    });

    it('falls back to empty settings for a malformed envelope', () => {
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => {
          settings.fromJSON({});
          assert.deepEqual(settings.getAll(), {});
        });
    });
  });


  describe('remote sync', () => {
    const orig = console.warn;
    const spyWarn = mock();

    beforeAll(() => {
      console.warn = spyWarn;
    });

    beforeEach(() => {
      spyWarn.mockClear();  // reset call count
    });

    afterAll(() => {
      console.warn = orig;
    });

    // A minimal stand-in for OsmService's single-key preference API.
    function makeMockOsm(opts = {}) {
      const authenticated = opts.authenticated ?? true;
      const state = { preferences: { ...(opts.preferences || {}) }, puts: [], deletes: [] };
      return {
        authenticated: () => authenticated,
        getUserPreferencesAsync: () => Promise.resolve({ ...state.preferences }),
        putUserPreferenceAsync: (key, value) => {
          state.puts.push([key, value]);
          state.preferences[key] = value;
          return Promise.resolve();
        },
        deleteUserPreferenceAsync: (key) => {
          state.deletes.push(key);
          delete state.preferences[key];
          return Promise.resolve();
        },
        _state: state
      };
    }

    it('pushRemoteAsync reports no-osm-service when OSM is unavailable', () => {
      context.services = {};
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => settings.pushRemoteAsync())
        .then(result => assert.deepEqual(result, { ok: false, reason: 'no-osm-service' }));
    });

    it('pushRemoteAsync reports not-authenticated when logged out', () => {
      context.services = { osm: makeMockOsm({ authenticated: false }) };
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => settings.pushRemoteAsync())
        .then(result => assert.deepEqual(result, { ok: false, reason: 'not-authenticated' }));
    });

    it('pushRemoteAsync sends single-key PUTs for changed settings and leaves other prefs untouched', () => {
      const osm = makeMockOsm({ preferences: { 'some.other.pref': 'keepme' } });
      context.services = { osm };
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => {
          settings.set('ui.sawWhatsNewVersion', '42');
          return settings.pushRemoteAsync();
        })
        .then(result => {
          assert.isTrue(result.ok);
          assert.strictEqual(osm._state.preferences['some.other.pref'], 'keepme');   // untouched
          assert.strictEqual(osm._state.preferences['rapid.settings.ui.sawWhatsNewVersion'], '42');
          assert.strictEqual(osm._state.preferences['rapid.settings.meta.updatedAt'], settings.toJSON().rapid.updatedAt);
          const putKeys = osm._state.puts.map(([k]) => k);
          assert.include(putKeys, 'rapid.settings.ui.sawWhatsNewVersion');
          assert.notInclude(osm._state.deletes, 'some.other.pref');   // never touches non-Rapid keys
        });
    });

    it('pushRemoteAsync skips empty and oversized values', () => {
      const osm = makeMockOsm();
      context.services = { osm };
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => {
          settings.set('imagery.custom[0].template', '');   // empty -> can't be stored remotely
          settings.set('ui.big', 'x'.repeat(256));          // oversized -> skipped
          settings.set('ui.small', 'ok');
          return settings.pushRemoteAsync();
        })
        .then(result => {
          assert.isTrue(result.ok);
          assert.isUndefined(osm._state.preferences['rapid.settings.imagery.custom[0].template']);
          assert.isUndefined(osm._state.preferences['rapid.settings.ui.big']);
          assert.strictEqual(osm._state.preferences['rapid.settings.ui.small'], 'ok');
          const putKeys = osm._state.puts.map(([k]) => k);
          assert.notInclude(putKeys, 'rapid.settings.imagery.custom[0].template');
          assert.notInclude(putKeys, 'rapid.settings.ui.big');
        });
    });

    it('pushRemoteAsync deletes remote keys that are no longer set locally', () => {
      const osm = makeMockOsm();
      context.services = { osm };
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => {
          settings.set('ui.foo', 'bar');
          return settings.pushRemoteAsync();
        })
        .then(() => {
          assert.strictEqual(osm._state.preferences['rapid.settings.ui.foo'], 'bar');
          settings.unset('ui.foo');
          return settings.pushRemoteAsync();
        })
        .then(result => {
          assert.isTrue(result.ok);
          assert.isUndefined(osm._state.preferences['rapid.settings.ui.foo']);
          assert.include(osm._state.deletes, 'rapid.settings.ui.foo');
        });
    });

    it('pushRemoteAsync does not re-send unchanged settings on a subsequent push', () => {
      const osm = makeMockOsm();
      context.services = { osm };
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => {
          settings.set('ui.foo', 'bar');
          return settings.pushRemoteAsync();
        })
        .then(() => {
          const putCount = osm._state.puts.length;
          return settings.pushRemoteAsync().then(result => {
            assert.deepEqual(result, { ok: true, reason: 'up-to-date' });
            assert.strictEqual(osm._state.puts.length, putCount);   // no additional PUTs
          });
        });
    });

    it('pullRemoteAsync applies remote settings when the remote copy is newer', () => {
      const future = new Date(Date.now() + 60000).toISOString();
      const osm = makeMockOsm({
        preferences: {
          'rapid.settings.meta.updatedAt': future,
          'rapid.settings.ui.sawWhatsNewVersion': '99'
        }
      });
      context.services = { osm };
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => settings.pullRemoteAsync())
        .then(result => {
          assert.deepEqual(result, { ok: true, reason: 'pulled' });
          assert.strictEqual(settings.get('ui.sawWhatsNewVersion'), '99');
        });
    });

    it('pullRemoteAsync keeps local settings when the local copy is newer', () => {
      const past = new Date(Date.now() - 60000).toISOString();
      const osm = makeMockOsm({
        preferences: {
          'rapid.settings.meta.updatedAt': past,
          'rapid.settings.ui.sawWhatsNewVersion': '1'
        }
      });
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => {
          settings.set('ui.sawWhatsNewVersion', '2');   // bumps local updatedAt to now (newer than `past`)
          context.services = { osm };                   // attach OSM *after* the local edit, so no auto-push clobbers `past`
          return settings.pullRemoteAsync();
        })
        .then(result => {
          assert.deepEqual(result, { ok: true, reason: 'local-newer' });
          assert.strictEqual(settings.get('ui.sawWhatsNewVersion'), '2');
        });
    });
  });
});
