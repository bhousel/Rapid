import { UiModal } from './UiModal.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiConfirm` component is a simple alert-style modal (header, message, buttons) built on
 * top of `UiModal`. After `show()`, render into `$header` / `$message` and add action buttons;
 * `okButton()` appends a focused "Okay" button that dismisses the dialog.
 */
export class UiConfirm extends UiModal {
  // D3 selections
  public $header: D3Selection | null;
  public $message: D3Selection | null;
  public $buttons: D3Selection | null;


  /**
   * @param context  - Global shared application context
   * @param blocking - if `true`, the dialog cannot be dismissed by clicking away or pressing Esc
   */
  public constructor(context: Context, blocking: boolean = false) {
    super(context, blocking);

    // D3 selections
    this.$header = null;
    this.$message = null;
    this.$buttons = null;

    this.okButton = this.okButton.bind(this);
  }


  /**
   * Shows the confirm dialog.
   */
  public override show(): this {
    super.show();
    if (!this.$modal || !this.$content) return this;   // no parent - called too early?

    this.$modal.classed('modal-alert', true);

    this.$header = this.$content
      .append('div')
      .attr('class', 'modal-section header');

    this.$message = this.$content
      .append('div')
      .attr('class', 'modal-section message-text');

    this.$buttons = this.$content
      .append('div')
      .attr('class', 'modal-section buttons');

    return this;
  }


  /**
   * Appends a focused "Okay" button that dismisses the dialog when clicked.
   * @return `this`
   */
  public okButton(): this {
    const l10n = this.context.systems.l10n;

    this.$buttons
      ?.append('button')
      .attr('class', 'button ok-button action')
      .on('click.confirm', () => this.close())
      .text(l10n?.t('confirm.okay') ?? 'Okay')
      .node()
      ?.focus();

    return this;
  }
}
