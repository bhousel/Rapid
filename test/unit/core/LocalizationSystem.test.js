import { beforeEach, describe, it } from 'node:test';
import { assert } from 'chai';
import * as Rapid from '../../../modules/headless.js';


describe('LocalizationSystem', () => {

  const context = new Rapid.MockContext();
  let _l10n;


  beforeEach(() => {
    _l10n = new Rapid.LocalizationSystem(context);
    _l10n._cache = {
      en: {
        core: {
          inspector: {
            display_name: {
              network_ref_name: '{network} {ref}: {name}',
              ref_name: '{ref}: {name}',
              direction: '{direction}',
              network: '{network}',
              from_to: 'from {from} to {to}',
              from_to_via: 'from {from} to {to} via {via}',
              network_direction: '{network} {direction}',
              network_from_to: '{network} from {from} to {to}',
              network_from_to_via: '{network} from {from} to {to} via {via}',
              ref: '{ref}',
              ref_direction: '{ref} {direction}',
              ref_from_to: '{ref} from {from} to {to}',
              ref_from_to_via: '{ref} from {from} to {to} via {via}',
              network_ref: '{network} {ref}',
              network_ref_direction: '{network} {ref} {direction}',
              network_ref_from_to: '{network} {ref} from {from} to {to}',
              network_ref_from_to_via: '{network} {ref} from {from} to {to} via {via}'
            }
          },
          units: {
            feet: '{quantity} ft',
            miles: '{quantity} mi',
            square_feet: '{quantity} sq ft',
            square_miles: '{quantity} sq mi',
            acres: '{quantity} ac',
            meters: '{quantity} m',
            kilometers: '{quantity} km',
            square_meters: '{quantity} m²',
            square_kilometers: '{quantity} km²',
            hectares: '{quantity} ha',
            area_pair: '{area1} ({area2})',
            arcdegrees: '{quantity}°',
            arcminutes: '{quantity}′',
            arcseconds: '{quantity}″',
            north: 'N',
            south: 'S',
            east: 'E',
            west: 'W',
            coordinate: '{coordinate}{direction}',
            coordinate_pair: '{latitude}, {longitude}',
            year_month_day: 'YYYY-MM-DD'
          }
        }
      }
    };
  });


  describe('displayName', () => {
    it('returns the name if tagged with a name', () => {
      const tags = { name: 'East Coast Greenway' };
      assert.strictEqual(_l10n.displayName(tags), 'East Coast Greenway');
    });

    it('returns just the name for non-routes', () => {
      const tags = { name: 'Abyssinian Room', ref: '260-115' };
      assert.strictEqual(_l10n.displayName(tags), 'Abyssinian Room');
    });

    it('returns the name and the ref for routes', () => {
      const tags1 = { name: 'Lynfield Express', ref: '25L', route: 'bus' };
      assert.strictEqual(_l10n.displayName(tags1), '25L: Lynfield Express');
      const tags2 = { name: 'Kāpiti Expressway', ref: 'SH1', route: 'road' };
      assert.strictEqual(_l10n.displayName(tags2), 'SH1: Kāpiti Expressway');
    });

    it('returns the name, ref, and network for routes', () => {
      const tags = { name: 'Lynfield Express', ref: '25L', network: 'AT', route: 'bus' };
      assert.strictEqual(_l10n.displayName(tags), 'AT 25L: Lynfield Express');
    });

    it('does not use the network tag if the hideNetwork argument is true', () => {
      const tags1 = { name: 'Lynfield Express', ref: '25L', network: 'AT', route: 'bus' };
      assert.strictEqual(_l10n.displayName(tags1, true), '25L: Lynfield Express');
      const tags2 = { network: 'SORTA', ref: '3X' };
      assert.strictEqual(_l10n.displayName(tags2, true), '3X');
    });

    it('distinguishes unnamed features by ref', () => {
      const tags = { ref: '66' };
      assert.strictEqual(_l10n.displayName(tags), '66');
    });

    it('distinguishes unnamed features by network or cycle_network', () => {
      const tags1 = { network: 'SORTA', ref: '3X' };
      assert.strictEqual(_l10n.displayName(tags1), 'SORTA 3X');
      const tags2 = { network: 'ncn', cycle_network: 'US:US', ref: '76' };
      assert.strictEqual(_l10n.displayName(tags2), 'US:US 76');
    });

    it('distinguishes unnamed routes by direction', () => {
      const tags1 = { network: 'US:US', ref: '66', direction: 'west', route: 'road' };
      assert.strictEqual(_l10n.displayName(tags1), 'US:US 66 west');
      const tags2 = { network: 'Marguerite', ref: 'X', direction: 'anticlockwise', route: 'bus' };
      assert.strictEqual(_l10n.displayName(tags2), 'Marguerite X anticlockwise');
    });

    it('distinguishes unnamed routes by waypoints', () => {
      const tags1 = { network: 'SORTA', ref: '3X', from: 'Downtown', route: 'bus' };
      assert.strictEqual(_l10n.displayName(tags1), 'SORTA 3X');
      const tags2 = { network: 'SORTA', ref: '3X', to: 'Kings Island', route: 'bus' };
      assert.strictEqual(_l10n.displayName(tags2), 'SORTA 3X');
      const tags3 = {network: 'SORTA', ref: '3X', via: 'Montgomery', route: 'bus' };
      assert.strictEqual(_l10n.displayName(tags3), 'SORTA 3X');

      // Green Line: Old Ironsides => Winchester
      const tags4 = { network: 'VTA', ref: 'Green', from: 'Old Ironsides', to: 'Winchester', route: 'bus' };
      assert.strictEqual(_l10n.displayName(tags4), 'VTA Green from Old Ironsides to Winchester');

      // BART Yellow Line: Antioch => Pittsburg/Bay Point => SFO Airport => Millbrae
      const tags5 = { network: 'BART', ref: 'Yellow', from: 'Antioch', to: 'Millbrae', via: 'Pittsburg/Bay Point;San Francisco International Airport', route: 'subway' };
      assert.strictEqual(_l10n.displayName(tags5), 'BART Yellow from Antioch to Millbrae via Pittsburg/Bay Point;San Francisco International Airport');
    });
  });

  describe('dmsMatcher', () => {
    it('parses D M SS format', () => {
      const result = _l10n.dmsMatcher('35 11 10.1 , 136 49 53.8');
      assert.closeTo(result[0],  35.18614, 0.00001);
      assert.closeTo(result[1], 136.83161, 0.00001);
    });
    it('parses D M SS format, with negative value', () => {
      const result = _l10n.dmsMatcher('-35 11 10.1 , -136 49 53.8');
      assert.closeTo(result[0],  -35.18614, 0.00001);
      assert.closeTo(result[1], -136.83161, 0.00001);
    });

    it('parses D MM format', () => {
      const result = _l10n.dmsMatcher('35 11.1683 , 136 49.8966');
      assert.closeTo(result[0],  35.18614, 0.00001);
      assert.closeTo(result[1], 136.83161, 0.00001);
    });
    it('parses D MM format, with negative value', () => {
      const result = _l10n.dmsMatcher('-35 11.1683 , -136 49.8966');
      assert.closeTo(result[0],  -35.18614, 0.00001);
      assert.closeTo(result[1], -136.83161, 0.00001);
    });

    it('handles invalid input', () => {
      const result = _l10n.dmsMatcher('!@#$');
      assert.isNull(result);
    });
  });

  describe('dmsCoordinatePair', () => {
    it('formats coordinate pair', () => {
      const result = _l10n.dmsCoordinatePair([90 + 0.5/3600, 45]);
      assert.strictEqual(result, '45°N, 90°0′1″E');
    });
    it('formats 0°', () => {
      const result = _l10n.dmsCoordinatePair([0, 0]);
      assert.strictEqual(result, '0°, 0°');
    });
    it('formats negative value', () => {
      const result = _l10n.dmsCoordinatePair([-179, -90]);
      assert.strictEqual(result, '90°S, 179°W');
    });
    it('formats 180° lng, should be E or W', () => {
      // The longitude at this line can be given as either east or west.
      const result = _l10n.dmsCoordinatePair([180, 0]);
      assert.oneOf(result, ['0°, 180°W', '0°, 180E°']);
    });
    it('formats value over 90°lat or 180°lng', () => {
      const result = _l10n.dmsCoordinatePair([181, 91]);
      assert.oneOf(result, ['90°N, 179°W']);
    });
  });

});
