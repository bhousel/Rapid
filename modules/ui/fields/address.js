import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';
import { Extent, projWgs84ToWorld, geoSphericalDistance, vecProject } from '@rapid-sdk/math';
import { utilArrayUniqBy } from '@rapid-sdk/util';
import { iso1A2Code } from '@rapideditor/country-coder';
import { uiCombobox } from '../combobox.js';
import { utilGetSetValue, utilNoAuto, utilRebind } from '../../util/index.ts';


export function uiFieldAddress(context, uifield) {
  const assets = context.systems.assets;
  const l10n = context.systems.l10n;
  const spatial = context.systems.spatial;
  const dispatch = d3_dispatch('change');

  let _selection = d3_select(null);
  let _wrap = d3_select(null);

  let _entityIDs = [];
  let _tags;
  let _countryCode;
  let _addressFormats = [{
    format: [
      ['housenumber', 'street'],
      ['city', 'postcode']
    ]
  }];

  assets.loadAssetAsync('address_formats')
    .then(d => {
      _addressFormats = d.addressFormats;
      if (!_selection.empty()) {
        _selection.call(address);  // rerender
      }
    })
    .catch(e => console.error(e));  // eslint-disable-line


  /**
   * Generate a query box for the spatial system, given a center and a padding.
   * @param   loc      - center coordinate (in WGS84 coordinates)
   * @param   padding  - padding disatance (in meters)
   * @returns Box object with `minX`,`minY`,`maxX`,`maxY` properties
   */
  function queryBox(loc, padding) {
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


  function getNearbyStreets() {
    const loc = uifield.entityExtent.center();
    const point = projWgs84ToWorld(loc);
    const box = queryBox(loc, 200);

    const streets = spatial.getDataAtBox('osm-staging', box)
      .map(hit => hit.contents)
      .filter(isAddressableStreet)
      .map(way => {
        // Sort by distance to the addressable streets in the query box.
        // A way will have LineString or Polygon geometry. We can use 'outer' to get these points.
        const line = way.geoms.parts[0]?.world?.outer;
        if (!line) return null;

        const choice = vecProject(point, line);
        return {
          title: way.tags.name,
          value: way.tags.name,
          dist: choice.distance
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.dist - b.dist);

    return utilArrayUniqBy(streets, 'value');

    function isAddressableStreet(d) {
      return d.tags.highway && d.tags.name && d.type === 'way';
    }
  }


  function getNearbyCities() {
    const loc = uifield.entityExtent.center();
    const point = projWgs84ToWorld(loc);
    const box = queryBox(loc, 200);

    const cities = spatial.getDataAtBox('osm-staging', box)
      .map(hit => hit.contents)
      .filter(isAddressableCity)
      .map(d => {
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
      .sort((a, b) => a.dist - b.dist);

    return utilArrayUniqBy(cities, 'value');

    function isAddressableCity(d) {
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
  function getNearbyValues(key) {
    const loc = uifield.entityExtent.center();
    const point = projWgs84ToWorld(loc);
    const box = queryBox(loc, 200);

    const results = spatial.getDataAtBox('osm-staging', box)
      .map(hit => hit.contents)
      .filter(entityHasAddressTag)
      .map(d => {
        // Sort by distance to the center of the addressable OsmEntities in the query box
        const center = d.geoms.world?.extent?.center();
        if (!center) return null;

        return {
          title: d.tags[key],
          value: d.tags[key],
          dist: geoSphericalDistance(point, center)
        };
      })
      .sort((a, b) => a.dist - b.dist);

    return utilArrayUniqBy(results, 'value');

    function entityHasAddressTag(d) {
      return !_entityIDs.includes(d.id) && d.tags[key];
    }
  }


  function updateForCountryCode() {
    if (!_countryCode) return;

    let addressFormat;
    for (const format of _addressFormats) {
      if (!addressFormat && !format.countryCodes) {
        addressFormat = format;   // choose the default format, keep going
      } else if (format.countryCodes.includes(_countryCode)) {
        addressFormat = format;   // choose the country format, stop here
        break;
      }
    }

    const dropdowns = addressFormat.dropdowns || [
      'city', 'county', 'country', 'district', 'hamlet',
      'neighbourhood', 'place', 'postcode', 'province',
      'quarter', 'state', 'street', 'subdistrict', 'suburb'
    ];

    const widths = addressFormat.widths || {
      housenumber: 1/3, street: 2/3,
      city: 2/3, state: 1/4, postcode: 1/3
    };

    function row(r) {
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

    let rows = _wrap.selectAll('.addr-row')
      .data(addressFormat.format, d => d.toString());

    rows.exit()
      .remove();

    rows
      .enter()
      .append('div')
      .attr('class', 'addr-row')
      .selectAll('input')
      .data(row)
      .enter()
      .append('input')
      .property('type', 'text')
      .call(updatePlaceholder)
      .attr('class', d => `addr-${d.id}`)
      .call(utilNoAuto)
      .each(addDropdown)
      .style('width', d => (d.width * 100) + '%');


    function addDropdown(d) {
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

    _wrap.selectAll('input')
      .on('blur', change())
      .on('change', change());

    _wrap.selectAll('input:not(.combobox-input)')
      .on('input', change(true));

    if (_tags) updateTags(_tags);
  }


  function address(selection) {
    _selection = selection;

    _wrap = selection.selectAll('.form-field-input-wrap')
      .data([0]);

    _wrap = _wrap.enter()
      .append('div')
      .attr('class', `form-field-input-wrap form-field-input-${uifield.type}`)
      .merge(_wrap);

    const center = uifield.entityExtent.center();
    let countryCode;
    if (context.inIntro) {  // localize the address format for the walkthrough
      countryCode = l10n.t('intro.graph.countrycode');
    } else {
      countryCode = iso1A2Code(center);
    }
    if (countryCode) {
      _countryCode = countryCode.toLowerCase();
      updateForCountryCode();
    }
  }


  function change(onInput) {
    return function() {
      let tagChange = {};
      _wrap.selectAll('input')
        .each((subfield, i, nodes) => {
          const node = nodes[i];
          const key = uifield.key + ':' + subfield.id;
          const value = onInput ? node.value : context.cleanTagValue(node.value);

          // don't override multiple values with blank string
          if (Array.isArray(_tags[key]) && !value) return;

          tagChange[key] = value || undefined;
        });

      dispatch.call('change', this, tagChange, onInput);
    };
  }


  function updatePlaceholder(inputSelection) {
    return inputSelection.attr('placeholder', subfield => {
      const key = `${uifield.key}:${subfield.id}`;
      if (_tags && Array.isArray(_tags[key])) {
        return l10n.t('inspector.multiple_values');
      }

      let placeholderID = `_tagging.presets.fields.${uifield.id}.placeholders.${subfield.id}`;
      if (_countryCode) {
        // Address field placeholders have a special overriding behavior where they sometimes look like
        // `tag!code`, for example `city!vn`, meaning to show this placeholder string only in Vietnam.
        const suffix = `!${_countryCode}`;
        if (l10n.hasTextForStringID(placeholderID + suffix)) {
          placeholderID += suffix;
        }
      }
      return l10n.t(placeholderID);
    });
  }


  function updateTags(tags) {
    utilGetSetValue(_wrap.selectAll('input'), function(subfield) {
        const key = uifield.key + ':' + subfield.id;
        const val = tags[key];
        return typeof val === 'string' ? val : '';
      })
      .attr('title', subfield => {
        const key = uifield.key + ':' + subfield.id;
        const val = tags[key];
        return val && Array.isArray(val) && val.filter(Boolean).join('\n');
      })
      .classed('mixed', subfield => {
        const key = uifield.key + ':' + subfield.id;
        return Array.isArray(tags[key]);
      })
      .call(updatePlaceholder);
  }


  address.entityIDs = function(val) {
    if (!arguments.length) return _entityIDs;
    _entityIDs = val;
    return address;
  };


  address.tags = function(tags) {
    _tags = tags;
    updateTags(tags);
  };


  address.focus = function() {
    let node = _wrap.selectAll('input').node();
    if (node) node.focus();
  };


  return utilRebind(address, dispatch, 'on');
}
