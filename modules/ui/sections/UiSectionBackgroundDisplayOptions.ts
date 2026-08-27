import { numClamp } from '@rapid-sdk/math';
import { AbstractUiSection } from './AbstractUiSection.ts';
import { uiIcon } from '../icon.ts';

import type { Context } from '../../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';


const MINVAL = 0;
const MAXVAL = 3;
const SETTINGS = ['brightness', 'contrast', 'saturation', 'sharpness'];


/**
 * `UiSectionBackgroundDisplayOptions` renders the display options for background imagery.
 *  These are slider controls to adjust the brightness, contrast, saturation, sharpness.
 */
export class UiSectionBackgroundDisplayOptions extends AbstractUiSection {
  protected _options: Record<string, number>;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'background-display-options');

    const storedOpacity = context.systems.settings?.get('imagery.opacity') ?? null;

    this._options = {
      brightness: (storedOpacity !== null ? (+storedOpacity) : 1),
      contrast: 1,
      saturation: 1,
      sharpness: 1
    };

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._updateValue = this._updateValue.bind(this);
  }


  /**
   * The section's heading label.
   * @return Localized section title
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('background.display_options');
  }


  /**
   * Clamps and applies a display option value, then re-renders.
   * @param d   - the display option to change (brightness/contrast/saturation/sharpness)
   * @param val - the new value
   */
  protected _updateValue(d: string, val: number): void {
    const context = this.context;
    const imagery = context.systems.imagery!;

    val = numClamp(val, MINVAL, MAXVAL);

    this._options[d] = val;
    if (d === 'brightness') {
      context.systems.settings?.set('imagery.opacity', String(val));
      imagery.brightness = val;
    } else if (d === 'contrast') {
      imagery.contrast = val;
    } else if (d === 'saturation') {
      imagery.saturation = val;
    } else if (d === 'sharpness') {
      imagery.sharpness = val;
    }
    this.renderInner();
  }


  /**
   * Renders the display options sliders into the disclosure body.
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const context = this.context;
    const imagery = context.systems.imagery!;
    const l10n = context.systems.l10n!;

    let $container: D3Selection = $selection.selectAll('.display-options-container')
      .data([0]);

    const $$container = $container.enter()
      .append('div')
      .attr('class', 'display-options-container controls-list');

    // add slider controls
    const $$sliders: D3EnterSelection = $$container.selectAll('.display-control')
      .data(SETTINGS)
      .enter()
      .append('div')
      .attr('class', (d: string) => `display-control display-control-${d}`);

    $$sliders
      .append('h5')
      .text((d: string) => l10n.t(`background.${d}`))
      .append('span')
      .attr('class', (d: string) => `display-option-value display-option-value-${d}`);

    const $$slidersControl = $$sliders
      .append('div')
      .attr('class', 'control-wrap');

    $$slidersControl
      .append('input')
      .attr('class', (d: string) => `display-option-input display-option-input-${d}`)
      .attr('type', 'range')
      .attr('min', MINVAL)
      .attr('max', MAXVAL)
      .attr('step', '0.05')
      .on('input', (d3_event: Event, d: string) => {
        this._updateValue(d, ((d3_event.target as HTMLInputElement).value as any || 1));
      });

    $$slidersControl
      .append('button')
      .attr('title', l10n.t('background.reset'))
      .attr('class', (d: string) => `display-option-reset display-option-reset-${d}`)
      .on('click', (d3_event: MouseEvent, d: string) => {
        if (d3_event.button !== 0) return;  // left click only
        this._updateValue(d, 1);
      })
      .call(uiIcon('#rapid-icon-' + (l10n.isRTL ? 'redo' : 'undo')));

    // reset all button
    $$container
      .append('a')
      .attr('class', 'display-option-resetlink')
      .attr('href', '#')
      .on('click', (d3_event: Event) => {
        d3_event.preventDefault();
        for (const s of SETTINGS) {
          this._updateValue(s, 1);
        }
      });

    // update
    $container = $$container
      .merge($container);

    $container.selectAll('.display-option-input')
      .property('value', (d: string) => this._options[d]);

    $container.selectAll('.display-option-value')
      .text((d: string) => Math.floor(this._options[d] * 100) + '%');

    $container.selectAll('.display-option-reset')
      .classed('disabled', (d: string) => this._options[d] === 1);

    $container.select('.display-option-resetlink')
      .text(l10n.t('background.reset_all'));

    // first time only, set brightness if needed
    if ($$container.size() && this._options.brightness !== 1) {
      imagery.brightness = this._options.brightness;
    }
  }
}
