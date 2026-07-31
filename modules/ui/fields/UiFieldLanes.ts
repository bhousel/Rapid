import { dispatch as d3_dispatch } from 'd3-dispatch';

import { utilRebind } from '../../util/rebind.ts';
import { utilGetDimensions } from '../../util/dimensions.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


export class UiFieldLanes {
    public context: Context;
    public dispatch: any;
    /** Added at runtime by `utilRebind` */
    public on!: (...args: any[]) => any;

    public static supportsMultiselection = false;

    protected _uifield: any;
    protected _entityIDs: EntityID[];

    public constructor(context: Context, uifield: any) {
        this.context = context;
        this._uifield = uifield;

        this._entityIDs = [];

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
        const uifield = this._uifield;

        const LANE_WIDTH = 40;
        const LANE_HEIGHT = 200;

        const graph = context.systems.editor!.staging.graph;
        const lanesData = (graph.entity(this._entityIDs[0]) as any).lanes();

        if (!context.container().select('.inspector-wrap.inspector-hidden').empty() || !$selection.node().parentNode) {
            $selection.call(this.off);
            return;
        }

        let $wrap: D3Selection = $selection.selectAll('.form-field-input-wrap')
            .data([0]);

        $wrap = $wrap.enter()
            .append('div')
            .attr('class', 'form-field-input-wrap form-field-input-' + uifield.type)
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


        let $lanesSelection: D3Selection = $surface.selectAll('.lanes')
            .data([0]);

        $lanesSelection = $lanesSelection.enter()
            .append('g')
            .attr('class', 'lanes')
            .merge($lanesSelection);

        $lanesSelection
            .attr('transform', function () {
                return 'translate(' + (freeSpace / 2) + ', 0)';
            });


        let $lane: D3Selection = $lanesSelection.selectAll('.lane')
           .data(lanesData.lanes);

        $lane.exit()
            .remove();

        const $$enter = $lane.enter()
            .append('g')
            .attr('class', 'lane');

        $$enter
            .append('g')
            .append('rect')
            .attr('y', 50)
            .attr('width', LANE_WIDTH)
            .attr('height', LANE_HEIGHT);

        $$enter
            .append('g')
            .attr('class', 'forward')
            .append('text')
            .attr('y', 40)
            .attr('x', 14)
            .text('▲');

        $$enter
            .append('g')
            .attr('class', 'bothways')
            .append('text')
            .attr('y', 40)
            .attr('x', 14)
            .text('▲▼');

        $$enter
            .append('g')
            .attr('class', 'backward')
            .append('text')
            .attr('y', 40)
            .attr('x', 14)
            .text('▼');


        $lane = $lane
            .merge($$enter);

        $lane
            .attr('transform', function(d) {
                return 'translate(' + (LANE_WIDTH * d.index * 1.5) + ', 0)';
            });

        $lane.select('.forward')
            .style('visibility', function(d) {
                return d.direction === 'forward' ? 'visible' : 'hidden';
            });

        $lane.select('.bothways')
            .style('visibility', function(d) {
                return d.direction === 'bothways' ? 'visible' : 'hidden';
            });

        $lane.select('.backward')
            .style('visibility', function(d) {
                return d.direction === 'backward' ? 'visible' : 'hidden';
            });
    }


    /**
     * Gets or sets the entity IDs this field is editing.
     * @param val - The entity IDs to set
     */
    public entityIDs(val?: EntityID[]): any {
        this._entityIDs = val as EntityID[];
    }

    /** Updates the field UI to reflect the given entity tags. (no-op for lanes) */
    public tags(): void {}

    /** Moves keyboard focus to the field's input. (no-op for lanes) */
    public focus(): void {}

    /** Detaches event handlers from the field. (no-op for lanes) */
    public off(): void {}
}
