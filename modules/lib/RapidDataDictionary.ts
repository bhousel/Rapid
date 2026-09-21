import { TreeStore } from '../lib/TreeStore.ts';

import type { Context } from '../Context.ts';
import type { TreeValue } from './TreeStore.ts';


/**
 * A `RapidDataTransform` lists the known data fields and any transformations
 * that should occur when data is accepted in Rapid.
 * - 'ignore' - the source attribute is ignored completely
 * - 'copy' - source value is copied exactly to the target field
 * - 'constant' - the target field is set to a constant value
 */
export interface RapidDataTransform {
  /** The order to apply the transformation */
  order: number;
  /** The function that should be performed */
  function: string;
  /** The name of the source field, if any */
  source?: string;
  /** The name of the target field, if any */
  target?: string;
  /** Parameters used to perform the function, if any */
  params?: string;
  /** true if this field is the identifier field */
  isID?: boolean;
}


/**
 * A `RapidDataDictionary` contains a mapping from source attributes to target attributes.
 *
 * Properties available:
 * - `transforms` - `Array` of `RapidDataTransform` objects,
 *    applied in order to convert source attributes to target tags
 */
export class RapidDataDictionary {

  /** Global shared application context */
  public context: Context;
  /** Data transformation rules */
  public transforms: RapidDataTransform[];


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.transforms = [];

    // // sample data
    // this.transforms = [
    //   { order: 0, source: 'OBJECTID',         function: 'ignore',   isID: true },
    //   { order: 1, source: 'addr:housenumber', function: 'copy',     target: 'addr:housenumber'  },
    //   { order: 2, source: 'addr:street',      function: 'copy',     target: 'addr:street'       },
    //   { order: 3, source: 'addr:unit',        function: 'copy',     target: 'addr:unit'         },
    //   { order: 4, source: 'addr:city',        function: 'copy',     target: 'addr:city'         },
    //   { order: 5, source: 'addr:state',       function: 'copy',     target: 'addr:state'        },
    //   { order: 6, source: 'addr:postcode',    function: 'copy',     target: 'addr:postcode'     },
    //   { order: 7, source: 'addr:floor',       function: 'copy',     target: 'addr:floor'        },
    //   { order: 8, source: 'source',           function: 'copy',     target: 'source'            },
    //   { order: 9, source: 'building',         function: 'copy',     target: 'building'          }
    // ];
  }


  /**
   * Returns a settings-safe JSON representation of this `RapidDataDictionary`.
   * @return JSON representation of this data element
   */
  public toJSON(): Record<string, TreeValue> {
    const result: Record<string, TreeValue> = {};

    if (this.transforms.length > 0) {
      result.transforms = this.transforms.map((t: RapidDataTransform) => {
        const item: TreeValue = {
          order: t.order.toString(),
          function: t.function
        };
        if (t.source)  item.source = t.source;
        if (t.target)  item.target = t.target;
        if (t.params)  item.params = t.params;
        if (t.isID)    item.isID = 'true';

        return item;
      });
    }

    return result;
  }


  /**
   * Reconstructs a `RapidDataDictionary` from its persisted JSON form (see `toJSON`).
   * The settings store is string-only, so non-string data is restored here.
   * @param context - Global shared application context
   * @param json - The persisted settings object
   * @return A new `RapidDataDictionary`
   */
  public static fromJSON(context: Context, json: Record<string, TreeValue>): RapidDataDictionary {
    const dict = new RapidDataDictionary(context);

    if (Array.isArray(json.transforms)) {
      for (const t of json.transforms) {
        if (!TreeStore.isPlainObject(t)) continue;
        if (typeof t.function !== 'string') continue;
        if (typeof t.order !== 'string') continue;

        const item: RapidDataTransform = {
          function:  t.function,
          order:     parseInt(t.order, 10),
        };
        if (typeof t.source === 'string')  item.source = t.source;
        if (typeof t.target === 'string')  item.target = t.target;
        if (typeof t.params === 'string')  item.params = t.params;
        if (typeof t.isID === 'string')    item.isID   = (t.isID === 'true');

        dict.transforms.push(item);
      }
    }
    return dict;
  }


  /**
   * Applies the transforms in order to convert the source data into the target data.
   * Input data that is not strings will be converted to strings.
   * Empty, null, undefined, data will be ignored.
   * Returns a new object, does not modify source.
   * @param   source - source tags, as key=value pairs - will not be modified
   * @return  target tags, as key=value pairs
   */
  public applyTransforms(source: Record<string, unknown>): Record<string, string> {
    const results: Record<string, string> = {};
    const rows = this.transforms   // sort without modifying
      .toSorted((a: RapidDataTransform, b: RapidDataTransform) => a.order - b.order);

    for (const row of rows) {
      // 'ignore':  Information only, can be ignored
      if (row.function === 'ignore') continue;

      // 'copy':  copy the source row to the target row, '*' means match all
      if (row.function === 'copy') {
        if (!row.source || !row.target) continue;
        for (const [kIn, vIn] of Object.entries(source)) {
          if (row.source === kIn || row.source === '*') {
            const kOut = (row.target === '*') ? kIn : row.target;
            const vOut = (typeof vIn === 'string' ? vIn : String(vIn)).trim();
            if (vOut !== '' && vOut !== 'null' && vOut !== 'undefined') {
              results[kOut] = vOut;
            }
          }
        }
      }

      // 'constant':  make a target row, use the value in params as the value
      if (row.function === 'constant') {
        if (!row.params || !row.target) continue;
        results[row.target] = row.params;
      }

      // no other functions implemented yet.
    }

    return results;
  }

}
