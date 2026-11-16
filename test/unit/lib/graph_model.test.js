import { describe, it } from 'bun:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


// Checks `Graph` against a reference model: plain Maps, copied for every version, with brute-force
// parent lists. Random histories of derives, replaces, removes, reverts, loads, commits, savepoints,
// freezes and rebases (forced too, with iD#2085 restores) run on a handful of graphs, and every graph
// is compared with its model after every step. See design/graph-geometry.md, "Testing".
//
// The default run takes about a second. For a longer one, set the environment, e.g.
// `GRAPH_MODEL_SEEDS=3000 GRAPH_MODEL_STEPS=200 bun test --preload ./test/test_setup.js test/unit/lib/graph_model.test.js`
// A failure names its seed: rerun just that one with `GRAPH_MODEL_SEED0=<seed> GRAPH_MODEL_SEEDS=1`.

const FIRST_SEED = Number(process.env.GRAPH_MODEL_SEED0 ?? 1);
const SEEDS = Number(process.env.GRAPH_MODEL_SEEDS ?? 25);
const STEPS = Number(process.env.GRAPH_MODEL_STEPS ?? 150);
const MAX_GRAPHS = 9;

const BASE_NODES = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10', 'n11', 'n12'];
const BASE_WAYS = ['w1', 'w2', 'w3', 'w4', 'w5'];
const BASE_RELS = ['r1', 'r2', 'r3'];
const LATE_IDS = ['n13', 'n14', 'w6', 'w7', 'r4'];   // arrive only by rebase
const NODE_IDS = [...BASE_NODES, 'n13', 'n14', 'n-1', 'n-2'];
const WAY_IDS = [...BASE_WAYS, 'w6', 'w7', 'w-1', 'w-2'];
const REL_IDS = [...BASE_RELS, 'r4', 'r-1'];
const ALL_IDS = [...NODE_IDS, ...WAY_IDS, ...REL_IDS];
const SERVER_IDS = [...BASE_NODES, ...BASE_WAYS, ...BASE_RELS, ...LATE_IDS];


// A small seeded random number generator (mulberry32), so a failure can be replayed.
function makeRandom(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}


// True if `ids` has each of `expected` exactly once, and nothing else.
function sameIDs(ids, expected) {
  return ids.length === expected.size && new Set(ids).size === ids.length && ids.every(id => expected.has(id));
}


// What a graph should hold: its own versions (`undefined` for deleted), over the shared base Map.
class Model {
  constructor(baseModel, local) {
    this.baseModel = baseModel;
    this.local = local ?? new Map();
    this.frozen = false;
    this.savepoint = null;
  }
  get(id) {
    return this.local.has(id) ? this.local.get(id) : this.baseModel.get(id);
  }
  isDeleted(id) {
    return this.local.has(id) && this.local.get(id) === undefined;
  }
  parentIDs(childID, type) {
    const result = new Set();
    for (const id of ALL_IDS) {
      const entity = this.get(id);
      if (type === 'way' && entity?.type === 'way' && entity.nodes.includes(childID)) {
        result.add(id);
      } else if (type === 'relation' && entity?.type === 'relation' && entity.members.some(m => m.id === childID)) {
        result.add(id);
      }
    }
    return result;
  }
}


function runSeed(context, seed, steps, log) {
  const random = makeRandom(seed);
  const pick = arr => arr[Math.floor(random() * arr.length)];
  const chance = p => random() < p;

  function makeEntity(id) {
    if (id[0] === 'n') {
      return new Rapid.OsmNode(context, { id: id, loc: [random(), random()], tags: chance(0.3) ? { a: String(Math.floor(random() * 3)) } : {} });

    } else if (id[0] === 'w') {
      const nodes = [];
      const length = Math.floor(random() * 6);
      for (let i = 0; i < length; i++) {
        nodes.push(chance(0.15) && nodes.length ? pick(nodes) : pick(NODE_IDS));   // repeated nodes
      }
      if (nodes.length > 2 && chance(0.3)) nodes.push(nodes[0]);   // closed
      const tags = chance(0.5) ? { highway: 'residential' } : (chance(0.5) ? { area: 'yes' } : {});
      return new Rapid.OsmWay(context, { id: id, nodes: nodes, tags: tags });

    } else {
      // A multipolygon's shape is built from every node of its member ways, which real data always
      // has and random histories don't, so multipolygons get only nodes and relations as members.
      const tags = { type: pick(['boundary', 'route', 'multipolygon']) };
      const memberIDs = (tags.type === 'multipolygon') ? [...NODE_IDS, ...REL_IDS] : ALL_IDS;
      const members = [];
      const length = Math.floor(random() * 5);
      for (let i = 0; i < length; i++) {
        const memberID = (chance(0.15) && members.length) ? pick(members).id : pick(memberIDs);   // repeated members
        const type = memberID[0] === 'n' ? 'node' : memberID[0] === 'w' ? 'way' : 'relation';
        members.push({ id: memberID, type: type, role: pick(['', 'outer', 'inner', 'stop']) });
      }
      return new Rapid.OsmRelation(context, { id: id, members: members, tags: tags });
    }
  }

  const baseModel = new Map();
  const initial = [...BASE_NODES, ...BASE_WAYS, ...BASE_RELS].map(makeEntity);
  for (const entity of initial) {
    baseModel.set(entity.id, entity);
  }
  const baseGraph = new Rapid.Graph(context, initial);
  const baseItem = { graph: baseGraph, model: new Model(baseModel), isBase: true, name: 'B' };
  const items = [baseItem];
  let graphCount = 0;

  function derive(from) {
    const graph = new Rapid.Graph(from.graph);
    const item = {
      graph: graph,
      model: new Model(baseModel, new Map(from.model.local)),
      session: new Rapid.SessionDifference(baseGraph, graph),   // updated as the graph changes, like EditSystem's
      isBase: false,
      name: `G${++graphCount}`
    };
    items.push(item);
    log.push(`${item.name} = derive(${from.name})`);
  }

  // Plain comparisons, with a message built only on a mismatch: this runs millions of times.
  function check(where) {
    for (const { graph, model, isBase, name } of items) {
      for (const id of ALL_IDS) {
        const expected = model.get(id);
        const actual = graph.hasEntity(id);
        if (actual !== expected) {
          assert.fail(`${where}: ${name}.hasEntity(${id}) is ${actual?.key}, expected ${expected?.key}`);
        }
        if (!isBase && graph.isLocal(id) !== model.local.has(id)) {
          assert.fail(`${where}: ${name}.isLocal(${id}) is ${graph.isLocal(id)}`);
        }

        const entity = expected ?? { id: id };
        const parentWays = graph.parentWays(entity).map(e => e.id);
        const expectedWays = model.parentIDs(id, 'way');
        if (!sameIDs(parentWays, expectedWays)) {
          assert.fail(`${where}: ${name}.parentWays(${id}) is [${parentWays}], expected [${[...expectedWays]}]`);
        }
        const parentRels = graph.parentRelations(entity).map(e => e.id);
        const expectedRels = model.parentIDs(id, 'relation');
        if (!sameIDs(parentRels, expectedRels)) {
          assert.fail(`${where}: ${name}.parentRelations(${id}) is [${parentRels}], expected [${[...expectedRels]}]`);
        }

        if (expected?.type === 'way' && expected.nodes.every(nodeID => model.get(nodeID))) {
          const childNodes = graph.childNodes(expected);
          if (childNodes.some((node, i) => node !== model.get(expected.nodes[i]))) {
            assert.fail(`${where}: ${name}.childNodes(${id}) is [${childNodes.map(n => n.key)}]`);
          }
        }
      }

      // The session difference, updated in place, answers as one built from scratch.
      if (!isBase) {
        const session = items.find(item => item.graph === graph).session;
        // Candidates: what differs from base now, and what did at the last update (since reverted).
        const candidateIDs = chance(0.5) ? ALL_IDS : graph.diffIDs(baseGraph).union(new Set(session.changes.keys()));
        session.update(graph, candidateIDs);
        const fresh = new Rapid.Difference(baseGraph, graph);
        const complete = fresh.complete();
        if (!sameIDs([...session.changes.keys()], new Set(fresh.changes.keys()))) {
          assert.fail(`${where}: ${name}'s session difference has [${[...session.changes.keys()]}], expected [${[...fresh.changes.keys()]}]`);
        }
        for (const id of ALL_IDS) {
          if (session.affects(id) !== complete.has(id)) {
            assert.fail(`${where}: ${name}'s session difference affects(${id}) is ${session.affects(id)}, expected ${complete.has(id)}`);
          }
        }
      }

      if (!isBase) {
        const localEntities = graph.localEntities();
        const sameLocal = localEntities.size === model.local.size &&
          [...model.local].every(([id, entity]) => localEntities.has(id) && localEntities.get(id) === entity);
        if (!sameLocal) {
          assert.fail(`${where}: ${name}.localEntities() is [${[...localEntities.keys()]}], expected [${[...model.local.keys()]}]`);
        }
      }

      // Each graph's shapes match shapes built from scratch, once it has caught up with the base
      // (as `EditSystem` makes a graph catch up when it becomes current). Reading shapes commits
      // uncommitted writes, so only some checks look, leaving other graphs' writes pending, and
      // their rebases unsynced, into later steps.
      if (chance(0.5)) {
        graph.syncWithBase();
        const problems = graph.verify(ALL_IDS);
        if (problems.length) {
          assert.fail(`${where}: ${problems.join(', ')}`);
        }
      }
    }

    // `diffIDs` may report more than what differs, never less. `Difference` must be exact.
    for (const a of items) {
      for (const b of items) {
        const diffIDs = b.graph.diffIDs(a.graph);
        for (const id of ALL_IDS) {
          if (a.model.get(id) !== b.model.get(id) && !diffIDs.has(id)) {
            assert.fail(`${where}: ${b.name}.diffIDs(${a.name}) misses ${id}`);
          }
        }
        if (a.isBase || chance(0.3)) {
          const changed = new Set(new Rapid.Difference(a.graph, b.graph).changes.keys());
          for (const id of ALL_IDS) {
            const expected = !!Rapid.compareEntities(a.model.get(id), b.model.get(id));
            if (changed.has(id) !== expected) {
              assert.fail(`${where}: Difference(${a.name}, ${b.name}) ${expected ? 'misses' : 'has'} ${id}`);
            }
          }
        }
      }
    }
  }

  derive(baseItem);
  check(`seed ${seed} start`);

  for (let step = 0; step < steps; step++) {
    const writable = items.filter(item => !item.isBase);
    const item = pick(writable);
    const { graph, model, name } = item;
    const where = `seed ${seed} step ${step}`;
    const op = Math.floor(random() * 13);

    const expectFrozen = (fn, what) => {
      assert.throws(fn, Error, undefined, `${where}: ${what} on frozen ${name}`);
    };

    if (op <= 2) {   // replace
      const id = pick(ALL_IDS);
      const r = random();
      let entity;
      if (r < 0.5) {
        entity = makeEntity(id);
      } else if (r < 0.7) {
        entity = baseModel.get(id) ?? makeEntity(id);              // the base's own object
      } else if (r < 0.85) {
        entity = pick(items).model.get(id) ?? makeEntity(id);      // another graph's version
      } else {
        entity = model.get(id) ?? makeEntity(id);                  // no change
      }
      log.push(`${name}.replace(${entity.key})`);
      if (model.frozen) {
        expectFrozen(() => graph.replace(entity), 'replace');
        continue;
      }
      graph.replace(entity);
      if (model.get(id) !== entity) model.local.set(id, entity);

    } else if (op === 3) {   // remove
      const id = pick(ALL_IDS);
      const entity = model.get(id) ?? baseModel.get(id) ?? makeEntity(id);
      log.push(`${name}.remove(${id})`);
      if (model.frozen) {
        expectFrozen(() => graph.remove(entity), 'remove');
        continue;
      }
      graph.remove(entity);
      if (model.get(id)) model.local.set(id, undefined);

    } else if (op === 4) {   // revert
      const ids = [pick(ALL_IDS), pick(ALL_IDS)];
      log.push(`${name}.revert(${ids})`);
      if (model.frozen) {
        expectFrozen(() => graph.revert(ids), 'revert');
        continue;
      }
      graph.revert(ids);
      for (const id of ids) {
        model.local.delete(id);
      }

    } else if (op === 5) {   // load
      const entities = {};
      for (let i = 0; i < 3; i++) {
        const id = pick(ALL_IDS);
        entities[id] = chance(0.3) ? undefined : makeEntity(id);
      }
      log.push(`${name}.load(${Object.keys(entities)})`);
      if (model.frozen) {
        expectFrozen(() => graph.load(entities), 'load');
        continue;
      }
      graph.load(entities);
      for (const [id, entity] of Object.entries(entities)) {
        model.local.set(id, entity);
      }

    } else if (op === 6 || op === 7) {   // derive, or drop a graph to make room
      if (items.length > MAX_GRAPHS) {
        const dropped = pick(writable);
        items.splice(items.indexOf(dropped), 1);
        log.push(`drop ${dropped.name}`);
      } else {
        derive(chance(0.1) ? baseItem : item);
      }

    } else if (op === 8) {   // commit
      log.push(`${name}.commit()`);
      graph.commit();

    } else if (op === 9) {   // savepoints
      if (model.frozen) continue;
      if (!model.savepoint || chance(0.2)) {
        log.push(`${name}.commit(); ${name}.beginSavepoint()`);
        graph.commit();
        graph.beginSavepoint();
        model.savepoint = new Map(model.local);
      } else if (chance(0.7)) {
        log.push(`${name}.rollbackToSavepoint()`);
        graph.rollbackToSavepoint();
        model.local = new Map(model.savepoint);
      } else {
        log.push(`${name}.endSavepoint()`);
        graph.endSavepoint();
        model.savepoint = null;
      }

    } else if (op === 10) {   // freeze
      if (chance(0.5)) continue;
      log.push(`${name}.freeze()`);
      graph.freeze();
      model.frozen = true;
      model.savepoint = null;

    } else {   // rebase
      const force = chance(0.4);
      const byID = new Map();   // one version of each ID, to keep the model simple
      const count = 1 + Math.floor(random() * 4);
      for (let i = 0; i < count; i++) {
        const entity = makeEntity(pick(SERVER_IDS));
        byID.set(entity.id, entity);
      }
      const entities = [...byID.values()];
      const stack = writable.filter(() => chance(0.6));
      log.push(`B.rebase([${entities.map(e => e.key)}], [${stack.map(s => s.name)}], ${force})`);

      const arrivedWays = [];
      for (const entity of entities) {
        if (!force && baseModel.has(entity.id)) continue;
        baseModel.set(entity.id, entity);
        if (entity.type === 'way') arrivedWays.push(entity);
      }
      // iD#2085: in each graph of the stack, a node that graph deleted comes back when a downloaded
      // way uses it, unless that graph deleted the way too.
      for (const s of stack) {
        const restoreIDs = new Set();
        for (const way of arrivedWays) {
          if (s.model.isDeleted(way.id)) continue;
          for (const nodeID of way.nodes) {
            if (s.model.isDeleted(nodeID)) restoreIDs.add(nodeID);
          }
        }
        for (const id of restoreIDs) {
          s.model.local.delete(id);
        }
      }
      baseGraph.rebase(entities, stack.map(s => s.graph), force);
    }

    check(where);
  }
}


describe('Graph against a reference model', () => {
  const context = new Rapid.MockContext();

  it(`matches the model in ${SEEDS} random histories of ${STEPS} steps`, () => {
    for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
      const log = [];
      try {
        runSeed(context, seed, STEPS, log);
      } catch (err) {
        err.message += `\nLast steps of seed ${seed}:\n  ` + log.slice(-25).join('\n  ');
        throw err;
      }
    }
  }, 600000);
});
