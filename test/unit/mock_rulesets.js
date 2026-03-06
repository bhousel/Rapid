/**
 * mock_rulesets.js
 * Shared test helper that sets up mock rulesets on a MockContext.
 *
 * Usage:
 *   import { setupMockRulesets } from '../mock_rulesets.js';
 *   setupMockRulesets(Rapid, context);
 *
 * This creates a minimal mock `schema` system on `context.systems` with
 * `getScope('osm')` returning a scope containing mock rulesets.
 *
 * IMPORTANT: These are test fixtures, not a mirror of data/osm_rulesets.json5.
 * Each ruleset contains only the specific tag values exercised by unit tests.
 * If a test needs a new value, add it here — but don't copy the full production lists.
 */

/**
 * Builds a Map of minimal Rulesets and attaches them as `context.systems.schema`
 * with a `getScope()` API matching SchemaSystem's interface.
 *
 * @param {object} Rapid - The Rapid module (from headless.js)
 * @param {object} context - The MockContext instance
 */
export function setupMockRulesets(Rapid, context) {
  const rulesets = new Map();

  // StyleSystem tests: surface='asphalt' → paved, tracktype='grade1' → paved
  rulesets.set('surface_paved', new Rapid.Ruleset(context, {
    id: 'surface_paved',
    include: [
      { key: 'surface', value: 'asphalt' },
      { key: 'tracktype', value: 'grade1' }
    ]
  }));

  // Tests: highway=motorway, junction=roundabout/circular, waterway=river/stream → one-way
  rulesets.set('oneway_forward', new Rapid.Ruleset(context, {
    id: 'oneway_forward',
    include: [
      { key: 'conveying', value: 'forward' },
      { key: 'highway', value: 'motorway' },
      { key: 'junction', op: 'in', value: ['circular', 'roundabout'] },
      { key: 'oneway', op: 'in', value: ['yes', '1'] },
      { key: 'waterway', op: 'in', value: ['river', 'stream'] }
    ],
    exclude: [
      { key: 'oneway', op: 'in', value: ['no', '0'] }
    ]
  }));

  rulesets.set('oneway_backward', new Rapid.Ruleset(context, {
    id: 'oneway_backward',
    include: [
      { key: 'conveying', value: 'backward' },
      { key: 'oneway', op: 'in', value: ['-1'] }
    ],
    exclude: [
      { key: 'oneway', op: 'in', value: ['no', '0'] }
    ]
  }));

  rulesets.set('oneway_bidirectional', new Rapid.Ruleset(context, {
    id: 'oneway_bidirectional',
    include: [
      { key: 'conveying', value: 'reversible' },
      { key: 'oneway', op: 'in', value: ['alternating', 'reversible'] }
    ],
    exclude: [
      { key: 'oneway', op: 'in', value: ['no', '0'] }
    ]
  }));

  // OsmWay.isSided(): tested values in OsmWay.test.js and join.test.js
  rulesets.set('sided_right', new Rapid.Ruleset(context, {
    id: 'sided_right',
    include: [
      { key: 'natural', op: 'in', value: ['cliff', 'coastline'] },
      { key: 'barrier', op: 'in', value: ['retaining_wall', 'kerb', 'guard_rail', 'city_wall'] },
      { key: 'man_made', op: 'in', value: ['embankment', 'quay'] }
    ],
    exclude: [
      { key: 'two_sided', value: 'yes' }
    ]
  }));

  // validationDisconnectedWay tests: highway=residential, highway=unclassified
  rulesets.set('connected_highway', new Rapid.Ruleset(context, {
    id: 'connected_highway',
    include: [
      { key: 'highway', op: 'in', value: ['residential', 'unclassified'] }
    ]
  }));

  // OsmEntity.hasInterestingTags / isInterestingTag: metadata/import-related keys
  rulesets.set('uninteresting', new Rapid.Ruleset(context, {
    id: 'uninteresting',
    include: [
      { key: 'attribution' },
      { key: 'created_by' },
      { key: 'source' },
      { keyOp: '~', key: '^source:' },
      { keyOp: '~', key: '^tiger:' }
    ]
  }));

  // OsmWay.tagSuggestingArea: force area even when key is typically linear
  rulesets.set('areakeys_force_true', new Rapid.Ruleset(context, {
    id: 'areakeys_force_true',
    include: [
      { key: 'highway', op: 'in', value: ['elevator', 'rest_area', 'services'] },
      { key: 'railway', op: 'in', value: [
        'platform', 'roundhouse', 'station', 'traverser', 'turntable',
        'ventilation_shaft', 'wash'
      ]}
    ]
  }));

  // OsmWay.tagSuggestingArea: prevent area even when key is in areaKeys
  rulesets.set('areakeys_force_false', new Rapid.Ruleset(context, {
    id: 'areakeys_force_false',
    include: [
      { key: 'emergency', op: 'in', value: ['yes', 'no'] }
    ]
  }));

  // Lifecycle prefixes: used by SchemaSystem.removeLifecyclePrefix and FilterSystem._isPastFuture
  rulesets.set('lifecycle', new Rapid.Ruleset(context, {
    id: 'lifecycle',
    include: [
      { keyOp: '~', key: '^abandoned:' },
      { keyOp: '~', key: '^construction:' },
      { keyOp: '~', key: '^demolished:' },
      { keyOp: '~', key: '^disused:' },
      { keyOp: '~', key: '^destroyed:' },
      { keyOp: '~', key: '^proposed:' },
      { keyOp: '~', key: '^was:' }
    ]
  }));

  // Derive lifecyclePrefixes Set from the lifecycle ruleset's key patterns
  const lifecyclePrefixes = new Set();
  const lifecycleRuleset = rulesets.get('lifecycle');
  if (lifecycleRuleset) {
    for (const matcher of lifecycleRuleset.include) {
      if (matcher.keyOp === '~' && typeof matcher.key === 'string') {
        const prefix = matcher.key.replace(/^\^/, '').replace(/:$/, '');
        if (prefix) {
          lifecyclePrefixes.add(prefix);
        }
      }
    }
  }

  const mockScope = {
    rulesets,
    areaKeys: {},
    lifecyclePrefixes
  };

  if (!context.systems.schema) {
    context.systems.schema = {
      getScope: (scopeID) => scopeID === 'osm' ? mockScope : undefined,

      // Mirror SchemaSystem.removeLifecyclePrefix for tests
      removeLifecyclePrefix: (key, scopeID = 'osm') => {
        const colonIndex = key.indexOf(':');
        if (colonIndex === -1) return key;
        const prefix = key.slice(0, colonIndex);
        if (lifecyclePrefixes.has(prefix)) {
          return key.slice(colonIndex + 1);
        }
        return key;
      }
    };
  }

  return rulesets;
}
