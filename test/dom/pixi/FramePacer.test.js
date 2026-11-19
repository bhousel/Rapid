import { DEFERRED_WAIT, FramePacer, MAX_PASS_GAP, PASS_GAP_FACTOR } from '../../../modules/pixi/lib/FramePacer.ts';


describe('FramePacer', () => {
  let pacer;

  beforeEach(() => {
    pacer = new FramePacer();
  });

  it('lets the first pass start at once, whatever it is for', () => {
    assert.strictEqual(pacer.wait(1000, true), 0);
    assert.strictEqual(pacer.wait(1000, false), 0);
    assert.strictEqual(pacer.gap, 0);
  });

  it('makes a pass for the view wait a gap that grows with what the last pass cost', () => {
    pacer.passed(1000, 30);
    assert.strictEqual(pacer.gap, 30 * PASS_GAP_FACTOR);
    assert.strictEqual(pacer.wait(1000, true), 60);
    assert.strictEqual(pacer.wait(1045, true), 15);
    assert.strictEqual(pacer.wait(1060, true), 0);
    assert.strictEqual(pacer.wait(5000, true), 0);

    pacer.passed(2000, 5);
    assert.strictEqual(pacer.wait(2000, true), 10);
  });

  it('never makes a pass wait longer than the longest gap', () => {
    pacer.passed(1000, 1600);   // a restyle of everything in a dense place
    assert.strictEqual(pacer.gap, MAX_PASS_GAP);
    assert.strictEqual(pacer.wait(1000, true), MAX_PASS_GAP);
    assert.strictEqual(pacer.wait(1000 + MAX_PASS_GAP, true), 0);
  });

  it('makes a pass for a deferred redraw alone wait longer, so that changes batch up', () => {
    pacer.passed(1000, 10);
    assert.strictEqual(pacer.wait(1020, true), 0);                       // the view would get its pass
    assert.strictEqual(pacer.wait(1020, false), DEFERRED_WAIT - 20);     // data that arrived waits
    assert.strictEqual(pacer.wait(1000 + DEFERRED_WAIT, false), 0);

    // ..and for the gap too, when that's longer
    assert.isAbove(MAX_PASS_GAP + 1, DEFERRED_WAIT);
    pacer.passed(2000, 1600);
    assert.strictEqual(pacer.wait(2000, false), Math.max(MAX_PASS_GAP, DEFERRED_WAIT));
  });

  it('lets a pass that was asked for now start at once, until that pass begins', () => {
    pacer.passed(1000, 100);
    assert.isAbove(pacer.wait(1001, true), 0);

    assert.isFalse(pacer.hurried);

    pacer.hurry();
    assert.isTrue(pacer.hurried);
    assert.strictEqual(pacer.wait(1001, true), 0);
    assert.strictEqual(pacer.wait(1001, false), 0);

    pacer.begin();   // the hurried pass starts..
    assert.isFalse(pacer.hurried);
    pacer.passed(1040, 20);
    assert.strictEqual(pacer.wait(1041, true), 39);   // ..and the next one waits again
  });

  it('keeps a request made while a pass is under way for the pass after it', () => {
    pacer.begin();
    pacer.hurry();   // e.g. the user clicked between the APP and DRAW passes
    pacer.passed(1040, 20);
    assert.strictEqual(pacer.wait(1041, true), 0);
  });

  it('treats a pass that cost nothing as no reason to wait for the view', () => {
    pacer.passed(1000, 0);
    assert.strictEqual(pacer.wait(1000, true), 0);
    pacer.passed(1000, -5);   // a clock that went backwards
    assert.strictEqual(pacer.gap, 0);
  });

  it('forgets the last pass on reset', () => {
    pacer.passed(1000, 100);
    pacer.hurry();
    pacer.reset();
    assert.strictEqual(pacer.gap, 0);
    assert.strictEqual(pacer.wait(1001, false), 0);

    pacer.passed(2000, 100);
    assert.isAbove(pacer.wait(2001, true), 0);   // not hurried any more
  });
});
