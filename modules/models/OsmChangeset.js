import { OsmEntity } from './OsmEntity.js';


/**
 * OsmChangeset
 * @see https://wiki.openstreetmap.org/wiki/Changeset
 *
 * Properties you can access:
 *   `geoms`   Geometry object (inherited from `AbstractData`)
 *   `props`   Properties object (inherited from `AbstractData`)
 *   `tags`    Object containing key-value string pairs for the OSM tags (inherited from `OsmEntity`)
 */
export class OsmChangeset extends OsmEntity {

  /**
   * @constructor
   * Data elements may be constructed by passing an application context or another data element.
   * They can also accept an optional properties object.
   * @param  {AbstractData|Context}  otherOrContext - copy another data element, or pass application context
   * @param  {Object}                props  - Properties to assign to the data element
   */
  constructor(otherOrContext, props = {}) {
    super(otherOrContext, props);
    this.props.type = 'changeset';

    if (!this.props.id) {  // no ID provided - generate one
      this.props.id = 'c-' + this.context.next('changeset');
    }

    // For consistency, offer a `this.id` property.
    this.id = this.props.id;
  }

  /**
   * asGeoJSON
   * Returns a GeoJSON representation of the OsmChangeset.
   * (This currently returns an unlocated Feature, but we could return a bounding box or something)
   * @return  {Object}  An empty object
   */
  asGeoJSON() {
    return {
      type: 'Feature',
      id: this.id,
      properties: this.tags,
      geometry: null
    };
  }

  /**
   * asJXON
   * Returns a JXON representation of the OsmChangeset.
   * For OSM Entities, this is used to prepare an OSM changeset XML.
   * @return  {Object}  JXON representation of the OsmChangeset
   */
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

  /**
   * geometry
   * Returns 'changeset'
   * @return  {string}  'changeset'
   */
  geometry() {
    return 'changeset';
  }


  /**
   * osmChangeJXON
   * @see http://wiki.openstreetmap.org/wiki/OsmChange
   * @return  {string}
   */
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
