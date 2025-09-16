/* eslint-disable quotes */

// ----------------------------------------
// Elements (nodes, ways, relations, map)

// Node, with tags
export const n1 = `
<node id="1" visible="true" version="2" changeset="1" timestamp="2025-09-01T00:00:01Z" user="bhousel" uid="100" lat="40.6555" lon="-74.5415">
  <tag k="crossing" v="marked"/>
  <tag k="crossing:markings" v="zebra"/>
  <tag k="highway" v="crossing"/>
</node>`;

// Node, no tags
export const n2 = `
<node id="2" visible="true" version="2" changeset="1" timestamp="2025-09-01T00:00:01Z" user="bhousel" uid="100" lat="40.6556" lon="-74.5416"/>`;

// Way, with nodes and tags
export const w1 = `
<way id="1" visible="true" version="2" changeset="1" timestamp="2025-09-01T00:00:01Z" user="bhousel" uid="100">
  <nd ref="1"/>
  <nd ref="2"/>
  <tag k="highway" v="tertiary"/>
  <tag k="lanes" v="1"/>
  <tag k="name" v="Spring Valley Boulevard"/>
  <tag k="oneway" v="yes"/>
</way>`;

// Relation, with members and tags
export const r1 = `
<relation id="1" visible="true" version="2" changeset="1" timestamp="2025-09-01T00:00:01Z" user="bhousel" uid="100">
  <member type="way" ref="1" role="south"/>
  <tag k="network" v="US:NJ:Somerset"/>
  <tag k="ref" v="651"/>
  <tag k="route" v="road"/>
  <tag k="type" v="route"/>
</relation>`;

// Bounds (present for map calls)
export const bounds = `
<bounds minlat="40.6550000" minlon="-74.5420000" maxlat="40.6560000" maxlon="-74.5410000"/>`;


// Elements (including `bounds`) are returned as direct descendant childNodes of the `osm` element.
// This covers responses to calls like:
// GET /api/0.6/map?bbox=left,bottom,right,top
// GET /api/0.6/node/#id
// GET /api/0.6/way/#id       (with or without `/full`)
// GET /api/0.6/relation/#id  (with or without `/full`)
export const mapXML =
`<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="openstreetmap-cgimap 2.1.0 (338846 spike-06.openstreetmap.org)" copyright="OpenStreetMap and contributors" attribution="http://www.openstreetmap.org/copyright" license="http://opendatacommons.org/licenses/odbl/1-0/">
  ${bounds}
  ${n1}
  ${n2}
  ${w1}
  ${r1}
</osm>`;

// Any error present should invalidate the entire response.
// see https://wiki.openstreetmap.org/wiki/API_v0.6#Internal_errors_while_generating_a_response
export const mapXMLpartial =
`<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="openstreetmap-cgimap 2.1.0 (338846 spike-06.openstreetmap.org)" copyright="OpenStreetMap and contributors" attribution="http://www.openstreetmap.org/copyright" license="http://opendatacommons.org/licenses/odbl/1-0/">
  ${bounds}
  ${n1}
  ${n2}
  <error>something went wrong loading postgres</error>
</osm>`;


// ----------------------------------------
// Notes

// Note, opened by a user (action will be opened)
const note1 = `
<note lon="10.0001" lat="0">
  <id>1</id>
  <url>https://www.openstreetmap.org/api/0.6/notes/1</url>
  <comment_url>https://api.openstreetmap.org/api/0.6/notes/1/comment</comment_url>
  <close_url>https://api.openstreetmap.org/api/0.6/notes/1/close</close_url>
  <date_created>2025-09-01 00:00:00 UTC</date_created>
  <status>open</status>
  <comments>
    <comment>
      <date>2025-01-01 00:00:00 UTC</date>
      <uid>100</uid>
      <user>bhousel</user>
      <user_url>https://www.openstreetmap.org/user/bhousel</user_url>
      <action>opened</action>
      <text>This is a note</text>
      <html>&lt;p&gt;This is a note&lt;/p&gt;</html>
    </comment>
  </comments>
</note>`;

// Note, opened anonymously (no user), with comment thread
const note2 = `
<note lon="10.0002" lat="0">
  <id>2</id>
  <url>https://www.openstreetmap.org/api/0.6/notes/2</url>
  <comment_url>https://api.openstreetmap.org/api/0.6/notes/2/comment</comment_url>
  <close_url>https://api.openstreetmap.org/api/0.6/notes/2/close</close_url>
  <date_created>2025-09-01 00:00:00 UTC</date_created>
  <status>open</status>
  <comments>
    <comment>
      <date>2025-01-01 00:00:00 UTC</date>
      <action>opened</action>
      <text>This is a note</text>
      <html>&lt;p&gt;This is a note&lt;/p&gt;</html>
    </comment>
    <comment>
      <date>2025-01-02 00:00:00 UTC</date>
      <uid>200</uid>
      <user>lgtm</user>
      <user_url>https://www.openstreetmap.org/user/lgtm</user_url>
      <action>commented</action>
      <text>LGTM!</text>
      <html>&lt;p&gt;LGTM!&lt;/p&gt;</html>
    </comment>
  </comments>
</note>`;


// Notes are returned as direct descendant childNodes of the `osm` element.
// This covers responses to calls like:
// GET /api/0.6/notes?bbox=left,bottom,right,top
// GET /api/0.6/notes/#id
// GET /api/0.6/notes/search
export const noteXML =
`<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="OpenStreetMap server" copyright="OpenStreetMap and contributors" attribution="http://www.openstreetmap.org/copyright" license="http://opendatacommons.org/licenses/odbl/1-0/">
  ${note1}
  ${note2}
</osm>`;


// ----------------------------------------
// Users

// User, no roles, logged in and with `/details`
// (includes home, languages, and messages)
export const user1 = `
<user id="100" display_name="bhousel" account_created="2000-01-01T00:00:01Z">
  <description>Hi</description>
  <contributor-terms agreed="true" pd="true"/>
  <img href="https://www.gravatar.com/avatar/test.png"/>
  <roles>
  </roles>
  <changesets count="999"/>
  <traces count="999"/>
  <blocks>
    <received count="0" active="0"/>
  </blocks>
  <languages>
    <lang>en</lang>
    <lang>en-US</lang>
  </languages>
  <messages>
    <received count="99" unread="1"/>
    <sent count="99"/>
  </messages>
</user>`;

// User, moderator role, not logged in (has fewer details)
export const user2 = `
<user id="200" display_name="lgtm" account_created="2000-01-01T00:00:01Z">
  <description>LGTM!</description>
  <contributor-terms agreed="true" pd="true"/>
  <img href="https://www.gravatar.com/avatar/test.png"/>
  <roles>
    <moderator/>
  </roles>
  <changesets count="999"/>
  <traces count="999"/>
  <blocks>
    <received count="0" active="0"/>
  </blocks>
</user>
</osm>`;

// Users are returned as direct descendant childNodes of the `osm` element.
// This covers responses to calls like:
// GET /api/0.6/user/#id
// GET /api/0.6/user/details
// GET /api/0.6/users.json?users=#id1,#id2,…,#idn
export const usersXML = `
<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="OpenStreetMap server" copyright="OpenStreetMap and contributors" attribution="http://www.openstreetmap.org/copyright" license="http://opendatacommons.org/licenses/odbl/1-0/">
  ${user1}
  ${user2}
</osm>`;


// ----------------------------------------
// Preferences

// Preferences of the logged-in user are returned in a `preferences` element.
// GET /api/0.6/user/preferences
export const preferencesXML = `
<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="OpenStreetMap server" copyright="OpenStreetMap and contributors" attribution="http://www.openstreetmap.org/copyright" license="http://opendatacommons.org/licenses/odbl/1-0/">
  <preferences>
    <preference k="foo" v="bar"/>
    <preference k="hello" v="world"/>
  </preferences>
</osm>`;


// ----------------------------------------
// Changesets

// Changeset, with comment and discussion
export const c1 = `
<changeset
  id="1"
  created_at="2025-09-01T00:00:01Z"
  closed_at="2025-09-01T00:00:02Z"
  open="false"
  uid="100"
  user="bhousel"
  comments_count="0"
  changes_count="7"
  min_lat="40.060883"
  min_lon="-74.2392873"
  max_lat="40.060993"
  max_lon="-74.2391612"
>
  <tag k="comment" v="Fix unsquare corners"/>
  <tag k="created_by" v="Rapid 2.6.0"/>
  <tag k="host" v="http://127.0.0.1:8080"/>
  <tag k="imagery_used" v="Bing Maps Aerial"/>
  <tag k="locale" v="en-US"/>
  <discussion>
   <comment id="1000" date="2025-09-02T00:00:01Z" uid="200" user="lgtm">
    <text>LGTM!</text>
   </comment>
  </discussion>
</changeset>`;

// Changeset, with empty comment tag, empty discussion element
export const c2 = `
<changeset
  id="2"
  created_at="2025-09-02T00:00:01Z"
  closed_at="2025-09-02T00:00:02Z"
  open="false"
  uid="100"
  user="bhousel"
  comments_count="0"
  changes_count="7"
  min_lat="40.060883"
  min_lon="-74.2392873"
  max_lat="40.060993"
  max_lon="-74.2391612"
>
  <tag k="comment" v=""/>
  <tag k="created_by" v="Rapid 2.6.0"/>
  <tag k="host" v="http://127.0.0.1:8080"/>
  <tag k="imagery_used" v="Bing Maps Aerial"/>
  <tag k="locale" v="en-US"/>
  <discussion/>
</changeset>`;

// Changeset, with no comment tag, no discussion element
export const c3 = `
<changeset
  id="3"
  created_at="2025-09-03T00:00:01Z"
  closed_at="2025-09-03T00:00:02Z"
  open="false"
  uid="100"
  user="bhousel"
  comments_count="0"
  changes_count="7"
  min_lat="40.060883"
  min_lon="-74.2392873"
  max_lat="40.060993"
  max_lon="-74.2391612"
>
  <tag k="comment" v=""/>
  <tag k="created_by" v="Rapid 2.6.0"/>
  <tag k="host" v="http://127.0.0.1:8080"/>
  <tag k="imagery_used" v="Bing Maps Aerial"/>
  <tag k="locale" v="en-US"/>
</changeset>`;


// Changesets are returned as direct descendant childNodes of the `osm` element.
// This covers responses to calls like:
// GET /api/0.6/changesets     (with or without `?include_discussion=true`)
// GET /api/0.6/changeset/#id  (with or without `?include_discussion=true`)
export const changesetsXML =
`<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="openstreetmap-cgimap 2.1.0 (318545 spike-06.openstreetmap.org)" copyright="OpenStreetMap and contributors" attribution="http://www.openstreetmap.org/copyright" license="http://opendatacommons.org/licenses/odbl/1-0/">
  ${c1}
  ${c2}
  ${c3}
</osm>`;


// ----------------------------------------
// API Capabilities
// GET /api/capabilities
export const capabilitiesXML =
`<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="OpenStreetMap server" copyright="OpenStreetMap and contributors" attribution="http://www.openstreetmap.org/copyright" license="http://opendatacommons.org/licenses/odbl/1-0/">
  <api>
    <version minimum="0.6" maximum="0.6"/>
    <area maximum="0.25"/>
    <note_area maximum="25"/>
    <tracepoints per_page="5000"/>
    <waynodes maximum="2000"/>
    <relationmembers maximum="32000"/>
    <changesets maximum_elements="10000" default_query_limit="100" maximum_query_limit="100"/>
    <notes default_query_limit="100" maximum_query_limit="10000"/>
    <timeout seconds="300"/>
    <status database="online" api="online" gpx="online"/>
  </api>
  <policy>
    <imagery>
      <blacklist regex="\.foo\.com"/>
      <blacklist regex="\.bar\.com"/>
    </imagery>
  </policy>
</osm>`;

