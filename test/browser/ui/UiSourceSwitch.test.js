import { UiRestore } from '../../../modules/ui/UiRestore.ts';
import { UiSourceSwitch } from '../../../modules/ui/UiSourceSwitch.ts';


describe('UiSourceSwitch', () => {
  // A session is only offered on the API it was made on, and startup is always on live, so after a
  // switch the switcher offers the new API's sessions. These use stand-ins for the systems it calls.
  const LIVE = { url: 'https://www.openstreetmap.org', apiUrl: 'https://api.openstreetmap.org' };
  const DEV = { url: 'https://master.apis.dev.openstreetmap.org', apiUrl: 'https://master.apis.dev.openstreetmap.org' };
  const origRender = UiRestore.prototype.render;
  let context, sessionsOn, switchedTo, offered;

  beforeEach(() => {
    sessionsOn = new Set();
    switchedTo = [];
    offered = [];
    UiRestore.prototype.render = () => offered.push(switchedTo.at(-1));

    context = new Rapid.MockContext();
    context.apiConnections = [LIVE, DEV];
    context.inIntro = false;
    context.enter = () => {};
    context.resetAsync = () => Promise.resolve();
    context.systems = {
      editor: {
        hasWork: () => false,
        clearBackup: () => {},
        findRestorableSessionsAsync: () => Promise.resolve(sessionsOn.has(switchedTo.at(-1)))
      },
      l10n: { t: k => k }
    };
    context.services = {
      osm: { switchAsync: (options) => { switchedTo.push(options.apiUrl); return Promise.resolve(); } }
    };
  });

  afterEach(() => {
    UiRestore.prototype.render = origRender;
  });

  const settle = () => new Promise(resolve => { setTimeout(resolve, 0); });


  it('offers to restore the sessions made on the API it switched to', async () => {
    sessionsOn.add(DEV.apiUrl);
    const sourceSwitch = new UiSourceSwitch(context);

    sourceSwitch.toggle();   // to dev
    await settle();
    assert.deepEqual(offered, [DEV.apiUrl]);

    sourceSwitch.toggle();   // back to live, which has none
    await settle();
    assert.deepEqual(switchedTo, [DEV.apiUrl, LIVE.apiUrl]);
    assert.deepEqual(offered, [DEV.apiUrl]);
  });
});
