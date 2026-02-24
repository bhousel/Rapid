import { EsriService } from './EsriService.ts';
import { GeoScribbleService } from './GeoScribbleService.ts';
import { KartaviewService } from './KartaviewService.ts';
import { KeepRightService } from './KeepRightService.ts';
import { MapillaryService } from './MapillaryService.ts';
import { MapRouletteService } from './MapRouletteService.ts';
import { MapWithAIService } from './MapWithAIService.ts';
import { NominatimService } from './NominatimService.ts';
import { NsiService } from './NsiService.ts';
import { OsmService } from './OsmService.ts';
import { OsmoseService } from './OsmoseService.ts';
import { OsmWikibaseService } from './OsmWikibaseService.ts';
import { OvertureService } from './OvertureService.ts';
import { StreetsideService } from './StreetsideService.ts';
import { TaginfoService } from './TaginfoService.ts';
import { VectorTileService } from './VectorTileService.ts';
import { WaybackService } from './WaybackService.ts';
import { WikidataService } from './WikidataService.ts';
import { WikipediaService } from './WikipediaService.ts';

import type { ServiceConstructor } from './types.ts';

export {
  EsriService,
  GeoScribbleService,
  KartaviewService,
  KeepRightService,
  MapillaryService,
  MapRouletteService,
  MapWithAIService,
  NominatimService,
  NsiService,
  OsmService,
  OsmoseService,
  OsmWikibaseService,
  OvertureService,
  StreetsideService,
  TaginfoService,
  VectorTileService,
  WaybackService,
  WikidataService,
  WikipediaService
};

export type { Services, ServiceConstructor } from './types.ts';

/** Registry for available service constructors */
interface ServiceRegistry {
  available: Map<ServiceID, ServiceConstructor>;
}

// At init time, we will instantiate any that are in the 'available' collection.
export const services: ServiceRegistry = {
  available: new Map<ServiceID, ServiceConstructor>()
};

services.available.set('esri', EsriService);
services.available.set('geoscribble', GeoScribbleService);
services.available.set('kartaview', KartaviewService);
services.available.set('keepright', KeepRightService);
services.available.set('mapillary', MapillaryService);
services.available.set('maproulette', MapRouletteService);
services.available.set('mapwithai', MapWithAIService);
services.available.set('nominatim', NominatimService);
services.available.set('nsi', NsiService);
services.available.set('osm', OsmService);
services.available.set('osmose', OsmoseService);
services.available.set('osmwikibase', OsmWikibaseService);
services.available.set('overture', OvertureService);
services.available.set('streetside', StreetsideService);
services.available.set('taginfo', TaginfoService);
services.available.set('vectortile', VectorTileService);
services.available.set('wayback', WaybackService);
services.available.set('wikidata', WikidataService);
services.available.set('wikipedia', WikipediaService);
