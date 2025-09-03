import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { promisify } from 'node:util';
import { assert } from 'chai';
import fetchMock from 'fetch-mock';
import * as Rapid from '../../../modules/headless.js';


describe('OsmService', () => {
  // Setup context..
  const context = new Rapid.MockContext();
  context.systems = {
    spatial: new Rapid.SpatialSystem(context)
  };

  // Setup fetchMock..
  before(() => {
    fetchMock.mockGlobal()
      .sticky(/api\/capabilities\.json/, {
        status: 200, body: capabilitiesJSON, headers: { 'Content-Type': 'application/json' }
      })
      .sticky(/api\/capabilities(?!\.json)/, {
        status: 200, body: capabilitiesXML, headers: { 'Content-Type': 'application/xml' }
      });
  });

  after(() => {
    fetchMock.hardReset({ includeSticky: true });
  });

  beforeEach(() => {
    fetchMock.removeRoutes().clearHistory();
  });


  // Test construction and startup of the service..
  describe('lifecycle', () => {
    describe('constructor', () => {
      it('constructs an OsmService from a context', () => {
        const osm = new Rapid.OsmService(context);
        assert.instanceOf(osm, Rapid.OsmService);
        assert.strictEqual(osm.id, 'osm');
        assert.strictEqual(osm.context, context);
        assert.instanceOf(osm.requiredDependencies, Set);
        assert.instanceOf(osm.optionalDependencies, Set);
        assert.isTrue(osm.autoStart);

        assert.deepEqual(osm._tileCache, {});
        assert.deepEqual(osm._noteCache, {});
        assert.deepEqual(osm._userCache, {});
        assert.strictEqual(osm.connectionID, 0);
      });
    });

    describe('initAsync', () => {
      it('returns a promise to init', () => {
        const osm = new Rapid.OsmService(context);
        const prom = osm.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.instanceOf(osm._tileCache.toLoad, Set);
            assert.instanceOf(osm._noteCache.toLoad, Set);
            assert.instanceOf(osm._userCache.toLoad, Set);
            assert.isAbove(osm.connectionID, 0);
          });
      });

      it('rejects if a dependency is missing', () => {
        const osm = new Rapid.OsmService(context);
        osm.requiredDependencies.add('missing');
        const prom = osm.initAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err, /cannot init/i));
      });
    });

    describe('startAsync', () => {
      it('returns a promise to start', () => {
        const osm = new Rapid.OsmService(context);
        const prom = osm.initAsync().then(() => osm.startAsync());
        assert.instanceOf(prom, Promise);
        return prom
          .then(val => assert.isTrue(osm.started));
      });
    });

    describe('resetAsync', () => {
      it('returns a promise to reset', () => {
        const osm = new Rapid.OsmService(context);
        osm._tileCache = {};
        osm._noteCache = {};
        osm._userCache = {};

        const prom = osm.resetAsync();
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.instanceOf(osm._tileCache.toLoad, Set);
            assert.instanceOf(osm._noteCache.toLoad, Set);
            assert.instanceOf(osm._userCache.toLoad, Set);
          });
      });
    });

    describe('switchAsync', () => {
      it('returns a promise to switch connection and reset', () => {
        const osm = new Rapid.OsmService(context);
        const opts = {
          url: 'https://www.example.com',
          apiUrl: 'https://api.example.com'
        };

        const prom = osm.switchAsync(opts);
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.strictEqual(osm.wwwroot, 'https://www.example.com');
          });
      });

      it('emits a change event', () => {
        const osm = new Rapid.OsmService(context);
        const spyAuthChange = mock.fn();
        osm.on('authchange', spyAuthChange);
        const opts = {
          url: 'https://www.example.com',
          apiUrl: 'https://api.example.com'
        };

        const prom = osm.switchAsync(opts);
        assert.instanceOf(prom, Promise);
        return prom
          .then(() => {
            assert.strictEqual(spyAuthChange.mock.callCount(), 1);
          });
      });
    });
  });


  // Test an already-constructed instance of the service..
  describe('methods', () => {
    let _osm;

    function loginAsync() {
      return _osm.switchAsync({
        url: 'https://www.openstreetmap.org',
        apiUrl: 'https://api.openstreetmap.org',
        client_id: 'O3g0mOUuA2WY5Fs826j5tP260qR3DDX7cIIE2R2WWSc',
        client_secret: 'b4aeHD1cNeapPPQTrvpPoExqQRjybit6JBlNnxh62uE',
        access_token: 'foo'  // preauth
      });
    }

    beforeEach(() => {
      fetchMock
        .route(/user\/details\.json/, { status: 200, body: userJSON, headers: { 'Content-Type': 'application/json' } })
        .route(/changesets\.json/, { status: 200, body: changesetJSON, headers: { 'Content-Type': 'application/json' } });

      _osm = new Rapid.OsmService(context);
      return _osm.initAsync().then(() => _osm.startAsync());
    });

    afterEach(() => {
      _osm.throttledReloadApiStatus.cancel();
    });


    describe('connectionID', () => {
      it('changes the connectionID every time service is reset', () => {
        const originalID = _osm.connectionID;
        return _osm.resetAsync()
          .then(() => {
            assert.isAbove(_osm.connectionID, originalID);
          });
      });

      it('changes the connectionID every time service is switched', () => {
        const originalID = _osm.connectionID;
        const opts = {
          url: 'https://api06.dev.openstreetmap.org',
          apiUrl: 'https://api06.dev.openstreetmap.org'
        };
        return _osm.switchAsync(opts)
          .then(() => {
            assert.isAbove(_osm.connectionID, originalID);
          });
      });
    });


    describe('changesetURL', () => {
      it('provides a changeset url based on wwwroot', () => {
        assert.strictEqual(_osm.changesetURL(2), `${_osm.wwwroot}/changeset/2`);
      });
    });


    describe('changesetsURL', () => {
      it('provides a local changesets url based on wwwroot', () => {
        const center = [-74.65, 40.65];
        const zoom = 17;
        assert.strictEqual(_osm.changesetsURL(center, zoom), `${_osm.wwwroot}/history#map=17/40.65000/-74.65000`);
      });
    });


    describe('entityURL', () => {
      it('provides an entity url for a node based on wwwroot', () => {
        const e = new Rapid.OsmNode(context, { id: 'n1' });
        assert.strictEqual(_osm.entityURL(e), `${_osm.wwwroot}/node/1`);
      });

      it('provides an entity url for a way based on wwwroot', () => {
        const e = new Rapid.OsmWay(context, { id: 'w1' });
        assert.strictEqual(_osm.entityURL(e), `${_osm.wwwroot}/way/1`);
      });

      it('provides an entity url for a relation based on wwwroot', () => {
        const e = new Rapid.OsmRelation(context, { id: 'r1' });
        assert.strictEqual(_osm.entityURL(e), `${_osm.wwwroot}/relation/1`);
      });
    });


    describe('historyURL', () => {
      it('provides a history url for a node based on wwwroot', () => {
        const e = new Rapid.OsmNode(context, { id: 'n1' });
        assert.strictEqual(_osm.historyURL(e), `${_osm.wwwroot}/node/1/history`);
      });

      it('provides a history url for a way based on wwwroot', () => {
        const e = new Rapid.OsmWay(context, { id: 'w1' });
        assert.strictEqual(_osm.historyURL(e), `${_osm.wwwroot}/way/1/history`);
      });

      it('provides a history url for a relation based on wwwroot', () => {
        const e = new Rapid.OsmRelation(context, { id: 'r1' });
        assert.strictEqual(_osm.historyURL(e), `${_osm.wwwroot}/relation/1/history`);
      });
    });


    describe('userURL', () => {
      it('provides a user url based on wwwroot', () => {
        assert.strictEqual(_osm.userURL('bob'), `${_osm.wwwroot}/user/bob`);
      });
    });


    describe('loadFromAPI', () => {
      const path = '/api/0.6/map.json?bbox=-74.542,40.655,-74.541,40.656';
      const body =
`{
  "version":"0.6",
  "bounds":{"minlat":40.6550000,"minlon":-74.5420000,"maxlat":40.6560000,"maxlon":-74.5410000},
  "elements":[
    {"type":"node","id":"105340439","visible":true,"version":2,"changeset":2880013,"timestamp":"2009-10-18T07:47:39Z","user":"woodpeck_fixbot","uid":147510,"lat":40.6555,"lon":-74.5415},
    {"type":"node","id":"105340442","visible":true,"version":2,"changeset":2880013,"timestamp":"2009-10-18T07:47:39Z","user":"woodpeck_fixbot","uid":147510,"lat":40.6556,"lon":-74.5416},
    {"type":"way","id":"40376199","visible":true,"version":1,"changeset":2403012,"timestamp":"2009-09-07T16:01:13Z","user":"NJDataUploads","uid":148169,"nodes":[105340439,105340442],"tags":{"highway":"residential","name":"Potomac Drive"}}
  ]
}`;
      const okResponse = { status: 200, body: body, headers: { 'Content-Type': 'application/json' } };


      it('returns an object', () => {
        const loadFromAPI = promisify(_osm.loadFromAPI).bind(_osm);
        fetchMock.route(/map\.json/, okResponse);

        return loadFromAPI(path)
          .then(result => {
            assert.isObject(result);
          });
      });

      it('retries an authenticated call unauthenticated if 400 Bad Request', () => {
        const loadFromAPI = promisify(_osm.loadFromAPI).bind(_osm);
        const badResponse = { status: 400, body: 'Bad Request', headers: { 'Content-Type': 'text/plain' } };
        fetchMock
          .route(match => /map\.json/.test(match.url) && match.options.headers?.authorization,  badResponse)
          .route(match => /map\.json/.test(match.url) && !match.options.headers?.authorization, okResponse);

        return loginAsync()
          .then(() => loadFromAPI(path))
          .then(result => {
            assert.isObject(result);
            assert.isNotOk(_osm.authenticated());

            const calls = fetchMock.callHistory.calls();
            assert.isAtLeast(calls.length, 2);   // auth, unauth, capabilities
            assert.property((calls[0].options.headers || {}), 'authorization');
            assert.notProperty((calls[1].options.headers || {}), 'authorization');
          });
      });

      it('retries an authenticated call unauthenticated if 401 Unauthorized', () => {
        const loadFromAPI = promisify(_osm.loadFromAPI).bind(_osm);
        const badResponse = { status: 401, body: 'Unauthorized', headers: { 'Content-Type': 'text/plain' } };
        fetchMock
          .route(match => /map\.json/.test(match.url) && match.options.headers?.authorization,  badResponse)
          .route(match => /map\.json/.test(match.url) && !match.options.headers?.authorization, okResponse);

        return loginAsync()
          .then(() => loadFromAPI(path))
          .then(result => {
            assert.isObject(result);
            assert.isNotOk(_osm.authenticated());

            const calls = fetchMock.callHistory.calls();
            assert.isAtLeast(calls.length, 2);   // auth, unauth, capabilities
            assert.property((calls[0].options.headers || {}), 'authorization');
            assert.notProperty((calls[1].options.headers || {}), 'authorization');
          });
      });

      it('retries an authenticated call unauthenticated if 403 Forbidden', done => {
        const loadFromAPI = promisify(_osm.loadFromAPI).bind(_osm);
        const badResponse = { status: 403, body: 'Forbidden', headers: { 'Content-Type': 'text/plain' } };
        fetchMock
          .route(match => /map\.json/.test(match.url) && match.options.headers?.authorization,  badResponse)
          .route(match => /map\.json/.test(match.url) && !match.options.headers?.authorization, okResponse);

        return loginAsync()
          .then(() => loadFromAPI(path))
          .then(result => {
            assert.isObject(result);
            assert.isNotOk(_osm.authenticated());

            const calls = fetchMock.callHistory.calls();
            assert.isAtLeast(calls.length, 2);   // auth, unauth, capabilities
            assert.property((calls[0].options.headers || {}), 'authorization');
            assert.notProperty((calls[1].options.headers || {}), 'authorization');
          });
      });

      it('receives an error when receiving a partial response', () => {
        const loadFromAPI = promisify(_osm.loadFromAPI).bind(_osm);
        const path = '/api/0.6/map.json?bbox=-74.542,40.655,-74.541,40.656';
        const partialBody =
 `{
  "version":"0.6",
  "bounds":{"minlat":40.6550000,"minlon":-74.5420000,"maxlat":40.6560000,"maxlon":-74.5410000},
  "elements":[
    {"type":"node","id":"105340439","visible":true,"version":2,"changeset":2880013,"timestamp":"2009-10-18T07:47:39Z","user":"woodpeck_fixbot","uid":147510,"lat":40.6555,"lon":-74.5415},
    {"type":"node","id":"105340442","visible":true,"version":2,"changeset":2880013,"timestamp":"2009-10-18T07:47:39Z","user":"woodpeck_fixbot","uid":147510,"lat":40.6556,"lon":-74.5416},
    {"type":"error", "message":"something went wrong loading postgres"}
  ]
 }`;
        const partialResponse = { status: 200, body: partialBody, headers: { 'Content-Type': 'application/json' } };
        fetchMock.route(/map\.json/, partialResponse);

        return loginAsync()
          .then(() => loadFromAPI(path))
          .then(val => assert.fail(`Promise was fulfilled but should have been rejected: ${val}`))
          .catch(err => assert.match(err.message, /partial json/i));
      });

    });


    describe('loadTiles', () => {
      const tileBody =
 `{
  "version":"0.6",
  "bounds":{"minlat":40.6681396,"minlon":-74.0478516,"maxlat":40.6723060,"maxlon":-74.0423584},
  "elements":[
    {"type":"node","id":"368395606","visible":true,"version":3,"changeset":28924294,"timestamp":"2015-02-18T04:25:04Z","user":"peace2","uid":119748,"lat":40.6694299,"lon":-74.0444216,"tags":{"addr:state":"NJ","ele":"0","gnis:county_name":"Hudson","gnis:feature_id":"881377","gnis:feature_type":"Bay","name":"Upper Bay","natural":"bay"}}
  ]
 }`;
      beforeEach(() => {
        const v = context.viewport;
        v.transform.zoom = 20;
        v.transform.translation = [55212042.434589595, 33248879.510193843];  // -74.0444216, 40.6694299
        v.dimensions = [64, 64];
      });

      it('calls callback when data tiles are loaded', () => {
        const loadTiles = promisify(_osm.loadTiles).bind(_osm);
        fetchMock.route(/map\.json/, {
          body: tileBody,
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        return loadTiles()
          .then(() => assert.isTrue(true));
      });
    });


////    it('isDataLoaded', () => {
////      expect(_osm.isDataLoaded([-74.0444216, 40.6694299])).to.be.false;
////
////      const bbox = { minX: -75, minY: 40, maxX: -74, maxY: 41, id: 'fake' };
////      _osm._tileCache.rbush.insert(bbox);
////
////      expect(_osm.isDataLoaded([-74.0444216, 40.6694299])).to.be.true;
////    });
//  });


    describe('loadEntity', () => {
      const nodeBody =
`{
  "version":"0.6",
  "elements":[
    {"type":"node","id":1,"visible":true,"version":1,"changeset":28924294,"timestamp":"2009-03-07T03:26:33Z","user":"peace2","uid":119748,"lat":0,"lon":0}
  ]
}`;

      const wayBody =
`{
  "version":"0.6",
  "elements":[
    {"type":"node","id":1,"visible":true,"version":1,"changeset":2817006,"timestamp":"2009-10-11T18:03:23Z","user":"peace2","uid":119748,"lat":0,"lon":0},
    {"type":"way","id":1,"visible":true,"version":1,"changeset":522559,"timestamp":"2008-01-03T05:24:43Z","user":"peace2","uid":119748,"nodes":[1]}
  ]
}`;

      it('loads a node', () => {
        const loadEntity = promisify(_osm.loadEntity).bind(_osm);
        fetchMock.route(/node\/1\.json/, {
          body: nodeBody,
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        const id = 'n1';
        return loadEntity(id)
          .then(result => {
            const entity = result.data.find(e => e.id === id);
            assert.instanceOf(entity, Rapid.OsmNode);
          });
      });


      it('loads a way', () => {
        const loadEntity = promisify(_osm.loadEntity).bind(_osm);
        fetchMock.route(/way\/1\/full\.json/, {
          body: wayBody,
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        const id = 'w1';
        return loadEntity(id)
          .then(result => {
            const entity = result.data.find(e => e.id === id);
            assert.instanceOf(entity, Rapid.OsmWay);
          });
      });


      it('does not ignore repeat requests', () => {
        const loadEntity = promisify(_osm.loadEntity).bind(_osm);
        fetchMock.route(/node\/1\.json/, {
          body: nodeBody,
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        const id = 'n1';
        let entity1, entity2;
        return loadEntity(id)
          .then(result => {
            entity1 = result.data.find(e => e.id === id);
            assert.instanceOf(entity1, Rapid.OsmNode);
          })
          .then(() => loadEntity(id))
          .then(result => {
            entity2 = result.data.find(e => e.id === id);
            assert.instanceOf(entity2, Rapid.OsmNode);
            assert.notStrictEqual(entity1, entity2);  // !==
          });
      });
    });


    describe('loadEntityVersion', () => {
      const nodeBody =
`{
"version":"0.6",
"elements":[
  {"type":"node","id":1,"visible":true,"version":1,"changeset":28924294,"timestamp":"2009-03-07T03:26:33Z","user":"peace2","uid":119748,"lat":0,"lon":0}
]
}`;
      const wayBody =
`{
"version":"0.6",
"elements":[
  {"type":"node","id":1,"visible":true,"version":1,"changeset":2817006,"timestamp":"2009-10-11T18:03:23Z","user":"peace2","uid":119748,"lat":0,"lon":0},
  {"type":"way","id":1,"visible":true,"version":1,"changeset":522559,"timestamp":"2008-01-03T05:24:43Z","user":"peace2","uid":119748,"nodes":[1]}
]
}`;

      it('loads a node', () => {
        const loadEntityVersion = promisify(_osm.loadEntityVersion).bind(_osm);
        fetchMock.route(/node\/1\/1\.json/, {
          body: nodeBody,
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        const id = 'n1';
        return loadEntityVersion(id, 1)
          .then(result => {
            const entity = result.data.find(e => e.id === id);
            assert.instanceOf(entity, Rapid.OsmNode);
          });
      });


      it('loads a way', () => {
        const loadEntityVersion = promisify(_osm.loadEntityVersion).bind(_osm);
        fetchMock.route(/way\/1\/1\.json/, {
          body: wayBody,
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        const id = 'w1';
        return loadEntityVersion(id, 1)
          .then(result => {
            const entity = result.data.find(e => e.id === id);
            assert.instanceOf(entity, Rapid.OsmWay);
          });
      });


      it('does not ignore repeat requests', () => {
        const loadEntityVersion = promisify(_osm.loadEntityVersion).bind(_osm);
        fetchMock.route(/node\/1\/1\.json/, {
          body: nodeBody,
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        const id = 'n1';
        let entity1, entity2;
        return loadEntityVersion(id, 1)
          .then(result => {
            entity1 = result.data.find(e => e.id === id);
            assert.instanceOf(entity1, Rapid.OsmNode);
          })
          .then(() => loadEntityVersion(id, 1))
          .then(result => {
            entity2 = result.data.find(e => e.id === id);
            assert.instanceOf(entity2, Rapid.OsmNode);
            assert.notStrictEqual(entity1, entity2);  // !==
          });
      });
    });


    describe('userDetails', () => {
      it('retrieves user details', () => {
        const userDetails = promisify(_osm.userDetails).bind(_osm);
        return loginAsync()
          .then(() => userDetails())
          .then(result => {
            assert.strictEqual(result.id, '584325');
          });

      });
    });


    describe('userChangesets', () => {
      it('retrieves user changesets', () => {
        const userChangesets = promisify(_osm.userChangesets).bind(_osm);
        return loginAsync()
          .then(() => userChangesets())
          .then(result => {
            // ignore changesets with empty or missing comment
            assert.lengthOf(result, 1);

            const changeset = result[0];
            assert.strictEqual(changeset.id, 137842015);
            assert.strictEqual(changeset.tags.comment, 'Fix unsquare corners');
          });
      });
    });


    describe('loadNotes', () => {
      const notesBody =
`<?xml version="1.0" encoding="UTF-8"?>
<osm>
<note lon="10" lat="0">
  <id>1</id>
  <url>https://www.openstreetmap.org/api/0.6/notes/1</url>
  <comment_url>https://api.openstreetmap.org/api/0.6/notes/1/comment</comment_url>
  <close_url>https://api.openstreetmap.org/api/0.6/notes/1/close</close_url>
  <date_created>2019-01-01 00:00:00 UTC</date_created>
  <status>open</status>
  <comments>
    <comment>
      <date>2019-01-01 00:00:00 UTC</date>
      <uid>584325</uid>
      <user>bhousel</user>
      <user_url>https://www.openstreetmap.org/user/bhousel</user_url>
      <action>opened</action>
      <text>This is a note</text>
      <html>&lt;p&gt;This is a note&lt;/p&gt;</html>
    </comment>
  </comments>
</note>
</osm>`;

      it('emits loadedNotes when notes are loaded', done => {
        fetchMock.route(/notes\?/, {
          body: notesBody,
          status: 200,
          headers: { 'Content-Type': 'text/xml' }
        });

        _osm.on('loadedNotes', () => {
          const calls = fetchMock.callHistory.calls();
          assert.isAtLeast(calls.length, 1);
          done();
        });

        _osm.loadNotes({ /*no options*/ });
      });
    });


    describe('API capabilities', () => {
      describe('status', () => {
        it('gets API status', () => {
          const status = promisify(_osm.status).bind(_osm);
          return status()
            .then(result => {
              assert.strictEqual(result, 'online');
            });
        });
      });

      describe('imageryBlocklists', () => {
        it('updates imagery blocklists', () => {
          const status = promisify(_osm.status).bind(_osm);
          return status()
            .then(result => {
              const blocklists = _osm.imageryBlocklists;
              assert.deepEqual(blocklists, [new RegExp('\.foo\.com'), new RegExp('\.bar\.org')]);
            });
        });
      });
    });

  });

//
//  describe('caches', () => {
//    it('loads reset caches', () => {
//      const caches = _osm.caches();
//      expect(caches.tile).to.have.all.keys(['lastv','toLoad','inflight','seen']);
//      expect(caches.note).to.have.all.keys(['lastv','toLoad','inflight','inflightPost','note','closed']);
//      expect(caches.user).to.have.all.keys(['toLoad','user']);
//    });
//
//    describe('sets/gets caches', () => {
////      it('sets/gets a tile', () => {
////        const obj = {
////          tile: { loaded: new Set(['1,2,16', '3,4,16']) }
////        };
////        _osm.caches(obj);
////        const result = _osm.caches();
////        expect(result.tile.loaded.has('1,2,16')).to.eql(true);
////        expect(result.tile.loaded.size).to.eql(2);
////      });
//
//      it('sets/gets a note', () => {
//        const note1 = new Rapid.Marker(context, { id: '1', loc: [0, 0], serviceID: 'osm' });
//        const note2 = new Rapid.Marker(context, { id: '2', loc: [0, 0], serviceID: 'osm' });
//        const obj = {
//          note: { note: { '1': note1, '2': note2 } }
//        };
//        _osm.caches(obj);
//        const result = _osm.caches();
//        expect(result.note.note[note1.id]).to.deep.equal(note1);
//        expect(Object.keys(result.note.note).length).to.eql(2);
//      });
//
//      it('sets/gets a user', () => {
//        const user = { id: '1', display_name: 'Name' };
//        const user2 = { id: '2', display_name: 'Name' };
//        const obj = {
//          user: { user: { '1': user, '2': user2 } }
//        };
//        _osm.caches(obj);
//        const result = _osm.caches();
//        expect(result.user.user[user.id]).to.eql(user);
//        expect(Object.keys(result.user.user).length).to.eql(2);
//      });
//    });
//  });
//
//
//    describe('notes', () => {
//      beforeEach(() => {
//        const v = context.viewport;
//        v.transform = { x: -116508, y: 0, z: 14 };  // [10°, 0°]
//        v.dimensions = [64, 64];
//      });
//
//      it('returns notes in the visible map area', () => {
//        const notes = [
//          { minX: 10, minY: 0, maxX: 10, maxY: 0, data: { key: '0', loc: [10,0] } },
//          { minX: 10, minY: 0, maxX: 10, maxY: 0, data: { key: '1', loc: [10,0] } },
//          { minX: 10, minY: 1, maxX: 10, maxY: 1, data: { key: '2', loc: [10,1] } }
//        ];
//
//        _osm._noteCache.rbush.load(notes);
//        const result = _osm.getNotes();
//        expect(result).to.deep.eql([
//          { key: '0', loc: [10,0] },
//          { key: '1', loc: [10,0] }
//        ]);
//      });
//    });
//
//
//  describe('replaceNote', () => {
//    it('adds a note', () => {
//      const noteID = '-1';
//      const note = new Rapid.Marker(context, { id: noteID, loc: [0, 0], serviceID: 'osm', isNew: true });
//      const result = _osm.replaceNote(note);
//      expect(result).to.equal(note);  // strict ===
//      expect(_osm._noteCache.note[noteID]).to.equal(note);  // note is added to cache
//
//      const rbush = _osm._noteCache.rbush;
//      const result_rbush = rbush.search({ 'minX': -1, 'minY': -1, 'maxX': 1, 'maxY': 1 });
//      expect(result_rbush.length).to.eql(1);        // note is added to rbush
//      expect(result_rbush[0].data).to.equal(note);  // strict ===
//    });
//
//    it('replaces a note', () => {
//      const noteID = '1';
//      const note1 = new Rapid.Marker(context, { id: noteID, loc: [0, 0], serviceID: 'osm' });
//      _osm.replaceNote(note1);  // note1 added to caches
//
//      const note2 = note1.update({ status: 'closed' });  // note2 is an updated note1
//      expect(note2).to.not.equal(note1);
//      expect(note2.id).to.equal(noteID);  // id unchanged
//      const result = _osm.replaceNote(note2);
//      expect(result).to.equal(note2);  // strict ===
//      expect(_osm._noteCache.note[noteID]).to.equal(note2);  // note2 has replaced note1 in cache
//
//      const rbush = _osm._noteCache.rbush;
//      const result_rbush = rbush.search({ 'minX': -1, 'minY': -1, 'maxX': 1, 'maxY': 1 });
//      expect(result_rbush.length).to.eql(1);
//      expect(result_rbush[0].data).to.equal(note2);  // note2 has replaced note1 in rbush
//    });
//  });
//
//  describe('getNote', () => {
//    it('returns a note from the cache', () => {
//      const noteID = '3';
//      const note = new Rapid.Marker(context, { id: noteID, loc: [0, 0], serviceID: 'osm' });
//      _osm.replaceNote(note);  // note added to caches
//      const result = _osm.getNote(noteID);
//      expect(result).to.equal(note);  // strict ===
//    });
//  });
//
//  describe('removeNote', () => {
//    it('removes a note', () => {
//      const noteID = '4';
//      const note = new Rapid.Marker(context, { id: noteID, loc: [0, 0], serviceID: 'osm', isNew: true });
//      _osm.replaceNote(note);  // note added to caches
//      expect(_osm._noteCache.note[noteID]).to.equal(note);  // note is added to cache
//
//      _osm.removeNote(note);
//      expect(_osm._noteCache.note[noteID]).to.be.undefined;  // note is removed from cache
//
//      const rbush = _osm._noteCache.rbush;
//      const result_rbush = rbush.search({ 'minX': -1, 'minY': -1, 'maxX': 1, 'maxY': 1 });
//      expect(result_rbush.length).to.eql(0);  // note is removed from rbush
//    });
//  });
//
//
});


const capabilitiesJSON =
`{
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
}`;

const capabilitiesXML =
`<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="OpenStreetMap server" copyright="OpenStreetMap and contributors" attribution="http://www.openstreetmap.org/copyright" license="http://opendatacommons.org/licenses/odbl/1-0/">
  <api>
    <version minimum="0.6" maximum="0.6"/>
    <area maximum="0.25"/>
    <note_area maximum="25"/>
    <tracepoints per_page="5000"/>
    <waynodes maximum="2000"/>
    <changesets maximum_elements="10000"/>
    <timeout seconds="300"/>
    <status database="online" api="online" gpx="online"/>
  </api>
  <policy>
    <imagery>
      <blacklist regex="\.foo\.com"/>
      <blacklist regex="\.bar\.org"/>
    </imagery>
  </policy>
</osm>`;

const userJSON =
`{
  "version": "0.6",
  "generator": "OpenStreetMap server",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "user": {
    "id": 584325,
    "display_name": "bhousel",
    "account_created": "2010-01-01T00:00:00Z",
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
}`;

const changesetJSON =
`{
  "version": "0.6",
  "generator": "OpenStreetMap server",
  "copyright": "OpenStreetMap and contributors",
  "attribution": "http://www.openstreetmap.org/copyright",
  "license": "http://opendatacommons.org/licenses/odbl/1-0/",
  "changesets": [
    {
      "id": 137842015,
      "created_at": "2023-06-01T00:00:00Z",
      "open": false,
      "comments_count": 0,
      "changes_count": 10,
      "closed_at": "2023-06-01T00:00:01Z",
      "min_lat": 40.060883,
      "min_lon": -75.2392873,
      "max_lat": 40.060993,
      "max_lon": -75.2391612,
      "uid": 584325,
      "user": "bhousel",
      "tags": {
        "comment": "Fix unsquare corners",
        "created_by": "Rapid 2.1.0",
        "host": "http://127.0.0.1:8080/",
        "locale": "en-US",
        "imagery_used": "Bing Maps Aerial"
      }
    },
    {
      "id": 137842016,
      "created_at": "2023-06-02T00:00:00Z",
      "open": false,
      "comments_count": 0,
      "changes_count": 10,
      "closed_at": "2023-06-02T00:00:01Z",
      "min_lat": 40.060883,
      "min_lon": -75.2392873,
      "max_lat": 40.060993,
      "max_lon": -75.2391612,
      "uid": 584325,
      "user": "bhousel",
      "tags": {
        "comment": "",
        "created_by": "Rapid 2.1.0",
        "host": "http://127.0.0.1:8080/",
        "locale": "en-US",
        "imagery_used": "Bing Maps Aerial"
      }
    },
    {
      "id": 137842017,
      "created_at": "2023-06-03T00:00:00Z",
      "open": false,
      "comments_count": 0,
      "changes_count": 10,
      "closed_at": "2023-06-02T00:00:01Z",
      "min_lat": 40.060883,
      "min_lon": -75.2392873,
      "max_lat": 40.060993,
      "max_lon": -75.2391612,
      "uid": 584325,
      "user": "bhousel",
      "tags": {
        "created_by": "Rapid 2.1.0",
        "host": "http://127.0.0.1:8080/",
        "locale": "en-US",
        "imagery_used": "Bing Maps Aerial"
      }
    }
  ]
}`;
