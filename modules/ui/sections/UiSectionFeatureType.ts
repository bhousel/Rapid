import { utilArrayIdentical } from '@rapid-sdk/util';

import { AbstractUiSection } from '../AbstractUiSection.js';
import { uiTooltip } from '../tooltip.js';
import { UiPresetIcon } from '../UiPresetIcon.js';
import { UiTagReference } from '../UiTagReference.js';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Preset } from '../../lib/Preset.ts';


export class UiSectionFeatureType extends AbstractUiSection {
  protected _entityIDs: EntityID[];
  protected _presets: Preset[];
  protected _tagReference: UiTagReference | undefined;

  public constructor(context: Context) {
    super(context, 'feature-type');
    this._entityIDs = [];
    this._presets = [];
    this._tagReference = undefined;
  }


  /**
   * The disclosure heading label — "Feature Type".
   * @return Localized heading text
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('inspector.feature_type');
  }


  /**
   * Gets or sets the entity IDs being inspected.
   * @param val - the new entity IDs, or omit to get the current value
   * @return the current entity IDs (getter) or `this` (setter)
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._entityIDs;
    this._entityIDs = val as EntityID[];
    return this;
  }


  /**
   * Gets or sets the presets to display, rebuilding the tag reference as needed.
   * @param val - the new presets, or omit to get the current value
   * @return the current presets (getter) or `this` (setter)
   */
  public presets(val?: Preset[]): any {
    if (!arguments.length) return this._presets;

    // don't reload the same preset
    if (!utilArrayIdentical(val!, this._presets)) {
      this._presets = val!;

      if (this._presets.length === 1) {
        this._tagReference = new UiTagReference(this.context, this._presets[0].reference()).showing(false);
      }
    }

    return this;
  }


  /**
   * Renders the preset button, icon, name, and tag reference.
   * @param $selection - A d3-selection to the HTMLElement this content renders into
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    $selection.classed('preset-list-item', true);
    $selection.classed('mixed-types', this._presets.length > 1);

    const $$presetButtonWrap = $selection
      .selectAll('.preset-list-button-wrap')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'preset-list-button-wrap');

    const $$presetButton = $$presetButtonWrap
      .append('button')
      .attr('class', 'preset-list-button preset-reset')
      .call(uiTooltip(context)
        .title(l10n.t('inspector.back_tooltip'))
        .placement('bottom')
      );

    $$presetButton.append('div')
      .attr('class', 'preset-icon-container');

    $$presetButton
      .append('div')
      .attr('class', 'label')
      .append('div')
      .attr('class', 'label-inner');

    $$presetButtonWrap.append('div')
      .attr('class', 'accessory-buttons');

    let $tagReferenceBodyWrap: D3Selection = $selection
      .selectAll('.tag-reference-body-wrap')
      .data([0]);

    $tagReferenceBodyWrap = $tagReferenceBodyWrap
      .enter()
      .append('div')
      .attr('class', 'tag-reference-body-wrap')
      .merge($tagReferenceBodyWrap);

    // update header
    if (this._tagReference) {
      $selection.selectAll('.preset-list-button-wrap .accessory-buttons')
        .style('display', this._presets.length === 1 ? null : 'none')
        .call(this._tagReference.button);

      $tagReferenceBodyWrap
        .style('display', this._presets.length === 1 ? null : 'none')
        .call(this._tagReference.body);
    }

    $selection.selectAll('.preset-reset')
      .on('click', (d3_event: Event) => {
         this.emit('choose', this._presets);
      })
      .on('pointerdown pointerup mousedown mouseup', function(d3_event: Event) {
        d3_event.preventDefault();
        d3_event.stopPropagation();
      });

    const geometries = this._entityGeometries();
    $selection.select('.preset-list-item button')
      .call(new UiPresetIcon(context)
        .geometry(geometries.length === 1 ? geometries[0] : geometries)
        .preset(this._presets.length === 1 ? this._presets[0] : this._presets)
        .render
      );

    const names = this._presets.length === 1 ? [
      this._presets[0].name,
      this._presets[0].subtitle()
    ].filter(Boolean) : [l10n.t('inspector.multiple_types')];

    const $label = $selection.select('.label-inner');
    const $nameparts = $label.selectAll('.namepart')
      .data(names, (d: string) => d);

    $nameparts.exit()
      .remove();

    $nameparts
      .enter()
      .append('div')
      .attr('class', 'namepart')
      .text(d => d);
  }


  /**
   * Returns the distinct geometries of the selected entities, most common first.
   * @return the geometry strings
   */
  protected _entityGeometries(): string[] {
    const editor = this.context.systems.editor!;
    const counts: Record<string, number> = {};

    const graph = editor.staging.graph;
    for (const entityID of this._entityIDs) {
      const entity = graph.entity(entityID);
      const geometry = entity.geometry(graph);
      if (!counts[geometry]) counts[geometry] = 0;
      counts[geometry] += 1;
    }

    return Object.keys(counts)
      .sort((geom1, geom2) => counts[geom2] - counts[geom1]);
  }
}
