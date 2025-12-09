import deepEqual from 'fast-deep-equal';


/**
 *  Difference
 *  Difference represents the difference between two Graphs.
 *  It knows how to calculate the set of entities that were
 *  created, modified, or deleted, and also contains the logic
 *  for recursively extending a difference to the complete set
 *  of entities that will require a redraw, taking into account
 *  child and parent relationships.
 */
export class Difference {

  /**
   * @constructor
   * @param  {Graph?}  base - Base Graph
   * @param  {Graph}   head - Head Graph
   */
  constructor(base, head) {
    this._base = base;
    this._head = head;
    this._changes = new Map();   // Map<entityID, Object>
    this.didChange = {};         // 'addition', 'deletion', 'geometry', 'properties'
    this._summary = null;
    this._complete = null;

    if (!head) return;           // no head graph, no difference
    if (base === head) return;   // same Graph, no difference

    // Gather affected ids
    let ids = new Set(head.local.entities.keys());
    if (base) {                               // Note:  Maps are "Set-like"
      ids = ids.union(base.local.entities);   // keys() will be invoked automatially
    }

    // Check each id to determine whether it has changed from base -> head..
    for (const id of ids) {
      const h = head.hasEntity(id);
      const b = base?.hasEntity(id);
      if (h === b) continue;  // no change

      const type = h?.type || b?.type;

      if (b && !h) {
        this._changes.set(id, { base: b, head: h });
        this.didChange.deletion = true;
        continue;
      }
      if (!b && h) {
        this._changes.set(id, { base: b, head: h });
        this.didChange.addition = true;
        continue;
      }

      if (h && b) {
        if (type === 'relation') {
          if (!deepEqual(h.members, b.members)) {
            this._changes.set(id, { base: b, head: h });
            this.didChange.geometry = true;
            this.didChange.properties = true;
            continue;
          }
        } else if (type === 'way') {
          if (!deepEqual(h.nodes, b.nodes)) {
            this._changes.set(id, { base: b, head: h });
            this.didChange.geometry = true;
          }
        } else if (type === 'node') {
          if (!deepEqual(h.loc, b.loc)) {
            this._changes.set(id, { base: b, head: h });
            this.didChange.geometry = true;
          }
        }

        if (!deepEqual(h.tags, b.tags)) {
          this._changes.set(id, { base: b, head: h });
          this.didChange.properties = true;
        }
      }
    }
  }


  /**
   * changes
   * @readonly
   * @return  {Map<entityID, Object>  The change details
   */
  get changes() {
    return this._changes;
  }


  /**
   * modified
   * @return  {Array<Entity>}  Array of Entities modified
   */
  modified() {
    let result = [];
    for (const change of this._changes.values()) {
      if (change.base && change.head) {
        result.push(change.head);
      }
    }
    return result;
  }


  /**
   * created
   * @return  {Array<Entity>}  Array of Entities created
   */
  created() {
    let result = [];
    for (const change of this._changes.values()) {
      if (!change.base && change.head) {
        result.push(change.head);
      }
    }
    return result;
  }


  /**
   * deleted
   * @return  {Array<Entity>}  Array of Entities deleted
   */
  deleted() {
    let result = [];
    for (const change of this._changes.values()) {
      if (change.base && !change.head) {
        result.push(change.base);
      }
    }
    return result;
  }


  /**
   * summary
   * Generates a difference "summary" in a format like what is presented on the
   *  pre-save commit component, with list items like "created", "modified", "deleted".
   *
   * The difference summary is used to present a more "human" difference regarding verticies.
   * For exmaple, when changing a way, the user might add/delete/move uninteresting child nodes,
   *  but the summary difference presents it as only the way being modified.
   *
   * Returns a result about the Entities that changed:
   *  {
   *    entityID: {
   *      entity:      The Entity that changed
   *      graph:       The Graph it can be found in (head or base)
   *      changeType:  String, one of 'created', 'modified', or 'deleted'
   *    }
   *  }
   * @return  {Map<entityID, Object>  Returns a summary of changes
   */
  summary() {
    if (this._summary) return this._summary;  // done already

    const base = this._base;
    const head = this._head;
    const result = new Map();  // Map<entityID, change detail>

    for (const change of this._changes.values()) {
      const h = change.head;
      const b = change.base;

      if (h && h.geometry(head) !== 'vertex') {
        result.set(h.id, { entity: h, graph: head, changeType: (b ? 'modified' : 'created') });

      } else if (b && b.geometry(base) !== 'vertex') {
        result.set(b.id, { entity: b, graph: base, changeType: 'deleted' });

      } else if (b && h) {  // modified vertex
        const moved = !deepEqual(b.loc, h.loc);
        const retagged = !deepEqual(b.tags, h.tags);
        if (moved) {
          for (const parent of head.parentWays(h)) {
            if (result.has(parent.id)) continue;
            result.set(parent.id, { entity: parent, graph: head, changeType: 'modified' });
          }
        }
        if (retagged || (moved && h.hasInterestingTags())) {
          result.set(h.id, { entity: h, graph: head, changeType: 'modified' });
        }

      } else if (h && h.hasInterestingTags()) {  // created vertex
        result.set(h.id, { entity: h, graph: head, changeType: 'created' });

      } else if (b && b.hasInterestingTags()) {  // deleted vertex
        result.set(b.id, { entity: b, graph: base, changeType: 'deleted' });
      }
    }

    this._summary = result;
    return result;
  }


  /**
   * complete
   * Returns complete set of Entities affected by the changes in this difference.
   * This is used to know which Entities need redraw or revalidation.
   * Recurses up to include all ancestor Entities in the result, parentWays and parentRelations.
   * @return  {Map<entityID, Entity>  Returns the complete set of entities affected by the change
   */
  complete() {
    if (this._complete) return this._complete;  // done already

    const head = this._head;
    const result = new Map();  // Map<entityID, Entity>

    for (const [entityID, change] of this._changes) {
      const h = change.head;
      const b = change.base;
      const entity = h || b;

      result.set(entityID, h);

      if (entity.type === 'way') {
        const headNodes = new Set(h?.nodes);
        const baseNodes = new Set(b?.nodes);
        for (const nodeID of headNodes.union(baseNodes)) {
          result.set(nodeID, head.hasEntity(nodeID));
        }
      }

      if (entity.type === 'relation' && entity.isMultipolygon()) {
        const headMembers = new Set(h?.members?.map(m => m.id));
        const baseMembers = new Set(b?.members?.map(m => m.id));
        for (const memberID of headMembers.union(baseMembers)) {
          const member = head.hasEntity(memberID);
          if (!member) continue;   // not downloaded
          result.set(memberID, member);
        }
      }

      _gatherParents(head.parentWays(entity), result);
      _gatherParents(head.parentRelations(entity), result);
    }

    this._complete = result;
    return result;


    function _gatherParents(parents) {
      for (const parent of parents) {
        if (result.has(parent.id)) continue;
        result.set(parent.id, parent);
        _gatherParents(head.parentRelations(parent));  // recurse up to parent relations
      }
    }
  }

}
