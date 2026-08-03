import { AbstractIntroChapter } from './AbstractIntroChapter.ts';
import { helpHtml } from './helper.ts';
import { uiModal } from '../modal.js';

import type { Context } from '../../Context.ts';
import type { IntroStep } from './AbstractIntroChapter.ts';
import type { UiCurtain } from './UiCurtain.ts';


/**
 * The "Start Editing" chapter of the walkthrough. Wraps up the tutorial and points out how to get
 * help, view shortcuts, save, and start mapping for real.
 */
export class UiIntroStartEditing extends AbstractIntroChapter {

  /**
   * @param context - Global shared application context
   * @param curtain - The `UiCurtain` used to reveal parts of the UI during the walkthrough
   */
  public constructor(context: Context, curtain: UiCurtain) {
    super(context, curtain);
    this.title = 'intro.startediting.title';
  }


  /** @return The chapter's first step */
  protected _firstStep(): IntroStep {
    return this._showHelpAsync;
  }


  /**
   * Exit the chapter, first removing any keyboard-shortcuts overlay the user may have opened.
   */
  public override exit(): void {
    const container = this.context.container();
    container.selectAll('.shaded').remove();  // in case user opened keyboard shortcuts
    super.exit();
  }


  // "You're now ready to edit OpenStreetMap! You can replay this walkthrough anytime
  // or view more documentation by pressing the help button..."
  // Click Ok to advance
  protected async _showHelpAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    return new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealSelector: '.map-control.help-control',
        tipHtml: helpHtml(context, 'intro.startediting.help'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._shortcutsAsync)
      });
    });
  }


  // "You can view a list of commands along with their keyboard shortcuts by pressing the ? key..."
  // Click Ok to advance
  protected async _shortcutsAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    return new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealSelector: '.map-control.help-control',
        tipHtml: helpHtml(context, 'intro.startediting.shortcuts'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._showSaveAsync)
      });
    });
  }


  // "Don't forget to regularly save your changes!"
  // Click Ok to advance
  protected async _showSaveAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const l10n = context.systems.l10n!;
    const curtain = this._curtain;

    container.selectAll('.shaded').remove();  // in case user opened keyboard shortcuts

    return new Promise<IntroStep>((resolve, reject) => {
      this._rejectStep = reject;
      curtain.reveal({
        revealSelector: '.map-toolbar button.save',
        tipHtml: helpHtml(context, 'intro.startediting.save'),
        buttonText: l10n.t('intro.ok'),
        buttonCallback: () => resolve(this._showStartMappingAsync)
      });
    });
  }


  // "Start mapping!"
  // Click the button to advance
  protected async _showStartMappingAsync(): Promise<IntroStep | void> {
    const context = this.context;
    const container = context.container();
    const l10n = context.systems.l10n!;

    container.selectAll('.shaded').remove();  // in case user opened keyboard shortcuts

    const modalSelection = uiModal(container);
    modalSelection.select('.modal').attr('class', 'modal-splash modal');
    modalSelection.selectAll('.close').remove();

    try {
      return await new Promise<IntroStep | void>((resolve, reject) => {
        this._rejectStep = reject;

        const startbutton = modalSelection.select('.content')
          .attr('class', 'fillL')
          .append('button')
          .attr('class', 'modal-section huge-modal-button')
          .on('click', () => {
            resolve();
            this._done();
          });

        startbutton
          .append('svg')
          .attr('class', 'illustration')
          .append('use')
          .attr('xlink:href', '#rapid-logo-walkthrough');

        startbutton
          .append('h2')
          .html(l10n.tHtml('intro.startediting.start'));
      });
    } finally {
      modalSelection.remove();
    }
  }
}
