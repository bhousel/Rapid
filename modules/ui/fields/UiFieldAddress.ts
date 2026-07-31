import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';
import { Extent, projWgs84ToWorld, geoSphericalDistance, vecProject } from '@rapid-sdk/math';
import { utilArrayUniqBy } from '@rapid-sdk/util';
import { iso1A2Code } from '@rapideditor/country-coder';
import { uiCombobox } from '../combobox.js';
import { utilGetSetValue, utilNoAuto, utilRebind } from '../../util/index.ts';

import type { Vec2 } from '@rapid-sdk/math';
import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { TagChange, Tags } from './types.ts';


export class UiFieldAddress {
  public context: Context;
  public dispatch: any;
  /** Added at runtime by `utilRebind` */
  public on!: (...args: any[]) => any;

  protected _uifield: any;
  public $parent: D3Selection;
  public $wrap: D3Selection;
  protected _entityIDs: EntityID[];
  protected _tags: Tags;
  protected _countryCode: string | undefined;
  protected _addressFormats: any[];

  public constructor(context: Context, uifield: any) {
    const assets = context.systems.assets!;

    this.context = context;
    this._uifield = uifield;

    this.$parent = d3_select(null);
    this.$wrap = d3_select(null);
    this._entityIDs = [];
    this._tags = {};
    this._countryCode = undefined;
    this._addressFormats = [{
      format: [
        ['housenumber', 'street'],
        ['city', 'postcode']
      ]
    }];

    this.render = this.render.bind(this);
    this._updatePlaceholder = this._updatePlaceholder.bind(this);

    this.dispatch = d3_dispatch('change');
    utilRebind(this as any, this.dispatch, 'on');

    assets.loadAssetAsync('address_formats')
      .then((d: any) => {
        this._addressFormats = d.addressFormats;
        if (!this.$parent.empty()) {
          this.$parent.call(this.render);  // rerender
        }
      })
      .catch((e: any) => console.error(e));  // eslint-disable-line
  }


  /**
   * Generate a query box for the spatial system, given a center and a padding.
   * @param   loc      - center coordinate (in WGS84 coordinates)
   * @param   padding  - padding disatance (in meters)
   * @returns Box object with `minX`,`minY`,`maxX`,`maxY` properties
   */
  protected _queryBox(loc: Vec2, padding: number) {
    const extent = new Extent(loc).padByMeters(padding);

    // Convert the WGS84 extent to a world-coordinate box.
    const bb = extent.bbox();
    const [ax, ay] = projWgs84ToWorld([bb.minX, bb.minY]);
    const [bx, by] = projWgs84ToWorld([bb.maxX, bb.maxY]);
    return {
      minX: Math.min(ax, bx),
      minY: Math.min(ay, by),
      maxX: Math.max(ax, bx),
      maxY: Math.max(ay, by)
    };
  }


  /** Finds nearby streets with names to suggest as `addr:street` values. */
  protected _getNearbyStreets(): any[] {
    const context = this.context;
    const editor = context.systems.editor!;
    const spatial = context.systems.spatial!;
    const uifield = this._uifield;

    const loc = uifield.entityExtent.center();
    const point = projWgs84ToWorld(loc);
    const box = this._queryBox(loc, 200);

    const spatialID = editor.spatialIDForGraph(editor.staging.graph);
    const streets = spatial.getItemsAtBox(spatialID, box)
      .map((hit: any) => hit.contents)
      .filter(isAddressableStreet)
      .map((way: any) => {
        // Sort by distance to the addressable streets in the query box.
        // A way will have LineString or Polygon geometry. We can use 'outer' to get these points.
        const line = way.geoms.parts[0]?.world?.outer;
        if (!line) return null;

        const choice: any = vecProject(point, line);
        return {
          title: way.tags.name,
          value: way.tags.name,
          dist: choice.distance
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.dist - b.dist);

    return utilArrayUniqBy(streets, 'value' as any);

    function isAddressableStreet(d: any): boolean {
      return d.tags.highway && d.tags.name && d.type === 'way';
    }
  }


  /** Finds nearby cities/towns/villages to suggest as `addr:city` values. */
  protected _getNearbyCities(): any[] {
    const context = this.context;
    const editor = context.systems.editor!;
    const spatial = context.systems.spatial!;
    const uifield = this._uifield;

    const loc = uifield.entityExtent.center();
    const point = projWgs84ToWorld(loc);
    const box = this._queryBox(loc, 200);

    const spatialID = editor.spatialIDForGraph(editor.staging.graph);
    const cities = spatial.getItemsAtBox(spatialID, box)
      .map((hit: any) => hit.contents)
      .filter(isAddressableCity)
      .map((d: any) => {
        // Sort by distance to the center of the cities in the query box
        const center = d.geoms.world?.extent?.center();
        if (!center) return null;

        return {
          title: d.tags['addr:city'] || d.tags.name,
          value: d.tags['addr:city'] || d.tags.name,
          dist: geoSphericalDistance(point, center)
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.dist - b.dist);

    return utilArrayUniqBy(cities, 'value' as any);

    function isAddressableCity(d: any): boolean {
      if (d.tags.name) {
        if (d.tags.admin_level === '8' && d.tags.boundary === 'administrative') return true;
        if (d.tags.border_type === 'city') return true;
        if (d.tags.place === 'city' || d.tags.place === 'town' || d.tags.place === 'village') return true;
      }

      if (d.tags['addr:city']) return true;

      return false;
    }
  }


  // Suggest values that are used by other nearby entities
  /**
   * Suggests values for the given address key that are used by nearby entities.
   * @param key - The address tag key (e.g. `addr:postcode`) to gather nearby values for
   * @returns Sorted, de-duplicated suggestion objects
   */
  protected _getNearbyValues(key: string): any[] {
    const context = this.context;
    const editor = context.systems.editor!;
    const spatial = context.systems.spatial!;
    const uifield = this._uifield;
    const entityIDs = this._entityIDs;

    const loc = uifield.entityExtent.center();
    const point = projWgs84ToWorld(loc);
    const box = this._queryBox(loc, 200);

    const spatialID = editor.spatialIDForGraph(editor.staging.graph);
    const results = spatial.getItemsAtBox(spatialID, box)
      .map((hit: any) => hit.contents)
      .filter(entityHasAddressTag)
      .map((d: any) => {
        // Sort by distance to the center of the addressable OsmEntities in the query box
        const center = d.geoms.world?.extent?.center();
        if (!center) return null;

        return {
          title: d.tags[key],
          value: d.tags[key],
          dist: geoSphericalDistance(point, center)
        };
      })
      .sort((a: any, b: any) => a.dist - b.dist);

    return utilArrayUniqBy(results, 'value' as any);

    function entityHasAddressTag(d: any): boolean {
      return !entityIDs.includes(d.id) && d.tags[key];
    }
  }


  /** Rebuilds the address subfield inputs to match the current country's address format. */
  protected _updateForCountryCode(): void {
    const context = this.context;
    const getNearbyStreets = this._getNearbyStreets.bind(this);
    const getNearbyCities = this._getNearbyCities.bind(this);
    const getNearbyValues = this._getNearbyValues.bind(this);

    if (!this._countryCode) return;

    let addressFormat: any;
    for (const format of this._addressFormats) {
      if (!addressFormat && !format.countryCodes) {
        addressFormat = format;   // choose the default format, keep going
      } else if (format.countryCodes.includes(this._countryCode)) {
        addressFormat = format;   // choose the country format, stop here
        break;
      }
    }

    const dropdowns = addressFormat.dropdowns || [
      'city', 'county', 'country', 'district', 'hamlet',
      'neighbourhood', 'place', 'postcode', 'province',
      'quarter', 'state', 'street', 'subdistrict', 'suburb'
    ];

    const widths: Record<string, number> = addressFormat.widths || {
      housenumber: 1/3, street: 2/3,
      city: 2/3, state: 1/4, postcode: 1/3
    };

    function row(r: string[]): any[] {
      // Normalize widths.
      const total = r.reduce((sum, key) => {
        return sum + (widths[key] || 0.5);
      }, 0);

      return r.map(key => {
        return {
          id: key,
          width: (widths[key] || 0.5) / total
        };
      });
    }

    const $rows: D3Selection = this.$wrap.selectAll('.addr-row')
      .data(addressFormat.format, (d: any) => d.toString());

    $rows.exit()
      .remove();

    $rows
      .enter()
      .append('div')
      .attr('class', 'addr-row')
      .selectAll('input')
      .data(row)
      .enter()
      .append('input')
      .property('type', 'text')
      .attr('class', (d: any) => `addr-${d.id}`)
      .call(utilNoAuto)
      .each(addDropdown)
      .style('width', (d: any) => (d.width * 100) + '%');


    function addDropdown(this: any, d: any): void {
      if (!dropdowns.includes(d.id)) return;  // not a dropdown

      const getValues = (d.id === 'street') ? getNearbyStreets
        : (d.id === 'city') ? getNearbyCities
        : getNearbyValues;

      d3_select(this)
        .call(uiCombobox(context, `address-${d.id}`)
          .minItems(1)
          .caseSensitive(true)
          .fetcher(function(value, callback) {
            callback(getValues(`addr:${d.id}`));
          })
        );
    }

    this.$wrap.selectAll('input')
      .on('blur', this._change())
      .on('change', this._change());

    this.$wrap.selectAll('input:not(.combobox-input)')
      .on('input', this._change(true));

    if (this._tags) this._updateTags(this._tags);
  }


  /**
   * Renders the field into the given selection.
   * Captures the selection in `this.$parent` on each render so other methods
   *  can re-render the field in place.
   * @param $selection - A d3-selection to the HTMLElement this field renders into
   */
  public render($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const uifield = this._uifield;

    this.$parent = $selection;

    this.$wrap = $selection.selectAll('.form-field-input-wrap')
      .data([0]);

    this.$wrap = this.$wrap.enter()
      .append('div')
      .attr('class', `form-field-input-wrap form-field-input-${uifield.type}`)
      .merge(this.$wrap);

    const center = uifield.entityExtent.center();
    let countryCode;
    if ((context as any).inIntro) {  // localize the address format for the walkthrough
      countryCode = l10n.t('intro.graph.countrycode');
    } else {
      countryCode = iso1A2Code(center);
    }
    if (countryCode) {
      this._countryCode = countryCode.toLowerCase();
      this._updateForCountryCode();
    }
  }


  /**
   * Returns a change handler that dispatches tag changes from the address subfields.
   * @param onInput - When true, treats the change as a live input event (no tag-value cleaning)
   * @returns An event handler that dispatches the tag change
   */
  protected _change(onInput?: boolean): () => void {
    return () => {
      const context = this.context;
      const uifield = this._uifield;
      const tagChange: TagChange = {};
      this.$wrap.selectAll('input')
        .each((subfield: any, i, nodes) => {
          const node = nodes[i] as HTMLInputElement;
          const key = uifield.key + ':' + subfield.id;
          const value = onInput ? node.value : context.cleanTagValue(node.value);

          // don't override multiple values with blank string
          if (Array.isArray(this._tags[key]) && !value) return;

          tagChange[key] = value || undefined;
        });

      this.dispatch.call('change', this, tagChange, onInput);
    };
  }


  /**
   * Sets localized placeholders on the given address subfield inputs.
   * @param $inputSelection - The input selection to set placeholders on
   * @returns The same selection, for chaining
   */
  protected _updatePlaceholder($inputSelection: D3Selection): D3Selection {
    const l10n = this.context.systems.l10n!;
    const uifield = this._uifield;

    return $inputSelection.attr('placeholder', (subfield: any) => {
      const key = `${uifield.key}:${subfield.id}`;
      if (this._tags && Array.isArray(this._tags[key])) {
        return l10n.t('inspector.multiple_values');
      }

      let placeholderID = `_tagging.presets.fields.${uifield.id}.placeholders.${subfield.id}`;
      if (this._countryCode) {
        // Address field placeholders have a special overriding behavior where they sometimes look like
        // `tag!code`, for example `city!vn`, meaning to show this placeholder string only in Vietnam.
        const suffix = `!${this._countryCode}`;
        if (l10n.hasTextForStringID(placeholderID + suffix)) {
          placeholderID += suffix;
        }
      }
      return l10n.t(placeholderID);
    });
  }


  /**
   * Updates the address subfield inputs to reflect the given tags.
   * @param tags - The entity tags to display
   */
  protected _updateTags(tags: Tags): void {
    const uifield = this._uifield;

    const t: any = tags;
    (utilGetSetValue(this.$wrap.selectAll('input'), function(subfield: any) {
        const key = uifield.key + ':' + subfield.id;
        const val = t[key];
        return typeof val === 'string' ? val : '';
      }) as D3Selection)
      .attr('title', (subfield: any) => {
        const key = uifield.key + ':' + subfield.id;
        const val = t[key];
        return val && Array.isArray(val) && val.filter(Boolean).join('\n');
      })
      .classed('mixed', (subfield: any) => {
        const key = uifield.key + ':' + subfield.id;
        return Array.isArray(t[key]);
      })
      .call(this._updatePlaceholder);
  }


  /**
   * Gets or sets the entity IDs this field is editing.
   * @param val - The entity IDs to set; if omitted, acts as a getter
   * @returns The current entity IDs (getter) or `this` (setter)
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._entityIDs;
    this._entityIDs = val as EntityID[];
    return this;
  }


  /**
   * Updates the field UI to reflect the given entity tags.
   * @param tags - The entity tags to display
   */
  public tags(tags: Tags): void {
    this._tags = tags;
    this._updateTags(tags);
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    const node = this.$wrap.selectAll('input').node() as HTMLElement | null;
    if (node) node.focus();
  }
}
