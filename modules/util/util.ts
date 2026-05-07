import { Extent } from '@rapid-sdk/math';

import type { D3Selection } from 'd3-selection';
import type { Context } from '../Context.ts';
import type { OsmEntity, OsmRelation } from '../data/types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { Vec2 } from '@rapid-sdk/math';


/** GeoJSON input - either a Feature or FeatureCollection */
type GeoJSONInput = GeoJSON.Feature | GeoJSON.FeatureCollection;


/**
 * Returns an `Extent` that contains all of the given Entities or entityIDs.
 * @param vals - Entities -or- EntityIDs
 * @param graph - The graph to look up entities
 * @returns Total Extent that contains the given Entities
 */
export function utilTotalExtent(vals: Iterable<OsmEntity | EntityID>, graph: Graph): Extent {
  const extent = new Extent();

  for (const val of vals) {
    const entity = (typeof val === 'string' ? graph.hasEntity(val) : val);
    const other = entity?.extent();
    if (other) {
      extent.extendSelf(other);
    }
  }

  return extent;
}


/**
 * The given GeoJSON may be a single Feature or a FeatureCollection.
 * Here we expand it to an Array of Features.
 * @param geojson - A GeoJSON Feature or FeatureCollection
 * @returns Array of GeoJSON Features
 */
export function geojsonFeatures(geojson: Nullable<GeoJSONInput>): GeoJSON.Feature[] {
  if (!geojson) return [];
  return (geojson.type === 'FeatureCollection') ? (geojson.features ?? []) : [geojson];
}


/**
 * Calculates the bounding extent of a GeoJSON Feature or FeatureCollection.
 * @param geojson - A GeoJSON Feature or FeatureCollection
 * @returns The bounding Extent
 */
export function geojsonExtent(geojson: Nullable<GeoJSONInput>): Extent {
  const extent = new Extent();
  if (!geojson) return extent;

  for (const feature of geojsonFeatures(geojson)) {
    const geometry = feature.geometry;
    if (!geometry) continue;

    const type = geometry.type;
    const coords = (geometry as GeoJSON.Geometry & { coordinates?: unknown }).coordinates;
    if (!coords) continue;

    // Treat single types as multi types to keep the code simple
    const parts = /^Multi/.test(type) ? (coords as unknown[]) : [coords];

    if (/Polygon$/.test(type)) {
      for (const polygon of parts as Vec2[][][]) {
        const outer = polygon[0];  // No need to iterate over inners
        for (const point of outer) {
          extent.extendSelf(point);
        }
      }
    } else if (/LineString$/.test(type)) {
      for (const line of parts as Vec2[][]) {
        for (const point of line) {
          extent.extendSelf(point);
        }
      }
    } else if (/Point$/.test(type)) {
      for (const point of parts as Vec2[]) {
        extent.extendSelf(point);
      }
    }
  }

  return extent;
}


/**
 * Adds or removes highlight styling for the specified entities.
 * @param context - The application context
 * @param entityIDs - Array of entity IDs to highlight
 * @param highlighted - True to add highlight, false to remove
 */
export function utilHighlightEntities(context: Context, entityIDs: EntityID[], highlighted: boolean): void {
  const editor = context.systems.editor;
  const gfx = context.systems.gfx;
  const scene = gfx?.scene;
  const layer = scene?.layers.get('osm');

  if (!editor || !scene || !layer) return;  // called too soon?

  if (highlighted) {
    for (const entityID of entityIDs) {
      layer.setClass('highlight', entityID);

      // When highlighting a relation, try to highlight its members.
      if (entityID[0] === 'r') {
        const relation = editor.staging.graph.hasEntity(entityID) as OsmRelation;
        if (!relation) continue;
        for (const member of relation.members) {
          layer.setClass('highlight', member.id);
        }
      }
    }

  } else {
    layer.clearClass('highlight');
  }

  gfx?.immediateRedraw();
}


/**
 * Returns whether value looks like a valid color we can display.
 * OSM only supports hex or named colors.
 * @param value - The color value to validate
 * @returns True if the value is a valid displayable color
 */
export function utilIsColorValid(value: string): boolean {
  // OSM only supports hex or named colors
  if (!value.match(/^(#([0-9a-fA-F]{3}){1,2}|\w+)$/)) {
    return false;
  }
  // see https://stackoverflow.com/a/68217760/1627467
  if (!CSS.supports('color', value) || ['unset', 'inherit', 'initial', 'revert'].includes(value)) {
    return false;
  }

  return true;
}


/**
 * Applies a CSS transformation to the given element.
 * @param element - The HTML element to transform
 * @param x - X translation in pixels
 * @param y - Y translation in pixels
 * @param scale - Optional scale factor (1 = no scale)
 * @param rotate - Optional rotation in radians
 */
export function utilSetTransform(element: HTMLElement, x: number, y: number, scale?: number, rotate?: number): void {
  const t = `translate3d(${x}px,${y}px,0)`;
  const s = (scale && scale !== 1) ? ` scale(${scale})` : '';
  const r = rotate ? ` rotate(${rotate}rad)` : '';
  element.style.transform = `${t}${s}${r}`;
}


/**
 * A functor is just a way of turning anything into a function.
 * This is particularly useful in places where D3 wants a function to be.
 * If passed a function, it returns that function.
 * If passed a value, it returns a function that returns that value.
 * @param value - Any value or function
 * @returns A function that returns that value or the value if it's already a function
 */
export function utilFunctor<T>(value: T | (() => T)): () => T {
  return (typeof value === 'function') ? (value as () => T) : (() => value);
}


/**
 * Sets common attributes on `<input>` or `<textarea>` elements to avoid autocomplete and other annoyances.
 * @param selection - A D3 selection to an `<input>` or `<textarea>`
 * @returns Same selection but with the attributes set
 */
export function utilNoAuto(selection: D3Selection): D3Selection {
  const isText = (selection.size() && (selection.node() as HTMLElement)?.tagName.toLowerCase() === 'textarea');

  // assign 'new-password' even for non-password fields to prevent browsers (Chrome) ignoring 'off'
  // https://developer.mozilla.org/en-US/docs/Web/Security/Securing_your_site/Turning_off_form_autocompletion

  return selection
    .attr('autocomplete',  'new-password')
    .attr('autocorrect', 'off')
    .attr('autocapitalize', 'off')
    .attr('data-1p-ignore', 'true')  // 1Password
    .attr('data-bwignore', 'true')   // Bitwarden
    .attr('data-form-type', 'other') // Dashlane
    .attr('data-lpignore', 'true')   // LastPass
    .attr('spellcheck', isText ? 'true' : 'false');
}
