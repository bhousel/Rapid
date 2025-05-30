import { utilArrayUnion, utilUnicodeCharsTruncated } from '@rapid-sdk/util';

import { AbstractFeature } from './AbstractFeature.js';
import { osmIsInterestingTag } from './tags.js';


/**
 * OsmEntity
 * Here is where we put logic that is common to OSM data.
 * Aside from the `props`, OSM features support a special `tags` object.
 *
 * OSM Entities are intended to be immutable - the `update()` method will return a new Entity.
 * (A lot of this was carried over from the previous `osmEntity` and similar classes.)
 *
 * Properties you can access:
 *   `props`  - Object containing Feature properties (inherited from `AbstractFeature`)
 *   `tags`   - Object containing key-value string pairs for the OSM tags
 */
export class OsmEntity extends AbstractFeature {

  /**
   * @constructor
   * Features may be constructed by passing an application context or another feature.
   * They can also accept an optional properties object.
   * @param  {AbstractFeature|Context}  otherOrContext - copy another Feature, or pass application context
   * @param  {Object}                   props   - Properties to assign to the Feature
   */
  constructor(otherOrContext, props = {}) {
    super(otherOrContext, props);

    // Idea: Store tags in a proto-less object to avoid collisions with
    //  reserved words in JavaScript objects, see iD#3044
    // Good idea, but this won't survive `structuredClone` or other
    //  serialize/deserialize tricks like JSON.parse/JSON.stringify
    if (!this.props.tags) {
      // this.props.tags = Object.create(null);
      this.props.tags = {};
    }
  }

  /**
   * update
   * Update the Feature's properties and return a new Feature.
   * Features are intended to be immutable.  To modify them a Feature,
   *  pass in the properties to change, and you'll get a new Feature.
   * The new Feature will have an updated `v` internal version number.
   * @param   {Object}     props - the updated properties
   * @return  {OsmEntity}  a new OsmEntity
   */
  update(props) {
    return new OsmEntity(this, props).touch();
  }

  /**
   * updateSelf
   * Like `update` but it modifies the current Feature's properties in-place.
   * This will also update the Feature's `v` internal version number.
   * `updateSelf` is slightly more performant for situations where you don't need
   * immutability and don't mind mutating the Feature.
   * @param   {Object}     props - the updated properties
   * @return  {OsmEntity}  this same OsmEntity
   */
  updateSelf(props) {
    this.props = Object.assign(this.props, props);
    this.touch();
    return this;
  }

  /**
   * copy
   * Makes a (mostly) deep copy of a feature.
   * Copied entities will start out with a fresh `id` and cleared out metadata.
   * This is like the sort of copy you would want when copy-pasting a feature.
   * Note that this function is subclassed, so that Ways and Relations can copy their child data too.
   * When completed, the `memo` argument will contain all the copied data elements.
   * @param   {Graph}      fromGraph - The Graph that owns the source object (needed for some data types)
   * @param   {Object}     memo      - An Object to store seen copies (to prevent circular/infinite copying)
   * @return  {OsmEntity}  a copy of this OsmEntity
   */
  copy(fromGraph, memo = {}) {
    if (memo[this.id]) {
      return memo[this.id];
    }
    const Type = this.constructor;
    const copy = new Type(this, { id: undefined, user: undefined, version: undefined, v: undefined });
    memo[this.id] = copy;
    return copy;
  }

  /**
   * tags
   * Tags are the key=value pairs of strings that assign meaning to an OSM element.
   * @see https://wiki.openstreetmap.org/wiki/Elements#Tag
   * @return {Object}
   * @readonly
   */
  get tags() {
    return this.props.tags;
  }

  /**
   * visible
   * This is the OSM `visibility` attribute.
   * Objects with `visibility=false` are considered deleted.
   * @see https://wiki.openstreetmap.org/wiki/Elements#Common_attributes
   * @return {boolean}
   */
  get visible() {
    return this.props.visible ?? true;
  }
  set visible(val) {
    this.props.visible = val;
  }

  /**
   * version
   * This is the OSM `version` attribute, used for conflict detection.
   * When updating an OSM object, its version must match the value on the server,
   *  otherwise the editing API will raise a conflict.
   * @see https://wiki.openstreetmap.org/wiki/Elements#Common_attributes
   * @return {string}
   */
  get version() {
    return this.props.version;
  }
  set version(val) {
    this.props.version = val;
  }


  static id = {
    next: { changeset: -1, node: -1, way: -1, relation: -1 }
  };

  static type(id) {
    return {
      'c': 'changeset', 'n': 'node', 'w': 'way', 'r': 'relation'
    }[id[0]];
  }

  // converts 'node', '-1' to 'n-1'
  static fromOSM(type, id) {
    return type[0] + id;
  }

  // converts 'n-1' to '-1'
  static toOSM(id) {
    return id.slice(1);
  }

  osmId() {
    return OsmEntity.toOSM(this.props.id);
  }

  isNew() {
    return this.osmId() < 0;
  }

  mergeTags(tags) {
    const merged = Object.assign({}, this.props.tags);  // copy
    let changed = false;
    for (let k in tags) {
      let t1 = merged[k];
      let t2 = tags[k];
      if (!t1) {
        changed = true;
        merged[k] = t2;
      } else if (k === 'building') {
        if (t2 === 'yes') {
          continue;
        } else if (t1 === 'yes') {
          changed = true;
          merged[k] = t2;
        }
      } else if (t1 !== t2) {
        changed = true;
        merged[k] = utilUnicodeCharsTruncated(
          utilArrayUnion(t1.split(/;\s*/), t2.split(/;\s*/)).join(';'),
          255 // avoid exceeding character limit; see also services/osm.js -> maxCharsForTagValue()
        );
      }
    }
    return changed ? this.update({ tags: merged }) : this;
  }


  intersects(other) {
    const extent = this.geom.origExtent;
    return extent?.intersects(other);
  }

  hasNonGeometryTags() {
    for (const k of Object.keys(this.props.tags)) {
      if (k !== 'area') return true;
    }
    return false;
  }

  hasParentRelations(graph) {
    return graph.parentRelations(this).length > 0;
  }

  hasInterestingTags() {
    for (const k of Object.keys(this.props.tags)) {
      if (osmIsInterestingTag(k)) return true;
    }
    return false;
  }

  isHighwayIntersection() {
    return false;
  }

  isDegenerate() {
    return true;
  }

  // Convert the entity to a JSON in the format that we save to history backup
  asJSON() {
    return Object.assign({}, this.props);
  }

}



// import { utilArrayUnion, utilUnicodeCharsTruncated } from '@rapid-sdk/util';

// import { osmIsInterestingTag } from './tags.js';


// let _nextv = 0;

// export function osmEntity(attrs) {
//     // For prototypal inheritance.
//     if (this instanceof osmEntity) return;

//     // Create the appropriate subtype.
//     if (attrs && attrs.type) {
//         return osmEntity[attrs.type].apply(this, arguments);
//     } else if (attrs && attrs.id) {
//         return osmEntity[osmEntity.id.type(attrs.id)].apply(this, arguments);
//     }

//     // Initialize a generic Entity (used only in tests).
//     return (new osmEntity()).initialize(arguments);
// }


// osmEntity.id = function(type) {
//     return osmEntity.id.fromOSM(type, osmEntity.id.next[type]--);
// };


// osmEntity.id.next = {
//     changeset: -1, node: -1, way: -1, relation: -1
// };


// ✅
// osmEntity.id.fromOSM = function(type, id) {
//     return type[0] + id;
// };


// ✅
// osmEntity.id.toOSM = function(id) {
//     return id.slice(1);
// };


// osmEntity.id.type = function(id) {
//     return { 'c': 'changeset', 'n': 'node', 'w': 'way', 'r': 'relation' }[id[0]];
// };


// // A function suitable for use as the second argument to d3.selection#data().
// ✅
// osmEntity.key = function(entity) {
//     return entity.id + 'v' + (entity.v || 0);
// };


// var _deprecatedTagValuesByKey;
// osmEntity.deprecatedTagValuesByKey = function(dataDeprecated) {
//     if (!_deprecatedTagValuesByKey) {
//         _deprecatedTagValuesByKey = {};
//         dataDeprecated.forEach(function(d) {
//             var oldKeys = Object.keys(d.old);
//             if (oldKeys.length === 1) {
//                 var oldKey = oldKeys[0];
//                 var oldValue = d.old[oldKey];
//                 if (oldValue !== '*') {
//                     if (!_deprecatedTagValuesByKey[oldKey]) {
//                         _deprecatedTagValuesByKey[oldKey] = [oldValue];
//                     } else {
//                         _deprecatedTagValuesByKey[oldKey].push(oldValue);
//                     }
//                 }
//             }
//         });
//     }
//     return _deprecatedTagValuesByKey;
// };


// osmEntity.prototype = {

// ✅
//     tags: {},


//     initialize: function(sources) {
//         for (var i = 0; i < sources.length; ++i) {
//             var source = sources[i];
//             for (var prop in source) {
//                 if (Object.prototype.hasOwnProperty.call(source, prop)) {
//                     if (source[prop] === undefined) {
//                         delete this[prop];
//                     } else {
//                         this[prop] = source[prop];
//                     }
//                 }
//             }
//         }

//         if (!this.id && this.type) {
//             this.id = osmEntity.id(this.type);
//         }
//         if (!this.hasOwnProperty('visible')) {
//             this.visible = true;
//         }

//         return this;
//     },


// ✅
//     copy: function(resolver, copies) {
//         if (copies[this.id]) return copies[this.id];

//         var copy = osmEntity(this, { id: undefined, user: undefined, version: undefined, v: undefined });
//         copies[this.id] = copy;

//         return copy;
//     },


// ✅
//     osmId: function() {
//         return osmEntity.id.toOSM(this.id);
//     },


// ✅
//     isNew: function() {
//         return this.osmId() < 0;
//     },


// ✅
//     update: function(attrs) {
//         return osmEntity(this, attrs).touch();
//     },

// ✅
//     // Bump internal version in place
//     touch: function() {
//         this.v = _nextv++;
//         return this;
//     },

// ✅
//     mergeTags: function(tags) {
//         var merged = Object.assign({}, this.tags);   // shallow copy
//         var changed = false;
//         for (var k in tags) {
//             var t1 = merged[k];
//             var t2 = tags[k];
//             if (!t1) {
//                 changed = true;
//                 merged[k] = t2;
//             } else if (k === 'building') {
//                 if (t2 === 'yes') {
//                     continue;
//                 } else if (t1 === 'yes') {
//                     changed = true;
//                     merged[k] = t2;
//                 }
//             } else if (t1 !== t2) {
//                 changed = true;
//                 merged[k] = utilUnicodeCharsTruncated(
//                     utilArrayUnion(t1.split(/;\s*/), t2.split(/;\s*/)).join(';'),
//                     255 // avoid exceeding character limit; see also services/osm.js -> maxCharsForTagValue()
//                 );
//             }
//         }
//         return changed ? this.update({ tags: merged }) : this;
//     },


// ✅
//     intersects: function(extent, resolver) {
//         return this.extent(resolver).intersects(extent);
//     },


// ✅
//     hasNonGeometryTags: function() {
//         return Object.keys(this.tags).some(function(k) { return k !== 'area'; });
//     },

// ✅
//     hasParentRelations: function(resolver) {
//         return resolver.parentRelations(this).length > 0;
//     },

// ✅
//     hasInterestingTags: function() {
//         return Object.keys(this.tags).some(osmIsInterestingTag);
//     },

// ✅
//     isHighwayIntersection: function() {
//         return false;
//     },

// ✅
//     isDegenerate: function() {
//         return true;
//     },

//     // TODO - This does not belong here.
//     // Entities should not be responsible for checking their tags are deprecated.
//     // (It's telling that `dataDeprecated` needs to be passed in for it to even do this.)
//     // `deprecatedTags` is only called by the `outdated_tags` validator, so maybe it should be moved there.
//     // Or maybe into the `PresetSystem`, if this is a thing might be called from outside the validator.
// ✅
//     deprecatedTags: function(dataDeprecated) {
//         var tags = this.tags;

//         // if there are no tags, none can be deprecated
//         if (Object.keys(tags).length === 0) return [];

//         var results = [];
//         dataDeprecated.forEach(function(d) {
//             var oldKeys = Object.keys(d.old);
//             if (d.replace) {
//                 var hasExistingValues = Object.keys(d.replace).some(function(replaceKey) {
//                     if (!tags[replaceKey] || d.old[replaceKey]) return false;
//                     var replaceValue = d.replace[replaceKey];
//                     if (replaceValue === '*') return false;
//                     if (replaceValue === tags[replaceKey]) return false;
//                     return true;
//                 });
//                 // don't flag deprecated tags if the upgrade path would overwrite existing data - #7843
//                 if (hasExistingValues) return;
//             }
//             var matchesDeprecatedTags = oldKeys.every(function(oldKey) {
//                 if (!tags[oldKey]) return false;
//                 if (d.old[oldKey] === '*') return true;
//                 if (d.old[oldKey] === tags[oldKey]) return true;

//                 var vals = tags[oldKey].split(';').filter(Boolean);
//                 if (vals.length === 0) {
//                     return false;
//                 } else if (vals.length > 1) {
//                     return vals.indexOf(d.old[oldKey]) !== -1;
//                 } else {
//                     if (tags[oldKey] === d.old[oldKey]) {
//                         if (d.replace && d.old[oldKey] === d.replace[oldKey]) {
//                             var replaceKeys = Object.keys(d.replace);
//                             return !replaceKeys.every(function(replaceKey) {
//                                 return tags[replaceKey] === d.replace[replaceKey];
//                             });
//                         } else {
//                             return true;
//                         }
//                     }
//                 }
//                 return false;
//             });
//             if (matchesDeprecatedTags) {
//                 results.push(d);
//             }
//         });

//         return results;
//     }
// };
