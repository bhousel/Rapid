//
// The difficult places that `bun run measure` and `bun run compare` visit
// (see `design/graphics-system.md`, plan step 2).
//
// OSM changes, so a place can stop being difficult. Add new ones here, and to the table in the design doc.
//

export interface Place {
  id: string;
  name: string;
  map: string;      // the `map=` value: zoom/lat/lon
  stresses: string;
}

export const PLACES: Place[] = [
  { id: 'seattle',       name: 'Downtown Seattle',               map: '17.50/47.61040/-122.33450', stresses: 'paths, dashes, buildings (the baseline)' },
  { id: 'nuevo-leon',    name: 'Nuevo León, Mexico',             map: '17.00/21.14900/-101.66980', stresses: 'address points' },
  { id: 'miami-dade',    name: 'Miami-Dade, Florida',            map: '19.00/25.53485/-80.37714',  stresses: 'lots of detail, fences' },
  { id: 'uzice',         name: 'Užice, Serbia',                  map: '16.00/43.8535/19.8433',     stresses: 'so much detail' },
  { id: 'bochum',        name: 'Bochum Hauptbahnhof, Germany',   map: '18.00/51.47836/7.22315',    stresses: 'very dense mapping, light directions' },
  { id: 'smith-point',   name: 'Smith Point Beach, New York',    map: '15.95/40.7335/-72.8624',    stresses: 'submarine cables' },
  { id: 'dekalb',        name: 'Market Square Plaza, DeKalb',    map: '17.50/41.94892/-88.72369',  stresses: 'every parking space mapped' },
  { id: 'staten-island', name: 'Staten Island Mall',             map: '16.50/40.58201/-74.16480',  stresses: 'every parking space mapped' },
  { id: 'grant-park',    name: 'Grant Park, Chicago',            map: '17.86/41.87606/-87.61865',  stresses: 'micromapping' },
  { id: 'golmud',        name: 'Golmud Solar Park, Qinghai',     map: '16.00/36.0677/100.2792',    stresses: 'solar panels, each one an area' },
  { id: 'jiangsu',       name: 'Factories, Jiangsu, China',      map: '15.00/34.54897/119.58936',  stresses: 'building detail' },
  { id: 'heybridge',     name: 'Heybridge, England',             map: '18.00/51.72229/0.67766',    stresses: 'fences' }
];
