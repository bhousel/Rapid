import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';

import { uiCombobox } from '../combobox.js';
import { utilGetSetValue, utilNoAuto, utilRebind } from '../../util/index.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Tags } from './types.ts';


function stripcolon(s: string): string {
    return s.replace(':', '');
}


export class UiFieldCycleway {
    public context: Context;
    public dispatch: any;
    /** Added at runtime by `utilRebind` */
    public on!: (...args: any[]) => any;

    protected _uifield: any;
    public $items: D3Selection;
    public $wrap: D3Selection;
    protected _tags: Tags;

    /**
     * @param context - Global shared application context
     * @param uifield - The `UiField` wrapper that owns this field internal
     */
    public constructor(context: Context, uifield: any) {
        this.context = context;
        this._uifield = uifield;

        this.$items = d3_select(null);
        this.$wrap = d3_select(null);
        this._tags = {};

        this.render = this.render.bind(this);
        this._change = this._change.bind(this);

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
        const l10n = context.systems.l10n!;
        const uifield = this._uifield;
        const getOptions = (): any[] => this.options();

        this.$wrap = $selection.selectAll('.form-field-input-wrap')
            .data([0]);

        this.$wrap = this.$wrap.enter()
            .append('div')
            .attr('class', 'form-field-input-wrap form-field-input-' + uifield.type)
            .merge(this.$wrap);


        let $div: D3Selection = this.$wrap.selectAll('ul')
            .data([0]);

        $div = $div.enter()
            .append('ul')
            .attr('class', 'rows rows-table')
            .merge($div);

        const keys = ['cycleway:left', 'cycleway:right'];

        this.$items = $div.selectAll('li')
            .data(keys);

        const $$enter = this.$items.enter()
            .append('li')
            .attr('class', d => 'labeled-input preset-cycleway-' + stripcolon(d));

        const stringBase = `_tagging.presets.fields.${uifield.id}.types`;
        $$enter
            .append('div')
            .attr('class', 'label preset-label-cycleway')
            .attr('for', d => 'preset-input-cycleway-' + stripcolon(d));

        $$enter
            .append('div')
            .attr('class', 'preset-input-cycleway-wrap')
            .append('input')
            .attr('type', 'text')
            .attr('class', d => 'preset-input-cycleway preset-input-' + stripcolon(d))
            .call(utilNoAuto)
            .each(function(this: any, d) {
                d3_select(this)
                    .call(uiCombobox(context, 'cycleway-' + stripcolon(d))
                        .data(getOptions())
                    );
            });

        this.$items = this.$items.merge($$enter);

        // Set localized text on the update selection so it re-localizes on language change.
        this.$items.selectAll('.preset-label-cycleway')
            .html(d => l10n.tHtml(`${stringBase}.${d}`));

        // Update
        this.$wrap.selectAll('.preset-input-cycleway')
            .on('change', this._change)
            .on('blur', this._change);
    }


    /**
     * Handles a change to one of the cycleway inputs and dispatches the tag change.
     * @param d3_event - The triggering DOM event
     * @param key - The cycleway key being changed ('cycleway:left' or 'cycleway:right')
     */
    protected _change(d3_event: Event, key: string): void {
        const context = this.context;

        let newValue: string | undefined = context.cleanTagValue(utilGetSetValue(d3_select(d3_event.currentTarget as any)) as string);

        // don't override multiple values with blank string
        if (!newValue && (Array.isArray(this._tags.cycleway) || Array.isArray(this._tags[key]))) return;

        if (newValue === 'none' || newValue === '') { newValue = undefined; }

        const otherKey = key === 'cycleway:left' ? 'cycleway:right' : 'cycleway:left';
        let otherValue: any = typeof this._tags.cycleway === 'string' ? this._tags.cycleway : this._tags[otherKey];
        if (otherValue && Array.isArray(otherValue)) {
            // we must always have an explicit value for comparison
            otherValue = otherValue[0];
        }
        if (otherValue === 'none' || otherValue === '') { otherValue = undefined; }

        let tag: Tags;

        // If the left and right tags match, use the cycleway tag to tag both
        // sides the same way
        if (newValue === otherValue) {
            tag = {
                cycleway: newValue,
                'cycleway:left': undefined,
                'cycleway:right': undefined
            };
        } else {
            // Always set both left and right as changing one can affect the other
            tag = {
                cycleway: undefined
            };
            tag[key] = newValue;
            tag[otherKey] = otherValue;
        }

        this.dispatch.call('change', this, tag);
    }


    /** Returns the selectable options for this field. */
    public options(): any[] {
        const l10n = this.context.systems.l10n!;
        const uifield = this._uifield;

        const stringBase = `_tagging.presets.fields.${uifield.id}.options.`;
        const opts = uifield.presetField.props.options;
        return opts.map(function(option: string) {
            return {
                title: l10n.t(`${stringBase}.${option}.description`),
                value: option
            };
        });
    }


    /**
     * Updates the field UI to reflect the given entity tags.
     * @param tags - The entity tags to display
     */
    public tags(tags: Tags): void {
        const l10n = this.context.systems.l10n!;
        const uifield = this._uifield;

        this._tags = tags;

        // If cycleway is set, use that instead of individual values
        const commonValue = typeof tags.cycleway === 'string' && tags.cycleway;

        (utilGetSetValue(this.$items.selectAll('.preset-input-cycleway'), function(d: any) {
                if (commonValue) return commonValue;
                return !tags.cycleway && typeof tags[d] === 'string' ? tags[d] : '';
            }) as D3Selection)
            .attr('title', function(d: any) {
                if (Array.isArray(tags.cycleway) || Array.isArray(tags[d])) {
                    let vals: any[] = [];
                    if (Array.isArray(tags.cycleway)) {
                        vals = vals.concat(tags.cycleway);
                    }
                    if (Array.isArray(tags[d])) {
                        vals = vals.concat(tags[d]);
                    }
                    return vals.filter(Boolean).join('\n');
                }
                return null;
            })
            .attr('placeholder', function(d: any) {
                if (Array.isArray(tags.cycleway) || Array.isArray(tags[d])) {
                    return l10n.t('inspector.multiple_values');
                }
                return uifield.placeholder;
            })
            .classed('mixed', function(d: any) {
                return Array.isArray(tags.cycleway) || Array.isArray(tags[d]);
            });
    }


    /** Moves keyboard focus to the field's input. */
    public focus(): void {
        const node = this.$wrap.selectAll('input').node() as HTMLElement | null;
        if (node) node.focus();
    }
}
