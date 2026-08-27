import { AbstractUiSection } from './AbstractUiSection.ts';
import { UiTooltip } from '../UiTooltip.ts';
import { UiCombobox } from '../UiCombobox.ts';
import { utilNoAuto } from '../../util/util.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * `UiSectionColorSelection` renders a radio button to select the map theme.
 * The user can switch the map between regular and high contrast.
 * This was an experiment that is currently commented out and won't work.
 * We'd need to replace the "ColorSystem" with something more permanent.
 */
export class UiSectionColorSelection extends AbstractUiSection {
  protected _comboData: any[];
  protected _colorCombo: any;
  protected _colorSelectedId: any;
  protected _checkboxState: any;

  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'preferences-color-selection');

    const colors = context.systems.colors as any;

    this._comboData = [];
    this._colorCombo = new UiCombobox(context, 'color-selection');
    this._colorSelectedId = null;
    this._checkboxState = false;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._loadComboBoxData = this._loadComboBoxData.bind(this);

    // Add or replace event handlers
    colors?.off('colorsloaded', this._loadComboBoxData);
    colors?.on('colorsloaded', this._loadComboBoxData);
  }


  /**
   * The section's heading label.
   * @return Localized section title (HTML)
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.tHtml('preferences.color_selection.title');
  }


  /**
   * Populates the combobox data from the available color schemes.
   * @return The combobox data list
   */
  protected _loadComboBoxData(): any[] {
    const context = this.context;
    const colors = context.systems.colors as any;
    const l10n = context.systems.l10n!;

    const colorSchemeKeys = Object.keys(colors?.getAllColorSchemes() ?? {});

    for (const k of colorSchemeKeys) {
      this._comboData.push({
        title: k,
        value: l10n.t(`preferences.color_selection.${k}`)
      });
    }
    return this._comboData;
  }


  /**
   * Renders the color-scheme picker into the disclosure body.
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const context = this.context;
    const colors = context.systems.colors as any;
    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;

    const getColorSchemeName = (val: any): any => {
      for (const d of this._comboData) {
        if (d.value === val) {
          return d.title;
        }
      }
    };

    const update = (): void => {
      $selection.selectAll('.preferences-color-selection-item')
        .classed('active', (this._checkboxState === 'true'))
        .select('input')
        .property('checked', (this._checkboxState === 'true'));
    };

    // enter
    const $$colorOptionsListEnter = $selection.selectAll('.preferences-color-selection-list')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'layer-list preferences-color-selection-list')
      .call(new UiTooltip(context)
        .title(l10n.tHtml('preferences.color_selection.tooltip')).attach);


    const $$pickerCombo = $$colorOptionsListEnter.append('div');

    $$pickerCombo.append('input')
      .attr('class', 'color-select')
      .call(utilNoAuto)
      .call(this._colorCombo.attach)
      .on('blur change', (d3_event: any) => {
        const element = d3_event.currentTarget;
        const val = (element && element.value) || '';
        const data = this._colorCombo.data();
        if (data.some((item: any) => item.value === val)) {
          this._colorSelectedId = val;
          const colorSchemeName = getColorSchemeName(this._colorSelectedId);

          if (colors?.currentColorScheme !== colorSchemeName) {
            colors?.setColorScheme(colorSchemeName);
            gfx.scene!.dirtyScene();
            gfx.deferredRedraw();
          }

        } else {
          d3_event.currentTarget.value = '';
          this._colorSelectedId = null;
        }
      });

    this._colorCombo.data(this._comboData);

    // Set localized placeholder on the update selection so it re-localizes on language change.
    $selection.select('.color-select')
      .attr('placeholder', l10n.t('preferences.color_selection.placeholder'));

    update();
  }
}
