import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode, OsmTags, OsmWay } from '../data/types.ts';


/** Options for the reverse action */
export interface ReverseOptions {
  /** Whether to also reverse oneway tags */
  reverseOneway?: boolean;
}

/** A reverse action with additional methods */
export interface ReverseAction extends Action {
  /** Returns a reason string if disabled, or false if not disabled */
  disabled: (graph: Graph) => string | false;
  /** Returns the entity ID being reversed */
  entityID: () => EntityID;
}

/** Key replacement pairs: [pattern to match, replacement string] */
type KeyReplacement = [RegExp, string];

/** Value replacement lookup table */
type ValueReplacements = Record<string, string>;

/** Role replacement lookup table */
type RoleReplacements = Record<string, string>;

/** Oneway replacement lookup table */
type OnewayReplacements = Record<string, string>;

/** Compass direction replacement lookup table */
type CompassReplacements = Record<string, string>;


/**
 * Order the nodes of a way in reverse order and reverse any direction dependent tags
 * other than `oneway`. (We assume that correcting a backwards oneway is the primary
 * reason for reversing a way.)
 *
 * In addition, numeric-valued `incline` tags are negated.
 *
 * References:
 *     http://wiki.openstreetmap.org/wiki/Forward_%26_backward,_left_%26_right
 *     http://wiki.openstreetmap.org/wiki/Key:direction#Steps
 *     http://wiki.openstreetmap.org/wiki/Key:incline
 *     http://wiki.openstreetmap.org/wiki/Route#Members
 *     http://josm.openstreetmap.de/browser/josm/trunk/src/org/openstreetmap/josm/corrector/ReverseWayTagCorrector.java
 *     http://wiki.openstreetmap.org/wiki/Tag:highway%3Dstop
 *     http://wiki.openstreetmap.org/wiki/Key:traffic_sign#On_a_way_or_area
 * @param   entityID  - The EntityID to reverse
 * @param   options - reverse options
 * @return  An Action function that reverses the given Entity
*/
export function actionReverse(entityID: EntityID, options?: ReverseOptions): ReverseAction {
  const ignoreKey = /^.*(_|:)?(description|name|note|website|ref|source|comment|watch|attribution)(_|:)?/;
  const numeric = /^([+\-]?)(?=[\d.])/;
  const directionKey = /direction$/;
  const turn_lanes = /^turn:lanes:?/;

  const keyReplacements: KeyReplacement[] = [
    [/:right$/, ':left'],
    [/:left$/, ':right'],
    [/:forward$/, ':backward'],
    [/:backward$/, ':forward'],
    [/:right:/, ':left:'],
    [/:left:/, ':right:'],
    [/:forward:/, ':backward:'],
    [/:backward:/, ':forward:']
  ];

  const valueReplacements: ValueReplacements = {
    left: 'right',
    right: 'left',
    up: 'down',
    down: 'up',
    forward: 'backward',
    backward: 'forward',
    forwards: 'backward',
    backwards: 'forward',
  };

  const roleReplacements: RoleReplacements = {
    forward: 'backward',
    backward: 'forward',
    forwards: 'backward',
    backwards: 'forward'
  };

  const onewayReplacements: OnewayReplacements = {
    yes: '-1',
    '1': '-1',
    '-1': 'yes'
  };

  const compassReplacements: CompassReplacements = {
    N: 'S',
    NNE: 'SSW',
    NE: 'SW',
    ENE: 'WSW',
    E: 'W',
    ESE: 'WNW',
    SE: 'NW',
    SSE: 'NNW',
    S: 'N',
    SSW: 'NNE',
    SW: 'NE',
    WSW: 'ENE',
    W: 'E',
    WNW: 'ESE',
    NW: 'SE',
    NNW: 'SSE'
  };


  /**
   * Applies the key replacement table to swap directional suffixes such as
   * `:right`/`:left` and `:forward`/`:backward`.
   * @param   key - The tag key to transform
   * @return  Transformed key, or the original key if no replacement matched
   */
  function reverseKey(key: string): string {
    for (const replacement of keyReplacements) {
      if (replacement[0].test(key)) {
        return key.replace(replacement[0], replacement[1]);
      }
    }
    return key;  // no change
  }


  /**
   * Transforms a tag value to its directional opposite.
   * Handles `left`/`right`, `forward`/`backward`, numeric `incline` negation,
   * `oneway` values (when `reverseOneway` option is set), and absolute compass
   * directions on `*direction` keys (when `includeAbsolute` is set).
   * Keys matching `ignoreKey` (names, descriptions, refs, etc.) are passed through unchanged.
   * @param   key             - The tag key (used to select the reversal strategy)
   * @param   value           - The tag value to transform
   * @param   includeAbsolute - When `true`, also reverse absolute compass bearings
   * @return  Transformed value, or the original value if no replacement applied
   */
  function reverseValue(key: string, value: string, includeAbsolute?: boolean): string {
    if (ignoreKey.test(key)) return value;

    // Turn lanes are left/right to key (not way) direction - iD#5674
    if (turn_lanes.test(key)) {
      return value;

    } else if (key === 'incline' && numeric.test(value)) {
      return value.replace(numeric, (_: string, sign: string) => {
        return sign === '-' ? '' : '-';
      });

    } else if (options && options.reverseOneway && key === 'oneway') {
      return onewayReplacements[value] || value;

    } else if (includeAbsolute && directionKey.test(key)) {
      if (compassReplacements[value]) return compassReplacements[value];

      let degrees: number = parseFloat(value);
      if (Number.isFinite(degrees)) {
        if (degrees < 180) {
          degrees += 180;
        } else {
          degrees -= 180;
        }
        return degrees.toString();
      }
    }

    return valueReplacements[value] || value;
  }


  /**
   * Applies key and value reversal to all tags on the listed nodes, writing
   * the updated nodes back into the graph.  Used to reverse direction-dependent
   * tags on nodes that belong to the way being reversed.
   * @param   graph   - The current graph (mutated in place)
   * @param   nodeIDs - EntityIDs of the nodes whose tags should be reversed
   */
  // Reverse the direction of tags attached to the nodes - iD#3076
  function reverseNodeTags(graph: Graph, nodeIDs: EntityID[]): void {
    for (const nodeID of nodeIDs) {
      const node = graph.hasEntity(nodeID) as OsmNode | undefined;
      if (!node || !Object.keys(node.tags).length) continue;

      const tags: OsmTags = {};
      for (const [key, value] of Object.entries(node.tags)) {
        tags[reverseKey(key)] = reverseValue(key, value, node.id === entityID);
      }
      graph.replace(node.update({ tags: tags }));
    }
  }


  /**
   * Reverses the order of the way's nodes, transforms all direction-dependent
   * tags (keys and values), updates any parent relation roles that reference
   * forward/backward direction, and reverses directional tags on the way's nodes.
   * @param   graph - The current graph (mutated in place)
   * @param   way   - The way to reverse
   */
  function reverseWay(graph: Graph, way: OsmWay): void {
    const nodes: EntityID[] = way.nodes.slice().reverse();
    const tags: OsmTags = {};

    for (const [key, value] of Object.entries(way.tags)) {
      tags[reverseKey(key)] = reverseValue(key, value);
    }

    for (let relation of graph.parentRelations(way)) {
      for (const member of relation.indexedMembers()) {
        if (member.id !== way.id) continue;

        const reverseRole: string | undefined = roleReplacements[member.role];
        if (!reverseRole) continue;

        relation = relation.updateMember({ role: reverseRole }, member.index);
        graph.replace(relation);
      }
    }

    // Reverse any associated directions on nodes on the way and then replace
    // the way itself with the reversed node ids and updated way tags
    reverseNodeTags(graph, nodes);
    graph.replace(way.update({ nodes: nodes, tags: tags }));
  }


  const action = (graph: Graph): Graph => {
    const entity = graph.entity(entityID);
    if (entity.type === 'way') {
      reverseWay(graph, entity as OsmWay);
    } else if (entity.type === 'node') {
      reverseNodeTags(graph, [entityID]);
    }
    return graph.commit();
  };


  /**
   * Returns a reason string if the reverse operation cannot be performed,
   * or `false` if it is allowed.
   * @param   graph - The current graph
   * @return  `'nondirectional_node'` if the entity is a node whose tags contain no directional
   *          key or value that would be changed by reversing;
   *          `false` if the action is enabled
   */
  action.disabled = function(graph: Graph): string | false {
    const entity = graph.hasEntity(entityID);
    if (!entity || entity.type === 'way') return false;

    for (const [key, value] of Object.entries(entity.tags)) {
      if (reverseKey(key) !== key || reverseValue(key, value, true) !== value) {
        return false;
      }
    }
    return 'nondirectional_node';
  };

  action.entityID = function(): EntityID {
    return entityID;
  };

  return action;
}
