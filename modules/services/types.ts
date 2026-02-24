/**
 * Type definitions for the services module.
 * These types represent the service instances container and constructor.
 * @module
 */

import type { Context } from '../Context.ts';
import type { AbstractSystem } from '../core/AbstractSystem.ts';

import type { EsriService } from './EsriService.ts';
import type { GeoScribbleService } from './GeoScribbleService.ts';
import type { KartaviewService } from './KartaviewService.ts';
import type { KeepRightService } from './KeepRightService.ts';
import type { MapillaryService } from './MapillaryService.ts';
import type { MapRouletteService } from './MapRouletteService.ts';
import type { MapWithAIService } from './MapWithAIService.ts';
import type { NominatimService } from './NominatimService.ts';
import type { NsiService } from './NsiService.ts';
import type { OsmService } from './OsmService.ts';
import type { OsmoseService } from './OsmoseService.ts';
import type { OsmWikibaseService } from './OsmWikibaseService.ts';
import type { OvertureService } from './OvertureService.ts';
import type { StreetsideService } from './StreetsideService.ts';
import type { TaginfoService } from './TaginfoService.ts';
import type { VectorTileService } from './VectorTileService.ts';
import type { WaybackService } from './WaybackService.ts';
import type { WikidataService } from './WikidataService.ts';
import type { WikipediaService } from './WikipediaService.ts';

/** A Service class constructor */
export type ServiceConstructor = new (context: Context) => AbstractSystem;

/**
 * Container interface for all service instances.
 * Services are accessed via `context.services[serviceID]`.
 * The index signature allows flexible access by service ID,
 * while specific properties provide type-safe access to known services.
 */
export interface Services {
  /** Index signature for flexible service access by ID */
  [key: ServiceID]: AbstractSystem | undefined;

  esri?: EsriService;
  geoscribble?: GeoScribbleService;
  kartaview?: KartaviewService;
  keepright?: KeepRightService;
  mapillary?: MapillaryService;
  maproulette?: MapRouletteService;
  mapwithai?: MapWithAIService;
  nominatim?: NominatimService;
  nsi?: NsiService;
  osm?: OsmService;
  osmose?: OsmoseService;
  osmwikibase?: OsmWikibaseService;
  overture?: OvertureService;
  streetside?: StreetsideService;
  taginfo?: TaginfoService;
  vectortile?: VectorTileService;
  wayback?: WaybackService;
  wikidata?: WikidataService;
  wikipedia?: WikipediaService;
}
