import * as PIXI from 'pixi.js';

import { AbstractUiSection } from '../AbstractUiSection.js';
import { uiTooltip } from '../tooltip.js';
import { uiCombobox } from '../combobox.js';
import { utilNoAuto } from '../../util/util.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


// This was an experiment that is currently commented out and won't work.
// We'd need to replace the "ColorSystem" with something more permanent.
export class UiSectionColorblindModeOptions extends AbstractUiSection {
  protected _mapDataContainer: any;
  protected _comboData: any[];
  protected _filtersObject: any;
  protected _colorblindCombo: any;
  protected _checkboxState: any;

  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'preferences-colorblind-mode-options');

    const colors = context.systems.colors as any;
    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;

    this._mapDataContainer = gfx.scene!.groups.get('basemap');
    this._comboData = [{ title: 'default', value: l10n.t('preferences.colorblind_options.default') }];

    // colorblind filters
    const protanopiaFilter = new PIXI.ColorMatrixFilter();
    const deuteranopiaFilter = new PIXI.ColorMatrixFilter();
    const tritanopiaFilter = new PIXI.ColorMatrixFilter();
    this._filtersObject = {
      'Protanopia': protanopiaFilter,
      'Deuteranopia': deuteranopiaFilter,
      'Tritanopia': tritanopiaFilter
    };

    // color matrices
    const protanopiaMatrix = colors?.protanopiaMatrix;
    const deuteranopiaMatrix = colors?.deuteranopiaMatrix;
    const tritanopiaMatrix = colors?.tritanopiaMatrix;

    // apply color matrices to filters
    protanopiaFilter.matrix = protanopiaMatrix;
    deuteranopiaFilter.matrix = deuteranopiaMatrix;
    tritanopiaFilter.matrix = tritanopiaMatrix;

    this._colorblindCombo = uiCombobox(context, 'colorblind-mode-options');
    this._checkboxState = false;

    this._loadComboBoxData();
  }


  /**
   * The section's heading label.
   * @return Localized section title (HTML)
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.tHtml('preferences.colorblind_options.title');
  }


  /**
   * Populates the combobox data from the available colorblind modes.
   * @return The combobox data list
   */
  protected _loadComboBoxData(): any[] {
    const l10n = this.context.systems.l10n!;

    const colorblindModes = Object.keys(this._filtersObject);
    for (const title of colorblindModes) {
      const k = title.toLowerCase();
      this._comboData.push({
        title: k,
        value: l10n.t(`preferences.colorblind_options.${k}`),
      });
    }
    return this._comboData;
  }


  /**
   * Renders the colorblind-mode picker into the disclosure body.
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const context = this.context;
    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;

    const update = (): void => {
      $selection.selectAll('.preferences-colorblind-mode-options-item')
        .classed('active', (this._checkboxState === 'true'))
        .select('input')
        .property('checked', (this._checkboxState === 'true'));
    };

    // enter
    const $$colorOptionsListEnter = $selection.selectAll('.preferences-colorblind-mode-options-list')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'layer-list preferences-colorblind-mode-options-list')
      .call(uiTooltip(context)
        .title(l10n.tHtml('preferences.colorblind_options.tooltip')));


    const $$pickerCombo = $$colorOptionsListEnter.append('div');

    $$pickerCombo.append('input')
      .attr('class', 'color-select')
      .call(utilNoAuto)
      .call(this._colorblindCombo)
      .on('blur change', (d3_event: any) => {
        const element = d3_event.currentTarget;
        const val = element.value;
        if (val in this._filtersObject && val !== 'Default') {
          const filterToApply = this._filtersObject[val];
          this._mapDataContainer.filters = [filterToApply];
        } else {
          this._mapDataContainer.filters = [];
        }
        gfx.immediateRedraw();
      });

    this._colorblindCombo.data(this._comboData);

    // Set localized placeholder on the update selection so it re-localizes on language change.
    $selection.select('.color-select')
      .attr('placeholder', l10n.t('preferences.colorblind_options.placeholder'));

    update();
  }
}
