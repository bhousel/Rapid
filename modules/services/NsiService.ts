import { Matcher, buildIDPresets } from 'name-suggestion-index';

import { AbstractSystem } from '../core/AbstractSystem.ts';

import type {
  DissolvedMap,
  IDPreset,
  MatchHit,
  NsiData,
  NsiDissolved,
  NsiItem as NsiOrigItem,
  NsiJSON,
  NsiPath,
  NsiReplacementsJSON,
  NsiTree,
  NsiTreesJSON,
  NsiWikidataJSON,
  OsmTags
} from 'name-suggestion-index';

import type { Context } from '../Context.ts';
import type { PresetProps } from '../lib/Preset.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * NSI item with some additional runtime-added bookkeeping fields that NsiService attaches:
 *   `tkv` (the tree/key/value path) and `mainTag` (e.g. `brand:wikidata`).
 */
interface NsiItem extends NsiOrigItem {
  /** Tree/key/value path, e.g. `"brands/amenity/restaurant"` */
  tkv: NsiPath;
  /** The primary wikidata tag key, e.g. `"brand:wikidata"` */
  mainTag: string;
}

/** Result from `upgradeTags` when a match is found */
interface UpgradeResult {
  /** The suggested tags the feature should have */
  newTags: OsmTags;
  /** The NSI item that was matched, or `null` if no item matched */
  matched: NsiItem | null;
}

/** Internal NSI data cache */
interface NsiServiceCache {
  /** Raw NSI data keyed by tree/key/value path */
  data: NsiData;
  /** Map of dissolved (defunct) item IDs to dissolution records */
  dissolved: DissolvedMap;
  /** Custom Features to merge into the location manager */
  features: GeoJSON.FeatureCollection;
  /** Trivial old-to-new Wikidata QID replacements */
  replacements: NsiReplacementsJSON['replacements'];
  /** Metadata about NSI trees (brands, operators, flags, transit) */
  trees: NsiTreesJSON['trees'];
  /** Metadata retrieved from Wikidata (logos, websites, social media accounts) */
  wikidata: NsiWikidataJSON['wikidata'];
  /** Reverse index: key → value → tree name */
  kvt: Map<string, Map<string, NsiTree>>;
  /** Map of Wikidata QID tag values to canonical QIDs */
  qids: Map<string, string>;
  /** Map of NSI item ID to the item object */
  ids: Map<string, NsiItem>;
  /** Matcher instance */
  matcher: Matcher;
}

/** Priority types */
type Priority = 'primary' | 'alternate';

/** Key/value pairs grouped by priority */
interface KVGroups {
  /** Primary key/value pairs that directly match an NSI category */
  primary: Set<string>;
  /** Fallback key/value pairs like `"amenity/yes"` */
  alternate: Set<string>;
}

/** Name values grouped by priority */
interface NameGroups {
  /** Primary namelike values (e.g. from `name` tag) */
  primary: Set<string>;
  /** Alternate namelike values (e.g. from `brand`, `operator` tags) */
  alternate: Set<string>;
}

/** A tuple of key, value, name to test against the matcher */
interface KVNTuple {
  /** OSM tag key, e.g. `"amenity"` */
  k: string;
  /** OSM tag value, e.g. `"restaurant"` */
  v: string;
  /** Name to test, e.g. `"McDonald's"` */
  n: string;
}


/** Preset IDs for buildings that can be upgraded from generic `building=yes` tagging */
const buildingPreset: Record<string, boolean> = {
  'building/commercial': true,
  'building/government': true,
  'building/hotel': true,
  'building/retail': true,
  'building/office': true,
  'building/supermarket': true,
  'building/yes': true
};

/**
 * Exceptions to the namelike regexes.
 * Usually a tag suffix contains a language code like `name:en`, `name:ru`
 * but we want to exclude things like `operator:type`, `name:etymology`, etc.
 */
const notNames = /:(colou?r|type|forward|backward|left|right|etymology|pronunciation|wikipedia)$/i;

/** Exceptions to the branchlike regexes — words that look like branch names but aren't */
const notBranches = /(coop|express|wireless|factory|outlet)/i;


/**
 * `NsiService` contains all the code related to the **name-suggestion-index** (aka 'NSI').
 * NSI contains the most correct tagging for many commonly mapped features.
 * NSI data is distributed in large data files, we load them at startup and
 * use them to add NSI presets and suggest tag upgrades.
 * @see https://github.com/osmlab/name-suggestion-index
 * @see https://nsi.guide
 */
export class NsiService extends AbstractSystem {

  /** Current loading status */
  status: 'loading' | 'ok' | 'failed';

  /** Internal NSI data cache */
  _nsi: Partial<NsiServiceCache>;

  /**
   * @constructor
   * @param context - Global shared application context
   */
  constructor(context: Context) {
    super(context);
    this.id = 'nsi';
    this.requiredDependencies = new Set<SystemID>(['assets', 'schema', 'locations']);

    this.status = 'loading';  // 'loading', 'ok', 'failed'

    this._nsi = {};
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    const context = this.context;
    const assets = context.systems.assets!;

    return this._initPromise = super.initAsync()
      .then(() => {
        // Tell the AssetSystem what to load..
        // NSI v7 ships JSON data under `dist/json/` and Wikidata logos under `dist/wikidata/`.
        const latestPath = 'https://cdn.jsdelivr.net/npm/name-suggestion-index@7.1/dist';
        const localPath = 'data/modules/name-suggestion-index/dist';

        assets.registerAsset('nsi_data', {
          latest: `${latestPath}/json/nsi.min.json`,
          local:  `${localPath}/json/nsi.min.json`
        });
        assets.registerAsset('nsi_dissolved', {
          latest: `${latestPath}/wikidata/dissolved.min.json`,
          local:  `${localPath}/wikidata/dissolved.min.json`
        });
        assets.registerAsset('nsi_features', {
          latest: `${latestPath}/json/featureCollection.min.json`,
          local:  `${localPath}/json/featureCollection.min.json`
        });
        assets.registerAsset('nsi_generics', {
          latest: `${latestPath}/json/genericWords.min.json`,
          local:  `${localPath}/json/genericWords.min.json`
        });
        assets.registerAsset('nsi_replacements', {
          latest: `${latestPath}/json/replacements.min.json`,
          local:  `${localPath}/json/replacements.min.json`
        });
        assets.registerAsset('nsi_trees', {
          latest: `${latestPath}/json/trees.min.json`,
          local:  `${localPath}/json/trees.min.json`
        });
        assets.registerAsset('nsi_wikidata', {
          latest: `${latestPath}/wikidata/wikidata.min.json`,
          local:  `${localPath}/wikidata/wikidata.min.json`
        });
      });
  }


  /**
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  startAsync(): Promise<void> {
    return super.startAsync()
      .then(() => this._loadNsiDataAsync())
      .then(() => this._generateNsiPresetsAsync())
      .then(() => { this.status = 'ok'; })
      .catch(err => {
        console.error(err);  // eslint-disable-line
        this.status = 'failed';
        throw err;  // rethrow, promise chain should reject
      });
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  resetAsync(): Promise<void> {
    return Promise.resolve();
  }


  /**
   * Is the `name` tag generic?
   * @param tags - Object containing the feature's OSM tags
   * @return `true` if it is generic, `false` if not
   */
  isGenericName(tags: OsmTags): boolean {
    const n = tags.name;
    if (!n) return false;

    // tryNames just contains the `name` tag value and nothing else
    const tryNames: NameGroups = { primary: new Set([n]), alternate: new Set() };

    // Gather key/value tag pairs to try to match
    const tryKVs = this._gatherKVs(tags);
    if (!tryKVs.primary.size && !tryKVs.alternate.size)  return false;

    // Order the [key,value,name] tuples - test primary before alternate
    const tuples = this._gatherTuples(tryKVs, tryNames);

    for (const tuple of tuples) {
      const hits = this._nsi.matcher?.match(tuple.k, tuple.v, tuple.n);   // Attempt to match an item in NSI

      // If we get a `excludeGeneric` hit, this is a generic name.
      if (hits?.length && hits[0].match === 'excludeGeneric') return true;
    }

    return false;
  }


  /**
   * Suggest tag upgrades.
   * This function will not modify the input tags, it makes a copy.
   * Returns a result about the suggested tags, and the item that matched:
   *  {
   *    'newTags': `Object` - The tags the the feature should have
   *    'matched': `Object` - The matched item
   *  }
   *
   * @param tags - Object containing the feature's OSM tags
   * @param loc - Location where this feature exists, as a [lon, lat]
   * @return The result, or `null` if no changes suggested
   */
  upgradeTags(tags: OsmTags, loc: Vec2): UpgradeResult | null {
    const newTags: OsmTags = { ...tags };  // shallow copy
    const changed = this._applyWikidataReplacements(newTags);

    // Match a 'route_master' as if it were a 'route' - name-suggestion-index#5184
    const isRouteMaster = (tags.type === 'route_master');

    // Gather key/value tag pairs to try to match
    const tryKVs = this._gatherKVs(tags);
    if (!tryKVs.primary.size && !tryKVs.alternate.size) {
      return changed ? { newTags: newTags, matched: null } : null;
    }

    // Gather namelike tag values to try to match
    const tryNames = this._gatherNames(tags);

    // Do `wikidata=*` tags identify this entity as a chain? - See iD#6416
    // If so, these tags can be swapped to e.g. `brand:wikidata`.
    const foundQID = this._nsi.qids?.get(tags.wikidata);
    if (foundQID) tryNames.primary.add(foundQID);  // matcher will recognize the Wikidata QID as name too

    if (!tryNames.primary.size && !tryNames.alternate.size) {
      return changed ? { newTags: newTags, matched: null } : null;
    }

    // Order the [key,value,name] tuples - test primary before alternate
    const tuples = this._gatherTuples(tryKVs, tryNames);
    for (const tuple of tuples) {
      const hits = this._nsi.matcher?.match(tuple.k, tuple.v, tuple.n, loc);   // Attempt to match an item in NSI

      if (!hits || !hits.length) continue;  // no match, try next tuple
      if (hits[0].match !== 'primary' && hits[0].match !== 'alternate') break;  // a generic match, stop looking

      // A match may contain multiple results, the first one is likely the best one for this location
      // e.g. `['pfk-a54c14', 'kfc-1ff19c', 'kfc-658eea']`
      const match = this._selectMatchedItem(hits, newTags);
      if (!match) continue;  // Can't use any of these hits, try next tuple..

      const { itemID } = match;
      const item: NsiItem = structuredClone(match.item) as NsiItem;   // deep copy

      // At this point we have matched a canonical item and can suggest tag upgrades..
      const tkv = item.tkv;
      const parts = tkv.split('/', 3);     // tkv = "tree/key/value"
      const k = parts[1];
      const v = parts[2];
      const category = this._nsi.data![tkv];
      const properties = category.properties || {};

      // Preserve some tags that we specifically don't want NSI to overwrite. ('^name', sometimes)
      const preserveTags = item.preserveTags || properties.preserveTags || [];

      // These tags are worth preserving too - see iD#8615
      // We'll only _replace_ the tag value if this tag is the toplevel/defining tag for the matched item (`k`)
      for (const osmkey of ['building', 'emergency', 'internet_access', 'opening_hours', 'takeaway']) {
        if (k !== osmkey) preserveTags.push(`^${osmkey}$`);
      }

      const regexes = preserveTags.map(s => new RegExp(s, 'i'));

      const keepTags: OsmTags = {};
      for (const osmkey of Object.keys(newTags)) {
        if (regexes.some(regex => regex.test(osmkey))) {
          keepTags[osmkey] = newTags[osmkey];
        }
      }

      // Remove any primary tags ("amenity", "craft", "shop", "man_made", "route", etc) that have a
      // value like `amenity=yes` or `shop=yes` (exceptions have already been added to `keepTags` above)
      for (const k of this._nsi.kvt!.keys()) {
        if (newTags[k] === 'yes') delete newTags[k];
      }

      // Replace mistagged `wikidata` with e.g. `brand:wikidata`
      if (foundQID) {
        delete newTags.wikipedia;
        delete newTags.wikidata;
      }

      // Do the tag upgrade
      Object.assign(newTags, item.tags, keepTags);

      // Swap `route` back to `route_master` - name-suggestion-index#5184
      if (isRouteMaster) {
        newTags.route_master = newTags.route;
        delete newTags.route;
      }

      if (this._applyBranchSplit(tags, newTags, k, v, itemID, loc)) return null;

      return { newTags: newTags, matched: item };
    }

    return changed ? { newTags: newTags, matched: null } : null;
  }


  /**
   * Performs trivial Wikidata QID replacements on any `*:wikidata` tags in `newTags`.
   * Mutates `newTags` in place.
   * @param newTags - Mutable copy of the feature's OSM tags
   * @return `true` if any tag was changed or deleted
   */
  _applyWikidataReplacements(newTags: OsmTags): boolean {
    let changed = false;
    for (const osmkey of Object.keys(newTags)) {
      const matchTag = osmkey.match(/^(\w+:)?wikidata$/);
      if (matchTag) {                         // Look at '*:wikidata' tags
        const wd = newTags[osmkey];
        const replace = this._nsi.replacements?.[wd];    // If it matches a QID in the replacement list...

        if (replace?.wikidata !== undefined) {   // replace or delete `*:wikidata` tag
          changed = true;
          if (replace.wikidata) {
            newTags[osmkey] = replace.wikidata;
          } else {
            delete newTags[osmkey];
          }
        }
      }
    }
    return changed;
  }


  /**
   * From a list of NSI match hits, select the best non-dissolved, non-excepted item.
   * @param hits - Match hits returned by the NSI Matcher
   * @param newTags - The (possibly modified) tags of the feature being upgraded
   * @return The matched item and its ID, or `null` if no usable hit was found
   */
  _selectMatchedItem(hits: MatchHit[], newTags: OsmTags): { itemID: string; item: NsiItem } | null {
    for (const hit of hits) {
      const itemID = hit.itemID;
      if (!itemID) continue;
      if (this._nsi.dissolved?.[itemID]) continue;   // Don't upgrade to a dissolved item

      const item = this._nsi.ids?.get(itemID);
      if (!item) continue;
      const mainTag = item.mainTag;               // e.g. `brand:wikidata`
      const itemQID = item.tags[mainTag];         // e.g. `brand:wikidata` qid
      const notQID = newTags[`not:${mainTag}`];   // e.g. `not:brand:wikidata` qid

      if (                                        // Exceptions, skip this hit
        (!itemQID || itemQID === notQID) ||       // No `*:wikidata` or matched a `not:*:wikidata`
        (newTags.office && !item.tags.office)     // feature may be a corporate office for a brand? - iD#6416
      ) {
        continue;  // keep looking
      }

      return { itemID, item };
    }
    return null;
  }


  /**
   * Applies "Name Branch" splitting: if NSI suggests replacing `name` and the original
   * name looks like "Brand SomeBranch", splits it into `name`/`branch` tags.
   * Mutates `newTags` in place.
   *
   * Rules — IF:
   * - NSI is suggesting to replace `name`, AND
   * - `branch` doesn't already contain something, AND
   * - original name has not moved to an alternate name (e.g. "Dunkin' Donuts" -> "Dunkin'"), AND
   * - original name is "some name" + "some stuff"
   * THEN consider splitting `name` into `name`/`branch`.
   *
   * @param tags - Original (unmodified) OSM tags
   * @param newTags - Mutable upgraded tag set
   * @param k - The matched NSI key (e.g. `"amenity"`)
   * @param v - The matched NSI value (e.g. `"fast_food"`)
   * @param itemID - The matched NSI item ID
   * @param loc - Location of the feature
   * @return `true` if the caller should bail out and return `null` (conflicting brand detected)
   */
  _applyBranchSplit(tags: OsmTags, newTags: OsmTags, k: string, v: string, itemID: string, loc: Vec2): boolean {
    const origName = tags.name;
    const newName = newTags.name;
    if (!newName || !origName || newName === origName || newTags.branch) return false;

    const newNames = this._gatherNames(newTags);
    const newSet = new Set([...newNames.primary, ...newNames.alternate]);
    if (newSet.has(origName)) return false;   // another tag holds the original name now

    // Test name fragments, longest to shortest, to fit them into a "Name Branch" pattern.
    // e.g. "TUI ReiseCenter - Neuss Innenstadt" -> ["TUI", "ReiseCenter", "Neuss", "Innenstadt"]
    const nameParts = origName.split(/[\s\-\/,.]/);
    for (let split = nameParts.length; split > 0; split--) {
      const name = nameParts.slice(0, split).join(' ');  // e.g. "TUI ReiseCenter"
      const branch = nameParts.slice(split).join(' ');   // e.g. "Neuss Innenstadt"
      const nameHits = this._nsi.matcher?.match(k, v, name, loc);
      if (!nameHits || !nameHits.length) continue;    // no match, try next name fragment

      if (nameHits.some((hit: any) => hit.itemID === itemID)) {   // matched the name fragment to the same itemID above
        if (branch) {
          if (notBranches.test(branch)) {   // "branch" was detected but is noise ("factory outlet", etc)
            newTags.name = origName;        // Leave `name` alone, this part of the name may be significant..
          } else {
            const branchHits = this._nsi.matcher?.match(k, v, branch, loc);
            if (branchHits && branchHits.length) {                                             // if "branch" matched something else in NSI..
              if (branchHits[0].match === 'primary' || branchHits[0].match === 'alternate') {  // if another brand! (e.g. "KFC - Taco Bell"?)
                return true;                                                                   //   bail out - can't suggest tags in this case
              }                                                                                // else a generic (e.g. "gas", "cafe") - ignore
            } else {                     // "branch" is not noise and not something in NSI
              newTags.branch = branch;   // Stick it in the `branch` tag..
            }
          }
        }
        break;
      }
    }
    return false;
  }


  /**
   * Generates NSI presets on the fly using `buildIDPresets()` and merges them into the schema.
   * Inputs:
   *  - The raw NSI data (already loaded into `this._nsi.data` by `_loadNsiDataAsync`).
   *  - The dissolved-items map (already loaded into `this._nsi.dissolved`).
   *  - The id-tagging-schema source presets (loaded as the `id_tagging_schema` bundle).
   *    The AssetSystem cache dedupes this with SchemaSystem's load.
   *  - The Wikidata logos map (used to source preset `imageURL` values).
   *  - The NSI feature collection (passed through to `schema.merge` for location-conflation).
   *
   * Generating presets locally avoids downloading the ~20MB `nsi-id-presets.min.json` file
   * that NSI used to ship.
   *
   * @return Promise fulfilled when the generated presets have been merged into Rapid.
   */
  _generateNsiPresetsAsync(): Promise<void> {
    const context = this.context;
    const assets = context.systems.assets!;
    const schema = context.systems.schema!;

    return (
      assets.loadAssetAsync('id_tagging_schema')
      .then((val: any) => {
        // Generate the NSI presets from data already in hand.
        const result = buildIDPresets(this._nsi.data!, {
          sourcePresets:  val.presets as Record<string, IDPreset>,
          wikidata:       this._nsi.wikidata,
          dissolved:      this._nsi.dissolved
        });

        // Add `suggestion=true` to all the generated presets.
        // The preset json schema doesn't include it, but the Rapid code still uses it.
        for (const preset of Object.values(result.presets)) {
          (preset as IDPreset & { suggestion?: boolean }).suggestion = true;
        }

        // The version we tag the schema with is the NSI library/data version we built against.
        const nsiMeta = (this._nsi.data as unknown as { _meta?: { version?: string } })._meta;
        const nsiVersion = nsiMeta?.version ?? 'unknown';

        // Merge the generated name-suggestion-index presets into the schema.
        // `merge()` accepts `Partial<PresetProps>`, and SchemaSystem fills in defaults
        // (id from the Record key, aliases, terms, etc.) when constructing each Preset.
        // The remaining structural mismatch is `IDPreset.geometry: string[]` vs the
        // narrower `GeometryType[]` — the runtime values are valid, so go through
        // `unknown` to bridge it.
        schema.merge({
          assetID: `name-suggestion-index@${nsiVersion}`,
          scopes: [{
            scope: 'osm',
            presets: result.presets as unknown as Record<PresetID, Partial<PresetProps>>,
          }],
          featureCollection: this._nsi.features
        });
      })
    );
  }


  /**
   * Loads the NSI-related assets.
   * @return Promise fulfilled when the other data have been downloaded and processed
   */
  _loadNsiDataAsync(): Promise<void> {
    const context = this.context;
    const assets = context.systems.assets!;
    const locations = context.systems.locations!;

    return (
      Promise.all([
        assets.loadAssetAsync('nsi_data'),
        assets.loadAssetAsync('nsi_dissolved'),
        assets.loadAssetAsync('nsi_features'),
        assets.loadAssetAsync('nsi_replacements'),
        assets.loadAssetAsync('nsi_trees'),
        assets.loadAssetAsync('nsi_wikidata')

      ])
      .then((vals: any[]) => {
        this._nsi = {
          data:          (vals[0] as NsiJSON).nsi,                        // the raw name-suggestion-index data
          dissolved:     (vals[1] as NsiDissolved).dissolved,             // list of dissolved items
          features:      (vals[2] as GeoJSON.FeatureCollection),          // custom features to merge into the location manager
          replacements:  (vals[3] as NsiReplacementsJSON).replacements,   // trivial old->new qid replacements
          trees:         (vals[4] as NsiTreesJSON).trees,                 // metadata about trees, main tags
          wikidata:      (vals[5] as NsiWikidataJSON).wikidata,           // metadata about wikidata and logos
          kvt:           new Map(),              // Map<k, Map<v, t>>
          qids:          new Map(),              // Map<wikidata QID → canonical QID>
          ids:           new Map()               // Map<id, NSI item>
        } as NsiServiceCache;


        const matcher = this._nsi.matcher = new Matcher();
        matcher.buildMatchIndex(this._nsi.data!);

        // Share Rapid's LocationConflation instance so the matcher and the rest of the app
        // use a single registry and spatial index (no duplicate resolution or indexing).
        matcher.buildLocationIndex(this._nsi.data!, locations.resolver());

        for (const tkv of Object.keys(this._nsi.data!) as NsiPath[]) {
          const category = this._nsi.data![tkv];
          const [t, k, v] = tkv.split('/', 3) as [NsiTree, string, string];     // tkv = "tree/key/value"

          // Build a reverse index of keys -> values -> trees present in the name-suggestion-index
          // Collect primary keys  (e.g. "amenity", "craft", "shop", "man_made", "route", etc)
          // "amenity": {
          //   "restaurant": "brands"
          // }
          let vmap = this._nsi.kvt!.get(k);
          if (!vmap) {
            vmap = new Map();
            this._nsi.kvt!.set(k, vmap);
          }
          vmap.set(v, t);

          const tree = this._nsi.trees![t];  // e.g. "brands", "operators"
          const mainTag = tree.mainTag;     // e.g. "brand:wikidata", "operator:wikidata", etc

          for (const baseItem of category.items ?? []) {
            // Remember some useful things for later, cache NSI id -> item
            const item = baseItem as NsiItem;
            item.tkv = tkv;
            item.mainTag = mainTag;
            this._nsi.ids!.set(item.id, item);

            // Cache Wikidata values -> qid, for iD#6416
            const wd = item.tags[mainTag];
            if (wd) this._nsi.qids!.set(wd, wd);
          }
        }
      })
    );
  }


  /**
   * Gather all the key/value pairs that we will run through the NSI matcher.
   * An OSM tags object can contain anything, but only a few tags will be interesting to NSI.
   *
   * This function will return the interesting tag pairs like:
   *   "amenity/restaurant", "man_made/flagpole"
   * and fallbacks like
   *   "amenity/yes"
   * excluding things like
   *   "tiger:reviewed", "surface", "ref", etc.
   *
   * Returns a result `Object` containing kv pairs to test:
   * {
   *   'primary': Set(),
   *   'alternate': Set()
   * }
   *
   * @param tags - Object containing the feature's OSM tags
   * @return Object containing the primary and alternate key/value pairs to test
   */
  _gatherKVs(tags: OsmTags): KVGroups {
    const primary = new Set<string>();
    const alternate = new Set<string>();

    for (const [osmkey, osmvalue] of Object.entries(tags)) {
      if (!osmkey || !osmvalue) continue;

      // Match a 'route_master' as if it were a 'route' - name-suggestion-index#5184
      const effectiveKey = osmkey === 'route_master' ? 'route' : osmkey;

      const vmap = this._nsi.kvt?.get(effectiveKey);
      if (!vmap) continue;  // not an interesting key

      if (vmap.get(osmvalue)) {     // Matched a category in NSI
        primary.add(`${effectiveKey}/${osmvalue}`);     // interesting key/value
      } else if (osmvalue === 'yes') {
        alternate.add(`${effectiveKey}/${osmvalue}`);   // fallback key/yes
      }
    }

    // Can we try a generic building fallback match? - See iD#6122, iD#7197
    // Only try this if we do a preset match and find nothing else remarkable about that building.
    // For example, a way with `building=yes` + `name=Westfield` may be a Westfield department store.
    // But a way with `building=yes` + `name=Westfield` + `public_transport=station` is a train station for a town named "Westfield"
    const schema = this.context.systems.schema!;
    const preset = schema.matchTags(tags, 'area');
    if (preset && buildingPreset[preset.id]) {
      alternate.add('building/yes');
    }

    return { primary: primary, alternate: alternate };
  }


  /**
   * NSI has a concept of trees: "brands", "operators", "flags", "transit".
   * The tree determines things like which tags are namelike, and which tags hold important wikidata.
   * This takes an Object of tags and tries to identify what tree to use.
   * Returns the name of the tree if known,
   *  or 'unknown' if it could match several trees (e.g. amenity/yes),
   *  or `null` if no match
   *
   * @param tags - Object containing the feature's OSM tags
   * @return The name of the tree if known, or 'unknown' for multiple, or `null` if no match
   */
  _identifyTree(tags: OsmTags): string | null {
    let unknown: string | undefined;
    let t: string | undefined;

    // Check all tags
    for (const [osmkey, osmvalue] of Object.entries(tags)) {
      if (!osmkey || !osmvalue) continue;

      // Match a 'route_master' as if it were a 'route' - name-suggestion-index#5184
      const effectiveKey = osmkey === 'route_master' ? 'route' : osmkey;

      const vmap = this._nsi.kvt?.get(effectiveKey);
      if (!vmap) continue;  // this key is not in nsi

      if (osmvalue === 'yes') {
        unknown = 'unknown';
      } else {
        t = vmap.get(osmvalue);
        break;  // found it
      }
    }

    return t || unknown || null;
  }


  /**
   * Gather all the namelike values that we will run through the NSI matcher.
   * It will gather values primarily from tags `name`, `name:ru`, `flag:name`
   *  and fallback to alternate tags like `brand`, `brand:ru`, `alt_name`
   *
   * Returns a result `Object` containing namelike values to test:
   * {
   *   'primary': Set(),
   *   'alternate': Set()
   * }
   *
   * @param tags - Object containing the feature's OSM tags
   * @return Object containing the primary and alternate names to test
   */
  _gatherNames(tags: OsmTags): NameGroups {
    const empty: NameGroups = { primary: new Set(), alternate: new Set() };
    const primary = new Set<string>();
    const alternate = new Set<string>();
    let foundSemi = false;
    let testNameFragments = false;
    let patterns: { primary: RegExp; alternate: RegExp };

    // Patterns for matching OSM keys that might contain namelike values.
    // These roughly correspond to the "trees" concept in name-suggestion-index,
    const t = this._identifyTree(tags);
    if (!t) return empty;

    if (t === 'transit') {
      patterns = {
        primary: /^network$/i,
        alternate: /^(operator|operator:\w+|network:\w+|\w+_name|\w+_name:\w+)$/i
      };
    } else if (t === 'flags') {
      patterns = {
        primary: /^(flag:name|flag:name:\w+)$/i,
        alternate: /^(flag|flag:\w+|subject|subject:\w+)$/i   // note: no `country`, we special-case it below
      };
    } else if (t === 'brands') {
      testNameFragments = true;
      patterns = {
        primary: /^(name|name:\w+)$/i,
        alternate: /^(brand|brand:\w+|operator|operator:\w+|\w+_name|\w+_name:\w+)/i,
      };
    } else if (t === 'operators') {
      testNameFragments = true;
      patterns = {
        primary: /^(name|name:\w+|operator|operator:\w+)$/i,
        alternate: /^(brand|brand:\w+|\w+_name|\w+_name:\w+)/i,
      };
    } else {  // unknown/multiple
      testNameFragments = true;
      patterns = {
        primary: /^(name|name:\w+)$/i,
        alternate: /^(brand|brand:\w+|network|network:\w+|operator|operator:\w+|\w+_name|\w+_name:\w+)/i,
      };
    }

    // Test `name` fragments, longest to shortest, to fit them into a "Name Branch" pattern.
    // e.g. "TUI ReiseCenter - Neuss Innenstadt" -> ["TUI", "ReiseCenter", "Neuss", "Innenstadt"]
    if (tags.name && testNameFragments) {
      const nameParts = tags.name.split(/[\s\-\/,.]/);
      for (let split = nameParts.length; split > 0; split--) {
        const name = nameParts.slice(0, split).join(' ');  // e.g. "TUI ReiseCenter"
        primary.add(name);
      }
    }

    // Check all tags
    for (const [osmkey, osmvalue] of Object.entries(tags)) {
      if (!osmkey || !osmvalue) continue;

      if (isNamelike(osmkey, 'primary')) {
        if (/;/.test(osmvalue)) {
          foundSemi = true;
        } else {
          primary.add(osmvalue);
          alternate.delete(osmvalue);
        }
      } else if (!primary.has(osmvalue) && isNamelike(osmkey, 'alternate')) {
        if (/;/.test(osmvalue)) {
          foundSemi = true;
        } else {
          alternate.add(osmvalue);
        }
      }
    }

    // For flags only, fallback to `country` tag only if no other namelike values were found.
    // See https://github.com/openstreetmap/iD/pull/8305#issuecomment-769174070
    if (tags.man_made === 'flagpole' && !primary.size && !alternate.size && !!tags.country) {
      const osmvalue = tags.country;
      if (/;/.test(osmvalue)) {
        foundSemi = true;
      } else {
        alternate.add(osmvalue);
      }
    }

    // If any namelike value contained a semicolon, return empty set and don't try matching anything.
    if (foundSemi) {
      return empty;
    } else {
      return { primary: primary, alternate: alternate };
    }

    function isNamelike(osmkey: string, which: Priority): boolean {
      if (osmkey === 'old_name') return false;
      return patterns[which].test(osmkey) && !notNames.test(osmkey);
    }
  }


  /**
   * Generate all combinations of [key,value,name] that we want to test.
   * This prioritizes them so that the primary name and key/value pairs go first.
   *
   * @param tryKVs - Object containing the primary and alternate key/value pairs to test
   * @param tryNames - Object containing the primary and alternate names to test
   * @return Array of tuple objects, ordered by priority
   */
  _gatherTuples(tryKVs: KVGroups, tryNames: NameGroups): KVNTuple[] {
    const tuples: KVNTuple[] = [];

    const groups: Priority[] = ['primary', 'alternate'];

    for (const nameGroup of groups) {
      // test names longest to shortest
      const names = [...tryNames[nameGroup]].sort((a, b) => b.length - a.length);
      for (const n of names) {
        for (const kvGroup of groups) {
          for (const kv of tryKVs[kvGroup]) {
            const [k, v] = kv.split('/', 2);
            tuples.push({ k: k, v: v, n: n });
          }
        }
      }
    }
    return tuples;
  }

}
