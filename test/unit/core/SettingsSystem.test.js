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

    // A minimal stand-in for OsmService's user details and single-key preference API.
    // `failPuts` lists keys whose PUT should fail.
    function makeMockOsm(opts = {}) {
      const state = {
        authenticated: opts.authenticated ?? true,
        userID: opts.userID ?? 1,
        preferences: { ...(opts.preferences || {}) },
        puts: [],
        deletes: [],
        failPuts: new Set(opts.failPuts || [])
      };
      return {
        wwwroot: 'https://www.openstreetmap.org',
        authenticated: () => state.authenticated,
        getUserDetailsAsync: () => Promise.resolve({ id: state.userID }),
        getUserPreferencesAsync: () => Promise.resolve({ ...state.preferences }),
        putUserPreferenceAsync: (key, value) => {
          if (state.failPuts.has(key)) return Promise.reject(new Error('nope'));
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

    // A SettingsSystem that syncs `ui.foo` and `imagery.favorites`, with OSM attached after
    // any local setup, so that setup doesn't start a sync on its own.
    function makeSettings(osm, setup) {
      const settings = new Rapid.SettingsSystem(context);
      settings.registerSync(['ui.foo', 'imagery.favorites']);
      return settings.initAsync()
        .then(() => {
          context.services = {};
          setup?.(settings);
          context.services = { osm };
          return settings;
        });
    }

    it('reports no-osm-service when OSM is unavailable', () => {
      context.services = {};
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => settings.syncRemote())
        .then(result => assert.deepEqual(result, { ok: false, reason: 'no-osm-service' }));
    });

    it('reports not-authenticated when logged out', () => {
      context.services = { osm: makeMockOsm({ authenticated: false }) };
      const settings = new Rapid.SettingsSystem(context);
      return settings.initAsync()
        .then(() => settings.syncRemote())
        .then(result => assert.deepEqual(result, { ok: false, reason: 'not-authenticated' }));
    });

    it('throws when registering a sync path in the reserved meta namespace', () => {
      const settings = new Rapid.SettingsSystem(context);
      assert.throws(() => settings.registerSync(['meta.updatedAt']), /reserved/);
    });

    it('sends only registered settings, and leaves other preferences alone', () => {
      const osm = makeMockOsm({ preferences: { 'some.other.pref': 'keepme' } });
      return makeSettings(osm, settings => {
        settings.set('ui.foo', 'bar');
        settings.set('ui.inspector.width', '400');   // not registered
      })
        .then(settings => settings.syncRemote())
        .then(result => {
          assert.deepInclude(result, { ok: true, reason: 'synced', pushed: 1 });
          assert.deepEqual(osm._state.puts, [['rapid.settings.ui.foo', 'bar']]);
          assert.strictEqual(osm._state.preferences['some.other.pref'], 'keepme');
          assert.notInclude(osm._state.deletes, 'some.other.pref');
        });
    });

    it('in a new browser, takes the synced settings from the account', () => {
      const osm = makeMockOsm({ preferences: { 'rapid.settings.ui.foo': 'remote' } });
      let settings;
      return makeSettings(osm, s => s.set('ui.foo', 'local'))   // e.g. written during startup
        .then(s => { settings = s; return settings.syncRemote(); })
        .then(result => {
          assert.deepInclude(result, { ok: true, pulled: 1, pushed: 0 });
          assert.strictEqual(settings.get('ui.foo'), 'remote');
          assert.isEmpty(osm._state.puts);
        });
    });

    it('never deletes a remote setting just because this browser lacks it', () => {
      const osm = makeMockOsm({ preferences: { 'rapid.settings.ui.foo': 'remote' } });
      let settings;
      return makeSettings(osm)
        .then(s => { settings = s; return settings.syncRemote(); })
        .then(() => {
          assert.isEmpty(osm._state.deletes);
          assert.strictEqual(settings.get('ui.foo'), 'remote');
        });
    });

    it('sends a local change after a sync', () => {
      const osm = makeMockOsm({ preferences: { 'rapid.settings.ui.foo': 'one' } });
      let settings;
      return makeSettings(osm)
        .then(s => { settings = s; return settings.syncRemote(); })
        .then(() => {
          settings.set('ui.foo', 'two');
          return settings.syncRemote();
        })
        .then(result => {
          assert.deepInclude(result, { ok: true, pushed: 1, pulled: 0 });
          assert.strictEqual(osm._state.preferences['rapid.settings.ui.foo'], 'two');
        });
    });

    it('takes a change made in another browser when this one has no change', () => {
      const osm = makeMockOsm({ preferences: { 'rapid.settings.ui.foo': 'one' } });
      let settings;
      return makeSettings(osm)
        .then(s => { settings = s; return settings.syncRemote(); })
        .then(() => {
          // A new session in this browser, after another browser changed the setting
          osm._state.preferences['rapid.settings.ui.foo'] = 'other';
          settings = new Rapid.SettingsSystem(context);
          settings.registerSync(['ui.foo', 'imagery.favorites']);
          return settings.initAsync().then(() => settings.syncRemote());
        })
        .then(result => {
          assert.deepInclude(result, { ok: true, pulled: 1, pushed: 0 });
          assert.strictEqual(settings.get('ui.foo'), 'other');
        });
    });

    it('deletes the remote setting when the user removes it here', () => {
      const osm = makeMockOsm({ preferences: { 'rapid.settings.ui.foo': 'one' } });
      let settings;
      return makeSettings(osm)
        .then(s => { settings = s; return settings.syncRemote(); })
        .then(() => {
          settings.unset('ui.foo');
          return settings.syncRemote();
        })
        .then(result => {
          assert.deepInclude(result, { ok: true, pushed: 1 });
          assert.deepEqual(osm._state.deletes, ['rapid.settings.ui.foo']);
        });
    });

    it('syncs an array as one unit', () => {
      const osm = makeMockOsm({
        preferences: {
          'rapid.settings.imagery.favorites[0]': 'A',
          'rapid.settings.imagery.favorites[1]': 'B'
        }
      });
      let settings;
      return makeSettings(osm)
        .then(s => { settings = s; return settings.syncRemote(); })
        .then(() => {
          assert.deepEqual(settings.get('imagery.favorites'), ['A', 'B']);
          settings.set('imagery.favorites', ['B']);
          return settings.syncRemote();
        })
        .then(() => {
          assert.strictEqual(osm._state.preferences['rapid.settings.imagery.favorites[0]'], 'B');
          assert.isUndefined(osm._state.preferences['rapid.settings.imagery.favorites[1]']);
        });
    });

    it('does not re-send unchanged settings', () => {
      const osm = makeMockOsm();
      let settings;
      return makeSettings(osm, s => s.set('ui.foo', 'bar'))
        .then(s => { settings = s; return settings.syncRemote(); })
        .then(() => {
          const putCount = osm._state.puts.length;
          return settings.syncRemote().then(result => {
            assert.deepInclude(result, { ok: true, reason: 'up-to-date' });
            assert.strictEqual(osm._state.puts.length, putCount);
          });
        });
    });

    it('keeps a synced setting local if the OSM API cannot store it', () => {
      const osm = makeMockOsm();
      let settings;
      return makeSettings(osm, s => s.set('ui.foo', 'x'.repeat(256)))
        .then(s => { settings = s; return settings.syncRemote(); })
        .then(result => {
          assert.isTrue(result.ok);
          assert.isEmpty(osm._state.puts);
          assert.strictEqual(settings.get('ui.foo'), 'x'.repeat(256));
          assert.strictEqual(spyWarn.mock.calls.length, 1);
        });
    });

    it('removes leftover remote settings that are not synced', () => {
      const osm = makeMockOsm({
        preferences: {
          'rapid.settings.meta.updatedAt': '2026-01-01T00:00:00.000Z',
          'rapid.settings.rapid.custom.mine.color': '#ff0000',
          'rapid.settings.ui.foo': 'one',
          'some.other.pref': 'keepme'
        }
      });
      return makeSettings(osm)
        .then(settings => settings.syncRemote())
        .then(result => {
          assert.deepInclude(result, { ok: true, removed: 2 });
          assert.sameMembers(osm._state.deletes, ['rapid.settings.meta.updatedAt', 'rapid.settings.rapid.custom.mine.color']);
          assert.strictEqual(osm._state.preferences['rapid.settings.ui.foo'], 'one');
          assert.strictEqual(osm._state.preferences['some.other.pref'], 'keepme');
        });
    });

    it('starts over when a different user signs in', () => {
      const osm = makeMockOsm({ preferences: { 'rapid.settings.ui.foo': 'one' } });
      let settings;
      return makeSettings(osm)
        .then(s => { settings = s; return settings.syncRemote(); })
        .then(() => {
          // Another user, whose account doesn't have the setting
          osm._state.userID = 2;
          osm._state.preferences = {};
          return settings.syncRemote();
        })
        .then(result => {
          // With the first user's base, this would look like a deletion in another browser.
          assert.deepInclude(result, { ok: true, pulled: 0, pushed: 1 });
          assert.strictEqual(settings.get('ui.foo'), 'one');
          assert.strictEqual(osm._state.preferences['rapid.settings.ui.foo'], 'one');
        });
    });

    it('retries a failed send without losing the local value', () => {
      const osm = makeMockOsm({ failPuts: ['rapid.settings.ui.foo'] });
      let settings;
      return makeSettings(osm, s => s.set('ui.foo', 'bar'))
        .then(s => { settings = s; return settings.syncRemote(); })
        .then(result => {
          assert.isFalse(result.ok);
          osm._state.failPuts.clear();
          return settings.syncRemote();
        })
        .then(result => {
          assert.deepInclude(result, { ok: true, pushed: 1, pulled: 0 });
          assert.strictEqual(settings.get('ui.foo'), 'bar');
          assert.strictEqual(osm._state.preferences['rapid.settings.ui.foo'], 'bar');
        });
    });

    it('clearAllAsync removes every setting here and on the account, and nothing else', () => {
      const osm = makeMockOsm({
        preferences: {
          'rapid.settings.rapid.custom.mine.color': '#ff0000',
          'rapid.settings.ui.foo': 'one',
          'some.other.pref': 'keepme'
        }
      });
      let settings;
      return makeSettings(osm, s => s.set('ui.inspector.width', '400'))
        .then(s => { settings = s; return settings.syncRemote(); })
        .then(() => settings.clearAllAsync())
        .then(result => {
          assert.deepEqual(result, { ok: true, reason: 'cleared', removed: 1 });   // `ui.foo`; the other was a leftover
          assert.deepEqual(settings.getAll(), {});
          assert.deepEqual(osm._state.preferences, { 'some.other.pref': 'keepme' });
          const stored = storage.keys().filter(k => k.startsWith('rapid.settings.') && !k.startsWith('rapid.settings.meta.'));
          assert.isEmpty(stored);
          assert.isNull(storage.getItem('rapid.settings.meta.syncBase'));
        });
    });

    it('clearAllAsync clears this browser when signed out', () => {
      const osm = makeMockOsm({ authenticated: false });
      let settings;
      return makeSettings(osm, s => s.set('ui.foo', 'bar'))
        .then(s => { settings = s; return settings.clearAllAsync(); })
        .then(result => {
          assert.deepEqual(result, { ok: true, reason: 'cleared-local' });
          assert.deepEqual(settings.getAll(), {});
        });
    });

    it('only starts a sync for changes to synced settings', () => {
      const osm = makeMockOsm();
      let calls = 0;
      return makeSettings(osm)
        .then(settings => {
          settings.syncRemote = () => { calls++; return Promise.resolve({ ok: true, reason: 'test' }); };
          settings.set('ui.inspector.width', '400');
          assert.strictEqual(calls, 0);
          settings.set('ui.foo', 'bar');
          assert.strictEqual(calls, 1);
        });
    });
  });
});
