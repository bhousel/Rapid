/* eslint-disable quotes */

// ----------------------------------------
// Elements (nodes, ways, relations, map)

// Node, with tags
export const n1 = {
  type: "node",
  id: 1,
  lat: 40.6555,
  lon: -74.5415,
  timestamp: "2025-09-01T00:00:01Z",
  version: 2,
  changeset: 1,
  user: "bhousel",
  uid: 100,
  tags: {
    crossing: "marked",
    "crossing:markings": "zebra",
    highway: "crossing"
  }
};

// Node, no tags
export const n2 = {
  type: "node",
  id: 2,
  lat: 40.6556,
  lon: -74.5416,
  timestamp: "2025-09-01T00:00:01Z",
  version: 2,
  changeset: 1,
  user: "bhousel",
  uid: 100
};

// Way, with nodes and tags
export const w1 = {
  type: "way",
  id: 1,
  timestamp: "2025-09-01T00:00:01Z",
  version: 2,
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

// Relation, with members and tags
export const r1 = {
  type: "relation",
  id: 1,
  timestamp: "2025-09-01T00:00:01Z",
  version: 2,
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

// Bounds (present for map calls)
export const bounds = {
  "minlat": 40.6550000,
  "minlon": -74.5420000,
  "maxlat": 40.6560000,
  "maxlon": -74.5410000
};

// Elements are returned in an `elements` Array property.
// This covers responses to calls like:
// GET /api/0.6/map?bbox=left,bottom,right,top
// GET /api/0.6/node/#id
// GET /api/0.6/way/#id       (with or without /full)
// GET /api/0.6/relation/#id  (with or without /full)
export const mapJSON = {
  "version": "0.6",
  "generator": "openstreetmap-cgimap 2.1.0 (3662880 spike-06.openstreetmap.org)",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "bounds": bounds,
  "elements": [ n1, n2, w1, r1 ]
};

// Any error present should invalidate the entire response.
// see https://wiki.openstreetmap.org/wiki/API_v0.6#Internal_errors_while_generating_a_response
export const mapJSONpartial = {
  "version": "0.6",
  "generator": "openstreetmap-cgimap 2.1.0 (3662880 spike-06.openstreetmap.org)",
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
    "url": "https://api.openstreetmap.org/api/0.6/notes/1.json",
    "comment_url": "https://api.openstreetmap.org/api/0.6/notes/1/comment.json",
    "close_url": "https://api.openstreetmap.org/api/0.6/notes/1/close.json",
    "date_created": "2025-01-01 00:00:00 UTC",
    "status": "open",
    "comments": [
      {
        "date": "2025-01-01 00:00:00 UTC",
        "uid": 100,
        "user": "bhousel",
        "user_url": "https://api.openstreetmap.org/user/bhousel",
        "action": "opened",
        "text": "This is a note",
        "html": "\u003cp dir=\"auto\"\u003eThis is a note\u003c/p\u003e"
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
    "url": "https://api.openstreetmap.org/api/0.6/notes/2.json",
    "comment_url": "https://api.openstreetmap.org/api/0.6/notes/2/comment.json",
    "close_url": "https://api.openstreetmap.org/api/0.6/notes/2/close.json",
    "date_created": "2025-01-01 00:00:00 UTC",
    "status": "open",
    "comments": [
      {
        "date": "2025-01-01 00:00:00 UTC",
        "action": "opened",
        "text": "This is a note",
        "html": "\u003cp dir=\"auto\"\u003eThis is a note\u003c/p\u003e"
      }, {
        "date": "2025-01-02 00:00:00 UTC",
        "uid": 200,
        "user": "lgtm",
        "user_url": "https://api.openstreetmap.org/user/lgtm",
        "action": "commented",
        "text": "LGTM!",
        "html": "\u003cp dir=\"auto\"\u003eLGTM!\u003c/p\u003e"
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
  "roles": [],
  "changesets": { "count": 999 },
  "traces": { "count": 999 },
  "blocks": { "received": {"count": 0, "active": 0 } },
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
    "hello": "world"
  }
};


// ----------------------------------------
// Changesets

// Changeset, with comment and discussion
export const c1  = {
  "id": 1,
  "created_at": "2025-09-01T00:00:01Z",
  "open": false,
  "comments_count": 0,
  "changes_count": 10,
  "closed_at": "2025-09-01T00:00:01Z",
  "min_lat": 40.060883,
  "min_lon": -75.2392873,
  "max_lat": 40.060993,
  "max_lon": -75.2391612,
  "uid": 100,
  "user": "bhousel",
  "tags": {
    "comment": "Fix unsquare corners",
    "created_by": "Rapid 2.6.0",
    "host": "http://127.0.0.1:8080/",
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
  "min_lon": -75.2392873,
  "max_lat": 40.060993,
  "max_lon": -75.2391612,
  "uid": 100,
  "user": "bhousel",
  "tags": {
    "comment": "",
    "created_by": "Rapid 2.6.0",
    "host": "http://127.0.0.1:8080/",
    "imagery_used": "Bing Maps Aerial",
    "locale": "en-US"
  }
};

// Changeset, with no comment tag
export const c3 = {
  "id": 3,
  "created_at": "2025-09-03T00:00:01Z",
  "open": false,
  "comments_count": 0,
  "changes_count": 10,
  "closed_at": "2025-09-03T00:00:02Z",
  "min_lat": 40.060883,
  "min_lon": -75.2392873,
  "max_lat": 40.060993,
  "max_lon": -75.2391612,
  "uid": 100,
  "user": "bhousel",
  "tags": {
    "created_by": "Rapid 2.6.0",
    "host": "http://127.0.0.1:8080/",
    "imagery_used": "Bing Maps Aerial",
    "locale": "en-US"
  }
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
        { "regex": "\.bar\.org" }
      ]
    }
  }
};

