import { selection } from 'd3-selection';
import { UiField } from '../UiField.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { UiFieldOptions } from '../UiField.ts';


/**
 * `UiFieldRestrictions` field lets the user view and edit turn restrictions at a
 * highway intersection.
 *
 * NOTE: The interactive mini-map this field used to render was built on the old SVG layer
 * system (`svgLayers`/`svgVertices`/`svgLines`/`svgTurns`), which was removed in favor of Pixi.
 * Until that preview is reimplemented, `render` only creates an empty placeholder container.
 * The field is registered in `uiFields`, but is intentionally not yet instantiated by
 * `UiSectionPresetFields`.
 */
export class UiFieldRestrictions extends UiField {
  // D3 selections
  public $parent: D3Selection | null;
  public $wrap: D3Selection | null;

  public static supportsMultiselection = false;


  /**
   * @constructor
   * @param context - Global shared application context
   * @param presetField - the original Field tracked by the SchemaSystem
   * @param entityIDs - the entities this field applies to
   * @param options - field display options
   */
  public constructor(context: Context, presetField: Field, entityIDs: EntityID[] = [], options: Partial<UiFieldOptions> = {}) {
    super(context, presetField, entityIDs, options);

    // D3 selections
    this.$parent = null;
    this.$wrap = null;

    this.renderContent = this.renderContent.bind(this);
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public renderContent($parent = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    let $wrap: D3Selection = $parent.selectAll('.form-field-input-wrap')
      .data([0]);

    this.$wrap = $wrap = $wrap.enter()
      .append('div')
      .attr('class', 'form-field-input-wrap form-field-input-' + this.type)
      .merge($wrap);

    // todo: reimplement the turn-restriction editor (intersection preview + turn editing) on Pixi.
    // The old SVG layer system it relied on was removed, so for now just render an empty container.
    $wrap.selectAll('.restriction-container')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'restriction-container');
  }


  /** Updates the field UI to reflect the given entity tags. (no-op until the editor is reimplemented) */
  public syncTags(): void { }

  /** Moves keyboard focus to the field's input. (no-op until the editor is reimplemented) */
  public focus(): void { }
}


