import { dispatch as d3_dispatch } from 'd3-dispatch';
import { marked } from 'marked';

import { uiConfirm } from '../confirm.js';
import { utilNoAuto, utilRebind } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiSettingsCustomBackground` renders a modal for entering a custom imagery template.
 * Call `.render($selection)` to open it; emits `change` with the new settings on save.
 */
export class UiSettingsCustomBackground {
  public context: Context;
  public dispatch: any;
  /** Added at runtime by `utilRebind` */
  public on!: (...args: any[]) => any;

  public constructor(context: Context) {
    this.context = context;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);

    this.dispatch = d3_dispatch('change');
    utilRebind(this as any, this.dispatch, 'on');
  }


  /**
   * Renders the content into the given selection.
   * This component is handed its target selection by its parent on each render, so it
   *  renders into `$selection` directly rather than capturing `$parent` for re-render.
   * @param $selection - A d3-selection to the HTMLElement this component renders into
   */
  public render($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const settings = context.systems.settings;

    // keep separate copies of original and current settings
    const _origSettings = { template: settings?.get('imagery.custom[0].template') ?? '' };
    const _currSettings = { ..._origSettings };  // shallow copy

    const modal = uiConfirm(context, $selection).okButton();

    modal
      .classed('settings-modal settings-custom-background', true);

    modal.select('.modal-section.header')
      .append('h3')
      .text(l10n.t('settings.custom_background.header'));

    const prefix = 'settings.custom_background.instructions';
    const info = l10n.t(`${prefix}.info`);
    const wms_label = l10n.t(`${prefix}.wms.tokens_label`);
    const wms_proj = l10n.t(`${prefix}.wms.tokens.proj`);
    const wms_wkid = l10n.t(`${prefix}.wms.tokens.wkid`);
    const wms_dims = l10n.t(`${prefix}.wms.tokens.dimensions`);
    const wms_bbox = l10n.t(`${prefix}.wms.tokens.bbox`);
    const tms_label = l10n.t(`${prefix}.tms.tokens_label`);
    const tms_xyz = l10n.t(`${prefix}.tms.tokens.xyz`);
    const tms_flip = l10n.t(`${prefix}.tms.tokens.flipped_y`);
    const tms_switch = l10n.t(`${prefix}.tms.tokens.switch`);
    const tms_quad = l10n.t(`${prefix}.tms.tokens.quadtile`);
    const tms_scale = l10n.t(`${prefix}.tms.tokens.scale_factor`);
    const example = l10n.t('example');

    const instructions = marked.parse(`
${info}
&nbsp;<br>
&nbsp;<br>
#### ${wms_label}
* ${wms_proj}
* ${wms_wkid}
* ${wms_dims}
* ${wms_bbox}
&nbsp;<br>
&nbsp;<br>
#### ${tms_label}
* ${tms_xyz}
* ${tms_flip}
* ${tms_switch}
* ${tms_quad}
* ${tms_scale}
&nbsp;<br>
&nbsp;<br>
#### ${example}
* \`https://{switch:a,b,c}.tile.openstreetmap.org/{zoom}/{x}/{y}.png\`
`) as string;


    const $textSection = modal.select('.modal-section.message-text');

    $textSection
      .append('div')
      .attr('class', 'instructions-template')
      .html(instructions);

    $textSection
      .append('textarea')
      .attr('class', 'field-template')
      .attr('placeholder', l10n.t('settings.custom_background.template.placeholder'))
      .call(utilNoAuto)
      .property('value', _currSettings.template);


    // insert a cancel button
    const $buttonSection = modal.select('.modal-section.buttons');

    $buttonSection
      .insert('button', '.ok-button')
      .attr('class', 'button cancel-button secondary-action')
      .text(l10n.t('confirm.cancel'));

    // restore the original template
    const clickCancel = (d3_event: Event): void => {
      $textSection.select('.field-template').property('value', _origSettings.template);
      settings?.set('imagery.custom[0].template', _origSettings.template);
      (d3_event.currentTarget as HTMLElement).blur();
      modal.close();
    };

    // accept the current template
    const clickSave = (d3_event: Event): void => {
      _currSettings.template = $textSection.select('.field-template').property('value');
      settings?.set('imagery.custom[0].template', _currSettings.template);
      (d3_event.currentTarget as HTMLElement).blur();
      modal.close();
      this.dispatch.call('change', this, _currSettings);
    };

    $buttonSection.select('.cancel-button')
      .on('click.cancel', clickCancel);

    $buttonSection.select('.ok-button')
      .on('click.save', clickSave);
  }
}
