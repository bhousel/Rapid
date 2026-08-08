import { select, selection } from 'd3-selection';
import { Extent, projWgs84ToWorld, geoSphericalDistance, vecProject } from '@rapid-sdk/math';
import { utilArrayUniqBy } from '@rapid-sdk/util';
import { iso1A2Code } from '@rapideditor/country-coder';
import { UiCombobox } from '../UiCombobox.ts';
import { UiField } from '../UiField.ts';
import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';

import type { Vec2 } from '@rapid-sdk/math';
import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Field } from '../../lib/index.ts';
import type { OsmEntity } from '../../data/index.ts';
import type { SpatialItem } from '../../core/SpatialSystem.ts';
import type { TagChange, Tags } from './types.ts';
import type { UiFieldOptions } from '../UiField.ts';


interface AddressFormat {
  countryCodes?: string[];
  format: string[][];
  dropdowns?: string[];
  widths?: Record<string, number>;
}

interface AddressSuggestion {
  title: string;
  value: string;
  dist: number;
}

interface AddressSubfield {
  id: string;
  width: number;
}

const DEFAULTFORMAT = {
  format: [
    ['housenumber', 'street'],
    ['city', 'postcode']
  ]
};


/**
 * This UI component displays an address field.
 * It determines the appropriate country code and adjust the subfields to
 * match the address format of the country where the feature is located.
 */
export class UiFieldAddress extends UiField {
  // D3 selections
  public $parent: D3Selection | null;
  public $wrap: D3Selection | null;

  protected _tags: Tags;
  protected _countryCode: string | undefined;
  protected _addressFormats: AddressFormat[];


  /**
   * @constructor
   * @param context - Global shared application context
   * @param presetField - The preset field definition this field renders
   * @param entityIDs - The entities this field applies to
   * @param options - Field display options
   */
  public constructor(context: Context, presetField: Field, entityIDs: EntityID[] = [], options: Partial<UiFieldOptions> = {}) {
    super(context, presetField, entityIDs, options);
    const assets = context.systems.assets!;

    // D3 selections
    this.$parent = null;
    this.$wrap = null;

    this._tags = {};
    this._countryCode = undefined;
    this._addressFormats = [DEFAULTFORMAT];

    this.renderContent = this.renderContent.bind(this);
    this._updatePlaceholder = this._updatePlaceholder.bind(this);

    assets.loadAssetAsync('address_formats')
      .then((d: any) => {
        this._addressFormats = d.addressFormats as AddressFormat[];
        this.renderContent();  // rerender
      })
      .catch((e: unknown) => console.error(e));  // eslint-disable-line
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
    const l10n = context.systems.l10n!;

    this.$wrap = $parent.selectAll('.form-field-input-wrap')
      .data([0]);

    this.$wrap = this.$wrap.enter()
      .append('div')
      .attr('class', `form-field-input-wrap form-field-input-${this.type}`)
      .merge(this.$wrap);

    const center = this.entityExtent!.center();
    let countryCode;
    if (context.inIntro) {  // localize the address format for the walkthrough
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
  protected _getNearbyStreets(): AddressSuggestion[] {
    const context = this.context;
    const editor = context.systems.editor!;
    const spatial = context.systems.spatial!;

    const loc = this.entityExtent!.center();
    const point = projWgs84ToWorld(loc);
    const box = this._queryBox(loc, 200);

    const spatialID = editor.spatialIDForGraph(editor.staging.graph);
    const streets = (spatial.getItemsAtBox(spatialID, box)
      .map((hit: SpatialItem) => hit.contents as OsmEntity)
      .filter(isAddressableStreet)
      .map((way: OsmEntity) => {
        // Sort by distance to the addressable streets in the query box.
        // A way will have LineString or Polygon geometry. We can use 'outer' to get these points.
        const line = (way as any).geoms.parts[0]?.world?.outer;
        if (!line) return null;

        const choice = vecProject(point, line);
        if (!choice) return null;
        return {
          title: way.tags.name!,
          value: way.tags.name!,
          dist: choice.distance
        };
      })
      .filter(Boolean) as AddressSuggestion[])
      .sort((a: AddressSuggestion, b: AddressSuggestion) => a.dist - b.dist);

    return utilArrayUniqBy(streets, 'value');

    function isAddressableStreet(d: OsmEntity): boolean {
      return !!d.tags.highway && !!d.tags.name && d.type === 'way';
    }
  }


  /** Finds nearby cities/towns/villages to suggest as `addr:city` values. */
  protected _getNearbyCities(): AddressSuggestion[] {
    const context = this.context;
    const editor = context.systems.editor!;
    const spatial = context.systems.spatial!;

    const loc = this.entityExtent!.center();
    const point = projWgs84ToWorld(loc);
    const box = this._queryBox(loc, 200);

    const spatialID = editor.spatialIDForGraph(editor.staging.graph);
    const cities = (spatial.getItemsAtBox(spatialID, box)
      .map((hit: SpatialItem) => hit.contents as OsmEntity)
      .filter(isAddressableCity)
      .map((d: OsmEntity) => {
        // Sort by distance to the center of the cities in the query box
        const center = (d as any).geoms.world?.extent?.center();
        if (!center) return null;

        return {
          title: (d.tags['addr:city'] || d.tags.name)!,
          value: (d.tags['addr:city'] || d.tags.name)!,
          dist: geoSphericalDistance(point, center)
        };
      })
      .filter(Boolean) as AddressSuggestion[])
      .sort((a: AddressSuggestion, b: AddressSuggestion) => a.dist - b.dist);

    return utilArrayUniqBy(cities, 'value');

    function isAddressableCity(d: OsmEntity): boolean {
      if (d.tags.name) {
        if (d.tags.admin_level === '8' && d.tags.boundary === 'administrative') return true;
        if (d.tags.border_type === 'city') return true;
        if (d.tags.place === 'city' || d.tags.place === 'town' || d.tags.place === 'village') return true;
      }

      if (d.tags['addr:city']) return true;

      return false;
    }
  }


  /**
   * Suggests values for the given address key that are used by nearby entities.
   * @param key - The address tag key (e.g. `addr:postcode`) to gather nearby values for
   * @returns Sorted, de-duplicated suggestion objects
   */
  protected _getNearbyValues(key: string): AddressSuggestion[] {
    const context = this.context;
    const editor = context.systems.editor!;
    const spatial = context.systems.spatial!;
    const entityIDs = this.entityIDs;

    const loc = this.entityExtent!.center();
    const point = projWgs84ToWorld(loc);
    const box = this._queryBox(loc, 200);

    const spatialID = editor.spatialIDForGraph(editor.staging.graph);
    const results = (spatial.getItemsAtBox(spatialID, box)
      .map((hit: SpatialItem) => hit.contents as OsmEntity)
      .filter(entityHasAddressTag)
      .map((d: OsmEntity) => {
        // Sort by distance to the center of the addressable OsmEntities in the query box
        const center = (d as any).geoms.world?.extent?.center();
        if (!center) return null;

        return {
          title: d.tags[key]!,
          value: d.tags[key]!,
          dist: geoSphericalDistance(point, center)
        };
      })
      .filter(Boolean) as AddressSuggestion[])
      .sort((a: AddressSuggestion, b: AddressSuggestion) => a.dist - b.dist);

    return utilArrayUniqBy(results, 'value');

    function entityHasAddressTag(d: OsmEntity): boolean {
      return !entityIDs.includes(d.id) && !!d.tags[key];
    }
  }


  /** Rebuilds the address subfield inputs to match the current country's address format. */
  protected _updateForCountryCode(): void {
    if (!this.$wrap) return;   // called too early?

    const context = this.context;
    const getNearbyStreets = this._getNearbyStreets.bind(this);
    const getNearbyCities = this._getNearbyCities.bind(this);
    const getNearbyValues = this._getNearbyValues.bind(this);

    // choose an address format
    let addressFormat: AddressFormat | undefined;
    for (const format of this._addressFormats) {
      const codes = format.countryCodes || [];
      if (!addressFormat && !codes.length) {
        addressFormat = format;   // choose the default format, but keep looking
      } else if (codes.includes(this._countryCode || '')) {
        addressFormat = format;   // choose the country format, stop here
        break;
      }
    }

    // shouldn't happen, by this point we should have a default format or a country format.
    if (!addressFormat) return;

    const dropdowns = addressFormat.dropdowns || [
      'city', 'county', 'country', 'district', 'hamlet',
      'neighbourhood', 'place', 'postcode', 'province',
      'quarter', 'state', 'street', 'subdistrict', 'suburb'
    ];

    const widths: Record<string, number> = addressFormat.widths || {
      housenumber: 1/3, street: 2/3,
      city: 2/3, state: 1/4, postcode: 1/3
    };

    function row(r: string[]): AddressSubfield[] {
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
      .data(addressFormat.format, (d: string[]) => d.toString());

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
      .attr('class', (d: AddressSubfield) => `addr-${d.id}`)
      .call(utilNoAuto)
      .each(addDropdown)
      .style('width', (d: AddressSubfield) => (d.width * 100) + '%');


    function addDropdown(this: HTMLInputElement, d: AddressSubfield): void {
      if (!dropdowns.includes(d.id)) return;  // not a dropdown

      const getValues = (d.id === 'street') ? getNearbyStreets
        : (d.id === 'city') ? getNearbyCities
        : getNearbyValues;

      select(this)
        .call(new UiCombobox(context, `address-${d.id}`)
          .minItems(1)
          .caseSensitive(true)
          .fetcher(function(value, callback) {
            callback(getValues(`addr:${d.id}`));
          })
          .attach
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
   * Returns a change handler that dispatches tag changes from the address subfields.
   * @param onInput - When true, treats the change as a live input event (no tag-value cleaning)
   * @returns An event handler that dispatches the tag change
   */
  protected _change(onInput?: boolean): () => void {
    return () => {
      if (!this.$wrap) return;   // called too early?

      const context = this.context;
      const tagChange: TagChange = {};
      this.$wrap.selectAll('input')
        .each((subfield: AddressSubfield, i, nodes) => {
          const node = nodes[i] as HTMLInputElement;
          const key = this.key + ':' + subfield.id;
          const value = onInput ? node.value : context.cleanTagValue(node.value);

          // don't override multiple values with blank string
          if (Array.isArray(this._tags[key]) && !value) return;

          tagChange[key] = value || undefined;
        });

      this.emit('change', tagChange, onInput);
    };
  }


  /**
   * Sets localized placeholders on the given address subfield inputs.
   * @param $inputSelection - The input selection to set placeholders on
   * @returns The same selection, for chaining
   */
  protected _updatePlaceholder($inputSelection: D3Selection): D3Selection {
    const l10n = this.context.systems.l10n!;

    return $inputSelection.attr('placeholder', (subfield: AddressSubfield) => {
      const key = `${this.key}:${subfield.id}`;
      if (this._tags && Array.isArray(this._tags[key])) {
        return l10n.t('inspector.multiple_values');
      }

      let placeholderID = `_tagging.presets.fields.${this.id}.placeholders.${subfield.id}`;
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
    if (!this.$wrap) return;   // called too early?

    const fieldKey = this.key;

    const t = tags;
    (utilGetSetValue(this.$wrap.selectAll('input'), function(subfield: AddressSubfield) {
        const key = fieldKey + ':' + subfield.id;
        const val = t[key];
        return typeof val === 'string' ? val : '';
      }) as D3Selection)
      .attr('title', (subfield: AddressSubfield) => {
        const key = this.key + ':' + subfield.id;
        const val = t[key];
        return val && Array.isArray(val) && val.filter(Boolean).join('\n');
      })
      .classed('mixed', (subfield: AddressSubfield) => {
        const key = this.key + ':' + subfield.id;
        return Array.isArray(t[key]);
      })
      .call(this._updatePlaceholder);
  }


  /**
   * Updates the field UI to reflect the given entity tags.
   * @param tags - The entity tags to display
   */
  public syncTags(tags: Tags): void {
    this._tags = tags;
    this._updateTags(tags);
  }


  /** Moves keyboard focus to the field's input. */
  public focus(): void {
    if (!this.$wrap) return;   // called too early?

    const node = this.$wrap.selectAll('input').node() as HTMLElement | null;
    if (node) node.focus();
  }
}
