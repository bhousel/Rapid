import { select as d3_select } from 'd3-selection';

import { osmPathHighwayTagValues, osmPavedTags, osmSemipavedTags, osmLifecyclePrefixes } from './tags.ts';

import type { D3Selection } from 'd3-selection';
import type { Tags } from '../data/types.ts';

//
// This code is no longer used in Rapid, and we should remove it eventually.
// It is still useful to use as a reference for tag and style matching
// Some of this should move into the osm or the style code maybe.
//

/** Entity-like object with tags */
interface TaggedEntity {
  tags: Record<string, string>;
}

/** Function that extracts tags from an entity */
type TagExtractor = (entity: TaggedEntity) => Record<string, string>;

/** The tag classes function interface */
interface TagClassesFunction {
  ($selection: D3Selection): void;
  getClassesString(tags: Record<string, string>, value: string): string;
  tags(val?: TagExtractor): TagExtractor | TagClassesFunction;
}

export function svgTagClasses(): TagClassesFunction {
  const primaries = [
    'building', 'highway', 'railway', 'waterway', 'aeroway', 'aerialway',
    'piste:type', 'boundary', 'power', 'amenity', 'natural', 'landuse',
    'leisure', 'military', 'place', 'man_made', 'route', 'roller_coaster',
    'attraction', 'building:part', 'indoor'
  ];
  const statuses = Object.keys(osmLifecyclePrefixes);
  const secondaries = [
    'oneway', 'bridge', 'tunnel', 'embankment', 'cutting', 'barrier',
    'surface', 'tracktype', 'footway', 'crossing', 'service', 'sport',
    'public_transport', 'location', 'parking', 'golf', 'type', 'leisure',
    'man_made', 'indoor'
  ];

  let _tags: TagExtractor = (entity: TaggedEntity) => entity.tags;


  const tagClasses = function($selection: D3Selection): void {
    $selection.each(function tagClassesEach(this: Element, entity: TaggedEntity) {
      let value = this.className;

      if ((this.className as any).baseVal !== undefined) {
        value = (this.className as any).baseVal as string;
      }

      const t = _tags(entity);
      const computed = tagClasses.getClassesString(t, value);

      if (computed !== value) {
        d3_select(this).attr('class', computed);
      }
    });
  } as TagClassesFunction;


  tagClasses.getClassesString = function(t: Tags, value: string): string {
    let primary: string | undefined;
    let status: string | undefined;
    let i: number, j: number, k: string, v: string;

    // in some situations we want to render perimeter strokes a certain way
    let overrideGeometry: string | undefined;
    if (/\bstroke\b/.test(value)) {
      if (!!t.barrier && t.barrier !== 'no') {
        overrideGeometry = 'line';
      }
    }

    // preserve base classes (nothing with `tag-`)
    const classes = value.trim().split(/\s+/)
      .filter(klass => {
        return klass.length && !/^tag-/.test(klass);
      })
      .map(klass => {  // special overrides for some perimeter strokes
        return (klass === 'line' || klass === 'area') ? (overrideGeometry || klass) : klass;
      });

    // pick at most one primary classification tag..
    for (i = 0; i < primaries.length; i++) {
      k = primaries[i];
      v = t[k];
      if (!v || v === 'no') continue;

      if (k === 'piste:type') {  // avoid a ':' in the class name
        k = 'piste';
      } else if (k === 'building:part') {  // avoid a ':' in the class name
        k = 'building_part';
      }

      primary = k;
      if (statuses.indexOf(v) !== -1) {   // e.g. `railway=abandoned`
        status = v;
        classes.push(`tag-${k}`);
      } else {
        classes.push(`tag-${k}`);
        classes.push(`tag-${k}-${v}`);
      }

      break;
    }

    if (!primary) {
      for (i = 0; i < statuses.length; i++) {
        for (j = 0; j < primaries.length; j++) {
          k = statuses[i] + ':' + primaries[j];  // e.g. `demolished:building=yes`
          v = t[k];
          if (!v || v === 'no') continue;

          status = statuses[i];
          break;
        }
      }
    }

    // add at most one status tag, only if relates to primary tag..
    if (!status) {
      for (i = 0; i < statuses.length; i++) {
        k = statuses[i];
        v = t[k];
        if (!v || v === 'no') continue;

        if (v === 'yes') {   // e.g. `railway=rail + abandoned=yes`
          status = k;
        } else if (primary && primary === v) {  // e.g. `railway=rail + abandoned=railway`
          status = k;
        } else if (!primary && primaries.includes(v)) {  // e.g. `abandoned=railway`
          status = k;
          primary = v;
          classes.push(`tag-${v}`);
        }  // else ignore e.g.  `highway=path + abandoned=railway`

        if (status) break;
      }
    }

    if (status) {
      classes.push('tag-status');
      classes.push(`tag-status-${status}`);
    }

    // add any secondary tags
    for (i = 0; i < secondaries.length; i++) {
      k = secondaries[i];
      v = t[k];
      if (!v || v === 'no' || k === primary) continue;
      classes.push(`tag-${k}`);
      classes.push(`tag-${k}-${v}`);
    }

    // For highways, look for surface tagging..
    if ((primary === 'highway' && !osmPathHighwayTagValues[t.highway]) || primary === 'aeroway') {
      let surface = t.highway === 'track' ? 'unpaved' : 'paved';
      for (k in t) {
        v = t[k];
        if (k in osmPavedTags) {
          surface = (osmPavedTags as Record<string, Record<string, boolean>>)[k][v] ? 'paved' : 'unpaved';
        }
        if (k in osmSemipavedTags && !!(osmSemipavedTags as Record<string, Record<string, boolean>>)[k][v]) {
          surface = 'semipaved';
        }
      }
      classes.push(`tag-${surface}`);
    }

    // If this is a wikidata-tagged item, add a class for that..
    const qid = (
      t.wikidata ||
      t['flag:wikidata'] ||
      t['brand:wikidata'] ||
      t['network:wikidata'] ||
      t['operator:wikidata']
    );

    if (qid) {
      classes.push('tag-wikidata');
    }

    return classes.join(' ').trim();
  };


  tagClasses.tags = function(val?: TagExtractor): TagExtractor | TagClassesFunction {
    if (!arguments.length) return _tags;
    _tags = val!;
    return tagClasses;
  };

  return tagClasses;
}
