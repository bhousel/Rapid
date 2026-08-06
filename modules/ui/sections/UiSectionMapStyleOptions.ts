import { AbstractUiSection } from './AbstractUiSection.ts';
import { uiTooltip } from '../tooltip.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


export class UiSectionMapStyleOptions extends AbstractUiSection {


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'fill-area');

    const map = context.systems.map!;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._drawListItems = this._drawListItems.bind(this);

    map.off('mapchange', this.reRender);
    map.on('mapchange', this.reRender);
  }


  /**
   * The section's heading label.
   * @return Localized section title
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('map_data.style_options');
  }


  /**
   * Renders the area-fill and visual-diff option lists into the disclosure body.
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const map = this.context.systems.map!;

    const isActiveFill = (d: string): boolean => map.areaFillMode === d;
    const setFill = (d3_event: Event, d: string): void => { map.areaFillMode = d as any; };
    const isHighlightChecked = (): boolean => map.highlightEdits;
    const setHighlighted = (d3_event: Event): void => {
      map.highlightEdits = (d3_event.currentTarget as HTMLInputElement).checked;
    };

    const $container: D3Selection = $selection.selectAll('.layer-fill-list')
      .data([0]);

    $container.enter()
      .append('ul')
      .attr('class', 'layer-list layer-fill-list')
      .merge($container)
      .call(this._drawListItems, map.areaFillOptions, 'radio', 'area_fill', setFill, isActiveFill);

    const $container2: D3Selection = $selection.selectAll('.layer-visual-diff-list')
      .data([0]);

    $container2.enter()
      .append('ul')
      .attr('class', 'layer-list layer-visual-diff-list')
      .merge($container2)
      .call(this._drawListItems, ['highlight_edits'], 'checkbox', 'visual_diff', setHighlighted, isHighlightChecked);
  }


  /**
   * Draws a radio/checkbox option list.
   * @param $selection - d3-selection to the list `ul`
   * @param data       - list of option keys to render
   * @param type       - input type ('radio' or 'checkbox')
   * @param name       - localization/input-name prefix
   * @param change     - change handler for the inputs
   * @param active     - predicate: whether an option is currently active
   */
  protected _drawListItems(
    $selection: D3Selection,
    data: string[],
    type: string,
    name: string,
    change: (d3_event: Event, d: string) => void,
    active: (d: string) => boolean
  ): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    let $items: D3Selection = $selection.selectAll('li')
      .data(data);

    // Exit
    $items.exit()
      .remove();

    // Enter
    const $$enter = $items.enter()
      .append('li')
      .call((uiTooltip(context) as any)
        .title((d: string) => l10n.t(`${name}.${d}.tooltip`))
        .shortcut((d: string) => {
          if (d === 'wireframe') return l10n.t('shortcuts.command.wireframe.key');
          if (d === 'highlight_edits') return l10n.t('shortcuts.command.highlight_edits.key');
          return null;
        })
        .placement('top')
      );

    const $$label = $$enter
      .append('label');

    $$label
      .append('input')
      .attr('type', type)
      .attr('name', name)
      .on('change', change);

    $$label
      .append('span')
      .text((d: string) => l10n.t(`${name}.${d}.description`));

    // Update
    $items = $items
      .merge($$enter);

    $items
      .classed('active', active)
      .selectAll('input')
      .property('checked', active)
      .property('indeterminate', false);
  }
}
