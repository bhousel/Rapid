import { UiIntro } from '../../../modules/ui/intro/UiIntro.ts';


describe('UiSystem', () => {

  // What to show first, at startup. The UI needs a full app to render, so these tests use a system made
  // without its constructor, with stand-ins for what `startAsync` uses.
  describe('startAsync', () => {
    const origStart = UiIntro.prototype.start;
    let context, ui, editor, introStarted;

    beforeEach(() => {
      introStarted = false;
      UiIntro.prototype.start = () => { introStarted = true; };

      context = new Rapid.MockContext();
      context.container = () => d3.select(document.body);
      context.enter = () => {};
      editor = {
        canRestoreBackup: true,   // there are sessions to restore
        startAsync: () => Promise.resolve(),
        dismissRestore: () => { editor.canRestoreBackup = false; }
      };
      context.systems = {
        editor: editor,
        map: { startAsync: () => Promise.resolve() },
        urlhash: { initialHashParams: new Map([['walkthrough', 'true']]) }
      };

      ui = Object.assign(Object.create(Rapid.UiSystem.prototype), { context: context, _startPromise: null });
      ui.render = () => {};
      ui.resize = () => {};
    });

    afterEach(() => {
      UiIntro.prototype.start = origStart;
    });


    it('`walkthrough=true` starts the walkthrough, and doesn\'t wait to offer a restore (which stops backups)', async () => {
      await ui.startAsync();
      assert.isTrue(introStarted);
      assert.isFalse(editor.canRestoreBackup);
    });
  });
});
