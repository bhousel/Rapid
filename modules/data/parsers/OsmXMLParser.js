import { DOMParser } from '@xmldom/xmldom';

import { OsmEntity } from '../OsmEntity.js';


/**
 * OsmXMLParser
 * This class contains the code for parsing an OSM XML content.
 *
 * Calling code should call `parseAsync` with the content to parse.
 * `parseAsync` returns a Promise either rejected with an error or resolved with
 * whatever valid data was found in the content, as an Array of Objects.
 *
 * @see https://wiki.openstreetmap.org/wiki/OSM_XML
 * Note that OSM XML data can contain slightly different syntax and attributes.
 */
export class OsmXMLParser {

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
      const xml = (typeof content === 'string' ? new DOMParser().parseFromString(content, 'application/xml') : content);

      if (!xml?.childNodes) {
        reject(new Error('No XML'));
        return;
      }

      const osmElement = Array.from(xml.childNodes).find(child => child.nodeName === 'osm');
      if (!osmElement?.childNodes) {
        reject(new Error('No OSM Element'));
        return;
      }

      const children = Array.from(osmElement.childNodes);

      // Sometimes an error can be present alongside other elements - Rapid#501
      const errElement = children.find(child => child.nodeName === 'error');
      if (errElement) {
        const message = errElement.textContent || 'unknown error';
        reject(new Error(`Partial Response: ${message}`));
        return;
      }

      for (const child of children) {
        let parser;
        if (child.nodeName === 'node') {
          parser = this._parseNode;
        } else if (child.nodeName === 'way') {
          parser = this._parseWay;
        } else if (child.nodeName === 'relation') {
          parser = this._parseRelation;
        } else if (child.nodeName === 'note') {
          parser = this._parseNote;
        } else if (child.nodeName === 'user') {
          parser = this._parseUser;
        }

        if (!parser) continue;

        let uid;
        if (child.nodeName === 'user') {
          uid = child.attributes.getNamedItem('id').value;
          if (options.skipSeen) {
            const key = `user-${uid}`;
            if (this._seen.has(key)) continue;  // avoid reparsing a "seen" user
            this._seen.add(key);
          }

        } else if (child.nodeName === 'note') {
          uid = child.getElementsByTagName('id')[0].textContent;
          if (options.skipSeen) {
            const key = `note-${uid}`;
            if (this._seen.has(key)) continue;  // avoid reparsing a "seen" user
            this._seen.add(key);
          }

        } else {
          uid = OsmEntity.fromOSM(child.nodeName, child.attributes.getNamedItem('id').value);
          results.seenIDs.add(uid);
          if (options.skipSeen) {
            if (this._seen.has(uid)) continue;  // avoid reparsing a "seen" entity
            this._seen.add(uid);
          }
        }

        const parsed = parser(child, uid);
        if (parsed) {
          results.data.push(parsed);
        }
      }

      resolve(results);
      return;
    });
  }


  /**
   * _parseUserPreferencesXML
   * @param xml
   * @param callback
   */
  _parseUserPreferences(xml, callback) {
    const preferences = {};
    const preferenceElems = xml.getElementsByTagName('preference');

    for (let i = 0; i < preferenceElems.length; i++) {
      const elem = preferenceElems[i];
      const key = elem.getAttribute('k');
      const value = elem.getAttribute('v');
      if (key && value) {
        preferences[key] = value;
      }
    }

    callback(null, { data: preferences });
  }


  _getLoc(attrs) {
    const lon = attrs.getNamedItem('lon')?.value;
    const lat = attrs.getNamedItem('lat')?.value;
    return [ parseFloat(lon), parseFloat(lat) ];
  }


  _getNodes(xml) {
    const elems = Array.from(xml.getElementsByTagName('nd'));
    return elems.map(elem => 'n' + elem.attributes.getNamedItem('ref').value);
  }


  _getTags(xml) {
    const elems = Array.from(xml.getElementsByTagName('tag'));
    let tags = {};
    for (const elem of elems) {
      const attrs = elem.attributes;
      const k = (attrs.getNamedItem('k')?.value ?? '').trim();
      const v = (attrs.getNamedItem('v')?.value ?? '').trim();
      if (k) {
        tags[k] = v;
      }
    }
    return tags;
  }


  _getMembers(xml) {
    const elems = Array.from(xml.getElementsByTagName('member'));
    return elems.map(elem => {
      const attrs = elem.attributes;
      return {
        id: attrs.getNamedItem('type').value[0] + attrs.getNamedItem('ref').value,
        type: attrs.getNamedItem('type').value,
        role: attrs.getNamedItem('role').value
      };
    });
  }

  _parseComments(comments) {
    let parsedComments = [];

    for (const comment of Array.from(comments)) {
      if (comment.nodeName === 'comment') {
        let parsedComment = {};

        for (const node of Array.from(comment.childNodes)) {
          const nodeName = node.nodeName;
          if (nodeName === '#text') continue;
          parsedComment[nodeName] = node.textContent;

          if (nodeName === 'uid') {
            // const uid = node.textContent;
            // if (uid && !this._userCache.user[uid]) {
              // this._userCache.toLoad.add(uid);
            // }
          }
        }

        if (Object.keys(parsedComment).length) {
          parsedComments.push(parsedComment);
        }
      }
    }
    return parsedComments;
  }


  _parseNode(xml, uid) {
    const attrs = xml.attributes;
    return {
      type: 'node',
      id: uid,
      visible: (!attrs.visible || attrs.visible.value !== 'false'),
      version: attrs.version.value,
      changeset: attrs.changeset?.value,
      timestamp: attrs.timestamp?.value,
      user: attrs.user?.value,
      uid: attrs.uid?.value,
      loc: this._getLoc(attrs),
      tags: this._getTags(xml)
    };
  }

  _parseWay(xml, uid) {
    const attrs = xml.attributes;
    return {
      type: 'way',
      id: uid,
      visible: (!attrs.visible || attrs.visible.value !== 'false'),
      version: attrs.version.value,
      changeset: attrs.changeset?.value,
      timestamp: attrs.timestamp?.value,
      user: attrs.user?.value,
      uid: attrs.uid?.value,
      tags: this._getTags(xml),
      nodes: this._getNodes(xml),
    };
  }

  _parseRelation(xml, uid) {
    const attrs = xml.attributes;
    return {
      type: 'relation',
      id: uid,
      visible: (!attrs.visible || attrs.visible.value !== 'false'),
      version: attrs.version.value,
      changeset: attrs.changeset?.value,
      timestamp: attrs.timestamp?.value,
      user: attrs.user?.value,
      uid: attrs.uid?.value,
      tags: this._getTags(xml),
      members: this._getMembers(xml)
    };
  }

  _parseNote(xml, uid) {
    const attrs = xml.attributes;
    const props = {
      type: 'note',
      id: uid,
      loc: this._getLoc(attrs)
    };

    // parse note contents
    for (const node of Array.from(xml.childNodes)) {
      const nodeName = node.nodeName;
      if (nodeName === '#text') continue;

      // if the element is comments, parse the comments
      if (nodeName === 'comments') {
        props.comments = this._parseComments(node.childNodes);
      } else {
        props.comments = node.textContent;
      }
    }

    return props;
  }


  _parseUser(xml, uid) {
    const attrs = xml.attributes;
    let props = {
      type: 'user',
      id: uid,
      display_name: attrs.getNamedItem('display_name')?.value,
      account_created: attrs.getNamedItem('account_created')?.value,
      changesets_count: '0',
      active_blocks: '0'
    };

    const img = xml.getElementsByTagName('img');
    if (img && img[0] && img[0].getAttribute('href')) {
      props.image_url = img[0].getAttribute('href');
    }

    const changesets = xml.getElementsByTagName('changesets');
    if (changesets && changesets[0] && changesets[0].getAttribute('count')) {
      props.changesets_count = changesets[0].getAttribute('count');
    }

    const blocks = xml.getElementsByTagName('blocks');
    if (blocks && blocks[0]) {
      const received = blocks[0].getElementsByTagName('received');
      if (received && received[0] && received[0].getAttribute('active')) {
        props.active_blocks = received[0].getAttribute('active');
      }
    }

    return props;
  }


  _parseCapabilities(xml) {
    // Update blocklists
    const regexes = [];
    for (const element of xml.getElementsByTagName('blacklist')) {
      const regexString = element.getAttribute('regex');  // needs unencode?
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
    const waynodes = xml.getElementsByTagName('waynodes');
    const maxWayNodes = waynodes.length && parseInt(waynodes[0].getAttribute('maximum'), 10);
    if (maxWayNodes && isFinite(maxWayNodes)) {
      this._maxWayNodes = maxWayNodes;
    }

    // Return status
    const apiStatus = xml.getElementsByTagName('status');
    return apiStatus[0].getAttribute('api');   // 'online', 'readonly', or 'offline'
  }

}
