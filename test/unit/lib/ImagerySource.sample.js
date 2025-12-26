
export const bingProps = {
  id: 'Bing',
  name: 'Bing Maps Aerial',
  type: 'bing',
  template: 'https://www.bing.com/maps',
  zoomExtent: [1, 22],
  description: 'Satellite and aerial imagery.',
  icon: 'https://osmlab.github.io/editor-layer-index/sources/world/Bing.png'
};

export const esriProps = {
  id: 'EsriWorldImagery',
  name: 'Esri World Imagery',
  type: 'tms',
  template: 'https://{switch:services,server}.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{zoom}/{y}/{x}',
  zoomExtent: [0, 22],
  terms_url: 'https://wiki.openstreetmap.org/wiki/Esri',
  terms_text: 'Terms & Feedback',
  description: 'Esri World Imagery',
  icon: 'https://osmlab.github.io/editor-layer-index/sources/world/EsriImageryClarity.png'
};

export const njProps = {
  id: 'test nj imagery',
  name: 'NJ 2015 Aerial Imagery',
  type: 'wms',
  template: 'https://img.nj.gov/imagerywms/Natural2015?LAYERS=Natural2015&STYLES=&FORMAT=image/png&SRS={proj}&WIDTH={width}&HEIGHT={height}&BBOX={bbox}&VERSION=1.1.1&SERVICE=WMS&REQUEST=GetMap',
  projection: 'EPSG:3857',
  endDate: '2015-05-03T00:00:00.000Z',
  startDate: '2015-03-29T00:00:00.000Z',
  zoomExtent: [3, 20],
  terms_url: 'https://njgin.state.nj.us/NJ_NJGINExplorer/ShowMetadata.jsp?docId=188471FF-2803-4145-A5AD-605DE86D3B4D',
  terms_text: 'NJ Office of Information Technology (NJOIT), Office of Geographic Information Systems (OGIS)',
  description: 'Digital orthophotography of New Jersey, Natural Color, 1 foot resolution',
  icon: 'https://njgin.nj.gov/njgin/assets/slices/njgin_logo.png',
  polygon: [[
    [-74.897, 38.835], [-74.0882, 39.649], [-73.860, 40.479], [-74.078, 40.535], [-73.828, 40.989],
    [-74.769, 41.413], [-75.410, 40.716], [-74.891, 40.175], [-75.789, 39.597], [-74.897, 38.835]
  ]]
};

export const bingStrings = {
  id: 'Bing',
  name: 'Bing Maps Aerial',
  description: 'Satellite and aerial imagery.'
};

export const esriStrings = {
  id: 'EsriWorldImagery',
  name: 'Esri World Imagery',
  description: 'Esri World Imagery'
};
