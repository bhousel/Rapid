import { OsmEntity } from '../OsmEntity.js';


/**
 * OsmJSONParser
 * This class contains the code for parsing an OSM JSON content.
 *
 * Calling code should call `parseAsync` with the content to parse.
 * `parseAsync` returns a Promise either rejected with an error or resolved with
 * whatever valid data was found in the content, as an Array of Objects.
 *
 * @see https://wiki.openstreetmap.org/wiki/OSM_JSON
 * Note that OSM JSON data can contain slightly different syntax and attributes.
 * History:  The XML-based formats came first, but now the OSM API supports JSON
 *  for many of it's methods.  Using JSON can be much more efficient because it
 *  avoids the overhead of parsing and creating an Document / DOM objects.
 */
export class OsmJSONParser {

  /**
   * @constructor
   */
  constructor() {
    this._seen = new Set();   // Set<string>  (unique identifers)
  }


  /**
   * reset
   * Call reset to clear the caches.
   */
  reset() {
    this._seen.clear();
  }


  /**
   * parseAsync
   * @param   {Object|string}  content - the content to parse
   * @param   {Object}         options - parsing options
   * @return  {Promise}  Promise resolved with results of parsed data, or rejected with error.
   */
  parseAsync(content, options = {}) {
    options.skipSeen ??= true;

    return new Promise((resolve, reject) => {
      if (!content)  {
        reject(new Error('No content'));
        return;
      }

      const results = { data: [], seenIDs: new Set() };
      const json = (typeof content === 'string' ? JSON.parse(content) : content);

      // The json may contain Elements, Users, or Changesets
      const elements = json.elements ?? [];
      const users = (json.user ? [json.user] : json.users) ?? [];
      const changesets = json?.changesets || [];

      // Sometimes an error can be present alongside other elements - Rapid#501
      const errElement = elements.find(el => el.error);
      if (errElement) {
        const message = errElement.error || 'unknown error';
        reject(new Error(`Partial JSON: ${message}`));
        return;
      }


      // Parse elements
      for (const element of elements) {
        let parser;
        if (element.type === 'node') {
          parser = this._parseNode;
        } else if (element.type === 'way') {
          parser = this._parseWay;
        } else if (element.type === 'relation') {
          parser = this._parseRelation;
        }
        if (!parser) continue;

        const uid = OsmEntity.fromOSM(element.type, element.id);
        results.seenIDs.add(uid);

        if (options.skipSeen) {
          if (this._seen.has(uid)) continue;  // avoid reparsing a "seen" entity
          this._seen.add(uid);
        }

        const parsed = parser(element, uid);
        if (parsed) {
          results.data.push(parsed);
        }
      }

      // Parse users
      for (const user of users) {
        const uid = user.id?.toString();
        if (!uid) continue;

        if (options.skipSeen) {
          const key = `user-${uid}`;
          if (this._seen.has(key)) continue;  // avoid reparsing a "seen" user
          this._seen.add(key);
        }

        const parsed = {
          id: uid,
          display_name: user.display_name,
          account_created: user.account_created,
          image_url: user.img?.href,
          changesets_count: user.changesets?.count?.toString() ?? '0',
          active_blocks: user.blocks?.received?.active?.toString() ?? '0'
        };

        this._userCache.user[uid] = parsed;
        results.data.push(parsed);
      }

      // Parse changesets
      for (const changeset of changesets) {
        if (!changeset?.tags?.comment) continue;   // only include changesets with comment
        results.data.push(changeset);
      }

      resolve(results);
      return;
    });
  }


  _parseNode(obj, uid) {
    return {
      type: 'node',
      id: uid,
      visible: typeof obj.visible === 'boolean' ? obj.visible : true,
      version: obj.version?.toString(),
      changeset: obj.changeset?.toString(),
      timestamp: obj.timestamp,
      user: obj.user,
      uid: obj.uid?.toString(),
      loc: [ parseFloat(obj.lon), parseFloat(obj.lat) ],
      tags: obj.tags
    };
  }

  _parseWay(obj, uid) {
    return {
      type: 'way',
      id: uid,
      visible: typeof obj.visible === 'boolean' ? obj.visible : true,
      version: obj.version?.toString(),
      changeset: obj.changeset?.toString(),
      timestamp: obj.timestamp,
      user: obj.user,
      uid: obj.uid?.toString(),
      tags: obj.tags,
      nodes: this._getNodes(obj)
    };
  }

  _parseRelation(obj, uid) {
    return {
      type: 'relation',
      id: uid,
      visible: typeof obj.visible === 'boolean' ? obj.visible : true,
      version: obj.version?.toString(),
      changeset: obj.changeset?.toString(),
      timestamp: obj.timestamp,
      user: obj.user,
      uid: obj.uid?.toString(),
      tags: obj.tags,
      members: this._getMembers(obj)
    };
  }

  _getNodes(obj) {
    return (obj.nodes ?? []).map(nodeID => `n${nodeID}`);
  }

  _getMembers(obj) {
    return (obj.members ?? []).map(member => {
      return {
        id: member.type[0] + member.ref,
        type: member.type,
        role: member.role
      };
    });
  }

  _parseCapabilities(json) {
    // Update blocklists
    const regexes = [];
    for (const item of json.policy.imagery.blacklist) {
      const regexString = item.regex;  // needs unencode?
      if (regexString) {
        try {
          regexes.push(new RegExp(regexString));
        } catch (e) {
          /* noop */
        }
      }
    }
    if (regexes.length) {
      this._imageryBlocklists = regexes;
    }

    // Update max nodes per way
    const maxWayNodes = json.api.waynodes.maximum;
    if (maxWayNodes && isFinite(maxWayNodes)) {
      this._maxWayNodes = maxWayNodes;
    }

    // Return status
    const apiStatus = json.api.status.api;  // 'online', 'readonly', or 'offline'
    return apiStatus;
  }

}
