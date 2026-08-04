import { EventEmitter } from 'tseep/lib/ee-safe';
import { select as d3_select } from 'd3-selection';
import { roadSpeedUnit } from '@rapideditor/country-coder';

import { uiCombobox } from '../combobox.js';
import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Tags } from './types.ts';


const metricValues = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
const imperialValues = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];


function comboValues(d: any): { value: string; title: string } {
    return {
        value: d.toString(),
        title: d.toString()
    };
}


export class UiFieldRoadspeed extends EventEmitter {
    public context: Context;

    protected _uifield: any;
    public $unitInput: D3Selection;
    public $input: D3Selection;
    protected _tags: Tags;
    protected _isImperial: boolean;
    protected _speedCombo: any;
    protected _unitCombo: any;

    public constructor(context: Context, uifield: any) {
        super();
        this.context = context;
        this._uifield = uifield;

        this.$unitInput = d3_select(null);
        this.$input = d3_select(null);
        this._tags = {};
        this._isImperial = false;

        this._speedCombo = uiCombobox(context, 'roadspeed');
        this._unitCombo = uiCombobox(context, 'roadspeed-unit')
            .data(['km/h', 'mph'].map(comboValues));

        this.render = this.render.bind(this);
        this._change = this._change.bind(this);
        this._changeUnits = this._changeUnits.bind(this);
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


        this.$input = $wrap.selectAll('input.roadspeed-number')
            .data([0]);

        this.$input = this.$input.enter()
            .append('input')
            .attr('type', 'text')
            .attr('class', 'roadspeed-number')
            .attr('id', uifield.uid)
            .call(utilNoAuto)
            .call(this._speedCombo)
            .merge(this.$input);

        this.$input
            .on('change', this._change)
            .on('blur', this._change);

        const loc = uifield.entityExtent.center();
        this._isImperial = roadSpeedUnit(loc) === 'mph';

        this.$unitInput = $wrap.selectAll('input.roadspeed-unit')
            .data([0]);

        this.$unitInput = this.$unitInput.enter()
            .append('input')
            .attr('type', 'text')
            .attr('class', 'roadspeed-unit')
            .call(this._unitCombo)
            .merge(this.$unitInput);

        this.$unitInput
            .on('blur', this._changeUnits)
            .on('change', this._changeUnits);
    }


    /** Toggles between metric and imperial units, then applies the change. */
    protected _changeUnits(): void {
        this._isImperial = utilGetSetValue(this.$unitInput) === 'mph';
        utilGetSetValue(this.$unitInput, this._isImperial ? 'mph' : 'km/h');
        this._setUnitSuggestions();
        this._change();
    }


    /** Updates the speed combobox suggestions to match the current unit system. */
    protected _setUnitSuggestions(): void {
        this._speedCombo.data((this._isImperial ? imperialValues : metricValues).map(comboValues));
        utilGetSetValue(this.$unitInput, this._isImperial ? 'mph' : 'km/h');
    }


    /** Dispatches the current roadspeed value as a tag change. */
    protected _change(): void {
        const context = this.context;
        const uifield = this._uifield;

        const tag: Tags = {};
        const value = (utilGetSetValue(this.$input) as string).trim();
        const key = uifield.key;

        // don't override multiple values with blank string
        if (!value && Array.isArray(this._tags[key])) return;

        if (!value) {
            tag[key] = undefined;
        } else if (isNaN(value as any) || !this._isImperial) {
            tag[key] = context.cleanTagValue(value);
        } else {
            tag[key] = context.cleanTagValue(value + ' mph');
        }

        this.emit('change', tag);
    }


    /**
     * Updates the field UI to reflect the given entity tags.
     * @param tags - The entity tags to display
     */
    public tags(tags: Tags): void {
        const l10n = this.context.systems.l10n!;
        const uifield = this._uifield;

        this._tags = tags;
        const key = uifield.key;

        let value: any = tags[key];
        const isMixed = Array.isArray(value);

        if (!isMixed) {
            if (value && value.indexOf('mph') >= 0) {
                value = parseInt(value, 10).toString();
                this._isImperial = true;
            } else if (value) {
                this._isImperial = false;
            }
        }

        this._setUnitSuggestions();

        (utilGetSetValue(this.$input, typeof value === 'string' ? value : '') as D3Selection)
            .attr('title', isMixed ? (value as string[]).filter(Boolean).join('\n') : null)
            .attr('placeholder', isMixed ? l10n.t('inspector.multiple_values') : uifield.placeholder)
            .classed('mixed', isMixed);
    }


    /** Moves keyboard focus to the field's input. */
    public focus(): void {
        this.$input.node().focus();
    }
}
