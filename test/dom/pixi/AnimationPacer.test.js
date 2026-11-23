import {
  ANIMATION_GAP_FACTOR, ANIMATION_MS, ANIMATION_REST_MS, AnimationPacer, MAX_ANIMATION_GAP
} from '../../../modules/pixi/lib/AnimationPacer.ts';


// An animation frame is the scene drawn again only because something in it moves by itself.
// The pacer says when one is due: `changed()` is a frame drawn for another reason, `animated()`
// an animation frame, `tick()` each turn of the frame loop.
describe('AnimationPacer', () => {
  let pacer;

  beforeEach(() => {
    pacer = new AnimationPacer();
  });

  it('waits a gap after a frame that was drawn because something changed', () => {
    assert.strictEqual(pacer.gap, ANIMATION_MS);
    pacer.changed(1000);
    assert.isFalse(pacer.isDue(1000));
    assert.isFalse(pacer.isDue(1000 + ANIMATION_MS - 1));
    assert.isTrue(pacer.isDue(1000 + ANIMATION_MS));
    assert.isTrue(pacer.isDue(5000));
  });

  it('draws a frame on every third tick of a screen that shows 60 a second: 20 a second', () => {
    const TICK = 1000 / 60;
    pacer.changed(0);
    let frames = 0;
    for (let i = 1; i <= 600; i++) {       // ten seconds, with ticks that come a little early or late
      const now = i * TICK + ((i % 2) ? 1.5 : -1.5);
      pacer.tick(TICK);
      if (pacer.isDue(now)) {
        pacer.animated(now);
        frames++;
      }
    }
    assert.strictEqual(frames, 200);
  });

  it('draws none while other frames are drawn as often', () => {
    pacer.changed(1000);
    for (let now = 1016.7; now < 2000; now += 16.7) {    // the view is moving
      assert.isFalse(pacer.isDue(now), `at ${now}`);
      pacer.changed(now);
      pacer.tick(16.7);
    }
  });

  it('makes the gap grow with how long the browser took to come back after an animation frame', () => {
    pacer.changed(1000);
    pacer.animated(1050);
    pacer.tick(40);                // the GPU needed longer than a tick for it
    assert.strictEqual(pacer.gap, 40 * ANIMATION_GAP_FACTOR);
    assert.isFalse(pacer.isDue(1050 + 80), 'not on the second tick after it');
    assert.isTrue(pacer.isDue(1050 + 120), 'on the third');

    pacer.animated(1170);
    pacer.tick(8.3);               // a faster screen: the gap is never shorter than on a screen of 60
    assert.strictEqual(pacer.gap, ANIMATION_MS);
  });

  it('never waits longer than the longest gap', () => {
    pacer.changed(1000);
    pacer.animated(1050);
    pacer.tick(4000);              // the tab was in the background
    assert.strictEqual(pacer.gap, MAX_ANIMATION_GAP);
    assert.isFalse(pacer.isDue(1050 + MAX_ANIMATION_GAP - 1));
    assert.isTrue(pacer.isDue(1050 + MAX_ANIMATION_GAP));
  });

  it('times only the tick after an animation frame', () => {
    pacer.changed(1000);
    pacer.tick(300);               // a long pass: nothing to do with animation
    assert.strictEqual(pacer.gap, ANIMATION_MS);

    pacer.animated(1050);
    pacer.tick(16.7);
    pacer.tick(300);               // a later tick
    assert.strictEqual(pacer.gap, ANIMATION_MS);

    pacer.animated(1100);
    pacer.changed(1110);           // another frame came first: the next tick says what that one cost
    pacer.tick(300);
    assert.strictEqual(pacer.gap, ANIMATION_MS);
  });

  it('rests when nothing else was drawn for a while, after one last frame', () => {
    pacer.changed(1000);
    let now = 1000;
    let frames = 0;
    while (now < 1000 + ANIMATION_REST_MS - 50) {
      now += 50;
      assert.isTrue(pacer.isDue(now), `at ${now}`);
      assert.isFalse(pacer.isResting(now));
      pacer.animated(now);
      pacer.tick(16.7);
      frames++;
    }
    assert.strictEqual(frames, ANIMATION_REST_MS / 50 - 1);
    assert.isFalse(pacer.isDue(now + 10), 'not yet resting, and the gap isn\'t over');

    now = 1000 + ANIMATION_REST_MS;
    assert.isTrue(pacer.isResting(now));
    assert.isTrue(pacer.isDue(now), 'the frame that settles what moves');
    pacer.animated(now);
    pacer.tick(16.7);

    assert.isFalse(pacer.isDue(now + 50));
    assert.isFalse(pacer.isDue(now + 60000));
    assert.isTrue(pacer.isResting(now + 60000));
  });

  it('goes on when something is drawn again', () => {
    pacer.changed(1000);
    const later = 1000 + ANIMATION_REST_MS + 5000;
    pacer.animated(later);         // settled
    assert.isFalse(pacer.isDue(later + 1000));

    pacer.changed(later + 1000);   // the pointer is over something else
    assert.isFalse(pacer.isResting(later + 1000));
    assert.isFalse(pacer.isDue(later + 1000));
    assert.isTrue(pacer.isDue(later + 1000 + ANIMATION_MS));

    // ..and rests again after as long, with a frame that settles it again
    const again = later + 1000 + ANIMATION_REST_MS;
    assert.isTrue(pacer.isDue(again));
    pacer.animated(again);
    assert.isFalse(pacer.isDue(again + 50));
  });

  it('settles only with a frame that was drawn while resting', () => {
    pacer.changed(1000);
    pacer.animated(1000 + ANIMATION_REST_MS - 10);     // the last one that moves
    assert.isTrue(pacer.isDue(1000 + ANIMATION_REST_MS), 'no gap to wait: the rest begins now');
  });

  it('rests before anything was drawn, and after a reset', () => {
    assert.isTrue(pacer.isResting(1000));
    pacer.changed(1000);
    pacer.animated(1050);
    pacer.tick(100);
    pacer.reset();
    assert.strictEqual(pacer.gap, ANIMATION_MS);
    assert.isTrue(pacer.isResting(1100));
  });
});
