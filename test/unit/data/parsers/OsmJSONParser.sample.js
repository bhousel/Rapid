/* eslint-disable quotes */

// ----------------------------------------
// Elements (nodes, ways, relations, map)

// Node, with tags (default visible)
export const n1 = {
  type: "node",
  id: 1,
  lat: 40.6555,
  lon: -74.5415,
  timestamp: "2025-09-01T00:00:01Z",
  version: 1,
  changeset: 1,
  user: "bhousel",
  uid: 100,
  tags: {
    crossing: "marked",
    "crossing:markings": "zebra",
    highway: "crossing",
    empty: ""
  }
};

// Node, no tags (default visible)
export const n2 = {
  type: "node",
  id: 2,
  lat: 40.6556,
  lon: -74.5416,
  timestamp: "2025-09-01T00:00:01Z",
  version: 2,
  changeset: 2,
  user: "bhousel",
  uid: 100
};

// Way, with nodes and tags (default visible)
export const w1 = {
  type: "way",
  id: 1,
  timestamp: "2025-09-01T00:00:01Z",
  version: 1,
  changeset: 1,
  user: "bhousel",
  uid: 100,
  nodes: [1, 2],
  tags: {
    highway: "tertiary",
    lanes: "1",
    name: "Spring Valley Boulevard",
    oneway: "yes"
  }
};

// Way, no nodes or tags (default visible)
export const w2 = {
  type: "way",
  id: 2,
  timestamp: "2025-09-01T00:00:01Z",
  version: 2,
  changeset: 2,
  user: "bhousel",
  uid: 100
};

// Relation, with members and tags (default visible)
export const r1 = {
  type: "relation",
  id: 1,
  timestamp: "2025-09-01T00:00:01Z",
  version: 1,
  changeset: 1,
  user: "bhousel",
  uid: 100,
  members: [
    { type: "way", ref: 1, role: "south" }
  ],
  tags: {
    network: "US:NJ:Somerset",
    ref: "651",
    route: "road",
    type: "route"
  }
};

// Relation, no members or tags (default visible)
export const r2 = {
  type: "relation",
  id: 2,
  timestamp: "2025-09-01T00:00:01Z",
  version: 2,
  changeset: 2,
  user: "bhousel",
  uid: 100
};

// Node, with tags (visible=true)
export const n1visible = {
  type: "node",
  id: 1,
  visible: true,
  lat: 40.6555,
  lon: -74.5415,
  timestamp: "2025-09-01T00:00:01Z",
  version: 1,
  changeset: 1,
  user: "bhousel",
  uid: 100,
  tags: {
    crossing: "marked",
    "crossing:markings": "zebra",
    highway: "crossing",
    empty: ""
  }
};

// Node, no tags (visible=true)
export const n2visible = {
  type: "node",
  id: 2,
  visible: true,
  lat: 40.6556,
  lon: -74.5416,
  timestamp: "2025-09-01T00:00:01Z",
  version: 2,
  changeset: 2,
  user: "bhousel",
  uid: 100
};

// Way, with nodes and tags (visible=true)
export const w1visible = {
  type: "way",
  id: 1,
  visible: true,
  timestamp: "2025-09-01T00:00:01Z",
  version: 1,
  changeset: 1,
  user: "bhousel",
  uid: 100,
  nodes: [1, 2],
  tags: {
    highway: "tertiary",
    lanes: "1",
    name: "Spring Valley Boulevard",
    oneway: "yes"
  }
};

// Way, no nodes or tags (visible=true)
export const w2visible = {
  type: "way",
  id: 2,
  visible: true,
  timestamp: "2025-09-01T00:00:01Z",
  version: 2,
  changeset: 2,
  user: "bhousel",
  uid: 100
};

// Relation, with members and tags (visible=true)
export const r1visible = {
  type: "relation",
  id: 1,
  visible: true,
  timestamp: "2025-09-01T00:00:01Z",
  version: 1,
  changeset: 1,
  user: "bhousel",
  uid: 100,
  members: [
    { type: "way", ref: 1, role: "south" }
  ],
  tags: {
    network: "US:NJ:Somerset",
    ref: "651",
    route: "road",
    type: "route"
  }
};

// Relation, no members or tags (visible=true)
export const r2visible = {
  type: "relation",
  id: 2,
  visible: true,
  timestamp: "2025-09-01T00:00:01Z",
  version: 2,
  changeset: 2,
  user: "bhousel",
  uid: 100
};

// Node, with tags (visible=false)
export const n1deleted = {
  type: "node",
  id: 1,
  visible: false,
  lat: 40.6555,
  lon: -74.5415,
  timestamp: "2025-09-01T00:00:01Z",
  version: 1,
  changeset: 1,
  user: "bhousel",
  uid: 100,
  tags: {
    crossing: "marked",
    "crossing:markings": "zebra",
    highway: "crossing",
    empty: ""
  }
};

// Node, no tags (visible=false)
export const n2deleted = {
  type: "node",
  id: 2,
  visible: false,
  lat: 40.6556,
  lon: -74.5416,
  timestamp: "2025-09-01T00:00:01Z",
  version: 2,
  changeset: 2,
  user: "bhousel",
  uid: 100
};

// Way, with nodes and tags (visible=false)
export const w1deleted = {
  type: "way",
  id: 1,
  visible: false,
  timestamp: "2025-09-01T00:00:01Z",
  version: 1,
  changeset: 1,
  user: "bhousel",
  uid: 100,
  nodes: [1, 2],
  tags: {
    highway: "tertiary",
    lanes: "1",
    name: "Spring Valley Boulevard",
    oneway: "yes"
  }
};

// Deleted Way, no nodes or tags (visible=false)
export const w2deleted = {
  type: "way",
  id: 2,
  visible: false,
  timestamp: "2025-09-01T00:00:01Z",
  version: 2,
  changeset: 2,
  user: "bhousel",
  uid: 100
};

// Relation, with members and tags (visible=false)
export const r1deleted = {
  type: "relation",
  id: 1,
  visible: false,
  timestamp: "2025-09-01T00:00:01Z",
  version: 1,
  changeset: 1,
  user: "bhousel",
  uid: 100,
  members: [
    { type: "way", ref: 1, role: "south" }
  ],
  tags: {
    network: "US:NJ:Somerset",
    ref: "651",
    route: "road",
    type: "route"
  }
};

// Relation, no members or tags (visible=false)
export const r2deleted = {
  type: "relation",
  id: 2,
  visible: false,
  timestamp: "2025-09-01T00:00:01Z",
  version: 2,
  changeset: 2,
  user: "bhousel",
  uid: 100
};

// Bounds (present for map calls)
export const bounds = {
  minlat: 40.6550000,
  minlon: -74.5420000,
  maxlat: 40.6560000,
  maxlon: -74.5410000
};

// Elements are returned in an `elements` Array property.
// This covers responses to calls like:
// GET /api/0.6/map?bbox=left,bottom,right,top
// GET /api/0.6/node/#id
// GET /api/0.6/way/#id       (with or without /full)
// GET /api/0.6/relation/#id  (with or without /full)
export const mapJSON = {
  "version": "0.6",
  "generator": "openstreetmap-cgimap 2.1.0 (338846 spike-06.openstreetmap.org)",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "bounds": bounds,
  "elements": [ n1, n2, w1, w2, r1, r2,
    {
      "type": "ignoreme",
      "unsupported": "true"
    }
  ]
};

// Any error present should invalidate the entire response.
// see https://wiki.openstreetmap.org/wiki/API_v0.6#Internal_errors_while_generating_a_response
export const mapJSONerror1 = {
  "version": "0.6",
  "generator": "openstreetmap-cgimap 2.1.0 (338846 spike-06.openstreetmap.org)",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "bounds": bounds,
  "elements": [ n1, n2,
    {
      "type": "error",
      "message": "something went wrong loading postgres",
    }
  ]
};

export const mapJSONerror2 = {
  "version": "0.6",
  "generator": "openstreetmap-cgimap 2.1.0 (338846 spike-06.openstreetmap.org)",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "bounds": bounds,
  "elements": [ n1, n2,
    {
      "type": "error"
    }
  ]
};

// test visible/deleted
export const mapJSONvisible = {
  "version": "0.6",
  "generator": "openstreetmap-cgimap 2.1.0 (338846 spike-06.openstreetmap.org)",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "bounds": bounds,
  "elements": [ n1visible, n2visible, w1visible, w2visible, r1visible, r2visible ]
};

export const mapJSONdeleted = {
  "version": "0.6",
  "generator": "openstreetmap-cgimap 2.1.0 (338846 spike-06.openstreetmap.org)",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "bounds": bounds,
  "elements": [ n1deleted, n2deleted, w1deleted, w2deleted, r1deleted, r2deleted ]
};

export const nodeJSON = {
  "version": "0.6",
  "generator": "openstreetmap-cgimap 2.1.0 (338846 spike-06.openstreetmap.org)",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "elements": [ n1 ]
};

export const wayJSON = {
  "version": "0.6",
  "generator": "openstreetmap-cgimap 2.1.0 (338846 spike-06.openstreetmap.org)",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "elements": [ w1 ]
};

export const relationJSON = {
  "version": "0.6",
  "generator": "openstreetmap-cgimap 2.1.0 (338846 spike-06.openstreetmap.org)",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "elements": [ r1 ]
};


// ----------------------------------------
// Notes
// Notes are returned as GeoJSON Features

// Note, opened by a user (action will be opened)
export const note1 = {
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [10.0001, 0]
  },
  "properties": {
    "id": 1,
    "foo": "bar",
    "url": "https://www.openstreetmap.org/api/0.6/notes/1",
    "comment_url": "https://api.openstreetmap.org/api/0.6/notes/1/comment",
    "close_url": "https://api.openstreetmap.org/api/0.6/notes/1/close",
    "date_created": "2025-09-01 00:00:00 UTC",
    "status": "open",
    "comments": [
      {
        "date": "2025-01-01 00:00:00 UTC",
        "uid": 100,
        "user": "bhousel",
        "user_url": "https://www.openstreetmap.org/user/bhousel",
        "action": "opened",
        "text": "This is a note",
        "html": "\u003cp\u003eThis is a note\u003c/p\u003e"
      }
    ]
  }
};

// Note, opened anonymously (no user), with comment thread
export const note2 = {
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [10.0002, 0]
  },
  "properties": {
    "id": 2,
    "url": "https://www.openstreetmap.org/api/0.6/notes/2",
    "comment_url": "https://api.openstreetmap.org/api/0.6/notes/2/comment",
    "close_url": "https://api.openstreetmap.org/api/0.6/notes/2/close",
    "date_created": "2025-09-01 00:00:00 UTC",
    "status": "open",
    "comments": [
      {
        "date": "2025-01-01 00:00:00 UTC",
        "action": "opened",
        "text": "This is a note",
        "html": "\u003cp\u003eThis is a note\u003c/p\u003e"
      }, {
        "date": "2025-01-02 00:00:00 UTC",
        "uid": 200,
        "user": "lgtm",
        "user_url": "https://www.openstreetmap.org/user/lgtm",
        "action": "commented",
        "text": "LGTM!",
        "html": "\u003cp\u003eLGTM!\u003c/p\u003e"
      }
    ]
  }
};

// Requesting a single note by id will just return that Feature.
// GET /api/0.6/notes/#id
export const noteJSON = note1;

// Requesting a collection of notes will return a FeatureCollection.
// This covers responses to calls like:
// GET /api/0.6/notes?bbox=left,bottom,right,top
// GET /api/0.6/notes/search
export const notesJSON = {
  "type": "FeatureCollection",
  "features": [ note1, note2 ]
};


// ----------------------------------------
// Users

// User, no roles, logged in and with `/details`
// (includes home, languages, and messages)
export const user1 = {
  "id": 100,
  "display_name": "bhousel",
  "account_created": "2000-01-01T00:00:01Z",
  "description": "Hi",
  "contributor_terms": { "agreed": true, "pd": true },
  "img": { "href": "https://www.gravatar.com/avatar/test.png" },
  "changesets": { "count": 999 },
  "traces": { "count": 999 },
  "blocks": { "received": { "count": 0, "active": 0 } },
  "home": { "lat": 40, "lon": -74, "zoom": 3 },
  "languages": ["en", "en-US"],
  "messages": {
    "received": { "count": 99, "unread": 1 },
    "sent": { "count": 99 }
  }
};

// User, moderator role, not logged in (has fewer details)
export const user2 = {
  "id": 200,
  "display_name": "lgtm",
  "account_created": "2000-01-01T00:00:01Z",
  "description": "LGTM!",
  "contributor_terms": { "agreed": true, "pd": true },
  "img": { "href": "https://www.gravatar.com/avatar/test.png" },
  "roles": [ "moderator" ],
  "changesets": { "count": 999 },
  "traces": { "count": 999 },
  "blocks": { "received": { "count": 0, "active": 0 } }
};

// A single user will be returned in a `user` property.
// GET /api/0.6/user/#id
// GET /api/0.6/user/details
export const userJSON = {
  "version": "0.6",
  "generator": "OpenStreetMap server",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "user": user1
};

// Multiple users will be returned in a `users` Array property.
// GET /api/0.6/users.json?users=#id1,#id2,…,#idn
export const usersJSON = {
  "version": "0.6",
  "generator": "OpenStreetMap server",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "users": [ user1, user2 ]
};


// ----------------------------------------
// User Blocks

// User block, basic info, needs_view=true
export const userBlock1 = {
  "id": 1,
  "created_at": "2025-09-01 00:00:00Z",
  "updated_at": "2025-09-01 00:00:01Z",
  "ends_at": "2025-09-01 00:00:02Z",
  "needs_view": true,
  "user": { "uid": 100, "user": "bhousel" },
  "creator": { "uid": 200, "user": "lgtm" },
  "revoker": { "uid": 200, "user": "lgtm" },
  "reason": "blocked for spamming"
};

// User block, no reason, needs_view=false
export const userBlock2 = {
  "id": 2,
  "created_at": "2025-09-02 00:00:00Z",
  "updated_at": "2025-09-02 00:00:01Z",
  "ends_at": "2025-09-02 00:00:02Z",
  "needs_view": false,
  "user": { "uid": 100, "user": "bhousel" },
  "creator": { "uid": 200, "user": "lgtm" }
};

// A single user block will be returned in a `user_block` property.
// GET /api/0.6/user_blocks/#id
export const userBlockJSON = {
  "version": "0.6",
  "generator": "OpenStreetMap server",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "user_block": userBlock1
};

// A user may have multiple active blocks returned in a `user_blocks` Array property.
// GET /user/blocks/active
export const userBlocksJSON = {
  "version": "0.6",
  "generator": "OpenStreetMap server",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "user_blocks": [ userBlock1, userBlock2 ]
};

// ----------------------------------------
// Preferences

// Preferences of the logged-in user are returned in a `preferences` property.
// GET /api/0.6/user/preferences
export const preferencesJSON = {
  "version": "0.6",
  "generator": "OpenStreetMap server",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "preferences": {
    "foo": "bar",
    "hello": "world",
    "empty": ""
   }
};


// ----------------------------------------
// Changesets

// Changeset, with comment and discussion
export const c1  = {
  "id": 1,
  "created_at": "2025-09-01T00:00:01Z",
  "open": false,
  "comments_count": 1,
  "changes_count": 10,
  "closed_at": "2025-09-01T00:00:02Z",
  "min_lat": 40.060883,
  "min_lon": -74.2392873,
  "max_lat": 40.060993,
  "max_lon": -74.2391612,
  "uid": 100,
  "user": "bhousel",
  "tags": {
    "comment": "Fix unsquare corners",
    "created_by": "Rapid 2.6.0",
    "host": "http://127.0.0.1:8080",
    "imagery_used": "Bing Maps Aerial",
    "locale": "en-US"
  },
  "comments": [
    {
      "id": 1000,
      "visible": true,
      "date": "2025-09-02T00:00:01Z",
      "uid": 200,
      "user": "lgtm",
      "text": "LGTM!"
    }
  ]
};

// Changeset, with empty comment tag
export const c2 = {
  "id": 2,
  "created_at": "2025-09-02T00:00:01Z",
  "open": false,
  "comments_count": 0,
  "changes_count": 10,
  "closed_at": "2025-09-02T00:00:02Z",
  "min_lat": 40.060883,
  "min_lon": -74.2392873,
  "max_lat": 40.060993,
  "max_lon": -74.2391612,
  "uid": 100,
  "user": "bhousel",
  "tags": {
    "comment": "",
    "created_by": "Rapid 2.6.0",
    "host": "http://127.0.0.1:8080",
    "imagery_used": "Bing Maps Aerial",
    "locale": "en-US"
  },
  "comments": []
};

// Changeset, with no tags, no comments
export const c3 = {
  "id": 3,
  "created_at": "2025-09-03T00:00:01Z",
  "open": false,
  "comments_count": 0,
  "changes_count": 10,
  "closed_at": "2025-09-03T00:00:02Z",
  "min_lat": 40.060883,
  "min_lon": -74.2392873,
  "max_lat": 40.060993,
  "max_lon": -74.2391612,
  "uid": 100,
  "user": "bhousel"
};

// A single changeset will be returned in a `changeset` property.
// GET /api/0.6/changeset/#id
export const changesetJSON = {
  "version": "0.6",
  "generator": "OpenStreetMap server",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "changeset": c1
};

// Multiple changesets will be returned in a `changesets` Array property.
// GET /api/0.6/changesets  (with or without `?include_discussion=true`)
export const changesetsJSON = {
  "version": "0.6",
  "generator": "OpenStreetMap server",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "changesets": [ c1, c2, c3 ]
};


// ----------------------------------------
// API Capabilities
// GET /api/capabilities
export const capabilitiesJSON = {
  "version": "0.6",
  "generator": "OpenStreetMap server",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "api": {
    "version": { "minimum": "0.6", "maximum": "0.6" },
    "area": { "maximum": 0.25 },
    "note_area": { "maximum": 25 },
    "tracepoints": { "per_page": 5000 },
    "waynodes": { "maximum": 2000 },
    "relationmembers": { "maximum": 32000 },
    "changesets": { "maximum_elements": 10000, "default_query_limit": 100, "maximum_query_limit": 100 },
    "notes": { "default_query_limit": 100, "maximum_query_limit": 10000 },
    "timeout": { "seconds": 300 },
    "status": { "database": "online", "api": "online", "gpx": "online" }
  },
  "policy": {
    "imagery": {
      "blacklist": [
        { "regex": "\.foo\.com" },
        { "regex": "\.bar\.org" },
        { "regex": "\\" }   // invalid regex ignored
      ]
    }
  }
};


// ----------------------------------------
// Expected parse results (same as XML)

export {
  metadataResult,
  boundsResult,
  n1Result,
  n2Result,
  w1Result,
  w2Result,
  r1Result,
  r2Result,
  n1ResultDeleted,
  n2ResultDeleted,
  w1ResultDeleted,
  w2ResultDeleted,
  r1ResultDeleted,
  r2ResultDeleted,
  c1Result,
  c2Result,
  c3Result,
  note1Result,
  note2Result,
  user1Result,
  user2Result,
  userBlock1Result,
  userBlock2Result,
  preferencesResult,
  apiResult,
  policyResult
} from './OsmXMLParser.sample.js';
