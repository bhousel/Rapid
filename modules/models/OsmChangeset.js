import { OsmEntity } from './OsmEntity.js';


/**
 * OsmChangeset
 * @see https://wiki.openstreetmap.org/wiki/Changeset
 *
 * Properties you can access:
 *   `props`   - Object containing Feature properties (inherited from `AbstractFeature`)
 *   `tags`    - Object containing key-value string pairs for the OSM tags (inherited from `OsmEntity`)
 */
export class OsmChangeset extends OsmEntity {

  /**
   * @constructor
   * Features may be constructed by passing an application context or another feature.
   * They can also accept an optional properties object.
   * @param  {AbstractFeature|Context}  otherOrContext - copy another Feature, or pass application context
   * @param  {Object}                   props   - Properties to assign to the Feature
   */
  constructor(otherOrContext, props = {}) {
    super(otherOrContext, props);
    this.props.type = 'changeset';

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = `c${OsmEntity.id.next.changeset--}`;
    }
  }

  /**
   * update
   * Update the Feature's properties and return a new Feature.
   * Features are intended to be immutable.  To modify them a Feature,
   *  pass in the properties to change, and you'll get a new Feature.
   * The new Feature will have an updated `v` internal version number.
   * @param   {Object}        props - the updated properties
   * @return  {OsmChangeset}  a new OsmChangeset
   */
  update(props) {
    return new OsmChangeset(this, props).touch();
  }

  // extent not currently supported for changesets, but we could eventually calculate this.
  extent() {
    return this.geom.extent;
  }

  geometry() {
    return 'changeset';
  }

  asGeoJSON() {
    return {};
  }


  asJXON() {
    return {
      osm: {
        changeset: {
          tag: Object.keys(this.tags).map(k => {
            return { '@k': k, '@v': this.tags[k] };
          }),
          '@version': 0.6,
          '@generator': 'Rapid'
        }
      }
    };
  }


  // Generate [osmChange](http://wiki.openstreetmap.org/wiki/OsmChange) XML.
  // Returns a string.
  osmChangeJXON(changes) {
    const changesetID = this.props.id;

    function nest(x, order) {
      const groups = {};
      for (let i = 0; i < x.length; i++) {
        const tagName = Object.keys(x[i])[0];
        if (!groups[tagName]) groups[tagName] = [];
        groups[tagName].push(x[i][tagName]);
      }
      const ordered = {};
      order.forEach(o => {
        if (groups[o]) ordered[o] = groups[o];
      });
      return ordered;
    }


    // sort relations in a changeset by dependencies
    function sort(changes) {
      // find a referenced relation in the current changeset
      function resolve(item) {
        return relations.find(relation => {
          return item.keyAttributes.type === 'relation' && item.keyAttributes.ref === relation['@id'];
        });
      }

      // a new item is an item that has not been already processed
      function isNew(item) {
        return !sorted[ item['@id'] ] && !processing.find(proc => {
          return proc['@id'] === item['@id'];
        });
      }

      let processing = [];
      const sorted = {};
      const relations = changes.relation;
      if (!relations) return changes;

      for (const relation of relations) {
        // skip relation if already sorted
        if (!sorted[relation['@id']]) {
          processing.push(relation);
        }

        while (processing.length > 0) {
          var next = processing[0],
          deps = next.member.map(resolve).filter(Boolean).filter(isNew);
          if (deps.length === 0) {
            sorted[next['@id']] = next;
            processing.shift();
          } else {
            processing = deps.concat(processing);
          }
        }
      }

      changes.relation = Object.values(sorted);
      return changes;
    }

    function rep(entity) {
      return entity.asJXON(changesetID);
    }

    return {
      osmChange: {
        '@version': 0.6,
        '@generator': 'Rapid',
        'create': sort(nest(changes.created.map(rep), ['node', 'way', 'relation'])),
        'modify': nest(changes.modified.map(rep), ['node', 'way', 'relation']),
        'delete': Object.assign(nest(changes.deleted.map(rep), ['relation', 'way', 'node']), { '@if-unused': true })
      }
    };
  }

}


// export function osmChangeset() {
//     if (!(this instanceof osmChangeset)) {
//         return (new osmChangeset()).initialize(arguments);
//     } else if (arguments.length) {
//         this.initialize(arguments);
//     }
// }


// osmEntity.changeset = osmChangeset;

// osmChangeset.prototype = Object.create(osmEntity.prototype);

// Object.assign(osmChangeset.prototype, {

//     type: 'changeset',


//     extent: function() {
//         return new new Extent();
//     },


//     geometry: function() {
//         return 'changeset';
//     },


//     asJXON: function() {
//         return {
//             osm: {
//                 changeset: {
//                     tag: Object.keys(this.tags).map(function(k) {
//                         return { '@k': k, '@v': this.tags[k] };
//                     }, this),
//                     '@version': 0.6,
//                     '@generator': 'Rapid'
//                 }
//             }
//         };
//     },


//     // Generate [osmChange](http://wiki.openstreetmap.org/wiki/OsmChange)
//     // XML. Returns a string.
//     osmChangeJXON: function(changes) {
//         var changeset_id = this.id;

//         function nest(x, order) {
//             var groups = {};
//             for (var i = 0; i < x.length; i++) {
//                 var tagName = Object.keys(x[i])[0];
//                 if (!groups[tagName]) groups[tagName] = [];
//                 groups[tagName].push(x[i][tagName]);
//             }
//             var ordered = {};
//             order.forEach(function(o) {
//                 if (groups[o]) ordered[o] = groups[o];
//             });
//             return ordered;
//         }


//         // sort relations in a changeset by dependencies
//         function sort(changes) {

//             // find a referenced relation in the current changeset
//             function resolve(item) {
//                 return relations.find(function(relation) {
//                     return item.keyAttributes.type === 'relation'
//                         && item.keyAttributes.ref === relation['@id'];
//                 });
//             }

//             // a new item is an item that has not been already processed
//             function isNew(item) {
//                 return !sorted[ item['@id'] ] && !processing.find(function(proc) {
//                     return proc['@id'] === item['@id'];
//                 });
//             }

//             var processing = [];
//             var sorted = {};
//             var relations = changes.relation;

//             if (!relations) return changes;

//             for (var i = 0; i < relations.length; i++) {
//                 var relation = relations[i];

//                 // skip relation if already sorted
//                 if (!sorted[relation['@id']]) {
//                     processing.push(relation);
//                 }

//                 while (processing.length > 0) {
//                     var next = processing[0],
//                     deps = next.member.map(resolve).filter(Boolean).filter(isNew);
//                     if (deps.length === 0) {
//                         sorted[next['@id']] = next;
//                         processing.shift();
//                     } else {
//                         processing = deps.concat(processing);
//                     }
//                 }
//             }

//             changes.relation = Object.values(sorted);
//             return changes;
//         }

//         function rep(entity) {
//             return entity.asJXON(changeset_id);
//         }

//         return {
//             osmChange: {
//                 '@version': 0.6,
//                 '@generator': 'Rapid',
//                 'create': sort(nest(changes.created.map(rep), ['node', 'way', 'relation'])),
//                 'modify': nest(changes.modified.map(rep), ['node', 'way', 'relation']),
//                 'delete': Object.assign(nest(changes.deleted.map(rep), ['relation', 'way', 'node']), { '@if-unused': true })
//             }
//         };
//     },


//     asGeoJSON: function() {
//         return {};
//     }

// });
