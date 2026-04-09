import { OsmEntity, OsmEntityProps } from './OsmEntity.ts';
import { GeoJSONObject } from '../lib/types.ts';

import type { Context } from '../Context.ts';


/**
 * Properties for OsmChangeset data elements.
 * Changesets don't have additional properties beyond the base OsmEntityProps.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface OsmChangesetProps extends OsmEntityProps {}


/**
 * Changes to be included in an osmChange document.
 */
export interface OsmChanges {
  created: OsmEntity[];
  modified: OsmEntity[];
  deleted: OsmEntity[];
}


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
   * @param otherOrContext - copy another data element, or pass application context
   * @param props - Properties to assign to the data element
   */
  constructor(otherOrContext: OsmChangeset | Context, props: Partial<OsmChangesetProps> = {}) {
    super(otherOrContext as any, props);
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
   * @return An empty object
   */
  asGeoJSON(): GeoJSONObject {
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
   * @return JXON representation of the OsmChangeset
   */
  asJXON(): Record<string, unknown> {
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
   * Returns 'point', 'line', 'vertex', 'area, or 'relation' depending on the data type.
   * @param graph - the Graph that holds the topology needed
   * @returns 'point', 'line', 'vertex', 'area, or 'relation' depending on the data type
   */
  geometry(): GeometryType {
    throw new Error(`Do not call 'geometry' on OsmChangeset`);
  }

  /**
   * osmChangeJXON
   * @see http://wiki.openstreetmap.org/wiki/OsmChange
   * @return JXON representation of an osmChange document
   */
  osmChangeJXON(changes: OsmChanges): Record<string, unknown> {
    const changesetID = this.props.id;

    function nest(arr: Record<string, any>[], order: string[]): Record<string, any[]> {
      const groups: Record<string, any[]> = {};
      for (const item of arr) {
        const tagName = Object.keys(item)[0];
        if (!groups[tagName]) groups[tagName] = [];
        groups[tagName].push(item[tagName]);
      }
      const ordered: Record<string, any[]> = {};
      for (const k of order) {
        if (groups[k]) ordered[k] = groups[k];
      }
      return ordered;
    }

    // sort relations in a changeset by dependencies
    function sort(changes: Record<string, any[]>): Record<string, any[]> {
      // find a referenced relation in the current changeset
      function resolve(item: any): any {
        return relations.find(relation => {
          return item.keyAttributes.type === 'relation' && item.keyAttributes.ref === relation['@id'];
        });
      }

      // a new item is an item that has not been already processed
      function isNew(item: any): boolean {
        return !sorted[ item['@id'] ] && !processing.find(proc => {
          return proc['@id'] === item['@id'];
        });
      }

      let processing: any[] = [];
      const sorted: Record<string, any> = {};
      const relations = changes.relation;
      if (!relations) return changes;

      for (const relation of relations) {
        // skip relation if already sorted
        if (!sorted[relation['@id']]) {
          processing.push(relation);
        }

        while (processing.length > 0) {
          const next = processing[0];
          const deps = next.member.map(resolve).filter(Boolean).filter(isNew);
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

    function rep(entity: OsmEntity): Record<string, unknown> {
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
