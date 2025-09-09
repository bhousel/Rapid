/* eslint-disable quotes */

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

export const userJSON = {
  "version": "0.6",
  "generator": "OpenStreetMap server",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "user": {
    "id": 100,
    "display_name": "bhousel",
    "account_created": "2000-01-01T00:00:01Z",
    "description": "Hi",
    "contributor_terms": { "agreed": true, "pd": true },
    "img": {"href": "https://www.gravatar.com/avatar/test.png"},
    "roles": [],
    "changesets": {"count": 999 },
    "traces": {"count": 999},
    "blocks": {"received": {"count": 0, "active": 0 } },
    "home": {"lat": 40, "lon": -74, "zoom": 3 },
    "languages": ["en", "en-US"],
    "messages": {
      "received": {"count": 99, "unread": 1 },
      "sent": {"count": 99 }
    }
  }
};

export const changesetJSON = {
  "version": "0.6",
  "generator": "OpenStreetMap server",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "changesets": [
    {
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
        "locale": "en-US",
        "imagery_used": "Bing Maps Aerial"
      }
    },
    {
      "id": 2,
      "created_at": "2025-09-02T00:00:01Z",
      "open": false,
      "comments_count": 0,
      "changes_count": 10,
      "closed_at": "2025-09-02T00:00:01Z",
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
        "locale": "en-US",
        "imagery_used": "Bing Maps Aerial"
      }
    },
    {
      "id": 3,
      "created_at": "2025-09-03T00:00:01Z",
      "open": false,
      "comments_count": 0,
      "changes_count": 10,
      "closed_at": "2025-09-02T00:00:01Z",
      "min_lat": 40.060883,
      "min_lon": -75.2392873,
      "max_lat": 40.060993,
      "max_lon": -75.2391612,
      "uid": 100,
      "user": "bhousel",
      "tags": {
        "created_by": "Rapid 2.6.0",
        "host": "http://127.0.0.1:8080/",
        "locale": "en-US",
        "imagery_used": "Bing Maps Aerial"
      }
    }
  ]
};

export const mapJSON = {
  "version":"0.6",
  "bounds":{"minlat":40.6550000,"minlon":-74.5420000,"maxlat":40.6560000,"maxlon":-74.5410000},
  "elements":[
    {"type":"node","id":"1","visible":true,"version":2,"changeset":1,"timestamp":"2025-09-01T00:00:01Z","user":"bhousel","uid":100,"lat":40.6555,"lon":-74.5415},
    {"type":"node","id":"1","visible":true,"version":2,"changeset":1,"timestamp":"2025-09-01T00:00:01Z","user":"bhousel","uid":100,"lat":40.6556,"lon":-74.5416},
    {"type":"way","id":"1","visible":true,"version":1,"changeset":1,"timestamp":"2025-09-01T00:00:01Z","user":"bhousel","uid":100,"nodes":[105340439,105340442],"tags":{"highway":"residential","name":"Main Street"}}
  ]
};

export const mapJSONpartial = {
  "version":"0.6",
  "bounds":{"minlat":40.6550000,"minlon":-74.5420000,"maxlat":40.6560000,"maxlon":-74.5410000},
  "elements":[
    {"type":"node","id":"1","visible":true,"version":2,"changeset":1,"timestamp":"2025-09-01T00:00:01Z","user":"bhousel","uid":100,"lat":40.6555,"lon":-74.5415},
    {"type":"node","id":"1","visible":true,"version":2,"changeset":1,"timestamp":"2025-09-01T00:00:01Z","user":"bhousel","uid":100,"lat":40.6556,"lon":-74.5416},
    {"type":"error", "message":"something went wrong loading postgres"}
  ]
};

export const nodeJSON = {
  "version":"0.6",
  "elements":[
    {"type":"node","id":1,"visible":true,"version":1,"changeset":1,"timestamp":"2025-09-01T00:00:01Z","user":"bhousel","uid":100,"lat":0,"lon":0}
  ]
};

export const wayJSON = {
  "version":"0.6",
  "elements":[
    {"type":"node","id":1,"visible":true,"version":1,"changeset":1,"timestamp":"2025-09-01T00:00:01Z","user":"bhousel","uid":100,"lat":0,"lon":0},
    {"type":"way","id":1,"visible":true,"version":1,"changeset":1,"timestamp":"2025-09-01T00:00:01Z","user":"bhousel","uid":100,"nodes":[1]}
  ]
};

export const noteXML =
`<?xml version="1.0" encoding="UTF-8"?>
<osm>
<note lon="10" lat="0">
  <id>1</id>
  <url>https://www.openstreetmap.org/api/0.6/notes/1</url>
  <comment_url>https://api.openstreetmap.org/api/0.6/notes/1/comment</comment_url>
  <close_url>https://api.openstreetmap.org/api/0.6/notes/1/close</close_url>
  <date_created>2025-09-01 00:00:00 UTC</date_created>
  <status>open</status>
  <comments>
    <comment>
      <date>2019-01-01 00:00:00 UTC</date>
      <uid>100</uid>
      <user>bhousel</user>
      <user_url>https://www.openstreetmap.org/user/bhousel</user_url>
      <action>opened</action>
      <text>This is a note</text>
      <html>&lt;p&gt;This is a note&lt;/p&gt;</html>
    </comment>
  </comments>
</note>
</osm>`;
