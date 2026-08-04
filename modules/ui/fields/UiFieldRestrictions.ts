import { EventEmitter } from 'tseep/lib/ee-safe';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


/**
 * The `UiFieldRestrictions` field lets the user view and edit turn restrictions at a
 * highway intersection.
 *
 * NOTE: The interactive mini-map this field used to render was built on the old SVG layer
 * system (`svgLayers`/`svgVertices`/`svgLines`/`svgTurns`), which was removed in favor of Pixi.
 * Until that preview is reimplemented, `render` only creates an empty placeholder container.
 * The field is registered in `uiFields`, but is intentionally not yet instantiated by
 * `UiSectionPresetFields`.
 */
export class UiFieldRestrictions extends EventEmitter {
  public context: Context;

  public static supportsMultiselection = false;

  protected _uifield: any;
  protected _entityIDs: EntityID[];

  /**
   * @param context - Global shared application context
   * @param uifield - The `UiField` wrapper that owns this field internal
   */
  public constructor(context: Context, uifield: any) {
    super();
    this.context = context;
    this._uifield = uifield;

    this._entityIDs = [];

    this.render = this.render.bind(this);
  }


  /**
   * Renders the content into the given selection.
   * This component is handed its target selection by its parent on each render, so it
   *  renders into `$selection` directly rather than capturing `$parent` for re-render.
   * @param $selection - A d3-selection to the HTMLElement this component renders into
   */
  public render($selection: D3Selection): void {
    const uifield = this._uifield;

    let $wrap: D3Selection = $selection.selectAll('.form-field-input-wrap')
      .data([0]);

    $wrap = $wrap.enter()
      .append('div')
      .attr('class', 'form-field-input-wrap form-field-input-' + uifield.type)
      .merge($wrap);

    // todo: reimplement the turn-restriction editor (intersection preview + turn editing) on Pixi.
    // The old SVG layer system it relied on was removed, so for now just render an empty container.
    $wrap.selectAll('.restriction-container')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'restriction-container');
  }


  /**
   * Gets or sets the entity IDs this field is editing.
   * @param val - The entity IDs to set
   */
  public entityIDs(val?: EntityID[]): any {
    this._entityIDs = val as EntityID[];
  }

  /** Updates the field UI to reflect the given entity tags. (no-op until the editor is reimplemented) */
  public tags(): void { }

  /** Moves keyboard focus to the field's input. (no-op until the editor is reimplemented) */
  public focus(): void { }
}


