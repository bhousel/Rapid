import { selection } from 'd3-selection';
import { UiField } from '../UiField.ts';
import { utilGetDimensions } from '../../util/dimensions.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { UiFieldOptions } from '../UiField.ts';


/**
 * This UI component displays a lanes field.
 * NOTE:  This is an experiment that is currently not implemented!
 */
export class UiFieldLanes extends UiField {
  public static supportsMultiselection = false;

  // D3 selections
  public $parent: D3Selection | null;


  /**
   * @constructor
   * @param context - Global shared application context
   * @param presetField - The preset field definition this field renders
   * @param entityIDs - The entities this field applies to
   * @param options - Field display options
   */
  public constructor(context: Context, presetField: Field, entityIDs: EntityID[] = [], options: Partial<UiFieldOptions> = {}) {
    super(context, presetField, entityIDs, options);

    // D3 selections
    this.$parent = null;

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

    const context = this.context;

    const LANE_WIDTH = 40;
    const LANE_HEIGHT = 200;

    const graph = context.systems.editor!.staging.graph;
    const lanesData = (graph.entity(this.entityIDs[0]) as any).lanes();

    if (!context.container().select('.inspector-wrap.inspector-hidden').empty() || !$parent.node().parentNode) {
      $parent.call(this._detach);
      return;
    }

    let $wrap: D3Selection = $parent.selectAll('.form-field-input-wrap')
      .data([0]);

    $wrap = $wrap.enter()
      .append('div')
      .attr('class', 'form-field-input-wrap form-field-input-' + this.type)
      .merge($wrap);

    let $surface: D3Selection = $wrap.selectAll('.surface')
      .data([0]);

    const d = utilGetDimensions($wrap);
    const freeSpace = d[0] - lanesData.lanes.length * LANE_WIDTH * 1.5 + LANE_WIDTH * 0.5;

    $surface = $surface.enter()
      .append('svg')
      .attr('width', d[0])
      .attr('height', 300)
      .attr('class', 'surface')
      .merge($surface);


    let $lanes: D3Selection = $surface.selectAll('.lanes')
      .data([0]);

    $lanes = $lanes.enter()
      .append('g')
      .attr('class', 'lanes')
      .merge($lanes);

    $lanes
      .attr('transform', function () {
        return 'translate(' + (freeSpace / 2) + ', 0)';
      });


    let $lane: D3Selection = $lanes.selectAll('.lane')
      .data(lanesData.lanes);

    $lane.exit()
      .remove();

    const $$lane = $lane.enter()
      .append('g')
      .attr('class', 'lane');

    $$lane
      .append('g')
      .append('rect')
      .attr('y', 50)
      .attr('width', LANE_WIDTH)
      .attr('height', LANE_HEIGHT);

    $$lane
      .append('g')
      .attr('class', 'forward')
      .append('text')
      .attr('y', 40)
      .attr('x', 14)
      .text('▲');

    $$lane
      .append('g')
      .attr('class', 'bothways')
      .append('text')
      .attr('y', 40)
      .attr('x', 14)
      .text('▲▼');

    $$lane
      .append('g')
      .attr('class', 'backward')
      .append('text')
      .attr('y', 40)
      .attr('x', 14)
      .text('▼');


    $lane = $lane
      .merge($$lane);

    $lane
      .attr('transform', function (d) {
        return 'translate(' + (LANE_WIDTH * d.index * 1.5) + ', 0)';
      });

    $lane.select('.forward')
      .style('visibility', function (d) {
        return d.direction === 'forward' ? 'visible' : 'hidden';
      });

    $lane.select('.bothways')
      .style('visibility', function (d) {
        return d.direction === 'bothways' ? 'visible' : 'hidden';
      });

    $lane.select('.backward')
      .style('visibility', function (d) {
        return d.direction === 'backward' ? 'visible' : 'hidden';
      });
  }


  /** Updates the field UI to reflect the given entity tags. (no-op for lanes) */
  public syncTags(): void { }

  /** Moves keyboard focus to the field's input. (no-op for lanes) */
  public focus(): void { }

  /** Detaches event handlers from the field. (no-op for lanes) */
  protected _detach(): void { }
}
