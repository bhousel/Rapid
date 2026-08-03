import { Extent } from '@rapid-sdk/math';

import { AbstractIntroChapter } from './AbstractIntroChapter.ts';
import { helpHtml } from './helper.ts';

import type { Context } from '../../Context.ts';
import type { IntroStep } from './AbstractIntroChapter.ts';
import type { UiCurtain } from './UiCurtain.ts';


const townHallExtent = new Extent([-85.63654, 41.94290], [-85.63632, 41.94307]);


/**
 * The "Welcome" chapter of the walkthrough. Introduces the walkthrough and how to navigate it.
 */
export class UiIntroWelcome extends AbstractIntroChapter {

  /**
   * @param context - Global shared application context
   * @param curtain - The `UiCurtain` used to reveal parts of the UI during the walkthrough
   */
  public constructor(context: Context, curtain: UiCurtain) {
    super(context, curtain);
    this.title = 'intro.welcome.title';
  }


  /** @return The chapter's first step */
  protected _firstStep(): IntroStep {
    return this._welcomeAsync;
  }


  // "Welcome! This walkthrough will teach you the basics of editing on OpenStreetMap."
  // Click Ok to advance
  protected async _welcomeAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const curtain = this._curtain;

    await map.setMapParamsAsync(townHallExtent.center(), 19, 0);

    return new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealSelector: '.intro-nav-wrap .chapter-welcome',
        tipHtml: helpHtml(context, 'intro.welcome.welcome'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._practiceAsync)
      });
    });
  }


  // "All of the data in this walkthrough is just for practicing...
  // Click Ok to advance
  protected async _practiceAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    return new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealSelector: '.intro-nav-wrap .chapter-welcome',
        tipHtml: helpHtml(context, 'intro.welcome.practice'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._wordsAsync)
      });
    });
  }


  // "When we introduce a new word, we'll use *italics*."
  // Click Ok to advance
  protected async _wordsAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    return new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealSelector: '.intro-nav-wrap .chapter-welcome',
        tipHtml: helpHtml(context, 'intro.welcome.words'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._chaptersAsync)
      });
    });
  }


  // "You can use the buttons below to skip chapters at any time..."
  // Click on Navigation (or another) chapter to advance
  protected async _chaptersAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    this._done();
    curtain.reveal({
      revealSelector: '.intro-nav-wrap .chapter-navigation',
      tipHtml: helpHtml(context, 'intro.welcome.chapters', { next: l10n.t('intro.navigation.title') })
    });
    // chapter is done
  }
}
